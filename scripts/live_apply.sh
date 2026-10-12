#!/bin/bash
# ==============================================================================
# live_apply.sh - 稼働中サーバーへRadarMapプラグイン＆AIPlayer最新脳を即時反映
# ==============================================================================

set -e

REPO_DIR="/content/ColabTool"
SERVER_DIR="/content/minecraft_server"
PIPE_PATH="$SERVER_DIR/server.pipe"

echo "=================================================="
echo "  🚀 稼働中サーバーへのリアルタイム改善反映"
echo "=================================================="

# 1. 最新リポジトリの取得
cd "$REPO_DIR"
git pull origin main || true

# 2. 自動縮尺レーダー地図プラグイン (RadarMap.jar) のコンパイル & 配置
echo ">> [1/4] レーダー地図プラグインをコンパイル中..."
BUILD_DIR="/tmp/radarmap_live_build"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/classes"

javac -cp "$SERVER_DIR/server.jar" -d "$BUILD_DIR/classes" \
    "$REPO_DIR/plugins_src/RadarMap/src/main/java/com/colabtool/radarmap/"*.java
cp "$REPO_DIR/plugins_src/RadarMap/src/main/resources/plugin.yml" "$BUILD_DIR/classes/"
jar -cf "$SERVER_DIR/plugins/RadarMap.jar" -C "$BUILD_DIR/classes" .
rm -rf "$BUILD_DIR"
echo "✅ RadarMap.jar のビルド完了！"

# 3. サーバーへプラグインを即時ロード & 全員へ配布
echo ">> [2/4] Minecraftサーバーへプラグインを反映中..."
if [ -p "$PIPE_PATH" ]; then
    echo "reload confirm" > "$PIPE_PATH" 2>/dev/null || true
    sleep 3
    echo "say §a[System] §f自動縮尺レーダー地図システムが更新されました。" > "$PIPE_PATH" 2>/dev/null || true
    echo "radar" > "$PIPE_PATH" 2>/dev/null || true
fi

# 4. LLMエンジンの起動確認 & 高速モデル準備
echo ">> [3/4] LLM推論エンジンの稼働確認..."
if [ -z "$GEMINI_API_KEY" ]; then
    if ! pgrep -f "ollama serve" > /dev/null 2>&1; then
        echo "Ollamaサーバーをバックグラウンド起動..."
        OLLAMA_HOST=0.0.0.0:8000 nohup ollama serve > /content/ollama.log 2>&1 &
        sleep 3
    fi
    echo "日本語高速LLMモデル (qwen2.5:1.5b) をロード中..."
    ollama pull qwen2.5:1.5b > /dev/null 2>&1 || true
fi

# 5. AIPlayer Bot の依存関係確認 & 再起動 (最新brain.js/自律行動/動的返信反映)
echo ">> [4/4] AIPlayerクラスタ (Gemini, ChatGPT, Claude, Grok) の最新コード反映..."
cd "$REPO_DIR/bot"
if [ ! -d "node_modules/canvas" ]; then
    npm install canvas --no-save > /dev/null 2>&1 || true
fi

pkill -f "node index.js" || true
nohup node index.js > /content/bots.log 2>&1 &
echo "AI仲間たちが再接続中..."

for i in {1..8}; do
    sleep 1
    echo -n "."
done
echo ""

echo "=================================================="
echo "🎉 反映完了！最新の稼働ログ:"
echo "=================================================="
tail -n 15 /content/bots.log 2>/dev/null || true

echo ""
echo "👉 Minecraft内であなたの手元（またはインベントリ/オフハンド）に"
echo "   「全員位置レーダー地図」が届いているかご確認ください！(Fキーで左手装備推奨)"
echo "👉 チャットで「@Gemini こんにちは」や「@all 木を集めて」と発言し、"
echo "   動的生成される個別返答と自律行動をお確かめください！"
echo "=================================================="
