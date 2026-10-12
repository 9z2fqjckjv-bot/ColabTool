#!/bin/bash
# ==============================================================================
# setup_server.sh - Minecraft Paper/Purpur Server & playit.gg Auto Setup
# ==============================================================================
set -e

SERVER_DIR="/content/minecraft_server"
MINECRAFT_VERSION="1.21.1" # 最新安定版
PLAYIT_VERSION="0.15.26"

echo "=== [1/4] Java 21 および必要パッケージのセットアップ ==="
apt-get update -qq
apt-get install -y -qq openjdk-21-jre-headless curl jq screen xvfb ffmpeg x11-utils zstd nodejs npm > /dev/null 2>&1
echo "Javaバージョン:"
java -version 2>&1 | head -n 1
echo "Nodeバージョン:"
node -v 2>&1 || true

echo "=== [2/4] Minecraft サーバーディレクトリ作成 ==="
mkdir -p "$SERVER_DIR/logs"
cd "$SERVER_DIR"

# EULA 同意
echo "eula=true" > eula.txt

# server.properties 最適化
cat << 'EOF' > server.properties
server-port=25565
online-mode=false
difficulty=normal
gamemode=survival
pvp=true
view-distance=8
simulation-distance=6
max-players=10
enable-command-block=true
motd=Minecraft AI Colab Server
network-compression-threshold=256
sync-chunk-writes=false
allow-flight=true
spawn-protection=0
EOF

echo "=== [3/4] PaperMC (Java 21 最適化サーバー) のダウンロード ==="
if [ ! -f "server.jar" ]; then
    # PaperMC APIから最新ビルドを取得
    PAPER_PROJECT="paper"
    LATEST_BUILD=$(curl -s "https://api.papermc.io/v2/projects/${PAPER_PROJECT}/versions/${MINECRAFT_VERSION}" | jq '.builds[-1]')
    if [ "$LATEST_BUILD" != "null" ] && [ -n "$LATEST_BUILD" ]; then
        JAR_NAME="${PAPER_PROJECT}-${MINECRAFT_VERSION}-${LATEST_BUILD}.jar"
        DOWNLOAD_URL="https://api.papermc.io/v2/projects/${PAPER_PROJECT}/versions/${MINECRAFT_VERSION}/builds/${LATEST_BUILD}/downloads/${JAR_NAME}"
        echo "PaperMC Build #${LATEST_BUILD} をダウンロード中: $DOWNLOAD_URL"
        curl -s -o server.jar "$DOWNLOAD_URL"
    else
        echo "Purpurのフォールバックダウンロード..."
        curl -s -o server.jar "https://api.purpurmc.org/v2/purpur/${MINECRAFT_VERSION}/latest/download"
    fi
    echo "server.jar の準備完了"
else
    echo "既存の server.jar が見つかりました。"
fi

echo "=== [4/4] playit.gg (無料トンネルCLI) のダウンロード ==="
if [ ! -f "/usr/local/bin/playit" ]; then
    echo "playit.gg CLI をインストール中..."
    curl -SsL -o /usr/local/bin/playit "https://github.com/playit-cloud/playit-agent/releases/download/v${PLAYIT_VERSION}/playit-linux-amd64"
    chmod +x /usr/local/bin/playit
fi
echo "playit.gg の準備完了"

echo "=== [追加] 互換性プラグイン (ViaVersion) の導入 ==="
mkdir -p "$SERVER_DIR/plugins"
if [ ! -f "$SERVER_DIR/plugins/ViaVersion.jar" ]; then
    echo "最新クライアント互換プラグイン (ViaVersion) をダウンロード中..."
    curl -sL -o "$SERVER_DIR/plugins/ViaVersion.jar" "https://github.com/ViaVersion/ViaVersion/releases/download/5.12.1/ViaVersion-5.12.1.jar"
fi

echo "=== サーバーセットアップ完了 ==="
