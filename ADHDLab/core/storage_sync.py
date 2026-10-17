"""
ADHDLab Storage & Sync Manager
GitHub、Google Drive、XServer（SSH `nanndemoya26.key`）への多重永続化・自動バックアップモジュール。
"""

import os
import shutil
import subprocess
import datetime
from typing import Dict, Any, Optional

# トークンの安全な取得（Colab Secrets または 環境変数）
def _get_github_token() -> str:
    try:
        from google.colab import userdata
        token = userdata.get("GITHUB_TOKEN")
        if token:
            return token
    except Exception:
        pass
    return os.environ.get("GITHUB_TOKEN", "")

GITHUB_REPO = "9z2fqjckjv-bot/ColabTool"
DEFAULT_DRIVE_PATH = "/content/drive/MyDrive/ADHDLab"
SSH_KEY_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "../nanndemoya26.key"))


class StorageSyncManager:
    def __init__(self, drive_path: str = DEFAULT_DRIVE_PATH, local_data_dir: str = "data"):
        self.drive_path = drive_path
        self.local_data_dir = os.path.abspath(local_data_dir)
        self.github_token = _get_github_token()

    # 1. Google Drive 連携
    def sync_to_google_drive(self) -> Dict[str, Any]:
        """Google Drive（/content/drive/MyDrive/ADHDLab）へローカルデータを同期"""
        if not os.path.exists("/content/drive/MyDrive"):
            return {"status": "skipped", "message": "Google Driveがマウントされていません (/content/drive/MyDrive 未検出)"}

        try:
            target_dir = os.path.abspath(self.drive_path)
            os.makedirs(target_dir, exist_ok=True)

            # SQLite DB や Excel、ログファイルをコピー
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

            return {
                "status": "success",
                "message": f"Google Driveへ同期完了 ({len(copied_files)} ファイル)",
                "target": target_dir,
                "files": copied_files
            }
        except Exception as e:
            return {"status": "error", "message": f"Google Drive同期失敗: {str(e)}"}

    def restore_from_google_drive(self) -> Dict[str, Any]:
        """Google Drive上のバックアップからローカル環境へ復元"""
        if not os.path.exists(self.drive_path):
            return {"status": "skipped", "message": "Google Drive上のバックアップが存在しません"}

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
                "message": f"Google Driveから復元完了 ({len(restored)} ファイル)",
                "files": restored
            }
        except Exception as e:
            return {"status": "error", "message": f"復元失敗: {str(e)}"}

    # 2. GitHub 連携
    def push_to_github(self, commit_msg: Optional[str] = None) -> Dict[str, Any]:
        """
        GitHub PATトークンを用いて ADHDLab ディレクトリの変更をリポジトリへ自動プッシュ。
        """
        if not commit_msg:
            now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            commit_msg = f"Auto-sync ADHDLab data & logs [{now_str}]"

        try:
            repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
            if not os.path.exists(os.path.join(repo_root, ".git")):
                return {"status": "skipped", "message": "Gitリポジトリが見つかりません"}

            # リモートURLの認証トークン組み込み
            remote_url = f"https://{self.github_token}@github.com/{GITHUB_REPO}.git"

            # git commands
            subprocess.run(["git", "config", "user.name", "ADHDLab Automation Bot"], cwd=repo_root, check=True)
            subprocess.run(["git", "config", "user.email", "adhdlab-bot@users.noreply.github.com"], cwd=repo_root, check=True)
            subprocess.run(["git", "add", "ADHDLab/"], cwd=repo_root, check=True)

            status_res = subprocess.run(["git", "status", "--porcelain", "ADHDLab/"], cwd=repo_root, capture_output=True, text=True)
            if not status_res.stdout.strip():
                return {"status": "success", "message": "変更点はありません（プッシュ不要）"}

            subprocess.run(["git", "commit", "-m", commit_msg], cwd=repo_root, check=True)
            subprocess.run(["git", "push", remote_url, "HEAD"], cwd=repo_root, check=True)

            return {"status": "success", "message": f"GitHubへプッシュ成功: {commit_msg}"}
        except subprocess.CalledProcessError as e:
            return {"status": "error", "message": f"Gitコマンドエラー: {e}"}
        except Exception as e:
            return {"status": "error", "message": f"GitHub同期例外: {str(e)}"}

    # 3. XServer 連携
    def sync_to_xserver(self, host: str = "sv14013.xserver.jp", user: str = "nanndemoya26", remote_dir: str = "~/adhdlab_backup") -> Dict[str, Any]:
        """
        nanndemoya26.key を利用してXServerへrsync/scpバックアップ
        """
        key_file = SSH_KEY_PATH
        if not os.path.exists(key_file):
            # ADHDLab直下やカレントディレクトリの探索
            cand = os.path.abspath("nanndemoya26.key")
            if os.path.exists(cand):
                key_file = cand
            else:
                return {"status": "skipped", "message": f"SSH秘密鍵 nanndemoya26.key が見つかりません ({key_file})"}

        try:
            # 秘密鍵のパーミッション設定
            os.chmod(key_file, 0o600)

            # scp または rsync による転送
            cmd = [
                "rsync", "-avz", "-e", f"ssh -i {key_file} -o StrictHostKeyChecking=no -p 10022",
                self.local_data_dir + "/",
                f"{user}@{host}:{remote_dir}/"
            ]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if res.returncode == 0:
                return {"status": "success", "message": "XServerへのrsyncバックアップが完了しました"}
            else:
                return {"status": "error", "message": f"XServerバックアップ失敗: {res.stderr}"}
        except Exception as e:
            return {"status": "error", "message": f"XServer同期例外: {str(e)}"}

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
