#!/bin/bash
# ==============================================================================
# shutdown.sh - 安全な停止・バックアップ・Git自動プッシュ (堅牢化版)
# ==============================================================================

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="/content/minecraft_server"
PIPE_PATH="$SERVER_DIR/server.pipe"

echo "=================================================="
echo "    Minecraft AI Colab Server - 安全なシャットダウン"
echo "=================================================="

# 1. 録画プロセスの終了
if [ -f "/content/recorder_pids.txt" ]; then
    echo ">> [1/5] 録画プロセスを停止中..."
    kill $(cat /content/recorder_pids.txt) 2>/dev/null || true
    rm -f /content/recorder_pids.txt
fi
pkill -f "ffmpeg" || true
pkill -f "Xvfb" || true

# 2. AIPlayer ボットの停止
echo ">> [2/5] AIPlayer をログアウト中..."
pkill -f "node index.js" || true

# 3. Minecraft サーバーへの save-all & stop
echo ">> [3/5] Minecraftワールドを保存して停止中..."
if [ -p "$PIPE_PATH" ]; then
    echo "say サーバーを安全にシャットダウンします..." > "$PIPE_PATH" 2>/dev/null || true
    sleep 1
    echo "save-all" > "$PIPE_PATH" 2>/dev/null || true
    sleep 3
    echo "stop" > "$PIPE_PATH" 2>/dev/null || true
    sleep 8
fi
pkill -f "server.jar" || true
rm -f "$PIPE_PATH"

# 4. playit.gg の停止
pkill -f "playit" || true

# 5. Google Drive / XServer への最終バックアップ同期
echo ">> [4/5] 最終バックアップをストレージに同期中..."
python3 "$REPO_DIR/scripts/backup_restore.py" backup || true

# 6. 行動日誌をリポジトリにコピーしてGitHubプッシュ
echo ">> [5/5] 行動日誌の保存 & GitHubプッシュ..."
if [ -f "/content/diary.md" ]; then
    mkdir -p "$REPO_DIR/logs"
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    cp /content/diary.md "$REPO_DIR/logs/diary_${TIMESTAMP}.md"
    cd "$REPO_DIR"
    git add logs/
    git commit -m "chore: プレイ記録・行動日誌の保存 (${TIMESTAMP})" || true
    git push origin main || true
fi

echo "=================================================="
echo "    シャットダウンが完了しました。お疲れ様でした！"
echo "=================================================="
