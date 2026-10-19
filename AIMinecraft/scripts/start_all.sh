#!/bin/bash
# ==============================================================================
# start_all.sh - ワンクリック完全起動スクリプト (改善指示書v3準拠)
# Qwen 2.5(14B)・2グループ全10名AIPlayer・総合行動モニターWebポータル・高速キャッシュ
# ==============================================================================

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="/content/minecraft_server"
mkdir -p "$SERVER_DIR/logs" "/content/logs"

echo "=================================================="
echo "    Minecraft AI Colab Cluster - 自動起動開始 (v3)"
echo "=================================================="

# 1. サーバー環境 & ツール & RadarMapプラグインセットアップ
echo ">> [1/7] システム & プラグインセットアップ実行中..."
bash "$REPO_DIR/scripts/setup_server.sh" || true

# 2. 以前のワールドデータおよび高速キャッシュの復元 (動画の拠点・ネザーポータルを保護)
echo ">> [2/7] 以前のワールドデータ復元 & 高速キャッシュ復元中..."

# 以前のワールドを Google Drive / XServer から最優先復元 (絶対に削除しない)
python3 "$REPO_DIR/scripts/backup_restore.py" restore || true
python3 "$REPO_DIR/scripts/backup_restore.py" restore_cache || true

# 旧4AI日誌のみをクリーン消去 (ワールドデータは完全保持)
rm -f /content/logs/ChatGPT_diary.md /content/logs/Claude_diary.md /content/logs/Gemini_diary.md /content/logs/Grok_diary.md /content/logs/survival_diary_combined.md 2>/dev/null || true
rm -f "$SERVER_DIR/logs/ChatGPT_diary.md" "$SERVER_DIR/logs/Claude_diary.md" "$SERVER_DIR/logs/Gemini_diary.md" "$SERVER_DIR/logs/Grok_diary.md" 2>/dev/null || true

# サーバー設定の再保証 (max-players=50, allow-flight=true, online-mode=false, connection-throttle=-1)
if [ -f "$SERVER_DIR/server.properties" ]; then
    sed -i 's/^max-players=.*/max-players=50/' "$SERVER_DIR/server.properties"
    sed -i 's/^online-mode=.*/online-mode=false/' "$SERVER_DIR/server.properties"
    sed -i 's/^allow-flight=.*/allow-flight=true/' "$SERVER_DIR/server.properties"
    sed -i 's/^network-compression-threshold=.*/network-compression-threshold=-1/' "$SERVER_DIR/server.properties"
    if grep -q "^enforce-secure-profile=" "$SERVER_DIR/server.properties"; then
        sed -i 's/^enforce-secure-profile=.*/enforce-secure-profile=false/' "$SERVER_DIR/server.properties"
    else
        echo "enforce-secure-profile=false" >> "$SERVER_DIR/server.properties"
    fi
fi
if [ -f "$SERVER_DIR/bukkit.yml" ]; then
    sed -i 's/connection-throttle:.*/connection-throttle: -1/' "$SERVER_DIR/bukkit.yml"
fi

# 3. LLM推論基盤の準備 (Qwen 2.5: Colab L4 24GB VRAM 最適化モデル)
echo ">> [3/7] LLM推論エンジン (Qwen 2.5 - 14B) の準備中..."
if ! command -v ollama >/dev/null 2>&1; then
    echo "Ollama をインストール中..."
    curl -fsSL https://ollama.com/install.sh | sh || true
fi

# Ollamaサーバー起動 (ホストRAM節約・GPU専従設定)
echo "Ollama サーバーをバックグラウンド起動中..."
pkill -f "ollama serve" || true
sleep 1
OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_HOST=0.0.0.0:8000 nohup ollama serve > /content/ollama.log 2>&1 &
sleep 3

# Colab L4 GPU上で機能する最高スペック: qwen2.5:14b (VRAM ~9GB使用、高速高精度)
MODEL_NAME="qwen2.5:14b"
echo "日本語対応・高スペックモデル ($MODEL_NAME) を準備中..."
if ! ollama list 2>/dev/null | grep -q "qwen2.5:14b"; then
    echo "Qwen 2.5 14B を取得中 (キャッシュがない場合の初回のみ)..."
    ollama pull "$MODEL_NAME" > /dev/null 2>&1 || {
        echo "⚠️ 14Bモデルの取得に失敗した場合、高速安定版 7B をフォールバック利用します..."
        MODEL_NAME="qwen2.5:7b"
        ollama pull "$MODEL_NAME" > /dev/null 2>&1 || true
    }
fi

export LLM_API_URL="http://localhost:8000/v1/chat/completions"
export LLM_MODEL="$MODEL_NAME"
echo "✅ Qwen 2.5 推論エンジンの準備完了 ($MODEL_NAME)。"

# 4. Minecraft サーバー起動 (FIFOパイプ経由でコンソールコマンド送信可能)
echo ">> [4/7] Minecraftサーバー (PaperMC 1.21.1) 起動中..."
cd "$SERVER_DIR"
pkill -f "server.jar" || true
pkill -f "sleep 999999999" || true

PIPE_PATH="$SERVER_DIR/server.pipe"
rm -f "$PIPE_PATH"
mkfifo "$PIPE_PATH"
nohup sleep 999999999 > "$PIPE_PATH" 2>/dev/null &

# サーバー起動 (Colab RAM最適化: -Xms1G -Xmx2560M でOOM Killerを完全回避)
nohup java -Xms1G -Xmx2560M -XX:+UseG1GC -jar server.jar nogui < "$PIPE_PATH" > "$SERVER_DIR/logs/latest.log" 2>&1 &
MC_PID=$!
echo "$MC_PID" > /content/mc_server.pid

# サーバー起動完了待機
echo "サーバーの起動完了を待機中..."
STARTED=false
for i in {1..35}; do
    if grep -q "Done (" "$SERVER_DIR/logs/latest.log" 2>/dev/null; then
        STARTED=true
        break
    fi
    if ! kill -0 "$MC_PID" 2>/dev/null; then
        echo "⚠️ サーバー起動エラー。直近ログ:"
        tail -n 20 "$SERVER_DIR/logs/latest.log" 2>/dev/null || true
        break
    fi
    sleep 2
    echo -n "."
done
echo ""

if [ "$STARTED" = true ]; then
    echo "✅ Minecraftサーバーが正常に起動しました！(ポート: 25565)"
    if [ -p "$PIPE_PATH" ]; then
        echo "gamerule mobGriefing false" > "$PIPE_PATH"
        echo "🛡️ gamerule mobGriefing false を設定し、拠点ブロック破壊を無効化しました。"
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
for i in {1..12}; do
    if grep -qE "tunnel running|registered|cairo-medicinal|zuyasi" /content/playit.log 2>/dev/null; then
        break
    fi
    sleep 1
    echo -n "."
done
echo ""

# 6. AIPlayerクラスタ (全10名 / 2グループ) & 総合Webポータル起動
echo ">> [6/7] AIPlayerクラスタ (10名) & 総合行動モニターWebポータル起動中..."
cd "$REPO_DIR/bot"
if [ ! -d "node_modules" ] || [ ! -d "node_modules/mineflayer" ]; then
    echo "Mineflayer & Express の依存関係をインストール中..."
    npm install --silent > /content/npm_install.log 2>&1 || npm install || true
fi
pkill -9 -f "node index.js" || true
pkill -9 -f "node --max-old-space-size" || true
sleep 1

for i in {1..15}; do
    if nc -z 127.0.0.1 25565 2>/dev/null || grep -q "Done (" "$SERVER_DIR/logs/latest.log" 2>/dev/null; then
        break
    fi
    sleep 1
done

export SERVER_PIPE="$PIPE_PATH"
export NODE_OPTIONS="--max-old-space-size=4096 --expose-gc"
nohup node --max-old-space-size=4096 --expose-gc index.js > /content/bots.log 2>&1 &
echo "✅ AIPlayerクラスタ & 行動モニターWebポータルをバックグラウンド起動しました (ポート: 3000)"

# Webポータル (ポート3000) の起動完了を確実に待機 (502 Bad Gateway 防止)
echo "Webポータル (ポート: 3000) のリッスン開始を待機中..."
for i in {1..20}; do
    if nc -z 127.0.0.1 3000 2>/dev/null; then
        echo "✅ ポート 3000 が正常にリッスンされました！"
        break
    fi
    sleep 1
    echo -n "."
done
echo ""

# Webポータルの外部公開用トンネル (Cloudflare Tunnel)
if ! command -v cloudflared >/dev/null 2>&1; then
    wget -q -O /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb 2>/dev/null || true
    dpkg -i /tmp/cloudflared.deb >/dev/null 2>&1 || true
    rm -f /tmp/cloudflared.deb
fi

if command -v cloudflared >/dev/null 2>&1; then
    pkill -f "cloudflared" || true
    nohup cloudflared tunnel --url http://localhost:3000 > /content/portal_tunnel.log 2>&1 &
    sleep 4
fi

echo "WebポータルのCloudflare公開トンネルURL確立を待機中..."
PORTAL_URL=""
for i in {1..20}; do
    PORTAL_URL=$(grep -oE "https://[a-zA-Z0-9-]+\.trycloudflare\.com" /content/portal_tunnel.log 2>/dev/null | tail -n 1 || true)
    if [ -n "$PORTAL_URL" ]; then
        echo "$PORTAL_URL" > /content/portal_url.txt
        break
    fi
    sleep 1
    echo -n "."
done
echo ""

# 7. バックグラウンド定期自動バックアップ (5分ごと、いつランタイムが切れても安全なように永続化)
echo ">> [7/7] バックグラウンド定期自動バックアップ常駐開始 (5分間隔)..."
nohup bash -c "while true; do sleep 300; cp -f '$SERVER_DIR/logs/latest.log' /content/logs/mc_server_latest.log 2>/dev/null; cp -f /content/bots.log /content/logs/bots.log 2>/dev/null; python3 '$REPO_DIR/scripts/backup_restore.py' backup > /content/autobackup.log 2>&1; done" > /dev/null 2>&1 &

echo ""
echo "=================================================="
echo "★ Minecraft & 総合Webポータル 接続情報 (v3) ★"
echo "=================================================="
echo "🎉 【Minecraft 接続先アドレス】(Java版 1.21.x):"
echo "👉  zuyasi.playit.plus"
echo "--------------------------------------------------"
echo "🌐 【総合行動モニター Webポータル URL】:"
if [ -n "$PORTAL_URL" ]; then
    echo "👉  $PORTAL_URL"
else
    echo "👉  http://localhost:3000"
fi
echo "--------------------------------------------------"
echo "🤖 【参加AIPlayer】: 全10名 (2グループ体制)"
echo "   ・第1グループ (5名): 撃退隊長, 農作業, 資材集め1&2(ペア), モブ狩り"
echo "   ・第2グループ (5名): 動物飼育, 洞窟探検1&2(ペア), ネザー遠征1&2(ペア)"
echo "🧠 【推論エンジン】: Qwen 2.5 ($MODEL_NAME on Colab L4 GPU)"
echo "💾 【保管場所】: Google Drive & XServer (nanndemoya26.key) 二重同期"
echo "=================================================="
echo "✨ サーバー・10体AIPlayer・Webポータルはバックグラウンドで独立して稼働しています。"
echo "=================================================="
exit 0
