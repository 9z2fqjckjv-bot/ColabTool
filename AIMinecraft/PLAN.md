# Minecraft for Colab 開発・実装計画書 (Project Plan v2)

本ドキュメントは、[改善指示書v2.html](改善指示書v2.html) に記載された仕様に基づき、Google Colab（L4 GPU）上で一時的なMinecraft Java版サーバーを立ち上げ、**Qwen 2.5（14B）を頭脳とする全41体の用途別自律AIPlayer** および **総合行動モニターWebポータル** と共にサバイバル生活を進め、データ永続化と統括日報（YouTubeスライド）作成を行うシステムの実装計画です。

---

## 1. システム全体アーキテクチャ

```mermaid
flowchart TB
    subgraph LocalPC["ユーザー環境 (Local PC)"]
        MC_Client["Minecraft Java Client (1.21.x)\n(手元から zuyasi.playit.plus へ接続)"]
        Browser["Webブラウザ (PC / タブレット)\n(総合Webポータル: ポート 3000 / Cloudflare)"]
    end

    subgraph Colab["Google Colab (L4 GPU / 24GB VRAM)"]
        subgraph Orchestrator["2セル完結ノートブック (Runner.ipynb)"]
            Cell1["ステップ1: ワンクリック起動 (Setup / Cache / PaperMC / Qwen2.5 / 41AI / Portal)"]
            Cell2["ステップ2: セーブ＆終了 (save-all / 深部DB・日誌二重同期 / GitPush)"]
        end

        subgraph MC_Server["Minecraft Server (PaperMC 1.21.1)"]
            Purpur["PaperMC Server (max-players=100)\n(Java 21 / RAM 7GB 最適化)"]
            Tunnel["playit.gg トンネル (zuyasi.playit.plus)\n(Minecraftポート 25565 公開)"]
            Radar["RadarMap Plugin (自動縮尺マップ配布)"]
        end

        subgraph AI_Cluster["AIPlayer クラスタ (41体 / Mineflayer)"]
            Otomo["お供 (1名: プレイヤー追従・護衛)"]
            Gekitai["迎撃部隊 (3名: 水中1名 / 地上2名)"]
            Gathering["木こり(1) & 資材部隊 (丸石/土/砂/石炭/鉱物 5名)"]
            Farming["農作業 (1名: 畑耕作・育成・収穫)"]
            Fishing["釣り (1名: チェストボート・釣り竿)"]
            Mining["洞窟発掘 (3名: 順次探索・松明配置)"]
            Nether["ネザー遠征 (3名: 荒廃ポータル修復・エンド資材)"]
            Trading["交易 (3名: 村人・行商人)"]
            Hunting["モブ狩り (4名: 牛・羊・豚・鶏)"]
            Breeding["飼育 (4名: 4種専用ペン・繁殖)"]
            Commanders["司令塔 (11名: 各分担統括・資材回収・チェスト格納)"]
            Helper["ヘルパー (1名: ユーザー個別指示特化)"]
        end

        subgraph LLM_Engine["LLM推論基盤 (Qwen 2.5 on L4 GPU)"]
            Qwen["Qwen 2.5 14B (Ollama / VRAM ~9GB)\n・自然な日本語対話 (5W3H原則)\n・行動日誌学習 & 戦略的改善提案\n・YouTubeスライド用 統括日報作成"]
        end

        subgraph Web_Portal["総合行動モニター & Webポータル (ポート 3000)"]
            PortalServer["Express & WebSocket サーバー"]
            Dashboard["リアルタイムダッシュボード & コマンド送信"]
            RadarMap2D["2D レーダーマップ (全ボット座標リアルタイム追従)"]
            LogStream["ストリーミング行動ログ & 司令塔進捗報告"]
            ChestViewer["拠点チェスト中身可視化UI"]
            DeepDB["深部システムデータベース エクスプローラー"]
            SlideView["YouTube用 統括日報スライドプレゼンテーション"]
        end
    end

    subgraph Storage["永続ストレージ & 高速キャッシュ"]
        GDrive["Google Drive (/content/drive/MyDrive/Minecraft_Colab)\n(ワールド・深部DB・行動日誌・キャッシュ二重保管)"]
        XServer["XServer (nanndemoya26@sv17151.xserver.jp)\n(SSH秘密鍵 nanndemoya26.key による完全バックアップ)"]
        GitHub["GitHub リポジトリ (日誌・コードの自動コミット)"]
    end

    %% Connections
    MC_Client <-->|playit.gg| Tunnel <--> Purpur
    Browser <-->|HTTP / WebSocket| PortalServer
    Purpur <--> AI_Cluster
    AI_Cluster <--> Qwen
    AI_Cluster <--> DeepDB
    PortalServer <--> DeepDB & AI_Cluster & Qwen
    Orchestrator --> GDrive & XServer & GitHub
```

---

## 2. 実装仕様一覧 (改善指示書v2 対応状況)

| 項目 | 要件仕様 | 実装内容 | ステータス |
| :--- | :--- | :--- | :---: |
| **AIPlayer** | 4AI(Gemini, ChatGPT, Claude, Grok)廃止 | `persona.js` にて旧4AIを完全廃止 | ✅ 完了 |
| **AIPlayer** | 用途別41体AIPlayerのスポーン | お供(1), 迎撃(水中1/地上2), 木こり(1), 農作業(1), 資材(5), 釣り(1), 洞窟(3), ネザー(3), 交易(3), 狩猟(4), 飼育(4), 司令塔(11), ヘルパー(1) を定義・実装 | ✅ 完了 |
| **AIPlayer** | 司令塔による資材回収とチェスト格納 | 11名の各司令塔が担当現場AIから資材を回収し、拠点チェストへ格納（空きなし時は床面ドロップ） | ✅ 完了 |
| **AIPlayer** | ネザー遠征 (荒廃ポータル修復) | 動画解析座標 (278, 63, 94) へボートで移動し、ゲート修復・ネザー探索・エンド資材集め | ✅ 完了 |
| **AIPlayer** | サーバー最大参加人数の拡張 | `server.properties` にて `max-players=100` へ引き上げ | ✅ 完了 |
| **推論基盤** | Qwen 2.5 (Colab L4最高スペック) | L4 GPU (24GB VRAM) に最適化された `qwen2.5:14b` をOllamaローカル推論として導入 | ✅ 完了 |
| **記録機能** | 画面収録機能の廃止 | `recorder/` ディレクトリおよびffmpeg/Chrome依存を完全削除 | ✅ 完了 |
| **記録機能** | 行動日誌のLLM学習 & 改善提案 | Qwen 2.5 が全ボット日誌と資材DBを自律分析し、具体的改善提案を出力 | ✅ 完了 |
| **ポータル** | 総合行動モニターWebポータル | ポート3000にExpress/WebSocketによるモダンDark UIポータルを実装 | ✅ 完了 |
| **ポータル** | 10大機能の完全統合 | コマンド送信, チャット, 2Dマップ, 日誌閲覧, 深部DB, ログ, 司令塔報告, チェスト閲覧, 畑牧場モニター, 統括日報 | ✅ 完了 |
| **日報** | YouTubeスライド統括日報 | 起動セッションごとに視覚的日報を作成、YouTubeスライド表示モード搭載 | ✅ 完了 |
| **Colab** | 2セル完結ノートブック | ワンクリック起動セルとセーブ＆終了セルの2つのみに集約 | ✅ 完了 |
| **高速化** | キャッシュ永続化 | Google Driveキャッシュにより2回目以降のモデル・依存ダウンロード時間を削減 | ✅ 完了 |
| **接続** | playit.gg 固定流用 | 既存の `playit.toml` (zuyasi / zuyasi.playit.plus) を完全流用 | ✅ 完了 |

---

## 3. 今後の運用手順

1. Google Colab上で [`Minecraft_Colab_Runner.ipynb`](Minecraft_Colab_Runner.ipynb) を開く。
2. ステップ1（起動セル）を実行し、約45秒〜1分で完了。
3. 表示されたWebポータルURLおよびMinecraftアドレス `zuyasi.playit.plus` から接続・プレイ。
4. 終了時はステップ2（セーブ＆終了セル）を実行。
