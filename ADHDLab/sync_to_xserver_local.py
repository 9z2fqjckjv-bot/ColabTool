#!/usr/bin/env python3
"""
ADHDLab Local-to-XServer Sync Script
ローカルマシン（Mac）から nanndemoya26.key を利用して
ADHDLab のデータ、コード、実行ログを XServer (~/adhdlab_backup) へ直接バックアップ・同期します。
Google Colabのアウトバウンドポート制限（10022番ブロック）に影響されず、確実に同期可能です。
"""

import os
import sys
import subprocess
import datetime
import tarfile

HOST = os.environ.get("XSERVER_HOST", "nanndemoya26.xsrv.jp")
USER = os.environ.get("XSERVER_USER", "nanndemoya26")
PORT = int(os.environ.get("XSERVER_PORT", "10022"))
REMOTE_DIR = os.environ.get("XSERVER_REMOTE_DIR", "~/adhdlab_backup")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = BASE_DIR
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
KEY_PATH = os.path.join(BASE_DIR, "nanndemoya26.key")

if not os.path.exists(KEY_PATH):
    # 親ディレクトリ等も探索
    alt_keys = [
        os.path.join(os.path.dirname(BASE_DIR), "nanndemoya26.key"),
        os.path.join(os.path.dirname(BASE_DIR), "AIMinecraft", "nanndemoya26.key"),
        os.path.expanduser("~/.ssh/nanndemoya26.key")
    ]
    for alt in alt_keys:
        if os.path.exists(alt):
            KEY_PATH = alt
            break

def main():
    print("=" * 60)
    print("🚀 ADHDLab ➔ XServer ローカルダイレクト同期")
    print(f"📡 接続先: {USER}@{HOST}:{PORT}")
    print(f"🔑 秘密鍵: {KEY_PATH}")
    print(f"📂 保管先: {REMOTE_DIR}")
    print("=" * 60)

    if not os.path.exists(KEY_PATH):
        print(f"❌ エラー: 秘密鍵 nanndemoya26.key が見つかりません: {KEY_PATH}")
        sys.exit(1)

    os.chmod(KEY_PATH, 0o600)

    ssh_base = f"ssh -i {KEY_PATH} -p {PORT} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o LogLevel=ERROR -o ConnectTimeout=10"

    # 1. 疎通確認
    print("\n🔍 1. XServerへの接続テスト...")
    test_res = subprocess.run(f"{ssh_base} {USER}@{HOST} 'uname -a && uptime'", shell=True, capture_output=True, text=True)
    if test_res.returncode != 0:
        print(f"❌ 接続失敗: {test_res.stderr.strip()}")
        sys.exit(1)
    print(f"✅ 接続成功！\n   {test_res.stdout.strip()}")

    # 2. Google Drive から最新データ（adhdlab.db, ソース一覧.xlsx）を自動同期
    gdrive_dir = os.path.expanduser("~/Library/CloudStorage/GoogleDrive-zuyasi4025@gmail.com/マイドライブ/ADHDLab")
    if os.path.exists(gdrive_dir):
        print(f"\n📂 2. Google Drive ({gdrive_dir}) から最新データを取得...")
        os.makedirs(DATA_DIR, exist_ok=True)
        for fname in ["adhdlab.db", "ソース一覧.xlsx"]:
            src = os.path.join(gdrive_dir, fname)
            dst = os.path.join(DATA_DIR, fname)
            if os.path.exists(src):
                import shutil
                shutil.copy2(src, dst)
                print(f"   - {fname} を取得完了 ({os.path.getsize(dst):,} bytes)")

    # 3. リモートディレクトリ作成
    print(f"\n📁 3. リモートディレクトリ構造の準備 ({REMOTE_DIR})...")
    mkdir_cmd = f"{ssh_base} {USER}@{HOST} 'mkdir -p {REMOTE_DIR}/data {REMOTE_DIR}/archives {REMOTE_DIR}/logs'"
    subprocess.run(mkdir_cmd, shell=True, check=True)
    print("✅ ディレクトリ準備完了")

    # 4. データ同期
    if os.path.exists(DATA_DIR):
        print(f"\n💾 4. データディレクトリ ({DATA_DIR}) の同期...")
        rsync_cmd = [
            "rsync", "-avz", "--delete",
            "-e", f"ssh -i {KEY_PATH} -p {PORT} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o LogLevel=ERROR",
            DATA_DIR + "/",
            f"{USER}@{HOST}:{REMOTE_DIR}/data/"
        ]
        res = subprocess.run(rsync_cmd, capture_output=True)
        if res.returncode == 0:
            print("✅ データ同期成功 (rsync)")
        else:
            print("⚠️ rsync代替としてscpで転送中...")
            scp_cmd = [
                "scp", "-P", str(PORT), "-i", KEY_PATH, "-r",
                "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "BatchMode=yes",
                DATA_DIR,
                f"{USER}@{HOST}:{REMOTE_DIR}/"
            ]
            subprocess.run(scp_cmd, check=True)
            print("✅ データ同期成功 (scp)")

    # 5. コード＆ログ＆データ包括アーカイブ作成・転送
    print("\n📦 5. 包括的バックアップアーカイブの生成＆転送...")
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    tar_name = f"adhdlab_archive_{timestamp}.tar.gz"
    tar_path = os.path.join("/tmp", tar_name)
    local_latest_tar = os.path.join(PROJECT_ROOT, "adhdlab_latest.tar.gz")

    targets = [
        ("core", os.path.join(PROJECT_ROOT, "core")),
        ("web", os.path.join(PROJECT_ROOT, "web")),
        ("data", DATA_DIR),
        ("ADHDLab_Colab.ipynb", os.path.join(PROJECT_ROOT, "ADHDLab_Colab.ipynb")),
        ("ソース一覧.xlsx", os.path.join(PROJECT_ROOT, "ソース一覧.xlsx")),
        ("README.md", os.path.join(PROJECT_ROOT, "README.md")),
    ]

    with tarfile.open(tar_path, "w:gz") as tar:
        for arcname, target in targets:
            if os.path.exists(target):
                tar.add(target, arcname=arcname)

    # ローカルプロジェクト直下にも最新アーカイブを保存
    import shutil
    shutil.copy2(tar_path, local_latest_tar)

    # 転送 (最新版 adhdlab_latest.tar.gz + 世代アーカイブ)
    scp_opts = f"-P {PORT} -i {KEY_PATH} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o LogLevel=ERROR"
    subprocess.run(f"scp {scp_opts} {tar_path} {USER}@{HOST}:{REMOTE_DIR}/adhdlab_latest.tar.gz", shell=True, check=True)
    subprocess.run(f"scp {scp_opts} {tar_path} {USER}@{HOST}:{REMOTE_DIR}/archives/{tar_name}", shell=True, check=True)

    if os.path.exists(tar_path):
        os.remove(tar_path)

    print("✅ コード＆ログ＆データ包括アーカイブの保管完了！")
    print(f"   - ローカル: {local_latest_tar} ({os.path.getsize(local_latest_tar):,} bytes)")
    print(f"   - XServer最新版: {REMOTE_DIR}/adhdlab_latest.tar.gz")
    print(f"   - XServer世代版: {REMOTE_DIR}/archives/{tar_name}")

    print("\n" + "=" * 60)
    print("🎉 XServerへのバックアップがすべて正常に完了しました！")
    print("=" * 60)

if __name__ == "__main__":
    main()
