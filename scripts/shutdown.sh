#!/bin/bash
# ==============================================================================
# shutdown.sh - 安全な停止・二重バックアップ(Drive/XServer)・日誌Gitプッシュ
# ==============================================================================

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="/content/minecraft_server"
PIPE_PATH="$SERVER_DIR/server.pipe"

echo "=================================================="
echo "    Minecraft AI Colab Server - 安全なシャットダウン"
echo "=================================================="

# 0. 定期バックアッププロセスの終了
pkill -f "backup_restore.py" || true

# 1. 録画プロセスの安全なファイナライズ (ffmpegにSIGINTを送り、正常にMP4ヘッダーを確定)
echo ">> [1/6] 画面収録プロセスを安全にファイナライズ・完了中..."
if [ -f "/content/recorder_pids.txt" ]; then
    source /content/recorder_pids.txt 2>/dev/null || true
    if [ -n "$FFMPEG_PID" ] && kill -0 "$FFMPEG_PID" 2>/dev/null; then
        echo "ffmpeg に正常終了信号 (SIGINT) を送信し、動画データを確定中..."
        kill -INT "$FFMPEG_PID" 2>/dev/null || true
        # 最大6秒間 ffmpeg の安全なクローズを待機
        for i in {1..12}; do
            if ! kill -0 "$FFMPEG_PID" 2>/dev/null; then
                break
            fi
            sleep 0.5
        done
    fi
    # ブラウザ・HTTP・Xvfb の順序で停止
    [ -n "$BROWSER_PID" ] && kill "$BROWSER_PID" 2>/dev/null || true
    [ -n "$HTTP_PID" ] && kill "$HTTP_PID" 2>/dev/null || true
    [ -n "$XVFB_PID" ] && kill "$XVFB_PID" 2>/dev/null || true
    rm -f /content/recorder_pids.txt
fi
# 残存プロセスの念のためクリーンアップ
pkill -INT -f "ffmpeg -y -f x11grab" 2>/dev/null || true
sleep 1
pkill -f "ffmpeg" || true
pkill -f "openbox" || true
pkill -f "Xvfb" || true
pkill -f "chromium" || true
pkill -f "google-chrome" || true

# 録画ファイルが存在する場合、全プレイヤーで即座にストリーミング再生できるよう faststart 最適化
if [ -f "/content/current_recording_file.txt" ]; then
    REC_FILE=$(cat /content/current_recording_file.txt)
    if [ -f "$REC_FILE" ] && [ -s "$REC_FILE" ]; then
        echo "🎬 録画動画のインデックス最適化中 (faststart処理): $REC_FILE"
        OPTIMIZED_FILE="${REC_FILE%.mp4}_opt.mp4"
        ffmpeg -y -v error -i "$REC_FILE" -c copy -movflags +faststart "$OPTIMIZED_FILE" 2>/dev/null || true
        if [ -f "$OPTIMIZED_FILE" ] && [ -s "$OPTIMIZED_FILE" ]; then
            mv -f "$OPTIMIZED_FILE" "$REC_FILE"
            echo "✅ 録画動画の最適化が完了しました: $REC_FILE"
        fi
    fi
fi

# 2. AIPlayer ボットの停止
echo ">> [2/6] AIPlayer (Gemini, ChatGPT, Claude, Grok) をログアウト中..."
pkill -f "node index.js" || true

# 3. Minecraft サーバーへの save-all & stop
echo ">> [3/6] Minecraftワールドを保存して停止中..."
if [ -p "$PIPE_PATH" ]; then
    echo "say サーバーを安全にシャットダウンします..." > "$PIPE_PATH" 2>/dev/null || true
    sleep 1
    echo "save-all" > "$PIPE_PATH" 2>/dev/null || true
    sleep 2
    echo "stop" > "$PIPE_PATH" 2>/dev/null || true
    sleep 5
fi
pkill -TERM -f "server.jar" || true

# ワールド保存完了待機
while pgrep -f "server.jar" > /dev/null; do
    echo "ワールドデータを保存中... お待ちください"
    sleep 2
done
echo "✅ ワールドデータの保存とサーバー停止が完了しました。"
rm -f "$PIPE_PATH" /content/mc_server.pid

# 4. playit.gg トンネル & LLM 停止
pkill -f "playit" || true
pkill -f "ollama serve" || true

# 5. Google Drive / XServer への最終バックアップ同期 (nanndemoya26.key使用)
echo ">> [4/6] 最終ワールド・録画・行動日誌をストレージ(Drive & XServer)に同期中..."
python3 "$REPO_DIR/scripts/backup_restore.py" backup || true

# 6. 行動日誌の保存 & Gitプッシュ
echo ">> [5/6] AIPlayer個別日誌の保存 & GitHubプッシュ..."
if [ -d "/content/logs" ]; then
    mkdir -p "$REPO_DIR/logs"
    cp -r /content/logs/* "$REPO_DIR/logs/" 2>/dev/null || true
    cd "$REPO_DIR"
    git add logs/ 2>/dev/null || true
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    git commit -m "chore: AIPlayerサバイバル行動日誌の保存 (${TIMESTAMP})" 2>/dev/null || true
    git push origin main 2>/dev/null || true
fi

echo "=================================================="
echo "    シャットダウンが完了しました。お疲れ様でした！"
echo "=================================================="
