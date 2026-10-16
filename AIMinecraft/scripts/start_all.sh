#!/bin/bash
# ==============================================================================
# start_all.sh - ワンクリック完全起動スクリプト (Colab非同期・独立稼働・即座完了版)
# ==============================================================================

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="/content/minecraft_server"
mkdir -p "$SERVER_DIR/logs" "/content/logs" "/content/recordings"

echo "=================================================="
echo "    Minecraft AI Colab Server - 自動起動開始"
echo "=================================================="

# 1. サーバー環境 & ツール & RadarMapプラグインセットアップ
echo ">> [1/7] システム & プラグインセットアップ実行中..."
bash "$REPO_DIR/scripts/setup_server.sh" || true

# 2. ワールドデータ復元 (Google Drive または XServer)
echo ">> [2/7] ストレージからワールドデータ復元中..."
python3 "$REPO_DIR/scripts/backup_restore.py" restore || true

# 3. LLM推論基盤の準備 (0円/GPU最適化)
echo ">> [3/7] LLM推論エンジンの準備中..."
if [ -z "$GEMINI_API_KEY" ]; then
    echo "ローカルLLM (Ollama) を確認中..."
    if ! command -v ollama >/dev/null 2>&1; then
        echo "Ollama をインストール中..."
        curl -fsSL https://ollama.com/install.sh | sh || true
    fi

    # Ollamaサーバー起動
    echo "Ollama サーバーをバックグラウンド起動中..."
    pkill -f "ollama serve" || true
    sleep 1
    OLLAMA_HOST=0.0.0.0:8000 nohup ollama serve > /content/ollama.log 2>&1 &
    sleep 3

    MODEL_NAME="qwen2.5:1.5b"
    echo "日本語対応高速モデル ($MODEL_NAME) を準備中..."
    ollama pull "$MODEL_NAME" > /dev/null 2>&1 || true

    export LLM_API_URL="http://localhost:8000/v1/chat/completions"
    export LLM_MODEL="$MODEL_NAME"
    echo "✅ ローカルLLMエンジンの準備完了。"
else
    echo "✅ Google AI Studio (Gemini Free Tier) を使用します。"
fi

# 4. Minecraft サーバー起動 (FIFOパイプ経由でコマンド送信可能にする)
echo ">> [4/7] Minecraftサーバー (PaperMC) 起動中..."
cd "$SERVER_DIR"
pkill -f "server.jar" || true

PIPE_PATH="$SERVER_DIR/server.pipe"
rm -f "$PIPE_PATH"
mkfifo "$PIPE_PATH"

# サーバー起動 (ColabのRAM 12.7GBでOOM強制終了を防ぐため-Xms2G -Xmx7Gに最適化)
nohup tail -f "$PIPE_PATH" | java -Xms2G -Xmx7G -XX:+UseG1GC -jar server.jar nogui > "$SERVER_DIR/logs/latest.log" 2>&1 &
MC_PID=$!
echo "$MC_PID" > /content/mc_server.pid

# サーバー起動完了待ち (最大75秒)
echo "サーバーの起動完了を待機中..."
STARTED=false
for i in {1..38}; do
    if grep -q "Done (" "$SERVER_DIR/logs/latest.log" 2>/dev/null; then
        STARTED=true
        break
    fi
    if ! kill -0 "$MC_PID" 2>/dev/null; then
        echo "⚠️ サーバーが予期せず停止しました。直近ログ:"
        tail -n 20 "$SERVER_DIR/logs/latest.log" 2>/dev/null || true
        break
    fi
    sleep 2
    echo -n "."
done
echo ""

if [ "$STARTED" = true ]; then
    echo "✅ Minecraftサーバーが正常に起動しました！(ポート: 25565)"
    # 拠点の安全確保: モブ攻撃・クリーパー爆発・ゾンビドア破壊による拠点チェスト・ベッド・家具破壊を完全無効化
    if [ -p "$PIPE_PATH" ]; then
        echo "gamerule mobGriefing false" > "$PIPE_PATH"
        echo "🛡️ gamerule mobGriefing false を設定し、モブによる拠点ブロック破壊を無効化しました。"
    fi
else
    echo "⚠️ 起動確認がタイムアウトしましたが、バックグラウンドで起動継続中です。"
fi

# 5. playit.gg トンネル起動 (固定エージェント: zuyasi / 固定ドメイン: zuyasi.playit.plus)
echo ">> [5/7] playit.gg トンネル接続中 (エージェント: zuyasi / zuyasi.playit.plus)..."
pkill -f "playit" || true

PLAYIT_SECRET="5ae8f7c17f9d58ecb144ed6df1f6d1bdffb6a30bc14a09a815976da2ccd174c1"
mkdir -p /etc/playit /root/.config/playit_gg /content
if [ -f "$REPO_DIR/playit.toml" ]; then
    cp -f "$REPO_DIR/playit.toml" /etc/playit/playit.toml
    cp -f "$REPO_DIR/playit.toml" /root/.config/playit_gg/playit.toml
    cp -f "$REPO_DIR/playit.toml" /content/playit.toml
fi

nohup playit --secret "$PLAYIT_SECRET" --stdout > /content/playit.log 2>&1 &
echo "playit.gg の接続確立を待機中..."
for i in {1..15}; do
    if grep -qE "tunnel running|registered|cairo-medicinal|zuyasi" /content/playit.log 2>/dev/null; then
        break
    fi
    sleep 1
    echo -n "."
done
echo ""

# 6. Bot依存関係インストール & AIPlayerクラスタ起動
cd "$REPO_DIR/bot"
if [ ! -d "node_modules/canvas" ] || [ ! -d "node_modules/prismarine-viewer" ]; then
    echo "Mineflayer Bot & Viewer (canvas) の依存関係をインストール中 (約30秒)..."
    npm install --silent > /content/npm_install.log 2>&1 || npm install || true
    if [ ! -d "node_modules/canvas" ]; then
        echo "canvas の単体インストールを試行中..."
        npm install canvas --no-save > /dev/null 2>&1 || true
    fi
fi
pkill -9 -f "node index.js" || true
fuser -k 3001/tcp 3002/tcp 3003/tcp 3004/tcp 2>/dev/null || true
sleep 1

# Minecraftサーバーのポート25565開放を確実に待機
echo "Minecraftサーバーポート (25565) の準備を確認中..."
for i in {1..20}; do
    if nc -z 127.0.0.1 25565 2>/dev/null || grep -q "Done (" "$SERVER_DIR/logs/latest.log" 2>/dev/null; then
        break
    fi
    sleep 1
done

nohup node index.js > /content/bots.log 2>&1 &
echo "✅ AIPlayerクラスタをバックグラウンド起動しました (ログ: /content/bots.log)"

echo "AIPlayer (Gemini, ChatGPT, Claude, Grok) のワールド参加を待機中..."
for i in {1..12}; do
    if grep -q "スポーン完了" /content/bots.log 2>/dev/null; then
        echo "🎉 AIPlayerがワールドへ正常にスポーン完了しました！"
        break
    fi
    sleep 1
    echo -n "."
done
echo ""


# 7. 4分割画面視線収録 (POV) 開始
echo ">> [7/7] AIPlayer目線・視線画面収録システム起動中..."
nohup bash "$REPO_DIR/recorder/record_viewer.sh" > /content/recorder.log 2>&1 &
echo "✅ 録画システムをバックグラウンド起動しました"

# 8. バックグラウンド定期バックアップ (10分ごと)
nohup bash -c "while true; do sleep 600; python3 '$REPO_DIR/scripts/backup_restore.py' backup > /content/autobackup.log 2>&1; done" > /dev/null 2>&1 &

echo ""
echo "=================================================="
echo "★ Minecraft 接続先アドレス (固定完了) ★"
echo "=================================================="
echo "🎉 【固定接続先アドレス】手元のMinecraftに入力してログイン:"
echo "👉  zuyasi.playit.plus"
echo "   (予備アドレス: cairo-medicinal.tun.ply.gg:47605)"
echo "--------------------------------------------------"

CLAIM_URL=$(grep -oE "https://playit\.gg/claim/[a-zA-Z0-9]+" /content/playit.log 2>/dev/null | head -n 1)
if [ -n "$CLAIM_URL" ]; then
    echo "⚠️ トンネル登録URLが検出されました (通常は自動認証されるため不要です):"
    echo "👉  $CLAIM_URL"
    echo "--------------------------------------------------"
fi

echo "🗺️ 【全員位置レーダー地図】: スポーン時に自動配布されます (Fキーで左手に装備可能)"
echo "🤖 【AI仲間へのメンション】: @Gemini, @ChatGPT, @Claude, @Grok, @みんな"
echo "🎥 【画面収録 & 日誌】: /content/recordings/ & /content/logs/"
echo "💾 【保管場所】: Google Drive & XServer (nanndemoya26.key) 二重同期"
echo "=================================================="
echo "✨ サーバーはバックグラウンドで独立して稼働しています。"
echo "✨ このセルは正常終了しました。他のセルを自由にご利用いただけます。"
echo "=================================================="
exit 0
