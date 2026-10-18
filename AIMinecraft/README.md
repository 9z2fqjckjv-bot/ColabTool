# 🎮 Minecraft for Colab (自律AIサバイバル帝国) - 改善指示書v2 準拠版

Google Colab（L4 GPU）上でMinecraft Java版サーバー（PaperMC 1.21.1）を立ち上げ、**Qwen 2.5（14B）を頭脳とする全41体の用途別自律AIPlayer** および **総合行動モニターWebポータル** と共にサバイバル生活を楽しむための自動化システムです。

---

## 🌟 改善指示書v2に基づく主要刷新ポイント

### 1. 4AI(Gemini, ChatGPT, Claude, Grok)の廃止 & 41体 用途別AIPlayerクラスタ
- **お供 (1名)**: 常にプレイヤーと共に行動・護衛する忠実な相棒 (`Otomo`)
- **撃退 (3名)**:
  - 拠点周囲の水中モブ（ドラウンド等）を迎撃（1名、`Gekitai_Water`）
  - 拠点周囲の地上モブ（ゾンビ、スケルトン、クモ、クリーパー）を迎撃（2名、`Gekitai_Land1`, `Gekitai_Land2`）
- **木こり (1名)**: 拠点から10チャンク以内を中心に木々を伐採・再植林 (`Kikori`)
- **農作業 (1名)**: 拠点チェストから種を取り出し、5チャンク以内で畑を作り耕作・収穫・再植え付け (`Nogyo`)
- **資材集め (5名)**: 拠点5チャンク以内で各資材を専門採集
  - 丸石 (`Shizai_Cobble`)、土 (`Shizai_Dirt`)、砂 (`Shizai_Sand`)、石炭 (`Shizai_Coal`)、地上露出鉱脈 (`Shizai_Ore`)
- **釣り (1名)**: 拠点10チャンク以内の水上をチェスト付きボートで移動し釣り竿で釣り (`Tsuri`)
- **洞窟発掘 (3名)**: 拠点に近い順に洞窟探索、鉱物採掘、廃坑探検、松明を配置して安全確保 (`Dokutsu1`, `Dokutsu2`, `Dokutsu3`)
- **ネザー遠征 (3名)**: 拠点からボートで荒廃ポータル座標 `(278, 63, 94)` へ向かい、ゲートを修復・着火してネザー探索・エンド資材集め (`Nether1`, `Nether2`, `Nether3`)
- **交易 (3名)**: 村へ向かい村人（農民、鍛冶屋、司書）や行商人と交易 (`Koeki1`, `Koeki2`, `Koeki3`)
- **モブ狩り (4名)**: 牛・羊・豚・鶏の野生中立モブを狩猟 (`MobKari_Cow`, `MobKari_Sheep`, `MobKari_Pig`, `MobKari_Chicken`)
- **飼育 (4名)**: 拠点5チャンク以内で牛・羊・豚・鶏の専用飼育ペンを作成し繁殖 (`Shiiku_Cow`, `Shiiku_Sheep`, `Shiiku_Pig`, `Shiiku_Chicken`)
- **司令塔 (11名)**:
  - 各作業・分担ごとに1名の司令塔AIを配置 (`Shirei_Otomo`, `Shirei_Gekitai`, `Shirei_Kikori`, `Shirei_Nogyo`, `Shirei_Shizai`, `Shirei_Tsuri`, `Shirei_Dokutsu`, `Shirei_Nether`, `Shirei_Koeki`, `Shirei_MobKari`, `Shirei_Shiiku`)
  - 現場AIとユーザー間の意思疎通、状況報告、結果報告、指示伝達を統括
  - 現場AIが持ち帰った資材を回収し、拠点チェストに収納（満杯時は床面にドロップ）
- **ヘルパー (1名)**: ユーザーからの個別指示を直に受け、依頼内容だけに特化して完遂させる専属AI (`Helper`)
- **サーバー同時参加上限の拡張**: `server.properties` の `max-players=100` に引き上げ

### 2. Qwen 2.5 (Colab L4 GPU最高スペック 14B)
- 従来のGemini APIや小型モデルを刷新し、Colab L4 GPU（24GB VRAM）のパワーを最大活用する **Qwen 2.5 14B** をローカル推論基盤として採用。
- **行動日誌の自律学習 & 改善提案エンジン**: 全41体のAI行動日誌と資材DBをQwen 2.5が精査し、プレイヤーへ「松明増設」「採掘優先度の変更」等の戦略的改善提案を自動出力。

### 3. 総合行動モニター & Webポータル (ポート 3000)
- 従来の画面収録機能（ffmpeg/ブラウザ録画）を廃止し、超軽量・多機能なWebポータルを導入。
  1. **リアルタイムコマンド送信機能** (RCON / コンソール)
  2. **リアルタイムチャット機能** (全AI・司令塔との対話・メンション対応)
  3. **2Dレーダーマップ機能** (拠点、ポータル、プレイヤー、全41体のリアルタイム座標表示)
  4. **行動日誌閲覧機能** (全AIPlayerのサバイバル日誌検索・閲覧)
  5. **深部データベース機能** (ボット状態、インベントリ、収集履歴、チェスト、イベントのクエリエクスプローラー)
  6. **詳細リアルタイム行動ログ** (カテゴリ別ストリーミングターミナル)
  7. **司令塔進捗報告レポート** (11名の司令塔によるタスク達成率・状況報告カード)
  8. **拠点チェストリアルタイム閲覧機能** (マインクラフト風スロットUIでチェスト内容を可視化)
  9. **畑＆飼育場モニター** (耕作面積、作物成長度、動物頭数、繁殖状況)
  10. **統括日報 (YouTubeスライド表示モード)**: 起動セッションごとに自動作成。稼働状況、TPS、司令塔報告、成果ハイライトをスライド形式で表示。ナレーション原稿付きで、ユーザーのYouTubeチャンネル動画収録に最適化。

### 4. 2セル完結ノートブック (`Minecraft_Colab_Runner.ipynb`)
- Colabの分散セルを完全に整理し、**「ワンクリック起動セル」** と **「セーブ＆終了セル」** の2つのみに集約。
- ワンクリック起動セルは約45秒〜1分で正常終了し、サーバー・AI・ポータルはバックグラウンドで完全独立稼働。

### 5. 二重永続バックアップ & 高速キャッシュ復元
- Google Drive および XServer（`nanndemoya26.key` 経由）にワールド、深部DB、行動日誌、統括日報を自動二重同期。
- `node_modules` や Qwen 2.5 モデルデータをGoogle Driveキャッシュに保存することで、2回目以降の起動時間を大幅に短縮。

---

## 🚀 クイックスタート (Google Colabでの使い方)

1. [Google Colab](https://colab.research.google.com/) で [`Minecraft_Colab_Runner.ipynb`](Minecraft_Colab_Runner.ipynb) を開きます。
2. ランタイムのタイプを **「GPU」 (L4 GPU 推奨)** に設定します。
3. **ステップ 1: 【ワンクリック統合起動】** を実行します（約45秒〜1分で完了し、セルが終了します）。
4. ログに表示される **`zuyasi.playit.plus`** を手元のMinecraft（Java版 1.21.x）に入力してログインします。
5. ノートブックに表示されるリンク（またはCloudflare URL）から **総合Webポータル** を開き、レーダーマップ、チャット、チェスト、日報を確認します。
6. プレイ終了時は、**ステップ 2: 【セーブ＆安全な終了】** を実行すると、ワールド・深部DB・日誌がGoogle DriveとXServerに保存され、Gitコミットも自動で行われます。

---

## 📁 ディレクトリ構成

```text
ColabTool/
├── 改善指示書v2.html                 # 今回の改善要件書
├── 改善指示書.html                   # 旧要件書
├── PLAN.md                          # プロジェクト計画書
├── README.md                        # 本書
├── Minecraft_Colab_Runner.ipynb     # 2セル完結実行ノートブック (メイン)
├── Minecraft_AI_Colab.ipynb         # 2セル完結実行ノートブック (予備)
├── nanndemoya26.key                 # XServer SSH秘密鍵 (二重バックアップ用)
├── playit.toml                      # playit.gg固定エージェント設定
├── plugins_src/
│   └── RadarMap/                    # 自動縮尺レーダー地図 PaperMCプラグイン
├── scripts/
│   ├── setup_server.sh              # PaperMC・Java 21・RadarMapビルド
│   ├── start_all.sh                 # 非同期独立起動スクリプト (Qwen 2.5 / 41AI / ポータル)
│   ├── shutdown.sh                  # 安全停止・二重同期・Gitプッシュ
│   ├── backup_restore.py            # Google Drive & XServer 二重同期 & キャッシュ
│   ├── live_apply.sh                # 稼働中サーバーへの即時反映スクリプト
│   └── build_notebooks.py           # ノートブック自己展開ジェネレーター
└── bot/
    ├── package.json                 # Mineflayer & Webポータル依存定義
    ├── persona.js                   # 全41体AIPlayer役割・パーソナリティ定義
    ├── brain.js                     # Qwen 2.5推論・改善提案・統括日報エンジン
    ├── knowledge_base.js            # Minecraftサバイバル知識ベース (RAG)
    ├── database.js                  # 深部システムデータベース (SQLite/JSON)
    ├── portal/
    │   ├── portal_server.js         # Webポータルバックエンド (Express & WebSocket)
    │   └── public/
    │       └── index.html           # 総合行動モニターSPA (ダークUI / レーダー / スライド)
    └── index.js                     # 41体AI同時制御マネージャー & 11司令塔体系
```

---

## 📝 ライセンス
MIT License
