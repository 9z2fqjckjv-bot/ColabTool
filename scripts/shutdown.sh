#!/bin/bash
# ==============================================================================
# shutdown.sh - 安全な停止・バックアップ・Git自動プッシュ
# ==============================================================================

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="/content/minecraft_server"

echo "=================================================="
echo "    Minecraft AI Colab Server - 安全なシャットダウン"
echo "=================================================="

# 1. 録画プロセスの終了
if [ -f "/content/recorder_pids.txt" ]; then
    echo ">> [1/5] 録画プロセスを停止中..."
    kill $(cat /content/recorder_pids.txt) 2>/dev/null || true
    rm -f /content/recorder_pids.txt
fi

# 2. AIPlayer ボットの停止
echo ">> [2/5] AIPlayer をログアウト中..."
screen -S bots -X quit 2>/dev/null || true

# 3. Minecraft サーバーへの save-all & stop
echo ">> [3/5] Minecraftワールドを保存して停止中..."
screen -S mc -p 0 -X stuff "say サーバーを安全にシャットダウンします...^M" 2>/dev/null || true
sleep 1
screen -S mc -p 0 -X stuff "save-all^M" 2>/dev/null || true
sleep 3
screen -S mc -p 0 -X stuff "stop^M" 2>/dev/null || true
sleep 10
screen -S mc -X quit 2>/dev/null || true

# 4. playit.gg の停止
screen -S playit -X quit 2>/dev/null || true

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
