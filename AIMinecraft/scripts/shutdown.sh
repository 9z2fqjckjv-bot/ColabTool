#!/bin/bash
# ==============================================================================
# shutdown.sh - 安全な停止・二重バックアップ(Drive/XServer)・日誌Gitプッシュ
# (改善指示書v2準拠: 41AIPlayer・深部DB・統括日報の完全保存)
# ==============================================================================

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="/content/minecraft_server"
PIPE_PATH="$SERVER_DIR/server.pipe"

echo "=================================================="
echo "    Minecraft AI Colab Server - 安全なシャットダウン"
echo "=================================================="

# 0. 定期バックアッププロセスの終了
pkill -f "backup_restore.py" || true

# 1. AIPlayer クラスタの安全停止
echo ">> [1/5] 全41体のAIPlayerを安全にログアウト中..."
pkill -f "node index.js" || true

# 2. Minecraft サーバーへの save-all & stop
echo ">> [2/5] Minecraftワールドを保存して停止中..."
if [ -p "$PIPE_PATH" ]; then
    echo "say サーバーを安全にシャットダウンします..." > "$PIPE_PATH" 2>/dev/null || true
    sleep 1
    echo "save-all" > "$PIPE_PATH" 2>/dev/null || true
    sleep 2
    echo "stop" > "$PIPE_PATH" 2>/dev/null || true
    sleep 4
fi
pkill -TERM -f "server.jar" || true

# サーバープロセス終了待機
for i in {1..20}; do
    if ! pgrep -f "server.jar" > /dev/null; then
        break
    fi
    echo "ワールドデータを保存中... お待ちください"
    sleep 1
done
echo "✅ ワールドデータの保存とサーバー停止が完了しました。"
rm -f "$PIPE_PATH" /content/mc_server.pid

# 3. playit.gg トンネル & LLM 停止
pkill -f "playit" || true
pkill -f "ollama serve" || true

# 4. Google Drive / XServer への最終バックアップ同期 (nanndemoya26.key使用)
echo ">> [3/5] ワールド・深部データベース・行動日誌をストレージ(Drive & XServer)に同期中..."
python3 "$REPO_DIR/scripts/backup_restore.py" backup || true

# 5. キャッシュの保存 (再起動高速化)
echo ">> [4/5] 再起動高速化キャッシュを保存中..."
python3 "$REPO_DIR/scripts/backup_restore.py" save_cache || true

# 6. 行動日誌の保存 & Gitプッシュ
echo ">> [5/5] AIPlayer行動日誌 & 深部DBのGitHubプッシュ..."
if [ -d "/content/logs" ]; then
    mkdir -p "$REPO_DIR/logs"
    cp -r /content/logs/* "$REPO_DIR/logs/" 2>/dev/null || true
    cd "$REPO_DIR"
    git add logs/ 2>/dev/null || true
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    git commit -m "chore: AIPlayerサバイバル日誌・深部DBの保存 (${TIMESTAMP})" 2>/dev/null || true
    git push origin main 2>/dev/null || true
fi

echo "=================================================="
echo "    シャットダウンが完了しました。お疲れ様でした！"
echo "=================================================="
