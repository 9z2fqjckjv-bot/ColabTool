#!/usr/bin/env python3
"""
backup_restore.py - Minecraft Server Data, Deep Database & Action Diaries Sync
(改善指示書v2準拠: Google Drive & XServer 二重同期 & 高速キャッシュ復元)
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
GDRIVE_CACHE_DIR = Path("/content/drive/MyDrive/Minecraft_Colab_Cache")
LOGS_DIR = Path("/content/logs")
REPO_DIR = Path(__file__).resolve().parent.parent

POSSIBLE_KEY_PATHS = [
    REPO_DIR / "nanndemoya26.key",
    Path("/content/ColabTool/nanndemoya26.key"),
    Path("/content/nanndemoya26.key"),
]

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

OLD_4AI_LOGS = [
    "ChatGPT_diary.md",
    "Claude_diary.md",
    "Gemini_diary.md",
    "Grok_diary.md",
    "survival_diary_combined.md"
]

def purge_old_4ai_logs():
    """旧4AI体制の日誌および統合ログをローカルとGoogle Driveの両方から完全に消去"""
    for log_dir in [LOGS_DIR, SERVER_DIR / "logs", GDRIVE_DIR / "logs"]:
        if log_dir.exists():
            for fname in OLD_4AI_LOGS:
                fpath = log_dir / fname
                if fpath.exists():
                    try:
                        fpath.unlink()
                        log(f"🗑️ 旧日誌を完全消去: {fpath}")
                    except Exception:
                        pass

def enforce_server_config():
    """復元されたserver.propertiesのmax-players=100を強制維持"""
    sp_path = SERVER_DIR / "server.properties"
    if sp_path.exists():
        try:
            content = sp_path.read_text(encoding="utf-8")
            lines = content.splitlines()
            new_lines = []
            has_max = False
            for line in lines:
                if line.startswith("max-players="):
                    new_lines.append("max-players=100")
                    has_max = True
                else:
                    new_lines.append(line)
            if not has_max:
                new_lines.append("max-players=100")
            sp_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
            log("🛡️ server.properties の max-players=100 を確認・維持しました。")
        except Exception as e:
            log(f"⚠️ server.properties 更新警告: {e}")

def clean_old_world_and_logs():
    """Minecraftのワールドを再生成し、既存の行動日誌やログを削除"""
    log("🧹 ワールド再生成指示に基づき、旧ワールドデータおよび旧日誌・ログを完全初期化中...")
    for w in ["world", "world_nether", "world_the_end"]:
        p = SERVER_DIR / w
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)
    if LOGS_DIR.exists():
        for f in LOGS_DIR.glob("*"):
            try:
                if f.is_file(): f.unlink()
                elif f.is_dir(): shutil.rmtree(f)
            except Exception: pass
    # Google Drive 側の旧ログも消去
    purge_old_4ai_logs()
    log("✅ ワールド初期化完了。新規ワールドが自動生成されます。")

def restore_from_storage():
    """Google DriveまたはXServerからワールドデータを復元 (FORCE_NEW_WORLD=1のときは新規生成)"""
    SERVER_DIR.mkdir(parents=True, exist_ok=True)

    if os.environ.get("FORCE_NEW_WORLD", "0") == "1":
        clean_old_world_and_logs()
        return False

    restored = False
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
            restored = True

    # 2. XServer からの復元確認
    if not restored:
        key_path = find_xserver_key()
        if key_path and XSERVER_HOST and XSERVER_USER:
            log(f"XServer ({XSERVER_HOST}) からの復元を試行中...")
            temp_tar = Path("/tmp/mc_restore_xserver.tar.gz")
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
                    restored = True
            except Exception as e:
                log(f"XServerからの復元スキップ: {e}")

    # 復元後の整合性担保 (旧ログ排除 & 人数上限100保証)
    purge_old_4ai_logs()
    enforce_server_config()

    if not restored:
        log("新規ワールドでサーバーを開始します。")
    return restored

def restore_cache():
    """node_modulesやLLMキャッシュを高速復元して起動時間を短縮"""
    if not GDRIVE_CACHE_DIR.exists():
        return

    node_modules_tar = GDRIVE_CACHE_DIR / "bot_node_modules.tar.gz"
    bot_dir = REPO_DIR / "bot"
    if node_modules_tar.exists() and not (bot_dir / "node_modules").exists():
        log("📦 Google Driveキャッシュから bot/node_modules を高速復元中...")
        try:
            with tarfile.open(node_modules_tar, "r:gz") as tar:
                tar.extractall(path=bot_dir)
            log("✅ node_modules 復元完了 (npm installをスキップ)")
        except Exception as e:
            log(f"キャッシュ復元警告: {e}")

    # Ollamaモデルキャッシュ
    ollama_models_tar = GDRIVE_CACHE_DIR / "ollama_models.tar.gz"
    ollama_dir = Path("/root/.ollama")
    if ollama_models_tar.exists() and not (ollama_dir / "models").exists():
        log("📦 Google Driveキャッシュから Qwen 2.5 モデルデータを高速展開中...")
        try:
            ollama_dir.mkdir(parents=True, exist_ok=True)
            with tarfile.open(ollama_models_tar, "r:gz") as tar:
                tar.extractall(path=ollama_dir)
            log("✅ Qwen 2.5 モデル展開完了 (ダウンロード不要)")
        except Exception as e:
            log(f"Ollamaキャッシュ復元警告: {e}")

def save_cache():
    """再インストールの時間を削減するためキャッシュをGoogle Driveへ保存"""
    GDRIVE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    bot_dir = REPO_DIR / "bot"
    node_modules_dir = bot_dir / "node_modules"

    if node_modules_dir.exists() and not (GDRIVE_CACHE_DIR / "bot_node_modules.tar.gz").exists():
        log("💾 bot/node_modules をGoogle Driveキャッシュへ保存中...")
        try:
            tar_path = GDRIVE_CACHE_DIR / "bot_node_modules.tar.gz"
            with tarfile.open(tar_path, "w:gz") as tar:
                tar.add(node_modules_dir, arcname="node_modules")
            log("✅ node_modules キャッシュ保存完了")
        except Exception as e:
            log(f"キャッシュ保存エラー: {e}")

    ollama_models = Path("/root/.ollama/models")
    if ollama_models.exists() and not (GDRIVE_CACHE_DIR / "ollama_models.tar.gz").exists():
        log("💾 Qwen 2.5 モデルデータをGoogle Driveキャッシュへ保存中...")
        try:
            tar_path = GDRIVE_CACHE_DIR / "ollama_models.tar.gz"
            with tarfile.open(tar_path, "w:gz") as tar:
                tar.add(ollama_models, arcname="models")
            log("✅ Qwen 2.5 モデルキャッシュ保存完了")
        except Exception as e:
            log(f"Ollamaキャッシュ保存エラー: {e}")

def backup_to_gdrive():
    """Google Driveへワールド、深部データベース、行動日誌を保存"""
    if not SERVER_DIR.exists():
        log("サーバーディレクトリが存在しません。")
        return None

    purge_old_4ai_logs()
    GDRIVE_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive_name = f"mc_world_{timestamp}.tar.gz"
    archive_path = GDRIVE_DIR / archive_name
    latest_path = GDRIVE_DIR / "mc_world_latest.tar.gz"

    log(f"ワールドデータおよび深部データベースを圧縮中: {archive_path.name}")
    with tarfile.open(archive_path, "w:gz") as tar:
        for target in SAVE_TARGETS:
            target_path = SERVER_DIR / target
            if target_path.exists():
                tar.add(target_path, arcname=target)
        if LOGS_DIR.exists():
            tar.add(LOGS_DIR, arcname="logs")

    shutil.copy2(archive_path, latest_path)
    log("✅ Google Driveへワールドアーカイブ保存完了。")

    # 行動日誌 & データベースファイルの同期
    if LOGS_DIR.exists():
        gdrive_logs_dir = GDRIVE_DIR / "logs"
        gdrive_logs_dir.mkdir(parents=True, exist_ok=True)
        for f in LOGS_DIR.glob("*"):
            if f.is_file():
                dest = gdrive_logs_dir / f.name
                shutil.copy2(f, dest)

    save_cache()
    return latest_path

def backup_to_xserver(archive_path: Path):
    """XServerへ nanndemoya26.key を利用して同期"""
    key_path = find_xserver_key()
    if not key_path:
        log("⚠️ nanndemoya26.key が見つからないため、XServer同期をスキップします。")
        return

    log(f"🚀 XServer ({XSERVER_HOST}) へGoogle Driveと同様のバックアップを同期開始...")
    ssh_opts = f"-p {XSERVER_PORT} -i {key_path} -o StrictHostKeyChecking=no -o ConnectTimeout=10"

    mkdir_cmd = f"ssh {ssh_opts} {XSERVER_USER}@{XSERVER_HOST} 'mkdir -p {XSERVER_REMOTE_DIR}/logs'"
    subprocess.run(mkdir_cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

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

    if LOGS_DIR.exists():
        rsync_logs = [
            "rsync", "-avz", "--timeout=15",
            "-e", f"ssh {ssh_opts}",
            f"{LOGS_DIR}/",
            f"{XSERVER_USER}@{XSERVER_HOST}:{XSERVER_REMOTE_DIR}/logs/"
        ]
        try:
            subprocess.run(rsync_logs, check=True)
            log("✅ XServerへ行動日誌・深部DB同期完了。")
        except Exception as e:
            log(f"⚠️ XServer日誌同期エラー: {e}")

if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "backup"
    if action == "restore":
        restore_cache()
        restore_from_storage()
    elif action == "restore_cache":
        restore_cache()
    elif action == "save_cache":
        save_cache()
    elif action == "clean":
        clean_old_world_and_logs()
    elif action == "backup":
        latest_archive = backup_to_gdrive()
        if latest_archive:
            backup_to_xserver(latest_archive)
    else:
        print(f"Unknown action: {action}")
