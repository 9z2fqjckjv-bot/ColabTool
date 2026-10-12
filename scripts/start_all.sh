#!/bin/bash
# ==============================================================================
# start_all.sh - ワンクリック完全起動スクリプト
# (サーバー・トンネル・LLM・Bot・録画・バックアップ)
# ==============================================================================
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="/content/minecraft_server"

echo "=================================================="
echo "    Minecraft AI Colab Server - 自動起動開始"
echo "=================================================="

# 1. サーバー環境 & ツールセットアップ
echo ">> [1/7] システムセットアップ実行中..."
bash "$REPO_DIR/scripts/setup_server.sh"

# 2. ワールドデータ復元
echo ">> [2/7] ストレージからワールドデータ復元中..."
python3 "$REPO_DIR/scripts/backup_restore.py" restore || true

# 3. LLM推論基盤の準備 (0円/L4 GPU最適化)
echo ">> [3/7] LLM推論エンジンの準備中..."
if [ -z "$GEMINI_API_KEY" ]; then
    echo "ローカルLLM (Ollama) をセットアップ中..."
    if ! which ollama > /dev/null 2>&1; then
        curl -fsSL https://ollama.com/install.sh | sh > /dev/null 2>&1
    fi
    # Ollamaサーバー起動
    OLLAMA_HOST=0.0.0.0:8000 ollama serve > /content/ollama.log 2>&1 &
    sleep 3
    echo "軽量・高性能日本語対応モデル (qwen2.5:7b) をロード中..."
    ollama pull qwen2.5:7b > /dev/null 2>&1 || true
    export LLM_API_URL="http://localhost:8000/v1/chat/completions"
    export LLM_MODEL="qwen2.5:7b"
else
    echo "Google AI Studio (Gemini 1.5 Free Tier) を使用します。"
fi

# 4. Minecraft サーバー起動 (screenセッション内)
echo ">> [4/7] Minecraftサーバー (PaperMC) 起動中..."
cd "$SERVER_DIR"
screen -dmS mc java -Xms8G -Xmx12G -XX:+UseG1GC -jar server.jar nogui

# サーバー起動完了待ち
echo "サーバーの起動待機中 (約30秒)..."
until grep -q "Done" "$SERVER_DIR/logs/latest.log" 2>/dev/null; do
    sleep 3
done
echo "Minecraftサーバーが正常に起動しました！"

# 5. playit.gg トンネル起動
echo ">> [5/7] playit.gg トンネル接続中..."
screen -dmS playit playit

sleep 5
echo ""
echo "=================================================="
echo "★ Minecraft 接続先アドレスの確認 ★"
echo "playit.gg の出力ログ:"
grep -E "claim|tunnel|connect" /root/.config/playit/playit.log 2>/dev/null || true
echo "手元のJava版Minecraftクライアントから接続してください。"
echo "=================================================="
echo ""

# 6. Bot依存関係インストール & AIPlayerクラスタ起動
echo ">> [6/7] AIPlayer群 (Gemini, ChatGPT, Claude, Grok) 起動中..."
cd "$REPO_DIR/bot"
if [ ! -d "node_modules" ]; then
    npm install --silent > /dev/null 2>&1
fi
screen -dmS bots node index.js

# 7. 画面視認 & 録画開始
echo ">> [7/7] Bot視点自動録画システム起動中..."
bash "$REPO_DIR/recorder/record_viewer.sh" > /content/recorder.log 2>&1 &

echo ""
echo "=================================================="
echo "    全システム起動完了！サバイバルをお楽しみください"
echo "=================================================="
echo "※ 終了時は、Colab上の「シャットダウンセル」を実行してください。"
echo ""

# バックグラウンド定期バックアップループ (10分ごと)
while true; do
    sleep 600
    echo "[AutoBackup] 定期バックアップを実行中..."
    python3 "$REPO_DIR/scripts/backup_restore.py" backup || true
done
