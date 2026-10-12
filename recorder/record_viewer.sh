#!/bin/bash
# ==============================================================================
# record_viewer.sh - Prismarine-Viewer & ffmpeg によるBot視点自動録画
# ==============================================================================

RECORDINGS_DIR="/content/recordings"
mkdir -p "$RECORDINGS_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_FILE="${RECORDINGS_DIR}/mc_play_${TIMESTAMP}.mp4"

echo "=== [1/3] 仮想ディスプレイ (Xvfb :99) 起動 ==="
export DISPLAY=:99
Xvfb :99 -screen 0 1280x720x24 > /dev/null 2>&1 &
XVFB_PID=$!
sleep 2

echo "=== [2/3] Prismarine-Viewer (Bot視点) のブラウザ描画開始 ==="
# Chromium / Google ChromeでPrismarine-viewerのURLを開く
if which chromium-browser > /dev/null; then
    BROWSER="chromium-browser"
elif which chromium > /dev/null; then
    BROWSER="chromium"
elif which google-chrome > /dev/null; then
    BROWSER="google-chrome"
else
    apt-get update -qq && apt-get install -y -qq chromium-browser > /dev/null 2>&1
    BROWSER="chromium-browser"
fi

# Viewerが起動するまで待機
until curl -s http://localhost:3000 > /dev/null; do
    echo "Prismarine-Viewer の起動待機中..."
    sleep 3
done

$BROWSER --no-sandbox --disable-gpu --window-size=1280,720 --start-fullscreen "http://localhost:3000" > /dev/null 2>&1 &
BROWSER_PID=$!
sleep 5

echo "=== [3/3] ffmpeg による画面収録開始 (出力: $OUTPUT_FILE) ==="
# 20fps, 1280x720, H.264
ffmpeg -y -f x11grab -draw_mouse 0 -video_size 1280x720 -framerate 20 -i :99.0 \
    -c:v libx264 -preset ultrafast -pix_fmt yuv420p "$OUTPUT_FILE" > /dev/null 2>&1 &
FFMPEG_PID=$!

echo "録画がバックグラウンドで開始されました (PID: $FFMPEG_PID)"

# プロセスIDを保存
echo "$XVFB_PID $BROWSER_PID $FFMPEG_PID" > /content/recorder_pids.txt
