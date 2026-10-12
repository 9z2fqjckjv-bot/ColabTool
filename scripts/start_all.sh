#!/bin/bash
# ==============================================================================
# start_all.sh - ワンクリック完全起動スクリプト (Colab堅牢化版)
# (サーバー・トンネル・LLM・Bot・録画・バックアップ・動向監視)
# ==============================================================================

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="/content/minecraft_server"
mkdir -p "$SERVER_DIR/logs"

echo "=================================================="
echo "    Minecraft AI Colab Server - 自動起動開始"
echo "=================================================="

# 1. サーバー環境 & ツールセットアップ
echo ">> [1/7] システムセットアップ実行中..."
bash "$REPO_DIR/scripts/setup_server.sh" || true

# 2. ワールドデータ復元
echo ">> [2/7] ストレージからワールドデータ復元中..."
python3 "$REPO_DIR/scripts/backup_restore.py" restore || true

# 3. LLM推論基盤の準備 (0円/L4 GPU最適化)
echo ">> [3/7] LLM推論エンジンの準備中..."
if [ -z "$GEMINI_API_KEY" ]; then
    echo "ローカルLLM (Ollama) を確認中..."
    if ! command -v ollama >/dev/null 2>&1; then
        echo "Ollama に必要な zstd をインストール中..."
        apt-get install -y -qq zstd >/dev/null 2>&1 || true
        echo "Ollama をインストール中 (数秒)..."
        curl -fsSL https://ollama.com/install.sh | sh || true
    fi

    # Ollamaサーバー起動
    echo "Ollama サーバーをバックグラウンド起動中..."
    pkill -f "ollama serve" || true
    sleep 1
    OLLAMA_HOST=0.0.0.0:8000 nohup ollama serve > /content/ollama.log 2>&1 &
    sleep 3

    echo "日本語対応LLMモデル (qwen2.5:7b) をダウンロード中 (約4.5GB、1〜2分)..."
    ollama pull qwen2.5:7b || echo "モデルロードを再試行します..."

    export LLM_API_URL="http://localhost:8000/v1/chat/completions"
    export LLM_MODEL="qwen2.5:7b"
else
    echo "Google AI Studio (Gemini 1.5 Free Tier) を使用します。"
fi

# 4. Minecraft サーバー起動 (Named Pipeによる安全なCUI入出力)
echo ">> [4/7] Minecraftサーバー (PaperMC) 起動中..."
cd "$SERVER_DIR"

# 入力パイプ作成 (コマンド配信用)
PIPE_PATH="$SERVER_DIR/server.pipe"
rm -f "$PIPE_PATH"
mkfifo "$PIPE_PATH" 2>/dev/null || true

# サーバー起動 (nohupバックグラウンド)
tail -f "$PIPE_PATH" 2>/dev/null | java -Xms8G -Xmx12G -XX:+UseG1GC -jar server.jar nogui > "$SERVER_DIR/logs/console.log" 2>&1 &
MC_PID=$!
echo "$MC_PID" > /content/mc_server.pid

# サーバー起動完了待ち
echo "サーバーの起動完了を待機中 (約30秒)..."
for i in {1..30}; do
    if grep -q "Done" "$SERVER_DIR/logs/latest.log" 2>/dev/null || grep -q "Done" "$SERVER_DIR/logs/console.log" 2>/dev/null; then
        break
    fi
    sleep 2
done
echo "✅ Minecraftサーバーが正常に起動しました！"

# 5. playit.gg トンネル起動
echo ">> [5/7] playit.gg トンネル接続中..."
pkill -f "playit" || true
nohup playit --stdout > /content/playit.log 2>&1 &
sleep 5

echo ""
echo "=================================================="
echo "★ Minecraft 接続先アドレスの確認 ★"
echo "playit.gg の接続ステータス:"
grep -E "claim|tunnel|connect|setup at|https://" /content/playit.log 2>/dev/null || cat /content/playit.log | head -n 10
echo "--------------------------------------------------"
echo "手元のJava版Minecraftクライアントから上記アドレスで接続してください。"
echo "=================================================="
echo ""

# 6. Bot依存関係インストール & AIPlayerクラスタ起動
echo ">> [6/7] AIPlayer群 (Gemini, ChatGPT, Claude, Grok) 起動中..."
cd "$REPO_DIR/bot"
if [ ! -d "node_modules" ]; then
    npm install --silent > /dev/null 2>&1 || true
fi
pkill -f "node index.js" || true
nohup node index.js > /content/bots.log 2>&1 &

# 7. 画面視認 & 録画開始
echo ">> [7/7] Bot視点自動録画システム起動中..."
nohup bash "$REPO_DIR/recorder/record_viewer.sh" > /content/recorder.log 2>&1 &

echo ""
echo "=================================================="
echo "    全システム起動完了！サバイバルをお楽しみください"
echo "=================================================="
echo "※ 終了時は、ノートブックの「シャットダウンセル」を実行してください。"
echo "※ 以下にサーバーのログ・動向をリアルタイム表示します..."
echo ""

# バックグラウンド定期バックアップ (10分ごと)
(
    while true; do
        sleep 600
        echo ""
        echo "[AutoBackup] 定期バックアップを実行中..."
        python3 "$REPO_DIR/scripts/backup_restore.py" backup || true
    done
) &

# サーバーコンソールログをリアルタイム監視・出力
touch "$SERVER_DIR/logs/latest.log"
tail -f "$SERVER_DIR/logs/latest.log"
