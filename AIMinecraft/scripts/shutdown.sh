#!/bin/bash
# ==============================================================================
# shutdown.sh - 安全な停止・二重バックアップ(Drive/XServer)・日誌Gitプッシュ
# ==============================================================================

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="/content/minecraft_server"
PIPE_PATH="$SERVER_DIR/server.pipe"

echo "=================================================="
echo "    Minecraft AI Colab Server - 安全なシャットダウン"
echo "=================================================="

# 0. 定期バックアッププロセスの終了
pkill -f "backup_restore.py" || true

# 1. 録画プロセスの終了 (ffmpeg, Xvfb, Chromium)
if [ -f "/content/recorder_pids.txt" ]; then
    echo ">> [1/6] 録画プロセスを安全に完了・停止中..."
    kill $(cat /content/recorder_pids.txt) 2>/dev/null || true
    rm -f /content/recorder_pids.txt
fi
pkill -f "ffmpeg" || true
pkill -f "Xvfb" || true
pkill -f "chromium" || true

# 2. AIPlayer ボットの停止
echo ">> [2/6] AIPlayer (Gemini, ChatGPT, Claude, Grok) をログアウト中..."
pkill -f "node index.js" || true

# 3. Minecraft サーバーへの save-all & stop
echo ">> [3/6] Minecraftワールドを保存して停止中..."
if [ -p "$PIPE_PATH" ]; then
    echo "say サーバーを安全にシャットダウンします..." > "$PIPE_PATH" 2>/dev/null || true
    sleep 1
    echo "save-all" > "$PIPE_PATH" 2>/dev/null || true
    sleep 2
    echo "stop" > "$PIPE_PATH" 2>/dev/null || true
    sleep 5
fi
pkill -TERM -f "server.jar" || true

# ワールド保存完了待機
while pgrep -f "server.jar" > /dev/null; do
    echo "ワールドデータを保存中... お待ちください"
    sleep 2
done
echo "✅ ワールドデータの保存とサーバー停止が完了しました。"
rm -f "$PIPE_PATH" /content/mc_server.pid

# 4. playit.gg トンネル & LLM 停止
pkill -f "playit" || true
pkill -f "ollama serve" || true

# 5. Google Drive / XServer への最終バックアップ同期 (nanndemoya26.key使用)
echo ">> [4/6] 最終ワールド・録画・行動日誌をストレージ(Drive & XServer)に同期中..."
python3 "$REPO_DIR/scripts/backup_restore.py" backup || true

# 6. 行動日誌の保存 & Gitプッシュ
echo ">> [5/6] AIPlayer個別日誌の保存 & GitHubプッシュ..."
if [ -d "/content/logs" ]; then
    mkdir -p "$REPO_DIR/logs"
    cp -r /content/logs/* "$REPO_DIR/logs/" 2>/dev/null || true
    cd "$REPO_DIR"
    git add logs/ 2>/dev/null || true
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    git commit -m "chore: AIPlayerサバイバル行動日誌の保存 (${TIMESTAMP})" 2>/dev/null || true
    git push origin main 2>/dev/null || true
fi

echo "=================================================="
echo "    シャットダウンが完了しました。お疲れ様でした！"
echo "=================================================="
