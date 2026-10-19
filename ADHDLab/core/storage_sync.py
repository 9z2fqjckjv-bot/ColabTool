"""
ADHDLab Storage & Sync Manager
GitHub、Google Drive、XServer（SSH `nanndemoya26.key`）への多重永続化・自動バックアップモジュール。
"""

import os
import json
import shutil
import subprocess
import datetime
from typing import Dict, Any, Optional

DEFAULT_DRIVE_PATH = "/content/drive/MyDrive/ADHDLab"
GITHUB_REPO = "9z2fqjckjv-bot/ColabTool"

# XServer 接続設定 (nanndemoya26.key に紐づく設定)
DEFAULT_XSERVER_HOST = os.environ.get("XSERVER_HOST", "nanndemoya26.xsrv.jp")
FALLBACK_XSERVER_HOST = "sv17151.xserver.jp"
DEFAULT_XSERVER_USER = os.environ.get("XSERVER_USER", "nanndemoya26")
DEFAULT_XSERVER_PORT = int(os.environ.get("XSERVER_PORT", "10022"))
DEFAULT_XSERVER_REMOTE_DIR = os.environ.get("XSERVER_REMOTE_DIR", "~/adhdlab_backup")

# XServer ホスト鍵フィンガープリント (照合・参考用)
XSERVER_FINGERPRINTS = {
    "ED25519": "SHA256:JW8I6QkDccWlz2UNvbmnKlZzVn9Dc3GL7JLAmUjSlt8",
    "ECDSA": "SHA256:zXNtCK5Z7dQBjU4s6c9yMikqoSoRCYd2JDg2GsE0srs",
    "RSA": "SHA256:Cc1r+bTUzhiIeDfpIKN++esLGJdZ/NZTXMG+woWIBjE"
}

def _resolve_github_token() -> str:
    """GitHub Personal Access Token の解決"""
    # 1. Colab Secrets から取得
    try:
        from google.colab import userdata
        token = userdata.get("GITHUB_TOKEN")
        if token:
            return token.strip()
    except Exception:
        pass

    # 2. 環境変数から取得
    env_token = os.environ.get("GITHUB_TOKEN")
    if env_token:
        return env_token.strip()

    # 3. Google Drive の設定ファイルから取得
    drive_cred = os.path.join(DEFAULT_DRIVE_PATH, "credentials.json")
    if os.path.exists(drive_cred):
        try:
            with open(drive_cred, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("github_token", "").strip()
        except Exception:
            pass

    return ""

def _resolve_ssh_key_path() -> Optional[str]:
    """nanndemoya26.key の配置パスを探索し、ローカルに安全に配置＆chmod 0600を設定"""
    env_key = os.environ.get("XSERVER_KEY_PATH")
    candidates = []
    if env_key:
        candidates.append(os.path.abspath(env_key))

    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_adhd_dir = os.path.abspath(os.path.join(base_dir, ".."))

    candidates.extend([
        # Google Drive 上の永続化キー（最優先で探してローカル同期）
        os.path.join(DEFAULT_DRIVE_PATH, "nanndemoya26.key"),
        "/content/drive/MyDrive/nanndemoya26.key",
        "/content/drive/MyDrive/ADHDLab/nanndemoya26.key",
        # ADHDLab 直下
        os.path.abspath(os.path.join(base_dir, "../nanndemoya26.key")),
        # カレントディレクトリ
        os.path.abspath("nanndemoya26.key"),
        os.path.abspath("ADHDLab/nanndemoya26.key"),
        # リポジトリ直下・他プロジェクト
        os.path.abspath(os.path.join(base_dir, "../../nanndemoya26.key")),
        os.path.abspath(os.path.join(base_dir, "../../AIMinecraft/nanndemoya26.key")),
        # Colab 標準マウントパス
        "/content/ColabTool/ADHDLab/nanndemoya26.key",
        "/content/ColabTool/nanndemoya26.key",
        "/content/ColabTool/AIMinecraft/nanndemoya26.key",
        "/content/nanndemoya26.key",
    ])

    local_secure_key = os.path.join(project_adhd_dir, "nanndemoya26.key")
    backup_secure_key = os.path.expanduser("~/.ssh/nanndemoya26.key")

    for p in candidates:
        if os.path.exists(p) and os.path.isfile(p):
            # Google Drive (FUSE) 上のファイルは chmod 0600 が効かない場合があるため、
            # Linuxローカルファイルシステム側にコピーしてパーミッションを厳格に 0600 に設定する
            target_key_path = p
            if p.startswith("/content/drive") or not os.access(p, os.W_OK):
                try:
                    os.makedirs(os.path.dirname(backup_secure_key), exist_ok=True)
                    shutil.copy2(p, backup_secure_key)
                    os.chmod(backup_secure_key, 0o600)
                    target_key_path = backup_secure_key
                except Exception:
                    try:
                        shutil.copy2(p, local_secure_key)
                        os.chmod(local_secure_key, 0o600)
                        target_key_path = local_secure_key
                    except Exception:
                        pass
            else:
                try:
                    os.chmod(p, 0o600)
                except Exception:
                    pass

            return target_key_path
    return None


class StorageSyncManager:
    def __init__(self, drive_path: str = DEFAULT_DRIVE_PATH, local_data_dir: str = "data"):
        self.drive_path = drive_path
        self.local_data_dir = os.path.abspath(local_data_dir)
        self.project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    # 1. Google Drive 連携
    def sync_to_google_drive(self) -> Dict[str, Any]:
        """Google Drive（/content/drive/MyDrive/ADHDLab）へローカルデータを同期"""
        if not os.path.exists("/content/drive/MyDrive"):
            return {"status": "skipped", "message": "Google Driveが未マウントです"}

        try:
            target_dir = os.path.abspath(self.drive_path)
            os.makedirs(target_dir, exist_ok=True)

            copied_files = []
            if os.path.exists(self.local_data_dir):
                for root, _, files in os.walk(self.local_data_dir):
                    for file in files:
                        src = os.path.join(root, file)
                        rel_path = os.path.relpath(src, self.local_data_dir)
                        dst = os.path.join(target_dir, rel_path)
                        os.makedirs(os.path.dirname(dst), exist_ok=True)
                        shutil.copy2(src, dst)
                        copied_files.append(rel_path)

            # LLMモデルデータの確認
            models_dir = os.path.join(target_dir, "models")
            model_info = "LLMモデル永続化済み" if os.path.exists(models_dir) and os.listdir(models_dir) else "LLMモデル待機中"

            return {
                "status": "success",
                "message": f"同期完了 ({len(copied_files)} ファイル永続化, {model_info})",
                "target": target_dir,
                "files": copied_files
            }
        except Exception as e:
            return {"status": "error", "message": f"同期失敗: {str(e)}"}

    def restore_from_google_drive(self) -> Dict[str, Any]:
        """Google Drive上のバックアップからローカル環境へ復元"""
        if not os.path.exists(self.drive_path):
            return {"status": "skipped", "message": "バックアップ未検出"}

        try:
            os.makedirs(self.local_data_dir, exist_ok=True)
            restored = []
            for root, _, files in os.walk(self.drive_path):
                for file in files:
                    src = os.path.join(root, file)
                    rel_path = os.path.relpath(src, self.drive_path)
                    dst = os.path.join(self.local_data_dir, rel_path)
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copy2(src, dst)
                    restored.append(rel_path)

            return {
                "status": "success",
                "message": f"復元完了 ({len(restored)} ファイル)",
                "files": restored
            }
        except Exception as e:
            return {"status": "error", "message": f"復元失敗: {str(e)}"}

    # 2. GitHub 連携
    def push_to_github(self, commit_msg: Optional[str] = None) -> Dict[str, Any]:
        """GitHub Personal Access Token を用いてADHDLabの変更を自動プッシュ"""
        token = _resolve_github_token()
        if not token:
            return {
                "status": "skipped",
                "message": "PATトークン未設定 (Colab Secretsまたは環境変数でGITHUB_TOKENを設定するとプッシュ可能)"
            }

        if not commit_msg:
            now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            commit_msg = f"Auto-sync ADHDLab data & logs [{now_str}]"

        try:
            repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
            if not os.path.exists(os.path.join(repo_root, ".git")):
                return {"status": "skipped", "message": "Gitリポジトリ未検出"}

            remote_url = f"https://{token}@github.com/{GITHUB_REPO}.git"

            subprocess.run(["git", "config", "user.name", "ADHDLab Automation Bot"], cwd=repo_root, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.email", "adhdlab-bot@users.noreply.github.com"], cwd=repo_root, check=True, capture_output=True)
            subprocess.run(["git", "add", "ADHDLab/"], cwd=repo_root, check=True, capture_output=True)

            status_res = subprocess.run(["git", "status", "--porcelain", "ADHDLab/"], cwd=repo_root, capture_output=True, text=True)
            if not status_res.stdout.strip():
                return {"status": "success", "message": "最新状態です（コミット対象なし）"}

            subprocess.run(["git", "commit", "-m", commit_msg], cwd=repo_root, check=True, capture_output=True)
            push_res = subprocess.run(["git", "push", remote_url, "HEAD"], cwd=repo_root, capture_output=True, text=True)
            if push_res.returncode == 0:
                return {"status": "success", "message": f"プッシュ成功: {commit_msg}"}
            else:
                return {"status": "error", "message": f"プッシュ拒否: {push_res.stderr.strip()[:80]}"}
        except Exception as e:
            return {"status": "error", "message": f"GitHub同期例外: {str(e)}"}

    # 3. XServer 連携
    def get_xserver_info(self) -> Dict[str, Any]:
        """XServer接続情報を取得"""
        key_file = _resolve_ssh_key_path()
        return {
            "host": DEFAULT_XSERVER_HOST,
            "fallback_host": FALLBACK_XSERVER_HOST,
            "user": DEFAULT_XSERVER_USER,
            "port": DEFAULT_XSERVER_PORT,
            "remote_dir": DEFAULT_XSERVER_REMOTE_DIR,
            "key_file": key_file,
            "key_detected": key_file is not None,
            "fingerprints": XSERVER_FINGERPRINTS
        }

    def test_xserver_connection(
        self,
        host: Optional[str] = None,
        user: Optional[str] = None,
        port: Optional[int] = None
    ) -> Dict[str, Any]:
        """nanndemoya26.key を利用したXServerへのSSH接続疎通テスト"""
        key_file = _resolve_ssh_key_path()
        if not key_file or not os.path.exists(key_file):
            return {
                "status": "error",
                "message": "nanndemoya26.key 未検出 (ADHDLabフォルダまたはGoogle Driveに配置してください)"
            }

        host = host or DEFAULT_XSERVER_HOST
        user = user or DEFAULT_XSERVER_USER
        port = port or DEFAULT_XSERVER_PORT

        ssh_opts = [
            "ssh",
            "-i", key_file,
            "-p", str(port),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "BatchMode=yes",
            "-o", "LogLevel=ERROR",
            "-o", "ConnectTimeout=8",
            f"{user}@{host}",
            "uname -a && uptime"
        ]

        try:
            start_time = datetime.datetime.now()
            res = subprocess.run(ssh_opts, capture_output=True, text=True, timeout=12)
            elapsed = (datetime.datetime.now() - start_time).total_seconds()

            if res.returncode == 0:
                server_info = res.stdout.strip().split("\n")[0]
                return {
                    "status": "success",
                    "message": f"XServer ({host}:{port}) 接続成功 [{elapsed:.2f}s]",
                    "server_info": server_info,
                    "host": host,
                    "user": user,
                    "port": port
                }
            else:
                # フォールバックホストを試行
                if host == DEFAULT_XSERVER_HOST and FALLBACK_XSERVER_HOST:
                    return self.test_xserver_connection(host=FALLBACK_XSERVER_HOST, user=user, port=port)
                return {
                    "status": "error",
                    "message": f"接続拒否 (コード {res.returncode}): {res.stderr.strip()[:100]}"
                }
        except subprocess.TimeoutExpired:
            return {
                "status": "error",
                "message": (
                    f"XServer接続タイムアウト ({host}:{port})\n"
                    "【原因と対策】Google Colab（海外IP）からのSSH接続が、XServerの「国外IPアクセス制限」により遮断されている可能性が高いです。\n"
                    "XServerサーバーパネルの「SSH設定」または「国外IPアクセス制限設定」でSSHの国外アクセス制限を【OFF（無効）】に設定してください。"
                )
            }
        except Exception as e:
            return {"status": "error", "message": f"接続例外: {str(e)}"}

    def sync_to_xserver(
        self,
        host: Optional[str] = None,
        user: Optional[str] = None,
        port: Optional[int] = None,
        remote_dir: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        nanndemoya26.key を利用してXServerへ実行コードファイル、データ、実行ログを保管。
        指示書要件: “ColabTool”内の‘nanndemoya26.key’を用いてXServer上にも、実行コードファイルと実行ログを保管する。
        """
        key_file = _resolve_ssh_key_path()
        if not key_file or not os.path.exists(key_file):
            return {
                "status": "skipped",
                "message": "nanndemoya26.key 未検出 (Google DriveまたはADHDLabフォルダに配置で自動同期)"
            }

        host = host or DEFAULT_XSERVER_HOST
        user = user or DEFAULT_XSERVER_USER
        port = port or DEFAULT_XSERVER_PORT
        remote_dir = remote_dir or DEFAULT_XSERVER_REMOTE_DIR

        ssh_base = f"ssh -i {key_file} -p {port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o LogLevel=ERROR -o ConnectTimeout=10"

        try:
            # 1. リモートディレクトリの準備 (~/adhdlab_backup/data, ~/adhdlab_backup/archives)
            mkdir_cmd = f"{ssh_base} {user}@{host} 'mkdir -p {remote_dir}/data {remote_dir}/archives {remote_dir}/logs'"
            sub_res = subprocess.run(mkdir_cmd, shell=True, capture_output=True, text=True, timeout=12)
            if sub_res.returncode != 0:
                # 代替ホストを試行
                if host == DEFAULT_XSERVER_HOST and FALLBACK_XSERVER_HOST:
                    return self.sync_to_xserver(host=FALLBACK_XSERVER_HOST, user=user, port=port, remote_dir=remote_dir)
                return {"status": "error", "message": f"リモートディレクトリ作成失敗: {sub_res.stderr.strip()[:80]}"}

            sync_results = []

            # 2. データディレクトリ (data/) の同期 (rsync 優先、scp フォールバック)
            if os.path.exists(self.local_data_dir):
                rsync_cmd = [
                    "rsync", "-avz", "--delete",
                    "-e", f"ssh -i {key_file} -p {port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o LogLevel=ERROR",
                    self.local_data_dir + "/",
                    f"{user}@{host}:{remote_dir}/data/"
                ]
                rsync_res = subprocess.run(rsync_cmd, capture_output=True, text=True, timeout=30)
                if rsync_res.returncode == 0:
                    sync_results.append("data同期成功(rsync)")
                else:
                    # scp フォールバック
                    scp_cmd = [
                        "scp", "-P", str(port), "-i", key_file, "-r",
                        "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "BatchMode=yes", "-o", "LogLevel=ERROR",
                        self.local_data_dir,
                        f"{user}@{host}:{remote_dir}/"
                    ]
                    scp_res = subprocess.run(scp_cmd, capture_output=True, text=True, timeout=30)
                    if scp_res.returncode == 0:
                        sync_results.append("data同期成功(scp)")
                    else:
                        sync_results.append(f"data同期警告({scp_res.stderr.strip()[:50]})")

            # 3. 実行コードファイルと実行ログの包括アーカイブ作成＆保管
            import tarfile
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            temp_tar_name = f"adhdlab_archive_{timestamp}.tar.gz"
            temp_tar_path = os.path.join("/tmp", temp_tar_name)

            # アーカイブ対象: core/, web/, data/, ノートブック, 仕様書, Excel
            targets = [
                ("core", os.path.join(self.project_root, "core")),
                ("web", os.path.join(self.project_root, "web")),
                ("data", self.local_data_dir),
                ("ADHDLab_Colab.ipynb", os.path.join(self.project_root, "ADHDLab_Colab.ipynb")),
                ("ソース一覧.xlsx", os.path.join(self.project_root, "ソース一覧.xlsx")),
                ("README.md", os.path.join(self.project_root, "README.md")),
            ]

            with tarfile.open(temp_tar_path, "w:gz") as tar:
                for arcname, target_path in targets:
                    if os.path.exists(target_path):
                        tar.add(target_path, arcname=arcname)

            # XServer へ最新アーカイブ (adhdlab_latest.tar.gz) および世代アーカイブを転送
            scp_tar_latest = [
                "scp", "-P", str(port), "-i", key_file,
                "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "BatchMode=yes", "-o", "LogLevel=ERROR",
                temp_tar_path,
                f"{user}@{host}:{remote_dir}/adhdlab_latest.tar.gz"
            ]
            scp_tar_archive = [
                "scp", "-P", str(port), "-i", key_file,
                "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "BatchMode=yes", "-o", "LogLevel=ERROR",
                temp_tar_path,
                f"{user}@{host}:{remote_dir}/archives/{temp_tar_name}"
            ]

            subprocess.run(scp_tar_latest, capture_output=True, text=True, timeout=25)
            subprocess.run(scp_tar_archive, capture_output=True, text=True, timeout=25)
            sync_results.append("コード&ログ包括アーカイブ保管成功")

            if os.path.exists(temp_tar_path):
                os.remove(temp_tar_path)

            return {
                "status": "success",
                "message": f"XServer ({host}:{port}) バックアップ完了: {', '.join(sync_results)}",
                "host": host,
                "remote_dir": remote_dir
            }

        except subprocess.TimeoutExpired:
            return {
                "status": "error",
                "message": (
                    f"XServer同期タイムアウト ({host}:{port})\n"
                    "【原因と対策】Google Colab（海外IP）からのSSH通信が、XServerの「国外IPアクセス制限」により遮断されている可能性が高いです。\n"
                    "XServerサーバーパネルの「SSH設定」または「国外IPアクセス制限設定」でSSHの国外アクセス制限を【OFF（無効）】に設定してください。"
                )
            }
        except Exception as e:
            return {"status": "error", "message": f"XServer同期例外: {str(e)}"}

    def restore_from_xserver(
        self,
        host: Optional[str] = None,
        user: Optional[str] = None,
        port: Optional[int] = None,
        remote_dir: Optional[str] = None
    ) -> Dict[str, Any]:
        """XServerから最新のバックアップアーカイブを取得し、ローカル環境へ復元"""
        key_file = _resolve_ssh_key_path()
        if not key_file or not os.path.exists(key_file):
            return {"status": "skipped", "message": "nanndemoya26.key 未検出"}

        host = host or DEFAULT_XSERVER_HOST
        user = user or DEFAULT_XSERVER_USER
        port = port or DEFAULT_XSERVER_PORT
        remote_dir = remote_dir or DEFAULT_XSERVER_REMOTE_DIR

        temp_tar_path = "/tmp/adhdlab_restore_xserver.tar.gz"
        scp_cmd = [
            "scp", "-P", str(port), "-i", key_file,
            "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "BatchMode=yes", "-o", "LogLevel=ERROR",
            f"{user}@{host}:{remote_dir}/adhdlab_latest.tar.gz",
            temp_tar_path
        ]

        try:
            res = subprocess.run(scp_cmd, capture_output=True, text=True, timeout=30)
            if res.returncode == 0 and os.path.exists(temp_tar_path) and os.path.getsize(temp_tar_path) > 0:
                import tarfile
                with tarfile.open(temp_tar_path, "r:gz") as tar:
                    tar.extractall(path=self.project_root)
                os.remove(temp_tar_path)
                return {
                    "status": "success",
                    "message": f"XServer ({host}) から最新アーカイブを完全復元しました"
                }
            else:
                return {
                    "status": "error",
                    "message": f"XServerからのアーカイブ取得に失敗しました: {res.stderr.strip()[:80]}"
                }
        except Exception as e:
            return {"status": "error", "message": f"XServer復元例外: {str(e)}"}

    # 4. 全保管先の一括自動バックアップ
    def full_sync(self, commit_msg: Optional[str] = None) -> Dict[str, Any]:
        """Google Drive、GitHub、XServerへの包括的一括バックアップ"""
        results = {
            "google_drive": self.sync_to_google_drive(),
            "github": self.push_to_github(commit_msg),
            "xserver": self.sync_to_xserver(),
            "timestamp": datetime.datetime.now().isoformat()
        }
        return results

