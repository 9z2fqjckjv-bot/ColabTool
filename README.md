# 🎮 Minecraft for Colab (AIサバイバルサーバー)

Google Colab（L4 GPU）上で一時的なMinecraft Java版サーバーを立ち上げ、**AI利用料0円で4体の自律AI仲間（Gemini, ChatGPT, Claude, Grok）** と共に日本語チャットしながらサバイバル生活を楽しむための自動化システムです。

---

## 🌟 主な機能と特徴

1. **追加費用0円のLLM推論 (L4 GPU / 24GB VRAM 最適化)**
   - ColabのL4 GPU上でローカルLLM（Ollama / vLLM: Qwen2.5-7B/14B）を高速稼働。外部有料APIを一切使わずに0円・無制限で稼働。
   - Google AI Studio (Gemini 1.5 Free Tier) の無料枠キーにも対応（ハイブリッド）。
2. **4人の個性的なAIPlayer (Mineflayer Node.js)**
   - **Gemini**: リーダー・建築・全体進行役
   - **ChatGPT**: 採掘・クラフト・素材チェスト管理役
   - **Claude**: 護衛・戦闘・安全食料管理役
   - **Grok**: 探索・冒険・ムードメーカー役
   - 日本語での自然な対話、文脈理解、誤字脱字の柔軟な補正に対応。
3. **ワンクリック全自動起動**
   - サーバー（PaperMC 1.21.x）、無料トンネル（playit.gg）、LLM、4体のBot、Bot視点自動録画（Xvfb + Prismarine-viewer + ffmpeg）が1回の実行で立ち上がります。
4. **データ消失対策 (シャットダウン対策)**
   - Google Drive への自動マウント＆10分ごとの自動同期。
   - XServer（レンタルサーバー SSH/SFTP）への遠隔同期にも対応。
5. **プレイ動画の自動収録 & 行動日誌**
   - Bot視点を3Dレンダリングし、H.264 MP4形式でGoogle Driveへ自動保存。
   - チャット履歴や主要イベントを日誌（Markdown）として記録し、GitHubへ自動プッシュ。

---

## 🚀 クイックスタート (Google Colabでの使い方)

1. [Google Colab](https://colab.research.google.com/) で [`Minecraft_Colab_Runner.ipynb`](Minecraft_Colab_Runner.ipynb) を開きます。
2. ランタイムのタイプを **「GPU」 (L4 GPU 推奨)** に設定します。
3. **ステップ 1**（Google Drive マウント）を実行します。
4. **ステップ 2**（ワンクリックサーバー起動）を実行します。
5. ログに表示される **`playit.gg` の接続アドレス**（例: `xxx.gl.joinmc.link` または `xxx.playit.gg:yyyy`）を手元のMinecraft（Java版）の「ダイレクト接続」または「サーバー追加」に入力してログインします。
6. プレイを終える際は、**ステップ 4**（シャットダウン＆バックアップ）を実行するだけで、ワールドと録画が安全に保存されます。

---

## 📁 ディレクトリ構成

```text
ColabTool/
├── Note.html                        # 要件メモ
├── PLAN.md                          # プロジェクト計画書
├── README.md                        # 本書
├── Minecraft_Colab_Runner.ipynb     # Colab用実行ノートブック
├── scripts/
│   ├── setup_server.sh              # PaperMC & playit.gg セットアップ
│   ├── backup_restore.py            # Google Drive & XServer データ同期
│   ├── start_all.sh                 # ワンクリック統合起動スクリプト
│   └── shutdown.sh                  # 安全停止・バックアップ・Gitプッシュ
├── bot/
│   ├── package.json                 # Mineflayer 依存定義
│   ├── persona.js                   # 4体のAIPlayer性格・役割定義
│   ├── brain.js                     # LLM推論・日本語文脈補正エンジン
│   └── index.js                     # マルチBotマネージャー
├── recorder/
│   └── record_viewer.sh             # Prismarine-viewer & ffmpeg 自動録画
└── logs/                            # プレイ記録・行動日誌
```

---

## 📝 ライセンス
MIT License
