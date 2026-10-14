#!/usr/bin/env python3
"""
backup_restore.py - Google Drive Save Data & Profile Synchronization for Gaming PC
(Syncs Minecraft worlds, Steam saves, Prism Launcher instances, Chrome profiles, and recordings)
"""

import os
import sys
import shutil
import tarfile
from datetime import datetime
from pathlib import Path

GDRIVE_BASE = Path("/content/drive/MyDrive/GamingPC")
GDRIVE_RECORDINGS = GDRIVE_BASE / "recordings"

# バックアップ対象パスの定義 (存在する場合のみアーカイブ)
TARGETS = [
    {"src": Path("/content/minecraft_server/world"), "arcname": "minecraft_server/world"},
    {"src": Path("/content/minecraft_server/world_nether"), "arcname": "minecraft_server/world_nether"},
    {"src": Path("/content/minecraft_server/world_the_end"), "arcname": "minecraft_server/world_the_end"},
    {"src": Path("/content/minecraft_server/server.properties"), "arcname": "minecraft_server/server.properties"},
    {"src": Path("/content/minecraft_server/plugins"), "arcname": "minecraft_server/plugins"},
    {"src": Path("/content/chrome_profiles"), "arcname": "chrome_profiles"},
    {"src": Path.home() / ".local/share/PrismLauncher/instances", "arcname": "prismlauncher_instances"},
    {"src": Path.home() / ".steam/steam/userdata", "arcname": "steam_userdata"},
    {"src": Path.home() / ".config/discord", "arcname": "config_discord"},
]

def log(msg: str):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)

def restore_from_storage():
    """Google Driveからセーブデータ・プロファイルを復元"""
    if not GDRIVE_BASE.exists():
        log("Google Driveのマウントまたはバックアップディレクトリが見つかりません。新規環境として開始します。")
        return False

    latest_archive = GDRIVE_BASE / "gaming_data_latest.tar.gz"
    if not latest_archive.exists():
        # アーカイブ一覧から最新を検索
        archives = sorted(GDRIVE_BASE.glob("gaming_data_*.tar.gz"), key=os.path.getmtime, reverse=True)
        if archives:
            latest_archive = archives[0]

    if latest_archive.exists():
        log(f"📦 Google Driveから最新バックアップを復元中: {latest_archive.name}")
        with tarfile.open(latest_archive, "r:gz") as tar:
            for member in tar.getmembers():
                dest_base = None
                rel_path = None

                if member.name.startswith("minecraft_server/"):
                    dest_base = Path("/content/minecraft_server")
                    rel_path = member.name[len("minecraft_server/"):]
                elif member.name.startswith("chrome_profiles"):
                    dest_base = Path("/content")
                    rel_path = member.name
                elif member.name.startswith("prismlauncher_instances"):
                    dest_base = Path.home() / ".local/share/PrismLauncher"
                    rel_path = "instances" + member.name[len("prismlauncher_instances"):]
                elif member.name.startswith("steam_userdata"):
                    dest_base = Path.home() / ".steam/steam"
                    rel_path = "userdata" + member.name[len("steam_userdata"):]
                elif member.name.startswith("config_discord"):
                    dest_base = Path.home() / ".config"
                    rel_path = "discord" + member.name[len("config_discord"):]

                if dest_base and rel_path:
                    target_file = dest_base / rel_path
                    target_file.parent.mkdir(parents=True, exist_ok=True)
                    if member.isdir():
                        target_file.mkdir(parents=True, exist_ok=True)
                    else:
                        f = tar.extractfile(member)
                        if f:
                            with open(target_file, "wb") as out:
                                shutil.copyfileobj(f, out)

        log("✅ セーブデータ・プロファイルの復元が完了しました。")
        return True

    log("復元対象のアーカイブがありませんでした。")
    return False

def backup_to_storage():
    """セーブデータ・プロファイル・録画動画をGoogle Driveへ完全同期"""
    if not Path("/content/drive/MyDrive").exists():
        log("⚠️ Google Driveがマウントされていないため、Drive同期をスキップします。")
        return None

    GDRIVE_BASE.mkdir(parents=True, exist_ok=True)
    GDRIVE_RECORDINGS.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive_name = f"gaming_data_{timestamp}.tar.gz"
    archive_path = GDRIVE_BASE / archive_name
    latest_path = GDRIVE_BASE / "gaming_data_latest.tar.gz"

    log(f"📦 セーブデータと設定を圧縮バックアップ中: {archive_name}")
    has_items = False
    with tarfile.open(archive_path, "w:gz") as tar:
        for t in TARGETS:
            src = t["src"]
            arcname = t["arcname"]
            if src.exists():
                tar.add(src, arcname=arcname)
                has_items = True

    if has_items:
        shutil.copy2(archive_path, latest_path)
        log("✅ セーブデータアーカイブをGoogle Driveへ保存しました。")
    else:
        log("保存対象のデータがまだありません。")

    # 画面収録動画 (MP4) の同期
    local_rec = Path("/content/recordings")
    if local_rec.exists():
        for mp4 in local_rec.glob("*.mp4"):
            dest_mp4 = GDRIVE_RECORDINGS / mp4.name
            if not dest_mp4.exists() or dest_mp4.stat().st_size != mp4.stat().st_size:
                log(f"🎥 録画ファイルを同期中: {mp4.name} ({mp4.stat().st_size / (1024*1024):.1f} MB)")
                shutil.copy2(mp4, dest_mp4)
        log("✅ 画面収録動画のGoogle Drive同期完了。")

    return latest_path

def backup_status():
    """現在のバックアップ状況を確認"""
    if not GDRIVE_BASE.exists():
        log("Google Drive同期ディレクトリが存在しません。")
        return

    archives = list(GDRIVE_BASE.glob("gaming_data_*.tar.gz"))
    recordings = list(GDRIVE_RECORDINGS.glob("*.mp4")) if GDRIVE_RECORDINGS.exists() else []

    log(f"Google Drive上のバックアップ数: {len(archives)} 個")
    for a in sorted(archives, key=os.path.getmtime, reverse=True)[:3]:
        log(f"  - {a.name} ({a.stat().st_size / (1024*1024):.2f} MB)")

    log(f"Google Drive上の録画動画数: {len(recordings)} 本")
    for r in sorted(recordings, key=os.path.getmtime, reverse=True)[:3]:
        log(f"  - {r.name} ({r.stat().st_size / (1024*1024):.2f} MB)")

if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "backup"
    if action == "restore":
        restore_from_storage()
    elif action == "backup":
        backup_to_storage()
    elif action == "status":
        backup_status()
    else:
        print(f"Unknown action: {action}")
