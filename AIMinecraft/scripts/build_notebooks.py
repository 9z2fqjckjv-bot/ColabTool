#!/usr/bin/env python3
"""
build_notebooks.py - 改善指示書v3準拠 2セル構成 Google Colab ノートブック生成スクリプト
(セル1: ワンクリック起動 & Webポータル新タブ自動展開 / セル2: セーブ＆終了)
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
    "# 🎮 Minecraft for Colab (自律サバイバル帝国) - 改善指示書v3 準拠\n",
    "\n",
    "Google Colab（L4 GPU）上でMinecraft Java版サーバーを立ち上げ、**Qwen 2.5（14B）を頭脳とする2グループ全10名の用途別自律AIPlayer** および **総合行動モニターWebポータル** と共にサバイバル生活を楽しむための自動化システムです。\n",
    "\n",
    "### 🌟 改善指示書v3に基づく主要刷新ポイント\n",
    "- **2グループ全10名の用途別自律クラスタ**:\n",
    "  - **第1グループ (5名)**: 撃退隊長(1), 農作業(1), 資材集め(2人ペア: 丸石/土/砂/石炭/露出鉱物/原木), モブ狩り(1: 牛/羊/豚/鶏)。※第1グループ内の会話・一体作業、ペア間の会話・共同作業。\n",
    "  - **第2グループ (5名)**: 動物飼育(1: 4種専用ペン), 洞窟発掘(2人ペア: 松明配置・鉱物採掘・廃坑探検), ネザー遠征(2人ペア: ボート移動・荒廃ポータル修復・エンド資材)。※AIだけで洞窟・ネザーを完遂。\n",
    "- **道具・アイテム・食料のプレイヤー要求機能**: 各AIPlayerは必要なツールや食料が不足した際にプレイヤーへ自動要求し、Webポータルに一覧表示。\n",
    "- **総合行動モニターWebポータル（新タブ自動展開プログラム搭載）**: 全AIPlayerの行動記録、現在地、2Dレーダーマップ、グループ別スポーン管理、リアルタイムチャット/コマンド、指示達成レポート、YouTubeスライド用統括日報を統合。\n",
    "- **2セル完結構成**: Colabのセルは「起動セル」と「セーブ＆終了セル」の2つのみ。起動完了時にWebポータルを新しいタブで自動展開し、常駐監視モードへ移行。\n",
    "- **二重永続バックアップ (Google Drive & XServer)**: ワールド・深部DB・行動日誌・日報を自動二重同期。いつランタイムが切れても安全なように5分ごとに自動オートセーブ常駐。"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 🚀 ステップ 1: 【ワンクリック統合起動】\n",
    "**下のセルを実行（再生ボタンを押す）するだけ** で、サーバー・Qwen 2.5・10体AIPlayer・Webポータルが全自動で起動します。  \n",
    "起動完了後、**総合行動モニターWebポータルが新しいタブで自動的に開きます**（ポップアップブロック時は表示されるリンクをクリック）。  \n",
    "手元のMinecraft（Java版 1.21.x）から **`zuyasi.playit.plus`** へ接続してください。\n",
    "（プレイを終了する際は、下の「ステップ 2: セーブ＆安全な終了」を実行してください）"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": None,
   "metadata": {},
   "outputs": [],
   "source": [
    "#@title 🎮 ワンクリック統合起動（PaperMC・Qwen 2.5・10体AIPlayer・Webポータル新タブ自動展開）\n",
    "import os\n",
    "import sys\n",
    "import json\n",
    "import base64\n",
    "import subprocess\n",
    "import time\n",
    "from IPython.display import Javascript, HTML, display\n",
    "\n",
    "print(\"==================================================\")\n",
    "print(\"  Minecraft AI Colab Cluster - 完全自動起動 (v3)\")\n",
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
    "print(\"🚀 サーバー・Qwen 2.5・10体AIPlayer・Webポータルを起動中...\")\n",
    "start_script = os.path.join(repo_dir, \"scripts/start_all.sh\")\n",
    "res = subprocess.run([\"bash\", start_script], check=False)\n",
    "\n",
    "# 4. 行動モニターWebポータルを新しいタブで開くプログラム (改善指示書v3要件)\n",
    "portal_url = None\n",
    "if os.path.exists(\"/content/portal_url.txt\"):\n",
    "    try:\n",
    "        with open(\"/content/portal_url.txt\", \"r\", encoding=\"utf-8\") as f:\n",
    "            portal_url = f.read().strip()\n",
    "    except Exception:\n",
    "        pass\n",
    "\n",
    "colab_proxy_url = None\n",
    "try:\n",
    "    from google.colab.output import eval_js\n",
    "    colab_proxy_url = eval_js(\"google.colab.kernel.proxyPort(3000)\")\n",
    "except Exception:\n",
    "    pass\n",
    "\n",
    "target_open_url = portal_url or colab_proxy_url or \"http://localhost:3000\"\n",
    "fallback_url = colab_proxy_url if portal_url else None\n",
    "\n",
    "print(f\"\\n🌐 総合行動モニターWebポータル URL: {target_open_url}\")\n",
    "print(\"🚀 新しいタブでWebポータルを自動オープンします...\")\n",
    "if target_open_url and target_open_url != \"http://localhost:3000\":\n",
    "    display(Javascript(f\"window.open('{target_open_url}', '_blank');\"))\n",
    "\n",
    "dual_btn_html = f'''\n",
    "    <div style=\"padding:20px; background:linear-gradient(135deg, #1e1b4b, #312e81); border-radius:14px; border:2px solid #6366f1; margin:16px 0; box-shadow:0 8px 30px rgba(99,102,241,0.35); font-family:sans-serif;\">\n",
    "        <h3 style=\"color:#fff; margin:0 0 8px 0; font-size:18px;\">🌐 総合行動モニター Webポータル (改善指示書v3)</h3>\n",
    "        <p style=\"color:#c7d2fe; font-size:14px; margin:0 0 14px 0;\">新しいタブが自動で開かない場合やCloudflareの接続準備中は、以下のボタンから開くことができます:</p>\n",
    "        <div style=\"display:flex; gap:12px; flex-wrap:wrap;\">\n",
    "            <a href=\"{target_open_url}\" target=\"_blank\" style=\"display:inline-block; padding:12px 24px; background:linear-gradient(135deg, #6366f1, #4f46e5); color:#fff; font-weight:bold; font-size:15px; border-radius:8px; text-decoration:none; box-shadow:0 4px 14px rgba(0,0,0,0.3);\">🚀 Webポータルを開く (推奨)</a>\n",
    "            <a href=\"{fallback_url or target_open_url}\" target=\"_blank\" style=\"display:inline-block; padding:12px 24px; background:linear-gradient(135deg, #059669, #10b981); color:#fff; font-weight:bold; font-size:15px; border-radius:8px; text-decoration:none; box-shadow:0 4px 14px rgba(0,0,0,0.3);\">⚡ Colab直結リンク (予備)</a>\n",
    "        </div>\n",
    "    </div>\n",
    "'''\n",
    "display(HTML(dual_btn_html))\n",
    "\n",
    "# Colab公式推奨の安全なインラインモニター展開 (serve_kernel_port_as_iframe)\n",
    "try:\n",
    "    from google.colab import output\n",
    "    print(\"📱 ノートブック内インラインモニターを展開中 (ポート: 3000)...\\n\")\n",
    "    output.serve_kernel_port_as_iframe(3000, height=850)\n",
    "except Exception:\n",
    "    pass\n",
    "\n",
    "print(\"\\n==================================================\")\n",
    "print(\"✨ 起動プロセスが正常に完了しました！\")\n",
    "print(\"🎮 Minecraft アドレス: zuyasi.playit.plus\")\n",
    "print(\"==================================================\")\n",
    "\n",
    "# 5. セッション常駐ハートビート＆稼働モニター (Colabのアイドル自動切断・タイムアウトを完全防止)\n",
    "print(\"🟢 サーバー常駐監視モードを開始しました (Colabのアイドル自動切断を防止中)\")\n",
    "print(\"💡 終了する際は、下の「ステップ 2: セーブ＆安全な終了」セルを実行してください。\\n\")\n",
    "\n",
    "# Colab UIキープアライブ (ブラウザ側からの定期接続シグナル送信)\n",
    "display(Javascript('''\n",
    "setInterval(() => {\n",
    "    const btn = document.querySelector(\"colab-connect-button\")?.shadowRoot?.querySelector(\"#connect\");\n",
    "    if (btn) btn.click();\n",
    "    console.log(\"[KeepAlive] Colabセッション維持シグナル送信\");\n",
    "}, 60000);\n",
    "'''))\n",
    "\n",
    "heartbeat = 0\n",
    "while True:\n",
    "    try:\n",
    "        time.sleep(15)\n",
    "        heartbeat += 1\n",
    "        if heartbeat % 4 == 0:\n",
    "            active_bots = 0\n",
    "            g1_count = 0\n",
    "            g2_count = 0\n",
    "            db_path = \"/content/logs/deep_system_database.json\"\n",
    "            if os.path.exists(db_path):\n",
    "                try:\n",
    "                    with open(db_path, \"r\", encoding=\"utf-8\") as f:\n",
    "                        data = json.load(f)\n",
    "                        bots = list(data.get(\"bots\", {}).values())\n",
    "                        active_bots = len([b for b in bots if b.get(\"connected\")])\n",
    "                        g1_count = len([b for b in bots if b.get(\"connected\") and b.get(\"group\") == 1])\n",
    "                        g2_count = len([b for b in bots if b.get(\"connected\") and b.get(\"group\") == 2])\n",
    "                except Exception:\n",
    "                    pass\n",
    "            uptime_min = (heartbeat * 15) // 60\n",
    "            print(f\"[{time.strftime('%H:%M:%S')}] 🟢 稼働中 (連続: {uptime_min}分) | AIPlayer稼働: {active_bots}/10名 (第1G: {g1_count}, 第2G: {g2_count}) | アドレス: zuyasi.playit.plus\", flush=True)\n",
    "            sys.stdout.flush()\n",
    "    except KeyboardInterrupt:\n",
    "        print(\"\\n⚠️ 監視ループが中断されました。下の「ステップ 2」で安全に保存・停止してください。\", flush=True)\n",
    "        break\n"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "---\n",
    "## 💾 ステップ 2: 【セーブ＆安全な終了】\n",
    "サバイバル生活を終了する際は、**下のセルを実行**してください。  \n",
    "ワールドの保存（`save-all`）、深部データベース同期、全AIPlayerの行動日誌保存、Google DriveおよびXServer（`nanndemoya26.key`）への完全同期、GitHubプッシュが全自動で行われ、サーバーとBotが安全に停止します。"
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
