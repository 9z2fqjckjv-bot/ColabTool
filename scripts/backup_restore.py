#!/usr/bin/env python3
"""
backup_restore.py - Minecraft Server Data, POV Recordings & Action Diaries Sync
(Google Drive & XServer Dual-Storage Synchronization)
"""

import os
import sys
import shutil
import tarfile
import subprocess
from datetime import datetime
from pathlib import Path

SERVER_DIR = Path("/content/minecraft_server")
GDRIVE_DIR = Path("/content/drive/MyDrive/Minecraft_Colab")
RECORDINGS_DIR = Path("/content/recordings")
LOGS_DIR = Path("/content/logs")

# リポジトリ内のSSH秘密鍵の検索
POSSIBLE_KEY_PATHS = [
    Path("/content/ColabTool/nanndemoya26.key"),
    Path(__file__).resolve().parent.parent / "nanndemoya26.key",
    Path("/content/nanndemoya26.key"),
]

# XServer 接続情報 (nanndemoya26.key に紐づくホスト・ユーザー・ポート)
XSERVER_HOST = os.environ.get("XSERVER_HOST", "sv17151.xserver.jp")
XSERVER_USER = os.environ.get("XSERVER_USER", "nanndemoya26")
XSERVER_PORT = os.environ.get("XSERVER_PORT", "10022")
XSERVER_REMOTE_DIR = os.environ.get("XSERVER_REMOTE_DIR", "~/minecraft_backup")

SAVE_TARGETS = [
    "world",
    "world_nether",
    "world_the_end",
    "server.properties",
    "whitelist.json",
    "ops.json",
    "banned-players.json",
    "plugins"
]

def log(msg: str):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)

def find_xserver_key():
    for p in POSSIBLE_KEY_PATHS:
        if p.exists():
            try:
                os.chmod(p, 0o600)
            except Exception:
                pass
            return str(p)
    return None

def restore_from_storage():
    """Google DriveまたはXServerからワールドデータを復元"""
    SERVER_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Google Drive からの復元確認
    if GDRIVE_DIR.exists():
        archives = sorted(GDRIVE_DIR.glob("mc_world_*.tar.gz"), key=os.path.getmtime, reverse=True)
        if archives:
            latest_archive = archives[0]
            log(f"Google Driveからワールドアーカイブを復元中: {latest_archive.name}")
            with tarfile.open(latest_archive, "r:gz") as tar:
                try:
                    tar.extractall(path=SERVER_DIR, filter='data')
                except TypeError:
                    tar.extractall(path=SERVER_DIR)
            log("✅ Google Driveからワールド復元完了。")
            return True

    # 2. XServer からの復元確認 (Google Driveが空または無い場合)
    key_path = find_xserver_key()
    if key_path and XSERVER_HOST and XSERVER_USER:
        log(f"XServer ({XSERVER_HOST}) からの復元を試行中...")
        temp_tar = Path("/tmp/mc_restore_xserver.tar.gz")
        ssh_cmd = f"ssh -p {XSERVER_PORT} -i {key_path} -o StrictHostKeyChecking=no -o ConnectTimeout=8"
        scp_cmd = [
            "scp", "-P", str(XSERVER_PORT), "-i", key_path, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=8",
            f"{XSERVER_USER}@{XSERVER_HOST}:{XSERVER_REMOTE_DIR}/mc_world_latest.tar.gz",
            str(temp_tar)
        ]
        try:
            subprocess.run(scp_cmd, check=True)
            if temp_tar.exists() and temp_tar.stat().st_size > 0:
                with tarfile.open(temp_tar, "r:gz") as tar:
                    tar.extractall(path=SERVER_DIR)
                log("✅ XServerからワールド復元完了。")
                return True
        except Exception as e:
            log(f"XServerからの復元スキップ: {e}")

    log("新規ワールドでサーバーを開始します。")
    return False

def backup_to_gdrive():
    """Google Driveへワールド、録画動画、行動日誌を保存"""
    if not SERVER_DIR.exists():
        log("サーバーディレクトリが存在しません。")
        return None

    GDRIVE_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive_name = f"mc_world_{timestamp}.tar.gz"
    archive_path = GDRIVE_DIR / archive_name
    latest_path = GDRIVE_DIR / "mc_world_latest.tar.gz"

    log(f"ワールドデータを圧縮中: {archive_path.name}")
    with tarfile.open(archive_path, "w:gz") as tar:
        for target in SAVE_TARGETS:
            target_path = SERVER_DIR / target
            if target_path.exists():
                tar.add(target_path, arcname=target)
        # 行動日誌も含める
        if LOGS_DIR.exists():
            tar.add(LOGS_DIR, arcname="logs")

    shutil.copy2(archive_path, latest_path)
    log("✅ Google Driveへワールドアーカイブ保存完了。")

    # 録画動画の同期
    if RECORDINGS_DIR.exists():
        gdrive_rec_dir = GDRIVE_DIR / "recordings"
        gdrive_rec_dir.mkdir(parents=True, exist_ok=True)
        for mp4 in RECORDINGS_DIR.glob("*.mp4"):
            dest = gdrive_rec_dir / mp4.name
            if not dest.exists() or dest.stat().st_size != mp4.stat().st_size:
                log(f"録画動画をGoogle Driveに同期中: {mp4.name}")
                shutil.copy2(mp4, dest)

    # 行動日誌の同期
    if LOGS_DIR.exists():
        gdrive_logs_dir = GDRIVE_DIR / "logs"
        gdrive_logs_dir.mkdir(parents=True, exist_ok=True)
        for md in LOGS_DIR.glob("*.md"):
            dest = gdrive_logs_dir / md.name
            shutil.copy2(md, dest)

    return latest_path

def backup_to_xserver(archive_path: Path):
    """XServerへ nanndemoya26.key を利用して同期"""
    key_path = find_xserver_key()
    if not key_path:
        log("⚠️ nanndemoya26.key が見つからないため、XServer同期をスキップします。")
        return

    log(f"🚀 XServer ({XSERVER_HOST}) へGoogle Driveと同様のバックアップを同期開始...")
    ssh_opts = f"-p {XSERVER_PORT} -i {key_path} -o StrictHostKeyChecking=no -o ConnectTimeout=10"

    # リモートディレクトリの作成
    mkdir_cmd = f"ssh {ssh_opts} {XSERVER_USER}@{XSERVER_HOST} 'mkdir -p {XSERVER_REMOTE_DIR}/recordings {XSERVER_REMOTE_DIR}/logs'"
    subprocess.run(mkdir_cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # 1. ワールドアーカイブの送信
    if archive_path and archive_path.exists():
        scp_world = [
            "scp", "-P", str(XSERVER_PORT), "-i", key_path, "-o", "StrictHostKeyChecking=no",
            str(archive_path),
            f"{XSERVER_USER}@{XSERVER_HOST}:{XSERVER_REMOTE_DIR}/mc_world_latest.tar.gz"
        ]
        try:
            subprocess.run(scp_world, check=True)
            log("✅ XServerへワールドアーカイブ送信完了。")
        except Exception as e:
            log(f"⚠️ XServerワールド送信エラー: {e}")

    # 2. 録画動画の同期 (rsync)
    if RECORDINGS_DIR.exists() and any(RECORDINGS_DIR.glob("*.mp4")):
        rsync_rec = [
            "rsync", "-avz", "--timeout=30",
            "-e", f"ssh {ssh_opts}",
            f"{RECORDINGS_DIR}/",
            f"{XSERVER_USER}@{XSERVER_HOST}:{XSERVER_REMOTE_DIR}/recordings/"
        ]
        try:
            subprocess.run(rsync_rec, check=True)
            log("✅ XServerへ録画動画同期完了。")
        except Exception as e:
            log(f"⚠️ XServer録画同期エラー: {e}")

    # 3. 行動日誌の同期 (rsync)
    if LOGS_DIR.exists() and any(LOGS_DIR.glob("*.md")):
        rsync_logs = [
            "rsync", "-avz", "--timeout=15",
            "-e", f"ssh {ssh_opts}",
            f"{LOGS_DIR}/",
            f"{XSERVER_USER}@{XSERVER_HOST}:{XSERVER_REMOTE_DIR}/logs/"
        ]
        try:
            subprocess.run(rsync_logs, check=True)
            log("✅ XServerへ行動日誌同期完了。")
        except Exception as e:
            log(f"⚠️ XServer日誌同期エラー: {e}")

if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "backup"
    if action == "restore":
        restore_from_storage()
    elif action == "backup":
        latest_archive = backup_to_gdrive()
        if latest_archive:
            backup_to_xserver(latest_archive)
    else:
        print(f"Unknown action: {action}")
