#!/usr/bin/env python3
"""
backup_restore.py - Minecraft Server Data & Recording Sync (Google Drive & XServer)
"""

import os
import sys
import shutil
import tarfile
import subprocess
from datetime import datetime
from pathlib import Path

SERVER_DIR = Path("/content/minecraft_server")
LOCAL_BACKUP_DIR = Path("/content/backup_temp")
GDRIVE_DIR = Path("/content/drive/MyDrive/Minecraft_Colab")
RECORDINGS_DIR = Path("/content/recordings")

# 保存対象のディレクトリ・ファイル
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

def restore_from_gdrive():
    """Google Driveから最新のワールドデータを復元"""
    if not GDRIVE_DIR.exists():
        log("Google Driveがマウントされていないか、Minecraft_Colabフォルダが見つかりません。新規ワールドで開始します。")
        return False

    latest_archive = None
    archives = sorted(GDRIVE_DIR.glob("mc_world_*.tar.gz"), key=os.path.getmtime, reverse=True)
    if archives:
        latest_archive = archives[0]
        log(f"Google Driveから最新アーカイブを検出: {latest_archive.name}")
        SERVER_DIR.mkdir(parents=True, exist_ok=True)
        with tarfile.open(latest_archive, "r:gz") as tar:
            try:
                tar.extractall(path=SERVER_DIR, filter='data')
            except TypeError:
                tar.extractall(path=SERVER_DIR)
        log("ワールドデータの復元が完了しました。")
        return True
    else:
        log("Google Drive内に既存のワールドアーカイブが見つかりません。新規作成します。")
        return False

def backup_to_gdrive():
    """Google Driveへワールドデータを保存"""
    if not SERVER_DIR.exists():
        log("サーバーディレクトリが存在しません。")
        return False

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

    # latestとしてもコピー
    shutil.copy2(archive_path, latest_path)
    log("Google Driveへのバックアップが完了しました。")

    # 録画動画の同期
    if RECORDINGS_DIR.exists():
        gdrive_rec_dir = GDRIVE_DIR / "recordings"
        gdrive_rec_dir.mkdir(parents=True, exist_ok=True)
        for mp4 in RECORDINGS_DIR.glob("*.mp4"):
            dest = gdrive_rec_dir / mp4.name
            if not dest.exists() or dest.stat().st_size != mp4.stat().st_size:
                log(f"録画動画をGoogle Driveに同期中: {mp4.name}")
                shutil.copy2(mp4, dest)
    return True

def sync_to_xserver(host, user, port, key_path, remote_dir):
    """XServerへrsyncで同期（オプション）"""
    if not host or not user:
        return
    log(f"XServer ({host}) へのバックアップ同期を開始...")
    archive_latest = GDRIVE_DIR / "mc_world_latest.tar.gz"
    if not archive_latest.exists():
        log("送信するアーカイブがありません。")
        return

    ssh_cmd = f"ssh -p {port} -i {key_path} -o StrictHostKeyChecking=no"
    cmd = [
        "rsync", "-avz", "-e", ssh_cmd,
        str(archive_latest),
        f"{user}@{host}:{remote_dir}/"
    ]
    try:
        subprocess.run(cmd, check=True)
        log("XServerへの同期が成功しました。")
    except Exception as e:
        log(f"XServer同期エラー: {e}")

if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "backup"
    if action == "restore":
        restore_from_gdrive()
    elif action == "backup":
        backup_to_gdrive()
        # XServer環境変数があれば同期
        x_host = os.environ.get("XSERVER_HOST")
        x_user = os.environ.get("XSERVER_USER")
        x_port = os.environ.get("XSERVER_PORT", "22")
        x_key = os.environ.get("XSERVER_KEY", "/root/.ssh/id_rsa")
        x_dir = os.environ.get("XSERVER_REMOTE_DIR", "~/minecraft_backup")
        if x_host and x_user:
            sync_to_xserver(x_host, x_user, x_port, x_key, x_dir)
    else:
        print(f"Unknown action: {action}")
