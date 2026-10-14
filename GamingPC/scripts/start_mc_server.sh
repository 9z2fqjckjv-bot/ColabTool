#!/bin/bash
# ==============================================================================
# start_mc_server.sh - Decoupled Background Minecraft Paper Server
# (Runs independently of notebook cells; uses named pipe for commands)
# ==============================================================================
set -e

MC_RAM_GB="${1:-8}"
SERVER_DIR="/content/minecraft_server"
MINECRAFT_VERSION="1.21.1"

echo "=================================================="
echo "  ⛏️ 独立Minecraftサーバー (PaperMC) 起動"
echo "  割り当てRAM: ${MC_RAM_GB}GB (Colab High-RAM最適化)"
echo "=================================================="

mkdir -p "$SERVER_DIR/logs" "$SERVER_DIR/plugins"
cd "$SERVER_DIR"

# EULA 同意
echo "eula=true" > eula.txt

# server.properties 最適化
if [ ! -f "server.properties" ]; then
cat << 'EOF' > server.properties
server-port=25565
online-mode=false
difficulty=normal
gamemode=survival
pvp=true
view-distance=10
simulation-distance=8
max-players=20
enable-command-block=true
motd=Colab Gaming PC Minecraft Server
network-compression-threshold=256
sync-chunk-writes=false
allow-flight=true
spawn-protection=0
EOF
fi

# PaperMC jar のダウンロード (未ダウンロード時)
if [ ! -f "server.jar" ]; then
    echo ">> PaperMC ($MINECRAFT_VERSION) のダウンロード中..."
    LATEST_BUILD=$(curl -s "https://api.papermc.io/v2/projects/paper/versions/${MINECRAFT_VERSION}" | jq '.builds[-1]' 2>/dev/null || true)
    if [ "$LATEST_BUILD" != "null" ] && [ -n "$LATEST_BUILD" ]; then
        DOWNLOAD_URL="https://api.papermc.io/v2/projects/paper/versions/${MINECRAFT_VERSION}/builds/${LATEST_BUILD}/downloads/paper-${MINECRAFT_VERSION}-${LATEST_BUILD}.jar"
        curl -sL -o server.jar "$DOWNLOAD_URL"
    else
        curl -sL -o server.jar "https://api.purpurmc.org/v2/purpur/${MINECRAFT_VERSION}/latest/download"
    fi
fi

# 既存サーバープロセスの確認
if pgrep -f "server.jar" > /dev/null 2>&1; then
    echo "✅ Minecraftサーバーは既にバックグラウンドで稼働中です。"
else
    echo ">> サーバープロセスをパイプ付きでバックグラウンド起動中..."
    PIPE_PATH="$SERVER_DIR/server.pipe"
    rm -f "$PIPE_PATH"
    mkfifo "$PIPE_PATH"

    # バックグラウンド起動 (nohup + tail -f FIFO パイプ)
    nohup tail -f "$PIPE_PATH" | java -Xms2G -Xmx${MC_RAM_GB}G -XX:+UseG1GC -jar server.jar nogui > "$SERVER_DIR/logs/latest.log" 2>&1 &
    MC_PID=$!
    echo "$MC_PID" > /content/mc_server.pid

    echo "起動待機中 (約15秒)..."
    for i in {1..15}; do
        if grep -q "Done (" "$SERVER_DIR/logs/latest.log" 2>/dev/null; then
            break
        fi
        sleep 1
        echo -n "."
    done
    echo ""
fi

# playit.gg トンネルの起動 (ポート25565の外部公開)
if ! pgrep -f "playit" > /dev/null 2>&1; then
    echo ">> playit.gg トンネルを起動中..."
    nohup playit --stdout > /content/playit.log 2>&1 &
    sleep 3
fi

PLAYIT_URL=$(grep -oE "([a-zA-Z0-9.-]+\.ply\.gg:[0-9]+|[a-zA-Z0-9.-]+\.playit\.plus)" /content/playit.log 2>/dev/null | tail -n 1 || true)
CLAIM_URL=$(grep -oE "https://playit\.gg/claim/[a-zA-Z0-9]+" /content/playit.log 2>/dev/null | head -n 1 || true)

echo "=================================================="
echo "✅ Minecraftサーバーはセルから独立してバックグラウンドで稼働しています。"
echo "ローカル接続: localhost:25565"
if [ -n "$PLAYIT_URL" ]; then
    echo "外部接続アドレス: $PLAYIT_URL"
elif [ -n "$CLAIM_URL" ]; then
    echo "playit トンネル割り当てリンク: $CLAIM_URL"
fi
echo "=================================================="
