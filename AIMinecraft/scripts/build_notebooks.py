#!/usr/bin/env python3
"""
build_notebooks.py - 改善指示書v2準拠 2セル構成 Google Colab ノートブック生成スクリプト
(セル1: ワンクリック起動 / セル2: セーブ＆終了)
"""

import json
from pathlib import Path

repo_dir = Path(__file__).resolve().parent.parent

embedded_files = {}
file_rel_paths = [
    'scripts/setup_server.sh',
    'scripts/start_all.sh',
    'scripts/shutdown.sh',
    'scripts/backup_restore.py',
    'bot/package.json',
    'bot/persona.js',
    'bot/brain.js',
    'bot/knowledge_base.js',
    'bot/database.js',
    'bot/portal/portal_server.js',
    'bot/portal/public/index.html',
    'bot/index.js',
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
    "# 🎮 Minecraft for Colab (自律AIサバイバル帝国) - 改善指示書v2 準拠\n",
    "\n",
    "Google Colab（L4 GPU）上でMinecraft Java版サーバーを立ち上げ、**Qwen 2.5（14B）を頭脳とする全41体の用途別自律AIPlayer** および **総合行動モニターWebポータル** と共にサバイバル生活を楽しむための自動化システムです。\n",
    "\n",
    "### 🌟 改善指示書v2に基づく主要刷新ポイント\n",
    "- **4AI(Gemini, ChatGPT, Claude, Grok)の廃止 & 41体用途別クラスタ**: お供(1)、撃退(水中1/地上2)、木こり(1)、農作業(1)、資材集め(丸石/土/砂/石炭/露出鉱物 各1)、釣り(1)、洞窟発掘(3)、ネザー遠征(3)、村人交易(3)、モブ狩り(牛/羊/豚/鶏 各1)、飼育(牛/羊/豚/鶏 各1)、11名の司令塔(各作業統括・資材回収・チェスト格納)、ヘルパー(1)。\n",
    "- **Qwen 2.5 (Colab L4 GPU最高スペック 14B)**: ローカル推論エンジンとしてQwen 2.5 14Bを搭載。行動日誌を自律分析し、プレイヤーへ改善提案を自動提示。\n",
    "- **総合行動モニターWebポータル**: Colabノートブック上の複雑な操作をすべてWebポータルへ統合（リアルタイムチャット、コマンド送信、2Dレーダーマップ、行動日誌閲覧、深部DB、チェスト可視化、畑・牧場モニター、YouTubeスライド用統括日報）。\n",
    "- **2セル完結構成**: Colabのセルは「起動セル」と「セーブ＆終了セル」の2つのみ。起動セルは約45秒で正常終了し、サーバー・AI・ポータルはバックグラウンドで完全独立稼働します。\n",
    "- **二重永続バックアップ (Google Drive & XServer)**: ワールド・深部DB・行動日誌・日報を自動二重同期。さらにキャッシュ復元により再起動時間を大幅短縮。"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 🚀 ステップ 1: 【ワンクリック統合起動】\n",
    "**下のセルを実行（再生ボタンを押す）するだけ** で、サーバー・Qwen 2.5・41体AIPlayer・Webポータルが全自動で起動します。  \n",
    "サーバーはバックグラウンドで独立稼働し、**約45秒〜1分でこのセルの実行は完了**します。  \n",
    "完了後、表示されるURLから **総合Webポータル** を開き、手元のMinecraft（Java版 1.21.x）から **`zuyasi.playit.plus`** へ接続してください。"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "#@title 🎮 ワンクリック統合起動（PaperMC・Qwen 2.5・41体AIPlayer・Webポータル・playit.gg）\n",
    "import os\n",
    "import sys\n",
    "import json\n",
    "import base64\n",
    "import subprocess\n",
    "import time\n",
    "\n",
    "print(\"==================================================\")\n",
    "print(\"  Minecraft AI Colab Cluster - 完全自動起動\")\n",
    "print(\"==================================================\")\n",
    "\n",
    "# 1. Google Drive の自動マウント（データ永続化用）\n",
    "try:\n",
    "    from google.colab import drive\n",
    "    if not os.path.exists(\"/content/drive/MyDrive\"):\n",
    "        print(\"📂 Google Drive をマウント中...\")\n",
    "        drive.mount(\"/content/drive\")\n",
    "    else:\n",
    "        print(\"✅ Google Drive は既にマウントされています。\")\n",
    "except Exception as e:\n",
    "    print(f\"⚠️ Google Drive マウントスキップ: {e}\")\n",
    "\n",
    "# 2. ソースコードの自己展開\n",
    "repo_dir = \"/content/ColabTool/AIMinecraft\"\n",
    "os.makedirs(repo_dir, exist_ok=True)\n",
    "\n",
    "embedded_files = " + embedded_json_str + "\n",
    "embedded_binaries = " + embedded_bin_str + "\n",
    "\n",
    "print(\"📦 システムファイルとWebポータルを展開中...\")\n",
    "for rel_path, content in embedded_files.items():\n",
    "    abs_path = os.path.join(repo_dir, rel_path)\n",
    "    os.makedirs(os.path.dirname(abs_path), exist_ok=True)\n",
    "    with open(abs_path, 'w', encoding='utf-8') as f:\n",
    "        f.write(content)\n",
    "    if rel_path.endswith('.sh') or rel_path.endswith('.py'):\n",
    "        os.chmod(abs_path, 0o755)\n",
    "\n",
    "for rel_path, b64content in embedded_binaries.items():\n",
    "    abs_path = os.path.join(repo_dir, rel_path)\n",
    "    os.makedirs(os.path.dirname(abs_path), exist_ok=True)\n",
    "    with open(abs_path, 'wb') as f:\n",
    "        f.write(base64.b64decode(b64content))\n",
    "\n",
    "# 秘密鍵パーミッション設定\n",
    "key_path = os.path.join(repo_dir, \"nanndemoya26.key\")\n",
    "if os.path.exists(key_path):\n",
    "    os.chmod(key_path, 0o600)\n",
    "    os.system(f\"cp -f '{key_path}' /content/nanndemoya26.key 2>/dev/null || true\")\n",
    "    os.chmod(\"/content/nanndemoya26.key\", 0o600)\n",
    "\n",
    "# 3. 完全起動スクリプトの実行\n",
    "print(\"🚀 サーバー・Qwen 2.5・41体AIPlayer・Webポータルを起動中...\")\n",
    "start_script = os.path.join(repo_dir, \"scripts/start_all.sh\")\n",
    "res = subprocess.run([\"bash\", start_script], check=False)\n",
    "\n",
    "# 4. 総合Webポータルのインライン埋め込み表示 (ブラウザセキュリティ警告完全防止)\n",
    "try:\n",
    "    from google.colab import output\n",
    "    print(\"🌐 総合Webポータルを画面下部にインライン展開中 (ポート 3000)...\")\n",
    "    output.serve_kernel_port_as_iframe(3000, height=850)\n",
    "except Exception as e:\n",
    "    pass\n",
    "\n",
    "print(\"\\n==================================================\")\n",
    "print(\"✨ 起動プロセスが正常に完了しました！\")\n",
    "print(\"🎮 Minecraft アドレス: zuyasi.playit.plus\")\n",
    "print(\"🌐 総合Webポータル: 下記のインライン画面から直接操作可能です\")\n",
    "print(\"==================================================\")\n"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 💾 ステップ 2: 【セーブ＆安全な終了】\n",
    "サバイバル生活を終了する際は、**下のセルを実行**してください。  \n",
    "ワールドの保存（`save-all`）、深部データベース同期、全41体のAI行動日誌の保存、Google DriveおよびXServer（`nanndemoya26.key`）への完全同期、GitHubプッシュが全自動で行われ、サーバーとBotが安全に停止します。"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "#@title 💾 セーブ＆安全な終了（ワールド保存・深部DB・二重同期・Gitプッシュ）\n",
    "import os\n",
    "import subprocess\n",
    "\n",
    "repo_dir = \"/content/ColabTool/AIMinecraft\"\n",
    "shutdown_script = os.path.join(repo_dir, \"scripts/shutdown.sh\")\n",
    "\n",
    "if os.path.exists(shutdown_script):\n",
    "    print(\"🛑 安全なシャットダウン処理を実行中...\")\n",
    "    subprocess.run([\"bash\", shutdown_script], check=False)\n",
    "else:\n",
    "    print(\"⚠️ shutdown.sh が見つかりません。手動停止を実行中...\")\n",
    "    os.system(\"pkill -f 'node index.js' || true\")\n",
    "    os.system(\"pkill -TERM -f 'server.jar' || true\")\n",
    "    os.system(\"pkill -f 'playit' || true\")\n",
    "    os.system(\"pkill -f 'ollama' || true\")\n",
    "    print(\"✅ 停止完了しました。\")\n"
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

nb_path1 = repo_dir / "Minecraft_Colab_Runner.ipynb"
nb_path2 = repo_dir / "Minecraft_AI_Colab.ipynb"

with open(nb_path1, 'w', encoding='utf-8') as f:
    json.dump(nb, f, ensure_ascii=False, indent=1)
print(f"✅ 生成完了: {nb_path1}")

with open(nb_path2, 'w', encoding='utf-8') as f:
    json.dump(nb, f, ensure_ascii=False, indent=1)
print(f"✅ 生成完了: {nb_path2}")
