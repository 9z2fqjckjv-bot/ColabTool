#!/bin/bash
# ==============================================================================
# record_viewer.sh - AIPlayerごとの目線・視線 (POV) を統合収録する録画システム
# ==============================================================================

RECORDINGS_DIR="/content/recordings"
mkdir -p "$RECORDINGS_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_FILE="${RECORDINGS_DIR}/mc_ai_pov_${TIMESTAMP}.mp4"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== [1/4] 既存の録画・ディスプレイ関連プロセスのクリーンアップ ==="
pkill -f "ffmpeg -y -f x11grab" || true
pkill -f "multiview.html" || true
pkill -f "http.server 8088" || true
pkill -f "openbox" || true
pkill -f "Xvfb :99" || true
sleep 1

echo "=== [2/4] 仮想ディスプレイ (Xvfb :99, 1920x1080) & ウィンドウマネージャ起動 ==="
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +extension RENDER +extension COMPOSITE -noreset > /dev/null 2>&1 &
XVFB_PID=$!
sleep 2

# openbox が利用可能な場合は起動 (ウィンドウの全画面マッピング・フォーカスを保証)
if command -v openbox > /dev/null 2>&1; then
    openbox > /dev/null 2>&1 &
fi

# ローカルHTTPサーバーを起動して multiview.html を安全に配信 (Private Network Access 制約の回避)
cd "$SCRIPT_DIR"
python3 -m http.server 8088 > /dev/null 2>&1 &
HTTP_PID=$!
sleep 1

echo "=== [3/4] ブラウザ探索および4分割POVマルチビュー起動 ==="
BROWSER=""
if which google-chrome > /dev/null 2>&1; then
    BROWSER="google-chrome"
elif which google-chrome-stable > /dev/null 2>&1; then
    BROWSER="google-chrome-stable"
elif which chromium-browser > /dev/null 2>&1; then
    BROWSER="chromium-browser"
elif which chromium > /dev/null 2>&1; then
    BROWSER="chromium"
else
    # Puppeteerダウンロード済みChromeバイナリの探索
    PUPPETEER_CHROME=$(find /root/.cache/puppeteer /root/.cache -type f -name chrome 2>/dev/null | head -n 1 || true)
    if [ -n "$PUPPETEER_CHROME" ] && [ -x "$PUPPETEER_CHROME" ]; then
        BROWSER="$PUPPETEER_CHROME"
    fi
fi

if [ -z "$BROWSER" ]; then
    echo "⚠️ ブラウザが見つからないため、Google Chrome 安定版をダウンロード・セットアップします..."
    wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb 2>/dev/null
    apt-get install -y -qq /tmp/google-chrome.deb > /dev/null 2>&1 || apt-get install -y -f -qq > /dev/null 2>&1
    rm -f /tmp/google-chrome.deb
    if which google-chrome > /dev/null 2>&1; then
        BROWSER="google-chrome"
    elif which google-chrome-stable > /dev/null 2>&1; then
        BROWSER="google-chrome-stable"
    fi
fi

echo "使用ブラウザ: $BROWSER"

# 4分割POVマルチビュー HTML をブラウザで全画面表示
TARGET_URL="http://127.0.0.1:8088/multiview.html"
rm -rf /tmp/rec_chrome_profile
mkdir -p /tmp/rec_chrome_profile

# WebGL (Three.js) を描画可能にするため SwiftShader / ANGLE を指定し、バックグラウンド抑制を無効化
$BROWSER \
    --no-sandbox \
    --disable-setuid-sandbox \
    --disable-dev-shm-usage \
    --enable-webgl \
    --ignore-gpu-blocklist \
    --use-gl=angle \
    --use-angle=swiftshader \
    --enable-unsafe-swiftshader \
    --window-size=1920,1080 \
    --window-position=0,0 \
    --start-fullscreen \
    --kiosk \
    --force-device-scale-factor=1 \
    --autoplay-policy=no-user-gesture-required \
    --disable-web-security \
    --allow-running-insecure-content \
    --disable-background-timer-throttling \
    --disable-backgrounding-occluded-windows \
    --disable-renderer-backgrounding \
    --no-first-run \
    --no-default-browser-check \
    --disable-extensions \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --user-data-dir=/tmp/rec_chrome_profile \
    "$TARGET_URL" > /content/recordings/browser.log 2>&1 &
BROWSER_PID=$!
sleep 4

echo "=== [4/4] ffmpeg による4画面統合POV収録開始 ==="
echo "録画出力先: $OUTPUT_FILE"
ffmpeg -y -f x11grab -draw_mouse 0 -video_size 1920x1080 -framerate 24 -i :99.0 \
    -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$OUTPUT_FILE" > "$RECORDINGS_DIR/ffmpeg.log" 2>&1 &
FFMPEG_PID=$!

sleep 2
if kill -0 "$FFMPEG_PID" 2>/dev/null; then
    echo "✅ 4分割画面収録システムが正常稼働しました！ (Xvfb:$XVFB_PID, Web:$HTTP_PID, Chrome:$BROWSER_PID, ffmpeg:$FFMPEG_PID)"
    echo "$XVFB_PID $HTTP_PID $BROWSER_PID $FFMPEG_PID" > /content/recorder_pids.txt
    echo "$OUTPUT_FILE" > /content/current_recording_file.txt
else
    echo "⚠️ ffmpeg 起動エラーの可能性があります。直近ログ:"
    tail -n 10 "$RECORDINGS_DIR/ffmpeg.log" 2>/dev/null || true
fi

