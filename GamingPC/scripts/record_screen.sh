#!/bin/bash
# ==============================================================================
# record_screen.sh - Hardware-Accelerated (NVENC 60fps) Screen Recording
# (Supports start, stop, status, toggle with PulseAudio sound)
# ==============================================================================
set -e

ACTION="${1:-status}"
PID_FILE="/content/recorder.pid"
RECORD_DIR="/content/recordings"
GDRIVE_REC="/content/drive/MyDrive/GamingPC/recordings"

mkdir -p "$RECORD_DIR"

start_recording() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "⚠️ 既に画面収録が実行中です (PID: $(cat "$PID_FILE"))"
        return 0
    fi

    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    OUT_FILE="$RECORD_DIR/Screen_${TIMESTAMP}.mp4"
    echo ">> 画面収録を開始します: $OUT_FILE"

    # PulseAudio モニターソース取得
    AUDIO_SRC=$(pactl list short sources 2>/dev/null | grep -E "VirtualSink|monitor" | head -n 1 | awk '{print $2}' || true)
    if [ -z "$AUDIO_SRC" ]; then
        AUDIO_SRC="default"
    fi

    # L4 GPU (NVENC) ハードウェアエンコード
    # 音声と映像を同期して 1920x1080 60fps 収録
    if ffmpeg -encoders 2>&1 | grep -q "h264_nvenc"; then
        echo ">> NVIDIA NVENC ハードウェアアクセラレーションを使用します (L4 GPU)"
        nohup ffmpeg -y \
            -f x11grab -draw_mouse 1 -framerate 60 -video_size 1920x1080 -i :1.0 \
            -f pulse -i "$AUDIO_SRC" \
            -c:v h264_nvenc -preset p4 -tune ll -b:v 8M -maxrate 12M -bufsize 16M \
            -c:a aac -b:a 192k \
            -pix_fmt yuv420p "$OUT_FILE" > /content/ffmpeg_record.log 2>&1 &
    else
        echo ">> ソフトウェアエンコード (libx264) を使用します"
        nohup ffmpeg -y \
            -f x11grab -draw_mouse 1 -framerate 30 -video_size 1920x1080 -i :1.0 \
            -f pulse -i "$AUDIO_SRC" \
            -c:v libx264 -preset veryfast -crf 23 \
            -c:a aac -b:a 192k \
            -pix_fmt yuv420p "$OUT_FILE" > /content/ffmpeg_record.log 2>&1 &
    fi

    REC_PID=$!
    echo "$REC_PID" > "$PID_FILE"
    echo "$OUT_FILE" > /content/recorder_current_file.txt
    sleep 2

    if kill -0 "$REC_PID" 2>/dev/null; then
        echo "✅ 画面収録を開始しました (PID: $REC_PID)"
    else
        echo "⚠️ 収録開始に失敗しました。ログを確認してください:"
        tail -n 15 /content/ffmpeg_record.log 2>/dev/null || true
    fi
}

stop_recording() {
    if [ ! -f "$PID_FILE" ]; then
        echo "画面収録は実行されていません。"
        return 0
    fi

    REC_PID=$(cat "$PID_FILE")
    if kill -0 "$REC_PID" 2>/dev/null; then
        echo ">> 画面収録を終了・MP4ヘッダーを確定中 (PID: $REC_PID)..."
        kill -INT "$REC_PID" 2>/dev/null || true
        # 終了待機
        for i in {1..10}; do
            if ! kill -0 "$REC_PID" 2>/dev/null; then
                break
            fi
            sleep 1
        done
        echo "✅ 画面収録を正常に終了しました。"
    fi
    rm -f "$PID_FILE"

    # Google Drive への同期
    CURRENT_FILE=$(cat /content/recorder_current_file.txt 2>/dev/null || true)
    if [ -n "$CURRENT_FILE" ] && [ -f "$CURRENT_FILE" ]; then
        echo "📁 録画ファイル: $CURRENT_FILE ($(ls -lh "$CURRENT_FILE" | awk '{print $5}'))"
        if [ -d "/content/drive/MyDrive" ]; then
            mkdir -p "$GDRIVE_REC"
            cp -f "$CURRENT_FILE" "$GDRIVE_REC/" 2>/dev/null || true
            echo "✅ Google Drive ($GDRIVE_REC) に同期しました。"
        fi
    fi
}

status_recording() {
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        CURRENT_FILE=$(cat /content/recorder_current_file.txt 2>/dev/null || true)
        echo "🔴 画面収録中 (PID: $(cat "$PID_FILE"), ファイル: $CURRENT_FILE)"
    else
        echo "⚪ 画面収録は停止しています。"
    fi
}

case "$ACTION" in
    start)
        start_recording
        ;;
    stop)
        stop_recording
        ;;
    status)
        status_recording
        ;;
    toggle)
        if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
            stop_recording
        else
            start_recording
        fi
        ;;
    *)
        echo "Usage: $0 {start|stop|status|toggle}"
        exit 1
        ;;
esac
