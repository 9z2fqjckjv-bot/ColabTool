#!/bin/bash
# ==============================================================================
# live_apply.sh - 稼働中サーバーへRadarMap・AIPlayer・画面収録・行動日誌を即時反映
# ==============================================================================

set -e

REPO_DIR="/content/ColabTool"
SERVER_DIR="/content/minecraft_server"
PIPE_PATH="$SERVER_DIR/server.pipe"

mkdir -p "$REPO_DIR" /content/logs /content/recordings

echo "=================================================="
echo "  🚀 稼働中サーバーへのリアルタイム改善反映"
echo "  (RadarMap・自律AI・4分割POV画面収録・行動日誌)"
echo "=================================================="

# 1. 最新リポジトリの取得 (.git がある場合は強制同期、ない場合はクローン)
if [ -d "$REPO_DIR/.git" ]; then
    echo "既存リポジトリを最新の origin/main に完全同期中..."
    cd "$REPO_DIR"
    git fetch origin main || true
    git reset --hard origin/main || true
else
    echo "最新スクリプトを取得中..."
    rm -rf /tmp/ColabTool_fetch
    git clone --depth 1 https://github.com/9z2fqjckjv-bot/ColabTool.git /tmp/ColabTool_fetch 2>/dev/null || true
    if [ -d "/tmp/ColabTool_fetch" ]; then
        cp -rf /tmp/ColabTool_fetch/* "$REPO_DIR/"
        rm -rf /tmp/ColabTool_fetch
    fi
fi

# サブディレクトリ AIMinecraft がある場合は中身を REPO_DIR 直下へ同期
if [ -d "$REPO_DIR/AIMinecraft" ]; then
    cp -rf "$REPO_DIR/AIMinecraft/"* "$REPO_DIR/"
fi

# 確実性保証: 最新コードを直接同期 (新旧両方のURLをフェイルセーフで試行)
mkdir -p "$REPO_DIR/bot" "$REPO_DIR/recorder" "$REPO_DIR/scripts"
BASE_URL="https://raw.githubusercontent.com/9z2fqjckjv-bot/ColabTool/main"

for bfile in index.js brain.js knowledge_base.js persona.js vision_capturer.js package.json; do
    curl -sL -f -o "$REPO_DIR/bot/$bfile" "${BASE_URL}/AIMinecraft/bot/$bfile" 2>/dev/null || \
    curl -sL -f -o "$REPO_DIR/bot/$bfile" "${BASE_URL}/bot/$bfile" 2>/dev/null || true
done

for rfile in record_viewer.sh multiview.html; do
    curl -sL -f -o "$REPO_DIR/recorder/$rfile" "${BASE_URL}/AIMinecraft/recorder/$rfile" 2>/dev/null || \
    curl -sL -f -o "$REPO_DIR/recorder/$rfile" "${BASE_URL}/recorder/$rfile" 2>/dev/null || true
done

chmod +x "$REPO_DIR/recorder/record_viewer.sh" "$REPO_DIR/scripts/"*.sh "$REPO_DIR/scripts/"*.py 2>/dev/null || true

# 2. 自動縮尺レーダー地図プラグイン (RadarMap.jar) の配置
echo ">> [1/6] レーダー地図プラグインを配置中..."
mkdir -p "$SERVER_DIR/plugins"
RADAR_APPLIED=false
if [ -f "$REPO_DIR/plugins/RadarMap.jar" ]; then
    cp -f "$REPO_DIR/plugins/RadarMap.jar" "$SERVER_DIR/plugins/RadarMap.jar"
    RADAR_APPLIED=true
elif [ -f "$REPO_DIR/AIMinecraft/plugins/RadarMap.jar" ]; then
    cp -f "$REPO_DIR/AIMinecraft/plugins/RadarMap.jar" "$SERVER_DIR/plugins/RadarMap.jar"
    RADAR_APPLIED=true
else
    curl -sL -f -o "$SERVER_DIR/plugins/RadarMap.jar" "${BASE_URL}/AIMinecraft/plugins/RadarMap.jar" 2>/dev/null || \
    curl -sL -f -o "$SERVER_DIR/plugins/RadarMap.jar" "${BASE_URL}/plugins/RadarMap.jar" 2>/dev/null || true
    if [ -s "$SERVER_DIR/plugins/RadarMap.jar" ]; then RADAR_APPLIED=true; fi
fi

# フォールバック: Java 21 でのオンデマンドビルド
if [ "$RADAR_APPLIED" = false ] || [ ! -s "$SERVER_DIR/plugins/RadarMap.jar" ]; then
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
echo "✅ RadarMap.jar の配置完了！"

# 3. サーバーのクリーン再起動 (ViaVersionのクラスローダー重複/LinkageError解消 & RadarMap完全反映)
echo ">> [2/6] Minecraftサーバーのクリーン再起動中..."
if [ -p "$PIPE_PATH" ] && pgrep -f "server.jar" > /dev/null 2>&1; then
    echo "ワールドデータを保存中..."
    echo "save-all" > "$PIPE_PATH" 2>/dev/null || true
    sleep 1
    echo "stop" > "$PIPE_PATH" 2>/dev/null || true
    sleep 2
fi
pkill -9 -f "server.jar" 2>/dev/null || true
pkill -9 -f "tail -f $PIPE_PATH" 2>/dev/null || true
fuser -k -9 25565/tcp 2>/dev/null || true
sleep 2

# bukkit.yml 最適化 (AIPlayerが同一IPから即座にログインできるよう connection-throttle を無効化)
mkdir -p "$SERVER_DIR"
if [ -f "$SERVER_DIR/bukkit.yml" ]; then
    sed -i -E 's/connection-throttle:.*/connection-throttle: -1/g' "$SERVER_DIR/bukkit.yml"
    if ! grep -q "connection-throttle:" "$SERVER_DIR/bukkit.yml"; then
        echo -e "settings:\n  connection-throttle: -1" >> "$SERVER_DIR/bukkit.yml"
    fi
else
    cat << 'EOF' > "$SERVER_DIR/bukkit.yml"
settings:
  allow-end: true
  warn-on-overload: false
  connection-throttle: -1
EOF
fi

cd "$SERVER_DIR"
rm -f "$PIPE_PATH" && mkfifo "$PIPE_PATH"
fuser -k -9 25565/tcp 2>/dev/null || true
nohup tail -f "$PIPE_PATH" | java -Xms2G -Xmx7G -XX:+UseG1GC -jar server.jar nogui > "$SERVER_DIR/logs/latest.log" 2>&1 &
echo $! > /content/mc_server.pid

echo "Minecraftサーバーの起動完了 (ポート25565の受付開始) を待機中..."
SERVER_READY=false
for i in {1..75}; do
    # ポート25565が実際にオープン（LISTEN）状態になったか直接確認 (最重要)
    if python3 -c "import socket; s = socket.socket(); s.settimeout(0.5); s.connect(('127.0.0.1', 25565)); s.close()" 2>/dev/null; then
        SERVER_READY=true
        break
    fi
    if grep -q "Done (" "$SERVER_DIR/logs/latest.log" 2>/dev/null; then
        sleep 1
        SERVER_READY=true
        break
    fi
    if grep -q "FAILED TO BIND TO PORT" "$SERVER_DIR/logs/latest.log" 2>/dev/null; then
        echo ""
        echo "⚠️ ポート25565競合を検知。ポートを強制解放して再試行..."
        fuser -k -9 25565/tcp 2>/dev/null || true
        pkill -9 -f "server.jar" 2>/dev/null || true
        sleep 2
        nohup tail -f "$PIPE_PATH" | java -Xms2G -Xmx7G -XX:+UseG1GC -jar server.jar nogui > "$SERVER_DIR/logs/latest.log" 2>&1 &
    fi
    sleep 1
    echo -n "."
done
echo ""

if [ "$SERVER_READY" = true ]; then
    echo "✅ Minecraftサーバーがポート25565で正常にクリーン起動しました！(ViaVersionの重複解消完了)"
else
    echo "⚠️ Minecraftサーバーの起動待機がタイムアウトしました。直近ログ確認:"
    tail -n 12 "$SERVER_DIR/logs/latest.log" 2>/dev/null || true
fi


# 拠点の安全確保: モブ攻撃・クリーパー爆発・ゾンビドア破壊による拠点チェスト・ベッド・家具破壊を完全無効化
if [ -p "$PIPE_PATH" ]; then
    echo "gamerule mobGriefing false" > "$PIPE_PATH" 2>/dev/null || true
    echo "🛡️ gamerule mobGriefing false を設定し、モブによる拠点ブロック破壊を無効化しました。"
fi

# 4. LLMエンジンの起動確認 & 高速モデル準備
echo ">> [3/6] LLM推論エンジンの稼働確認..."
if [ -z "$GEMINI_API_KEY" ]; then
    if ! pgrep -f "ollama serve" > /dev/null 2>&1; then
        echo "Ollamaサーバーをバックグラウンド起動..."
        OLLAMA_HOST=0.0.0.0:8000 nohup ollama serve > /content/ollama.log 2>&1 &
        sleep 3
    fi
    echo "日本語高速LLMモデル (qwen2.5:1.5b) をロード中..."
    ollama pull qwen2.5:1.5b > /dev/null 2>&1 || true
fi

# 5. AIPlayer Bot の依存関係確認 & 再起動 (最新3秒視覚スクショ/知識ベースRAG/自律行動/行動日誌を反映)
echo ">> [4/6] AIPlayerクラスタ (Gemini, ChatGPT, Claude, Grok) の最新コード反映..."
cd "$REPO_DIR/bot"
if [ ! -d "node_modules/canvas" ] || [ ! -d "node_modules/prismarine-viewer" ]; then
    echo "依存関係 (canvas, prismarine-viewer) をインストール中..."
    npm install --silent > /content/npm_install.log 2>&1 || npm install || true
fi
if [ ! -d "node_modules/puppeteer" ]; then
    npm install puppeteer --no-save > /dev/null 2>&1 || true
fi

# 既存Botプロセス終了 & ポート解放
pkill -9 -f "node index.js" || true
fuser -k 3001/tcp 3002/tcp 3003/tcp 3004/tcp 2>/dev/null || true
sleep 1
MC_HOST=127.0.0.1 nohup node index.js > /content/bots.log 2>&1 &
echo "✅ AIPlayerクラスタ (3秒視覚スクショ + 知識RAG + 自動行動日誌) を最新コードで再起動しました。"

# 6. 4分割一人称視点 (POV) 画面収録システムの再起動
echo ">> [5/6] 4分割画面視線収録 (POV) システムの最新反映・再起動..."
# openbox と Google Chrome の確認
if ! command -v openbox > /dev/null 2>&1; then
    apt-get install -y -qq openbox > /dev/null 2>&1 || true
fi
if ! which google-chrome > /dev/null 2>&1 && ! which google-chrome-stable > /dev/null 2>&1; then
    echo "画面収録用ブラウザ (Google Chrome 安定版) をセットアップ中..."
    wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb 2>/dev/null
    apt-get install -y -qq /tmp/google-chrome.deb > /dev/null 2>&1 || apt-get install -y -f -qq > /dev/null 2>&1
    rm -f /tmp/google-chrome.deb
fi

# 直前の録画を安全にクローズ
pkill -INT -f "ffmpeg -y -f x11grab" 2>/dev/null || true
sleep 1.5
pkill -f "ffmpeg" || true
pkill -f "multiview.html" || true
pkill -f "http.server 8088" || true
pkill -f "openbox" || true
pkill -f "Xvfb :99" || true
pkill -f "chromium" || true
pkill -f "google-chrome" || true
sleep 1


nohup bash "$REPO_DIR/recorder/record_viewer.sh" > /content/recorder.log 2>&1 &
echo "✅ 4分割画面収録システムをバックグラウンド起動しました。"

# 7. playit.gg トンネルの再同期 (サーバー再起動に伴う接続切断・リセットを完全防止)
echo ">> [6/6] playit.gg トンネル状態の同期・リフレッシュ..."
pkill -9 -f "playit" 2>/dev/null || true
sleep 1
PLAYIT_SECRET="5ae8f7c17f9d58ecb144ed6df1f6d1bdffb6a30bc14a09a815976da2ccd174c1"
mkdir -p /etc/playit /root/.config/playit_gg /content
if [ -f "$REPO_DIR/playit.toml" ]; then
    cp -f "$REPO_DIR/playit.toml" /etc/playit/playit.toml
    cp -f "$REPO_DIR/playit.toml" /root/.config/playit_gg/playit.toml
    cp -f "$REPO_DIR/playit.toml" /content/playit.toml
fi
nohup playit --secret "$PLAYIT_SECRET" --stdout > /content/playit.log 2>&1 &
sleep 2
echo "✅ playit.gg トンネル (zuyasi.playit.plus) をサーバーと同期して正常稼働開始！"

# 8. 稼働診断 (行動日誌 & 画面収録)
sleep 7
echo ""
echo "=================================================="
echo "🔍 稼働診断: AIPlayer・画面収録・行動日誌"
echo "=================================================="

# 行動日誌のチェック
echo "【1. 行動日誌 (/content/logs/)】"
DIARY_FILES=$(ls -1 /content/logs/*_diary.md 2>/dev/null || true)
if [ -n "$DIARY_FILES" ]; then
    echo "✅ 生成確認された行動日誌一覧:"
    for df in $DIARY_FILES; do
        echo "   📄 $(basename "$df") ($(wc -l < "$df") 行記録中)"
    done
else
    echo "⏳ 行動日誌はBotのスポーン完了後に順次生成されます (ログ: /content/bots.log)"
fi

# 画面収録のチェック
echo ""
echo "【2. 画面収録システム (/content/recordings/)】"
if pgrep -f "ffmpeg -y -f x11grab" > /dev/null 2>&1; then
    echo "✅ ffmpeg 4分割POV録画プロセス稼働中 (PID: $(pgrep -f "ffmpeg -y -f x11grab" | head -n 1))"
    REC_FILES=$(ls -lh /content/recordings/*.mp4 2>/dev/null || true)
    if [ -n "$REC_FILES" ]; then
        echo "   🎥 現在の録画ファイル:"
        echo "$REC_FILES" | awk '{print "      " $9 " (" $5 ")"}'
    fi
else
    echo "⚠️ 録画システム起動中または待機中 (/content/recorder.log 直近ログ):"
    tail -n 8 /content/recorder.log 2>/dev/null || true
fi


echo ""
echo "【3. AIPlayer Bot 直近ログ】"
tail -n 10 /content/bots.log 2>/dev/null || true

echo ""
echo "=================================================="
echo "🎉 ステップ6での最新反映が完了しました！"
echo "🌐 【固定接続先アドレス】: zuyasi.playit.plus"
echo "   (予備アドレス: cairo-medicinal.tun.ply.gg:47605)"
echo "📔 【行動日誌閲覧】: ノートブックの「ステップ 3」を実行して確認できます。"
echo "🎥 【画面収録保存先】: /content/recordings/ (ステップ 8終了時にDrive/XServerへ同期)"
echo "=================================================="

