#!/bin/bash
# ==============================================================================
# record_viewer.sh - AIPlayerごとの目線・視線 (POV) を統合収録する録画システム
# ==============================================================================

RECORDINGS_DIR="/content/recordings"
mkdir -p "$RECORDINGS_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_FILE="${RECORDINGS_DIR}/mc_ai_pov_${TIMESTAMP}.mp4"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== [1/3] 仮想ディスプレイ (Xvfb :99, 1920x1080) 起動 ==="
export DISPLAY=:99
pkill -f "Xvfb :99" || true
Xvfb :99 -screen 0 1920x1080x24 > /dev/null 2>&1 &
XVFB_PID=$!
sleep 2

echo "=== [2/3] AIPlayer視点ストリームの待機 (3001..3004) ==="
# いずれかのViewerポートが起動するのを待機 (最大45秒)
READY=false
for i in {1..30}; do
    if curl -s http://localhost:3001 > /dev/null 2>&1 || curl -s http://localhost:3002 > /dev/null 2>&1; then
        READY=true
        break
    fi
    sleep 1.5
done

if [ "$READY" = true ]; then
    echo "AIPlayer視点ストリームを確認しました。"
else
    echo "⚠️ ストリーム待機タイムアウト。フォールバックで録画待機します。"
fi

# ブラウザの決定
if which chromium-browser > /dev/null 2>&1; then
    BROWSER="chromium-browser"
elif which chromium > /dev/null 2>&1; then
    BROWSER="chromium"
elif which google-chrome > /dev/null 2>&1; then
    BROWSER="google-chrome"
else
    BROWSER="chromium-browser"
fi

# 4分割POVマルチビュー HTML をブラウザで全画面表示
MULTIVIEW_PATH="$SCRIPT_DIR/multiview.html"
$BROWSER --no-sandbox --disable-gpu --window-size=1920,1080 --kiosk --start-fullscreen "file://$MULTIVIEW_PATH" > /dev/null 2>&1 &
BROWSER_PID=$!
sleep 4

echo "=== [3/3] ffmpeg による4画面統合POV収録開始 ==="
echo "出力ファイル: $OUTPUT_FILE"
ffmpeg -y -f x11grab -draw_mouse 0 -video_size 1920x1080 -framerate 24 -i :99.0 \
    -c:v libx264 -preset veryfast -pix_fmt yuv420p "$OUTPUT_FILE" > /dev/null 2>&1 &
FFMPEG_PID=$!

echo "✅ 録画システムが稼働しました (PID: $FFMPEG_PID)"
echo "$XVFB_PID $BROWSER_PID $FFMPEG_PID" > /content/recorder_pids.txt
