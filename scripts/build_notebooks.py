#!/usr/bin/env python3
import json
from pathlib import Path

repo_dir = Path(__file__).resolve().parent.parent

embedded_files = {}
file_rel_paths = [
    'scripts/setup_server.sh',
    'scripts/start_all.sh',
    'scripts/shutdown.sh',
    'scripts/backup_restore.py',
    'scripts/live_apply.sh',
    'bot/package.json',
    'bot/persona.js',
    'bot/brain.js',
    'bot/knowledge_base.js',
    'bot/vision_capturer.js',
    'bot/index.js',
    'recorder/record_viewer.sh',
    'recorder/multiview.html',
    'plugins_src/RadarMap/src/main/java/com/colabtool/radarmap/RadarMapPlugin.java',
    'plugins_src/RadarMap/src/main/java/com/colabtool/radarmap/RadarMapRenderer.java',
    'plugins_src/RadarMap/src/main/resources/plugin.yml',
    'nanndemoya26.key',
    'playit.toml'
]

for rel in file_rel_paths:
    fpath = repo_dir / rel
    if fpath.exists():
        embedded_files[rel] = fpath.read_text(encoding='utf-8')
    else:
        print(f"Warning: {rel} not found!")

embedded_json_str = json.dumps(embedded_files, ensure_ascii=False)

embedded_binaries = {}
if (repo_dir / 'plugins/RadarMap.jar').exists():
    import base64
    embedded_binaries['plugins/RadarMap.jar'] = base64.b64encode((repo_dir / 'plugins/RadarMap.jar').read_bytes()).decode('ascii')
embedded_bin_str = json.dumps(embedded_binaries)

nb = {
 "cells": [
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "# 🎮 Minecraft for Colab (自律AIサバイバルサーバー) - 改善対応版\n",
    "\n",
    "一時的なMinecraft Java版サーバーをGoogle Colab上で起動し、**追加費用0円でLLMを搭載した4体の自律AI仲間（Gemini, ChatGPT, Claude, Grok）** と共にサバイバル生活を楽しむための自動化ノートブックです。\n",
    "\n",
    "### 🌟 改善指示書に基づく主な強化ポイント\n",
    "- **自律行動＆役割分担の廃止**: 各AIが固定の役割制限なく、自律的に木こり・採掘・探索・建築・モンスター討伐・クラフト・追従を判断して実行。\n",
    "- **動的テキスト生成＆定型文の廃止**: テンプレート返信を完全排除。ユーザーの発言、時刻、HP、周囲のバイオームを考慮して毎回ユニークな発言を生成。\n",
    "- **メンション対応**: `@Gemini`, `@ChatGPT`, `@Claude`, `@Grok` による個別指示や、`@all`, `@みんな`, `@全員` による一斉指示に対応。\n",
    "- **自動縮尺レーダー地図**: スポーン時にプレイヤーと全AI仲間の位置がリアルタイムに表示されるレーダー地図を自動配布（Fキーでオフハンド装備可能）。遠くに離れても自動で縮尺調整。\n",
    "- **4分割一人称視点 (POV) 画面収録**: 各AIPlayerの目線・視線を1920x1080の4分割画面で自動録画。\n",
    "- **AIPlayer個別行動日誌**: 各Botの自律的な思考、行動、対話履歴を個別のMarkdown日誌（`/content/logs/`）としてリアルタイム保存。\n",
    "- **二重バックアップ (Google Drive & XServer)**: `nanndemoya26.key` を活用し、Google DriveだけでなくXServerレンタルサーバーにもワールド・録画動画・日誌を完全同期。\n",
    "- **Colab非同期・独立稼働**: セル実行は約45秒〜1分で完了して終了するため、後続のセルやターミナルを自由に操作可能。"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 🚀 ステップ 1: 【ワンクリック起動】\n",
    "**下のセルを実行（再生ボタンを押す）するだけ** で、すべての準備・起動・Bot参加・録画が全自動で始まります。  \n",
    "サーバーはバックグラウンドで独立稼働し、**約45秒〜1分でこのセルの実行は完了**します。  \n",
    "完了後、固定接続アドレス **`zuyasi.playit.plus`**（予備: `cairo-medicinal.tun.ply.gg:47605`）を手元のMinecraft（Java版）に入力してログインしてください。"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "#@title 🎮 ワンクリック起動（サーバー・自律AI・レーダー地図・POV録画）\n",
    "import os\n",
    "import sys\n",
    "import json\n",
    "import base64\n",
    "import subprocess\n",
    "import time\n",
    "\n",
    "print(\"==================================================\")\n",
    "print(\"  Minecraft AI Colab Server - 完全自動起動\")\n",
    "print(\"==================================================\")\n",
    "\n",
    "# 1. Google Drive の自動マウント（データ永続化用）\n",
    "try:\n",
    "    from google.colab import drive\n",
    "    if not os.path.exists(\"/content/drive/MyDrive\"):\n",
    "        print(\"📂 Google Drive をマウント中...\")\n",
    "        drive.mount(\"/content/drive\")\n",
    "    else:\n",
    "        print(\"📂 Google Drive は既にマウントされています。\")\n",
    "except Exception as e:\n",
    "    print(\"⚠️ Google Driveのマウントをスキップ (ローカル保存で継続):\", e)\n",
    "\n",
    "# 2. リポジトリスクリプト群の完全自己展開（認証不要）\n",
    "REPO_PATH = \"/content/ColabTool\"\n",
    "os.makedirs(REPO_PATH, exist_ok=True)\n",
    "\n",
    f"EMBEDDED_FILES = {embedded_json_str}\n",
    f"EMBEDDED_BINARIES = {embedded_bin_str}\n",
    "\n",
    "for file_path, content in EMBEDDED_FILES.items():\n",
    "    full_path = os.path.join(REPO_PATH, file_path)\n",
    "    os.makedirs(os.path.dirname(full_path), exist_ok=True)\n",
    "    with open(full_path, \"w\", encoding=\"utf-8\") as f:\n",
    "        f.write(content)\n",
    "\n",
    "for file_path, b64_str in EMBEDDED_BINARIES.items():\n",
    "    full_path = os.path.join(REPO_PATH, file_path)\n",
    "    os.makedirs(os.path.dirname(full_path), exist_ok=True)\n",
    "    with open(full_path, \"wb\") as f:\n",
    "        f.write(base64.b64decode(b64_str))\n",
    "\n",
    "print(\"✅ 最新スクリプト・プラグイン一式を /content/ColabTool に展開完了。\")\n",
    "\n",
    "# 3. 実行権限の付与と起動スクリプトの実行 (非同期・即座完了)\n",
    "get_ipython().run_line_magic(\"cd\", \"/content/ColabTool\")\n",
    "!chmod +x scripts/*.sh scripts/*.py recorder/*.sh\n",
    "!chmod 600 nanndemoya26.key 2>/dev/null || true\n",
    "!bash scripts/start_all.sh\n"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 🔍 ステップ 2: 【接続アドレス・サーバー稼働状況確認】\n",
    "いつでも現在の接続先アドレスや各プロセスの稼働状態を確認できます。"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "#@title 🔍 Minecraft 接続アドレス＆サーバー状態の確認\n",
    "import re\n",
    "import os\n",
    "\n",
    "print(\"=== [1] Minecraftサーバー稼働状況 ===\")\n",
    "!pgrep -a java || echo \"⚠️ Javaサーバープロセスが見つかりません\"\n",
    "\n",
    "print(\"\\n=== [2] playit.gg トンネル接続情報 (エージェント: zuyasi 固定) ===\")\n",
    "print(\"🎉 【固定接続先アドレス】手元のMinecraftのダイレクト接続に入力してください:\")\n",
    "print(\"👉  zuyasi.playit.plus\")\n",
    "print(\"   (予備アドレス: cairo-medicinal.tun.ply.gg:47605)\")\n",
    "if os.path.exists(\"/content/playit.log\"):\n",
    "    with open(\"/content/playit.log\", \"r\") as f:\n",
    "        log_data = f.read()\n",
    "    \n",
    "    matches = re.findall(r\"([a-zA-Z0-9\\.\\-]+\\.(?:gl\\.joinmc\\.link|auto\\.playit\\.gg|playit\\.gg|tun\\.ply\\.gg)(?::\\d+)?)\", log_data)\n",
    "    claims = re.findall(r\"(https://playit\\.gg/claim/[a-zA-Z0-9]+)\", log_data)\n",
    "    \n",
    "    if claims:\n",
    "        print(\"⚠️ トンネル登録URLが検出されました (通常は自動認証されるため不要です):\", claims[-1])\n",
    "    else:\n",
    "        print(\"✅ 固定トンネル (zuyasi.playit.plus) に正常バインドされています。\")\n",
    "else:\n",
    "    print(\"playit.log が見つかりません。\")\n",
    "\n",
    "print(\"\\n=== [3] AIPlayer Bot 状態 ===\")\n",
    "if os.path.exists(\"/content/bots.log\"):\n",
    "    !tail -n 12 /content/bots.log\n",
    "else:\n",
    "    print(\"bots.log がまだ生成されていません。\")\n"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 📔 ステップ 3: 【AIPlayerサバイバル行動日誌の確認】\n",
    "Gemini, ChatGPT, Claude, Grok の4体が記録した最新の行動日誌・自律意思決定をリアルタイム表示します。"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "#@title 📔 AIPlayerサバイバル行動日誌の閲覧\n",
    "import os\n",
    "import glob\n",
    "\n",
    "log_files = glob.glob(\"/content/logs/*_diary.md\")\n",
    "if log_files:\n",
    "    print(f\"検出された行動日誌一覧: {[os.path.basename(f) for f in log_files]}\")\n",
    "    for lf in sorted(log_files):\n",
    "        print(f\"\\n========================================\")\n",
    "        print(f\"  {os.path.basename(lf)} (直近の記録)\")\n",
    "        print(f\"========================================\")\n",
    "        !tail -n 12 \"{lf}\"\n",
    "else:\n",
    "    print(\"行動日誌は生成待機中です (/content/logs/)\")\n"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 💬 ステップ 4: 【AI仲間へのチャット・指示送信】\n",
    "ゲーム内だけでなく、Colabのノートブックから直接AI仲間たちへメンション付きで発言・指示を送ることができます。"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "#@title 💬 AI仲間へのチャット送信 (メンション: @Gemini, @ChatGPT, @Claude, @Grok, @みんな)\n",
    "message = \"@all 周囲の安全を確認して、木や石を集めてください！\" #@param {type:\"string\"}\n",
    "pipe_path = \"/content/minecraft_server/server.pipe\"\n",
    "if os.path.exists(pipe_path):\n",
    "    with open(pipe_path, \"w\") as f:\n",
    "        f.write(f\"say [Commander] {message}\\n\")\n",
    "    print(f\"ゲーム内へチャット送信完了: {message}\")\n",
    "    import time\n",
    "    time.sleep(2)\n",
    "    print(\"\\nBotの直近の応答ログ:\")\n",
    "    !tail -n 8 /content/bots.log 2>/dev/null || true\n",
    "else:\n",
    "    print(\"サーバーが起動していません。\")\n"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## ⚙️ ステップ 5: 【サーバーコマンド送信】\n",
    "管理者権限（OP）の付与や、天候・ゲームモード変更などのコマンドをサーバーコンソールへ送信できます。"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "#@title ⚙️ サーバー管理者コマンド送信 (例: op <自分のMC名>, time set day)\n",
    "command = \"op your_mc_username\" #@param {type:\"string\"}\n",
    "pipe_path = \"/content/minecraft_server/server.pipe\"\n",
    "if os.path.exists(pipe_path):\n",
    "    with open(pipe_path, \"w\") as f:\n",
    "        f.write(f\"{command}\\n\")\n",
    "    print(f\"コマンド送信完了: {command}\")\n",
    "    !tail -n 6 /content/minecraft_server/logs/latest.log 2>/dev/null || true\n",
    "else:\n",
    "    print(\"サーバーが起動していません。\")\n"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 🔄 ステップ 6: 【稼働中サーバーへの最新反映（画面収録・行動日誌・RadarMap・AI反映）】\n",
    "サーバーを止めずに、AIPlayerの4分割画面収録・行動日誌機能の修復/再起動、固定トンネル (zuyasi.playit.plus) への切替、最新レーダー地図プラグインを即座に再反映したい場合はこのセルを実行してください。"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "#@title 🔄 稼働中サーバーへの最新反映 (画面収録修復・行動日誌・RadarMap・Bot再起動)\n",
    "!curl -sL https://raw.githubusercontent.com/9z2fqjckjv-bot/ColabTool/main/scripts/live_apply.sh | bash\n"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 💻 ステップ 7: 【対話型Webターミナル (colab-xterm)】\n",
    "「特定のセルに依存せずに、ターミナルを活用する」ためのセルです。  \n",
    "実行すると、ブラウザ上で直接操作できる本格的なLinuxターミナルが起動します（終了時は `exit`）。"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "#@title 💻 対話型ターミナルの起動 (colab-xterm)\n",
    "try:\n",
    "    !pip install -q colab-xterm\n",
    "    get_ipython().run_line_magic(\"load_ext\", \"colabxterm\")\n",
    "    print(\"💡 ターミナルを起動しました。終了する際は exit を入力してください。\")\n",
    "    get_ipython().run_line_magic(\"xterm\", \"\")\n",
    "except Exception as e:\n",
    "    print(\"colab-xterm の初期化をスキップ。最新ログを表示:\", e)\n",
    "    !tail -n 25 /content/minecraft_server/logs/latest.log 2>/dev/null || true\n"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 🛑 ステップ 8: 【安全なシャットダウン＆二重バックアップ】\n",
    "ゲームを終えるときは、**このセルを実行** してください。  \n",
    "ワールドデータをGoogle DriveおよびXServer (`nanndemoya26.key`) へ確実に二重同期し、録画動画を保存、AIPlayer行動日誌を保存・GitHubプッシュして安全に終了します。"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "#@title 🛑 サーバー安全シャットダウン & 二重バックアップ (Google Drive & XServer)\n",
    "import os\n",
    "if os.path.exists(\"/content/ColabTool\"):\n",
    "    get_ipython().run_line_magic(\"cd\", \"/content/ColabTool\")\n",
    "    !bash scripts/shutdown.sh\n",
    "else:\n",
    "    print(\"サーバーが起動されていません。\")\n"
   ]
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

content = json.dumps(nb, ensure_ascii=False, indent=1)
(repo_dir / 'Minecraft_Colab_Runner.ipynb').write_text(content, encoding='utf-8')
(repo_dir / 'Minecraft_AI_Colab.ipynb').write_text(content, encoding='utf-8')
print("Successfully generated both notebooks via build_notebooks.py!")
