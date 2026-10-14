# 🎮 Minecraft for Colab (AIサバイバルサーバー)

Google Colab（L4 GPU）上で一時的なMinecraft Java版サーバーを立ち上げ、**AI利用料0円で4体の自律AI仲間（Gemini, ChatGPT, Claude, Grok）** と共に日本語チャットしながらサバイバル生活を楽しむための自動化システムです。

---

## 🌟 改善指示書に基づく強化ポイント

1. **固定の役割分担を廃止＆全員が自律行動**
   - 「Geminiだけしか喋らない」「ChatGPT/Claudeが棒立ちになる」問題を根本解決。
   - 4体全員が自律行動ループを持ち、木こり、鉱石採掘、周囲の探索、モンスター迎撃、プレイヤー追従を自ら判断して実行します。
2. **テンプレート定型文返信の完全廃止＆動的テキスト生成**
   - 決まった返答を繰り返す問題を解消。プレイヤーの発言内容、時間帯（昼/夜）、HP、周囲のモブやブロックの状況を踏まえ、キャラクターの個性（Gemini: 明るく協調的、ChatGPT: 論理的・丁寧、Claude: 誠実・安全配慮、Grok: 好奇心・ユーモア）に合わせた血の通った発言を毎回生成します。
3. **チャットのメンション機能**
   - `@Gemini`, `@ChatGPT`, `@Claude`, `@Grok` で個別指示、`@all`, `@みんな`, `@全員` で一斉指示が可能。
4. **全員位置レーダー地図 (RadarMap) の自動配布**
   - プレイヤーおよびAI仲間がスポーンした際、**自分と全AI仲間の現在位置をリアルタイム表示するレーダー地図**を自動配布。
   - プレイヤー同士が何百ブロック離れても**自動で縮尺（スケール）を調整**し、全員が常に地図内に収まるよう設計。オフハンド（Fキー）に装備すれば常時視界に表示。
5. **4分割 一人称視線 (POV) 画面収録**
   - AIPlayerごとに目線・視線（First-Person POV）をPrismarine-Viewerで個別描画し、1920x1080の4分割画面として `ffmpeg` で高品質MP4動画を自動収録。
6. **AIPlayerごとの個別サバイバル行動日誌**
   - 各AIPlayerの思考、自律意思決定、プレイヤーとの対話、戦闘・収集履歴を個別のMarkdown日誌（`Gemini_diary.md`, `ChatGPT_diary.md`, etc.）としてリアルタイム保存。
7. **二重永続バックアップ (Google Drive & XServer)**
   - ワールドデータ、録画動画、行動日誌をGoogle Driveに自動同期。
   - リポジトリ内のSSH鍵 `nanndemoya26.key` を活用し、**XServerレンタルサーバー（`nanndemoya26@sv17151.xserver.jp`）** にも同一のバックアップを完全二重保管。
8. **Colabセルの即座完了＆サーバー独立稼働**
   - Colabの複数セル同時実行制限に対応し、ワンクリック起動セルは約45秒〜1分で処理を正常終了。
   - サーバーはバックグラウンドで独立して動き続けるため、後続のステータス確認、日誌閲覧、チャット送信、対話型Webターミナル (`colab-xterm`) を自由に利用可能。

---

## 🚀 クイックスタート (Google Colabでの使い方)

1. [Google Colab](https://colab.research.google.com/) で [`Minecraft_Colab_Runner.ipynb`](Minecraft_Colab_Runner.ipynb) を開きます。
2. ランタイムのタイプを **「GPU」 (L4 GPU 推奨)** に設定します。
3. **ステップ 1: 【ワンクリック起動】** を実行します（約45秒〜1分で完了し、セルが終了します）。
4. ログに表示される **`playit.gg` の接続アドレス**（例: `xxx.gl.joinmc.link` または `cairo-kt.tun.ply.gg`）を手元のMinecraft（Java版 1.21.x）に入力してログインします。
5. プレイ中はノートブックから **ステップ 3（日誌閲覧）** や **ステップ 4（チャット・メンション送信）**、**ステップ 6（Webターミナル）** も利用できます。
6. プレイ終了時は、**ステップ 7: 【安全なシャットダウン】** を実行すると、ワールド・動画・日誌がGoogle DriveとXServerに保存され、Gitコミットも自動で行われます。

---

## 📁 ディレクトリ構成

```text
ColabTool/
├── 改善指示書.html                  # 今回の改善要件書
├── Note.html                        # 全体要件メモ
├── PLAN.md                          # プロジェクト計画書
├── README.md                        # 本書
├── Minecraft_Colab_Runner.ipynb     # Colab用実行ノートブック (メイン)
├── Minecraft_AI_Colab.ipynb         # Colab用実行ノートブック (予備)
├── nanndemoya26.key                 # XServer SSH秘密鍵 (二重バックアップ用)
├── plugins_src/
│   └── RadarMap/                    # 自動縮尺レーダー地図 PaperMCプラグイン
│       ├── src/main/java/           # Javaソース (RadarMapPlugin, RadarMapRenderer)
│       └── src/main/resources/      # plugin.yml
├── scripts/
│   ├── setup_server.sh              # PaperMC・Java 21・RadarMapビルド
│   ├── backup_restore.py            # Google Drive & XServer 二重同期
│   ├── start_all.sh                 # 非同期独立起動スクリプト
│   ├── shutdown.sh                  # 安全停止・二重同期・Gitプッシュ
│   └── build_notebooks.py           # ノートブック自己展開ジェネレーター
├── bot/
│   ├── package.json                 # Mineflayer & Prismarine-viewer 依存定義
│   ├── persona.js                   # 4体の自律AI性格・対話・メンション定義
│   ├── brain.js                     # 自律意思決定・動的チャット生成エンジン
│   └── index.js                     # マルチAIマネージャー & 個別日誌・POV
├── recorder/
│   ├── multiview.html               # 4分割一人称視点 (POV) モニターUI
│   └── record_viewer.sh             # 4画面統合POV 1080p自動録画スクリプト
└── logs/                            # 各AI行動日誌・統合日誌
```

---

## 📝 ライセンス
MIT License
