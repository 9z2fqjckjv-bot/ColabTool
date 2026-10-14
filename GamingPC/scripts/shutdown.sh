#!/bin/bash
# ==============================================================================
# shutdown.sh - Safe Shutdown & Complete Data Synchronization
# (Stops recording, saves Minecraft, syncs to Google Drive, terminates daemons)
# ==============================================================================

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="/content/minecraft_server"
PIPE_PATH="$SERVER_DIR/server.pipe"

echo "=================================================="
echo "  🛑 Gaming PC - 安全なシャットダウン処理開始"
echo "=================================================="

# 1. 画面収録プロセスの停止
echo ">> [1/5] 画面収録プロセスの終了とMP4の確定..."
bash "$REPO_DIR/scripts/record_screen.sh" stop 2>/dev/null || true

# 2. 定期バックアッププロセスの終了
pkill -f "backup_restore.py" 2>/dev/null || true

# 3. Minecraft サーバーのワールド保存と安全な停止
echo ">> [2/5] Minecraftサーバーのワールド保存 (save-all) & 停止..."
if [ -p "$PIPE_PATH" ] && pgrep -f "server.jar" > /dev/null 2>&1; then
    echo "say サーバーを安全にシャットダウンします..." > "$PIPE_PATH" 2>/dev/null || true
    sleep 1
    echo "save-all" > "$PIPE_PATH" 2>/dev/null || true
    sleep 2
    echo "stop" > "$PIPE_PATH" 2>/dev/null || true
    sleep 3
fi

# サーバープロセス終了待機
for i in {1..15}; do
    if ! pgrep -f "server.jar" > /dev/null 2>&1; then
        break
    fi
    sleep 1
    echo -n "."
done
echo ""
pkill -TERM -f "server.jar" 2>/dev/null || true
rm -f "$PIPE_PATH" /content/mc_server.pid

# 4. セーブデータ & 録画動画のGoogle Drive同期
echo ">> [3/5] セーブデータ・プロファイル・録画動画の最終Google Drive同期..."
python3 "$REPO_DIR/scripts/backup_restore.py" backup || true

# 5. トンネルおよびデスクトッププロセスの終了
echo ">> [4/5] トンネル & リモートデスクトッププロセスの停止..."
pkill -f "playit" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
pkill -f "websockify" 2>/dev/null || true
pkill -f "x11vnc" 2>/dev/null || true
pkill -f "xfce4" 2>/dev/null || true
pkill -f "Xvfb :1" 2>/dev/null || true

echo ">> [5/5] シャットダウン完了確認..."
echo ""
echo "=================================================="
echo "🎉 すべてのデータ保存とシャットダウンが完了しました！"
echo "💾 保存先: Google Drive > GamingPC/"
echo "お疲れ様でした。"
echo "=================================================="
