import json
import os

files_to_embed = [
    'scripts/setup_server.sh',
    'scripts/backup_restore.py',
    'scripts/start_all.sh',
    'scripts/shutdown.sh',
    'bot/package.json',
    'bot/persona.js',
    'bot/brain.js',
    'bot/index.js',
    'recorder/record_viewer.sh'
]

embed_dict = {}
for rel_path in files_to_embed:
    with open(rel_path, 'r', encoding='utf-8') as f:
        embed_dict[rel_path] = f.read()

embedded_json_str = json.dumps(embed_dict, ensure_ascii=False)

step1_code = f"""#@title 🎮 ワンクリック起動（サーバー・0円LLM・4体Bot・録画）
import os
import sys
import json
import subprocess
import time

print("==================================================")
print("  Minecraft AI Colab Server - 完全自動起動")
print("==================================================")

# 1. Google Drive の自動マウント（データ永続化用）
try:
    from google.colab import drive
    if not os.path.exists('/content/drive/MyDrive'):
        print('📂 Google Drive をマウント中...')
        drive.mount('/content/drive')
    else:
        print('📂 Google Drive は既にマウントされています。')
except Exception as e:
    print('⚠️ Google Driveのマウントをスキップ (ローカル保存で継続):', e)

# 2. リポジトリスクリプト群の完全自己展開（認証不要）
REPO_PATH = '/content/ColabTool'
os.makedirs(REPO_PATH, exist_ok=True)

EMBEDDED_FILES = {embedded_json_str}
for file_path, content in EMBEDDED_FILES.items():
    full_path = os.path.join(REPO_PATH, file_path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, 'w', encoding='utf-8') as f:
        f.write(content)

print('✅ 最新スクリプト一式を /content/ColabTool に展開完了。')

# 3. 実行権限の付与と起動スクリプトの実行
%cd /content/ColabTool
!chmod +x scripts/*.sh scripts/*.py recorder/*.sh
!bash scripts/start_all.sh
"""

step_check_code = """#@title 🔍 Minecraft 接続アドレス＆サーバー状態の確認
import re
import os

print("=== [1] Minecraftサーバー稼働状況 ===")
!pgrep -a java || echo "⚠️ Javaサーバープロセスが見つかりません"

print("\\n=== [2] playit.gg トンネル接続情報 ===")
if os.path.exists('/content/playit.log'):
    with open('/content/playit.log', 'r') as f:
        log_data = f.read()
    
    # 接続アドレスを検索 (tun.ply.gg / gl.joinmc.link / playit.gg)
    matches = re.findall(r'([a-zA-Z0-9\.\-]+\.(?:gl\.joinmc\.link|auto\.playit\.gg|playit\.gg|tun\.ply\.gg)(?::\d+)?)', log_data)
    claims = re.findall(r'(https://playit\.gg/claim/[a-zA-Z0-9]+)', log_data)
    
    if matches:
        print("🎉 【接続先アドレス】手元のMinecraftのダイレクト接続に入力してください:")
        for m in sorted(list(set(matches))):
            print(f"👉  {m}")
    elif claims:
        print("⚠️ トンネルの初期登録が必要です。以下のURLをブラウザで開いて「Add Tunnel」を押してください:")
        print(f"👉  {claims[-1]}")
    else:
        print("トンネル接続準備中... 数秒待ってから再実行してください。")
        !tail -n 10 /content/playit.log
else:
    print("playit.log が見つかりません。")
"""

step2_code = """#@title 💬 サーバーコンソールへのコマンド送信 (例: op <自分のMCユーザー名>)
command = "op your_mc_username" #@param {type:"string"}
pipe_path = "/content/minecraft_server/server.pipe"
if os.path.exists(pipe_path):
    with open(pipe_path, "w") as f:
        f.write(f"{command}\\n")
    print(f"送信完了: {command}")
    !tail -n 10 /content/minecraft_server/logs/latest.log
else:
    print("コマンド送信準備中... 直近のサーバーログ:")
    !tail -n 10 /content/minecraft_server/logs/latest.log 2>/dev/null || true
"""

step3_code = """#@title 🛑 サーバー安全シャットダウン & バックアップ
import os
if os.path.exists('/content/ColabTool'):
    %cd /content/ColabTool
    !bash scripts/shutdown.sh
else:
    print('サーバーが起動されていません。')
"""

notebook_content = {
 "cells": [
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "# 🎮 Minecraft for Colab (AIサバイバルサーバー) - 完全自動版\n",
    "\n",
    "一時的なMinecraft Java版サーバーをGoogle Colab上で起動し、**追加費用0円でLLMを搭載した4体のAI仲間（Gemini, ChatGPT, Claude, Grok）** と日本語チャットしながらサバイバル生活を楽しむための自動化ノートブックです。\n",
    "\n",
    "### 🌟 特徴\n",
    "- **完全0円のLLM**: L4 GPU (24GB VRAM) を活用したローカル推論 (Qwen2.5/Ollama) または Google AI Studio (Gemini 1.5 Free Tier)。\n",
    "- **4人の個性的なAIPlayer**: Gemini（建築・進行）、ChatGPT（採掘・素材管理）、Claude（護衛・安全）、Grok（探索・冒険）が同時に参加。\n",
    "- **自己完結型ワンクリック起動**: 認証不要で1セル実行するだけで、Google Driveマウント・全スクリプト展開・サーバー構築・playit.ggトンネル・Bot参加・録画開始まで全自動で完了。\n",
    "- **データ消失防止**: Google Drive および XServer へのワールドデータ＆録画動画の自動同期・復元。\n",
    "- **自動動画収録**: Bot視点を3Dレンダリングし、プレイ動画（MP4）を自動録画保存。"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 🚀 ステップ 1: 【ワンクリック起動】\n",
    "**下のセルを実行（再生ボタンを押す）するだけ** で、すべての準備・起動・Bot参加・録画が全自動で始まります。  \n",
    "ログ内に表示される **`playit.gg` の接続アドレス**（例: `cairo-kt.tun.ply.gg` や `xxx.gl.joinmc.link`）を手元のMinecraft（Java版）に入力してログインしてください。"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [step1_code]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 🔍 ステップ 2: 【接続アドレス・状態確認】\n",
    "playit.ggの初期リンクを踏んだ後や、いつでも接続先アドレス（`cairo-kt.tun.ply.gg` 等）を確認できます。"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [step_check_code]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 💬 ステップ 3: サーバーコマンド送信（任意・必要な時のみ）\n",
    "自分に管理者権限（OP）を付与したい時や、天候・ゲームルールの変更などに使えます。"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [step2_code]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 🛑 ステップ 4: 【安全なシャットダウン】\n",
    "ゲームを終えるときは、**このセルを実行** してください。  \n",
    "ワールドデータをGoogle Drive/XServerへ確実にバックアップし、動画を保存、プレイ行動日誌を保存して安全に終了します。"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [step3_code]
  }
 ],
 "metadata": {
  "accelerator": "GPU",
  "colab": {
   "gpuType": "L4",
   "provenance": []
  },
  "language_info": {
   "name": "python"
  }
 },
 "nbformat": 4,
 "nbformat_minor": 0
}

with open('Minecraft_Colab_Runner.ipynb', 'w', encoding='utf-8') as f:
    json.dump(notebook_content, f, ensure_ascii=False, indent=1)

print("Masterpiece Minecraft_Colab_Runner.ipynb generated successfully.")
