#!/bin/bash
# ==============================================================================
# live_apply.sh - 稼働中サーバーへ41体AIPlayer・Webポータル・深部DBを即時反映
# ==============================================================================

set -e

REPO_DIR="/content/ColabTool/AIMinecraft"
[ ! -d "$REPO_DIR" ] && REPO_DIR="/content/ColabTool"
SERVER_DIR="/content/minecraft_server"
PIPE_PATH="$SERVER_DIR/server.pipe"

mkdir -p "$REPO_DIR" /content/logs

echo "=================================================="
echo "  🚀 稼働中サーバーへのリアルタイム改善反映"
echo "  (41体AIPlayer・総合Webポータル・Qwen 2.5・深部DB)"
echo "=================================================="

# 1. サーバー設定 (max-players=100) の確認・適用
if [ -f "$SERVER_DIR/server.properties" ]; then
    sed -i 's/^max-players=.*/max-players=100/' "$SERVER_DIR/server.properties"
fi

# 2. Bot & Webポータルプロセスの再起動
echo ">> Botクラスタ & Webポータルを再起動中..."
pkill -9 -f "node index.js" || true
sleep 1

cd "$REPO_DIR/bot"
npm install --silent > /dev/null 2>&1 || true

export SERVER_PIPE="$PIPE_PATH"
nohup node index.js > /content/bots.log 2>&1 &
echo "✅ AIPlayerクラスタ & Webポータルを再起動しました。"

echo "=================================================="
echo "✨ 稼働中サーバーへの最新反映が完了しました。"
echo "=================================================="
