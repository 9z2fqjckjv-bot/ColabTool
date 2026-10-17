# 🧠 ADHDLab (Google Colab L4 × Qwen 2.5 14B)

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/9z2fqjckjv-bot/ColabTool/blob/main/ADHDLab/ADHDLab_Colab.ipynb)

Google Oneの最上位メンバーシップである **Google AI Ultra (20TB)** の大容量環境を最大限に活かし、**Google Colab (NVIDIA L4 GPU / 24GB VRAM)** 上で **Qwen 2.5 (14B)** と最新エビデンスナレッジベースを融合させた **ADHD特化型自己理解・タスク管理支援AIシステム** です。

---

## 🌟 主な特徴と「ADHDLab制作指示書」への完全準拠

| 指示書要件 | ADHDLabの実装内容 |
| :--- | :--- |
| **搭載LLM** | **Qwen 2.5 (14B-Instruct)** を主軸に採用。L4 GPU (24GB VRAM) に最適化された 4bit 量子化（BitsAndBytes NF4）により、VRAM約9.5GBで超高速＆高精度に稼働。7Bモデルへの切り替えにも対応。 |
| **ADHD特化型対話** | 否定しない絶対受容・共感、先延ばしを防ぐマイクロステップ法（30秒スタート）、視覚的箇条書き、ドーパミン報酬系ハック、エビデンス明示を自動適用。 |
| **データベース** | 医療機関・公的機関・SNS・Blog・Otherの情報を網羅。添付の **「ソース一覧.xlsx」の全シート構成・見出し・sampleシート4〜5行目の優先順位規則に完全準拠**。統一番号（ソースNo）の一意管理、新しい順ソート。 |
| **機械学習・情報収集** | `duckduckgo-search`（DDGS）によるWeb自動収集。キーワード「ADHD」「注意欠陥多動性障害」「大人のADHD」「ライフハック」等から自動分類・要約・登録。 |
| **チャットUI** | **指示書添付の画像（Gemini Advanced スタイル）を忠実に再現**。洗練されたグラデーション、サイドバー履歴、データ探索モーダル、フローティング入力バー、リアルタイムSSEストリーミング。 |
| **GitHub連携** | PATトークン（`ghp_...`）を用いた自動コミット＆プッシュ。実行ログや最新コード、収集データを常にリポジトリへ同期。 |
| **Google Drive連携** | `/content/drive/MyDrive/ADHDLab` へマウントし、チャットログ・生成メディア・データベースを永続化。世界公開時も実行ユーザー自身のGoogle Driveに安全保管。 |
| **XServer連携** | `ColabTool` 内の `nanndemoya26.key`（SSH秘密鍵）を活用したXServerへのrsync/scp多重バックアップ。 |
| **追加費用0円** | Google ColabとオープンソースLLM、無料Web検索・無料トンネル（Cloudflare Tunnel）を活用し、**追加費用0円** で運用可能。 |

---

## 📁 ディレクトリ構成

```text
ADHDLab/
├── ADHDLab_Colab.ipynb           # 🚀 Colabワンクリック起動用メインノートブック
├── ADHDLab製作指示書.md           # 製作指示書原本（仕様・要件・UI画像含む）
├── ソース一覧.xlsx                # 正式データソース一覧（Excelテンプレート/実体）
├── nanndemoya26.key             # XServer SSH秘密鍵
├── client_secret_....json       # Google OAuth クライアント情報
├── README.md                    # 本ドキュメント
├── core/                        # バックエンド中核ロジック
│   ├── database_manager.py      # 「ソース一覧.xlsx」規則完全準拠のDB・Excel・RAG管理
│   ├── data_collector.py        # Web自動検索（DuckDuckGo）＆カテゴリ自動分類
│   ├── llm_engine.py            # Qwen 2.5 (14B) 4bit量子化・ADHDプロンプト・ストリーミング
│   └── storage_sync.py          # Google Drive / GitHub / XServer 外部連携・自動同期
├── web/                         # Webアプリケーション
│   ├── app.py                   # FastAPI バックエンドサーバー（SSE, REST API）
│   └── static/
│       └── index.html           # GeminiスタイルのモダンチャットUI & データ探索ビューア
└── data/                        # 永続化データ（SQLite DB, Excel, チャットログ, アップロード）
```

---

## 🚀 Google Colab での利用手順

1. 上部の **[Open in Colab]** バッジをクリックしてノートブックを開きます。
2. 上部メニューの **[ランタイム] ➔ [ランタイムのタイプを変更]** で **「L4 GPU」** を選択します。
3. セルを上から順に実行します：
   - **ステップ 0**: GPU診断（L4 GPU 24GB VRAM確認）
   - **ステップ 1**: Google Drive マウント（永続化ディレクトリ設定）
   - **ステップ 2**: リポジトリセットアップ＆依存ライブラリの自動インストール
   - **ステップ 3**: Qwen 2.5 (14B) モデルのロード（4bit量子化）
   - **ステップ 4**: Web UIサーバー起動＆パブリックURL発行（Cloudflare Tunnel）
4. ステップ4で出力される **「🚀 今すぐ ADHDLab を開く」** ボタンをクリックすると、ブラウザ上でGeminiライクなADHDLabチャットUIが起動します。
5. 作業終了時または定期的に **ステップ 5** を実行するか、Web UI上の **「同期・保存」** ボタンを押すことで、Google Drive・GitHub・XServerへ全データが自動バックアップされます。

---

## 📊 「ソース一覧.xlsx」のデータ管理仕様（sampleシート準拠）

`core/database_manager.py` は、指示書および `sample` シート行4・行5に規定された以下の仕様を自動処理します：

1. **並び順の原則**:
   - 投稿日あるいは作成年月日の **新しい順（降順）** を原則。
2. **シート優先順位（同一日付時）**:
   - **医療機関 ＞ 公的機関 ＞ SNS ＞ Blog ＞ Other**
3. **統一番号（ソースNo）**:
   - 全シート共通で重複のない一連番号（No.1, No.2, ...）として自動採番。総合シート以外のシートでは飛び番になります。
4. **自動エクスポート**:
   - SQLite上のリレーショナルデータを、指定の書式・カラー・列幅を保持したまま `ソース一覧.xlsx` にリアルタイム反映。
