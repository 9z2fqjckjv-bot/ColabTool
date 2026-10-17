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
    """nanndemoya26.key の配置パスを探索"""
    candidates = [
        # カレント/プロジェクト内
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../nanndemoya26.key")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../AIMinecraft/nanndemoya26.key")),
        "/content/ColabTool/ADHDLab/nanndemoya26.key",
        "/content/ColabTool/AIMinecraft/nanndemoya26.key",
        # Google Drive 上のバックアップキー
        os.path.join(DEFAULT_DRIVE_PATH, "nanndemoya26.key")
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                os.chmod(p, 0o600)
            except Exception:
                pass
            return p
    return None


class StorageSyncManager:
    def __init__(self, drive_path: str = DEFAULT_DRIVE_PATH, local_data_dir: str = "data"):
        self.drive_path = drive_path
        self.local_data_dir = os.path.abspath(local_data_dir)

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
    def sync_to_xserver(self, host: str = "sv14013.xserver.jp", user: str = "nanndemoya26", remote_dir: str = "~/adhdlab_backup") -> Dict[str, Any]:
        """nanndemoya26.key を利用してXServerへrsyncバックアップ"""
        key_file = _resolve_ssh_key_path()
        if not key_file or not os.path.exists(key_file):
            return {
                "status": "skipped",
                "message": "nanndemoya26.key 未検出 (Google DriveまたはADHDLabフォルダに配置で自動同期)"
            }

        try:
            cmd = [
                "rsync", "-avz",
                "-e", f"ssh -i {key_file} -o StrictHostKeyChecking=no -o ConnectTimeout=5 -p 10022",
                self.local_data_dir + "/",
                f"{user}@{host}:{remote_dir}/"
            ]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            if res.returncode == 0:
                return {"status": "success", "message": "XServerへのバックアップ完了"}
            else:
                return {"status": "error", "message": f"同期失敗 (終了コード {res.returncode})"}
        except subprocess.TimeoutExpired:
            return {"status": "error", "message": "接続タイムアウト (ポート10022)"}
        except Exception as e:
            return {"status": "error", "message": f"例外: {str(e)}"}

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
