#!/bin/bash
# ==============================================================================
# setup_server.sh - Minecraft Paper Server & playit.gg & RadarMap Auto Setup
# (改善指示書v2準拠: 41体AIPlayer対応 max-players=100 & 軽量高速セットアップ)
# ==============================================================================
set -e

SERVER_DIR="/content/minecraft_server"
MINECRAFT_VERSION="1.21.1" # 最新安定版
PLAYIT_VERSION="0.15.26"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== [1/4] Java 21 JDK および必要パッケージのセットアップ ==="
apt-get update -qq
apt-get install -y -qq openjdk-21-jdk-headless curl jq screen wget zstd nodejs npm rsync netcat-openbsd > /dev/null 2>&1

echo "Javaバージョン:"
java -version 2>&1 | head -n 1
echo "Nodeバージョン:"
node -v 2>&1 || true

echo "=== [2/4] Minecraft サーバーディレクトリ作成 ==="
mkdir -p "$SERVER_DIR/logs" "$SERVER_DIR/plugins"
cd "$SERVER_DIR"

# EULA 同意
echo "eula=true" > eula.txt

# server.properties 最適化 (41AI + プレイヤー対応 max-players=100)
cat << 'EOF' > server.properties
server-port=25565
online-mode=false
difficulty=normal
gamemode=survival
pvp=true
view-distance=8
simulation-distance=6
max-players=100
enable-command-block=true
motd=Minecraft AI Colab Cluster Server (41 Bots)
network-compression-threshold=256
sync-chunk-writes=false
allow-flight=true
spawn-protection=0
EOF

# bukkit.yml 最適化 (同一IPからの41体AIPlayer連続接続制限を完全解除)
cat << 'EOF' > bukkit.yml
settings:
  allow-end: true
  warn-on-overload: false
  connection-throttle: -1
EOF

# spigot.yml 最適化 (タイムアウト時間の拡大)
cat << 'EOF' > spigot.yml
settings:
  timeout-time: 180
  restart-on-crash: false
EOF

# PaperMC / Purpur グローバル設定 (パケット制限・ユーザー名検証の緩和)
mkdir -p config
cat << 'EOF' > config/paper-global.yml
unsupported-settings:
  perform-username-validation: false
packet-limiter:
  kick-message: 'Kicked for spamming packets'
  limits:
    all:
      interval: 10.0
      max-packet-rate: 2500.0
EOF

echo "=== [3/4] PaperMC / Purpur (Java 21 最適化サーバー 1.21.1) の準備 ==="
if [ ! -f "server.jar" ] || [ ! -s "server.jar" ]; then
    echo "最新高速サーバー (Purpur/Paper 1.21.1) をダウンロード中..."
    curl -sL -f -o server.jar "https://api.purpurmc.org/v2/purpur/${MINECRAFT_VERSION}/latest/download" || \
    curl -sL -f -o server.jar "https://download.purpurmc.org/purpur/1.21.1/latest/purpur-1.21.1.jar" || true
    echo "server.jar の準備完了"
else
    echo "既存の server.jar が見つかりました。"
fi

echo "=== [4/4] playit.gg (無料トンネルCLI) のダウンロード & 設定 ==="
if [ ! -f "/usr/local/bin/playit" ]; then
    echo "playit.gg CLI をインストール中..."
    curl -SsL -o /usr/local/bin/playit "https://github.com/playit-cloud/playit-agent/releases/download/v${PLAYIT_VERSION}/playit-linux-amd64"
    chmod +x /usr/local/bin/playit
fi

# playit.toml の固定設定配置 (エージェント: zuyasi, ドメイン: zuyasi.playit.plus)
mkdir -p /etc/playit /root/.config/playit_gg /content
if [ -f "$REPO_DIR/playit.toml" ]; then
    cp -f "$REPO_DIR/playit.toml" /etc/playit/playit.toml
    cp -f "$REPO_DIR/playit.toml" /root/.config/playit_gg/playit.toml
    cp -f "$REPO_DIR/playit.toml" /content/playit.toml
fi
echo "playit.gg (固定エージェント: zuyasi) の準備完了"

echo "=== [追加1] 互換性プラグイン (ViaVersion) の導入 ==="
if [ ! -f "$SERVER_DIR/plugins/ViaVersion.jar" ]; then
    echo "最新クライアント互換プラグイン (ViaVersion) をダウンロード中..."
    curl -sL -o "$SERVER_DIR/plugins/ViaVersion.jar" "https://github.com/ViaVersion/ViaVersion/releases/download/5.12.1/ViaVersion-5.12.1.jar" || true
fi

echo "=== [追加2] 自動縮尺レーダー地図プラグイン (RadarMap) の導入 ==="
mkdir -p "$SERVER_DIR/plugins"
RADAR_DEPLOYED=false

if [ -f "$REPO_DIR/plugins/RadarMap.jar" ]; then
    cp -f "$REPO_DIR/plugins/RadarMap.jar" "$SERVER_DIR/plugins/RadarMap.jar"
    RADAR_DEPLOYED=true
    echo "✅ RadarMap.jar (Java 21 互換版) の導入完了！"
elif [ -f "/tmp/ColabTool_fetch/plugins/RadarMap.jar" ]; then
    cp -f "/tmp/ColabTool_fetch/plugins/RadarMap.jar" "$SERVER_DIR/plugins/RadarMap.jar"
    RADAR_DEPLOYED=true
    echo "✅ RadarMap.jar の導入完了！"
fi

if [ "$RADAR_DEPLOYED" = false ] || [ ! -s "$SERVER_DIR/plugins/RadarMap.jar" ]; then
    echo "RadarMap ソースから Java 21 向け自動コンパイルを実行中..."
    BUILD_DIR="/tmp/radarmap_live_build"
    rm -rf "$BUILD_DIR" && mkdir -p "$BUILD_DIR"
    if [ -d "$REPO_DIR/plugins_src/RadarMap" ]; then
        javac --release 21 -cp "$SERVER_DIR/server.jar" \
          -d "$BUILD_DIR" \
          "$REPO_DIR"/plugins_src/RadarMap/src/main/java/com/colabtool/radarmap/*.java 2>/dev/null || true
        if [ -f "$BUILD_DIR/com/colabtool/radarmap/RadarMapPlugin.class" ]; then
            cp -f "$REPO_DIR/plugins_src/RadarMap/src/main/resources/plugin.yml" "$BUILD_DIR/"
            jar -cf "$SERVER_DIR/plugins/RadarMap.jar" -C "$BUILD_DIR" .
            echo "✅ RadarMap オンデマンドビルドに成功しました！"
        fi
    fi
fi

echo "=== サーバーセットアップ完了 ==="
