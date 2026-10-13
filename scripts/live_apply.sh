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

# 1. 最新リポジトリの取得 (.git がない場合も対応)
if [ -d "$REPO_DIR/.git" ]; then
    cd "$REPO_DIR" && git pull origin main || true
else
    echo "最新スクリプトを取得中..."
    rm -rf /tmp/ColabTool_fetch
    git clone --depth 1 https://github.com/9z2fqjckjv-bot/ColabTool.git /tmp/ColabTool_fetch 2>/dev/null || true
    if [ -d "/tmp/ColabTool_fetch" ]; then
        cp -rf /tmp/ColabTool_fetch/* "$REPO_DIR/"
        rm -rf /tmp/ColabTool_fetch
    fi
fi

# 2. 自動縮尺レーダー地図プラグイン (RadarMap.jar) の配置
echo ">> [1/4] レーダー地図プラグインを配置中..."
mkdir -p "$SERVER_DIR/plugins"
if [ -f "$REPO_DIR/plugins/RadarMap.jar" ]; then
    cp -f "$REPO_DIR/plugins/RadarMap.jar" "$SERVER_DIR/plugins/RadarMap.jar"
else
    curl -sL -o "$SERVER_DIR/plugins/RadarMap.jar" "https://raw.githubusercontent.com/9z2fqjckjv-bot/ColabTool/main/plugins/RadarMap.jar" || true
fi
echo "✅ RadarMap.jar の配置完了！"

# 3. サーバーのクリーン再起動 (ViaVersionのクラスローダー競合・LinkageErrorを完全防止)
echo ">> [2/4] Minecraftサーバーを安全に再起動中 (約8秒)..."
if [ -p "$PIPE_PATH" ]; then
    echo "stop" > "$PIPE_PATH" 2>/dev/null || true
fi
pkill -TERM -f "server.jar" 2>/dev/null || true
while pgrep -f "server.jar" > /dev/null 2>&1; do
    sleep 1
done

cd "$SERVER_DIR"
rm -f "$PIPE_PATH" && mkfifo "$PIPE_PATH"
nohup tail -f "$PIPE_PATH" | java -Xms8G -Xmx12G -XX:+UseG1GC -jar server.jar nogui > "$SERVER_DIR/logs/latest.log" 2>&1 &
echo $! > /content/mc_server.pid

for i in {1..30}; do
    if grep -q "Done (" "$SERVER_DIR/logs/latest.log" 2>/dev/null; then
        break
    fi
    sleep 1
done
echo "✅ Minecraftサーバー再起動完了！"

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

# 6. playit.gg トンネルを固定エージェント (zuyasi / zuyasi.playit.plus) に切り替え
echo ">> [追加] playit.gg トンネルを固定エージェント (zuyasi) に再接続中..."
pkill -f "playit" || true
PLAYIT_SECRET="5ae8f7c17f9d58ecb144ed6df1f6d1bdffb6a30bc14a09a815976da2ccd174c1"
mkdir -p /etc/playit /root/.config/playit_gg /content
if [ -f "$REPO_DIR/playit.toml" ]; then
    cp -f "$REPO_DIR/playit.toml" /etc/playit/playit.toml
    cp -f "$REPO_DIR/playit.toml" /root/.config/playit_gg/playit.toml
    cp -f "$REPO_DIR/playit.toml" /content/playit.toml
fi
nohup playit --secret "$PLAYIT_SECRET" --stdout > /content/playit.log 2>&1 &

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
echo "🌐 【固定接続先アドレス】: zuyasi.playit.plus"
echo "   (予備アドレス: cairo-medicinal.tun.ply.gg:47605)"
echo "👉 Minecraft内であなたの手元（またはインベントリ/オフハンド）に"
echo "   「全員位置レーダー地図」が届いているかご確認ください！(Fキーで左手装備推奨)"
echo "👉 チャットで「@Gemini こんにちは」や「@all 木を集めて」と発言し、"
echo "   動的生成される個別返答と自律行動をお確かめください！"
echo "=================================================="
