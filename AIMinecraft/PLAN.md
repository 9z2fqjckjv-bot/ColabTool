# Minecraft for Colab 開発・実装計画書 (Project Plan v3)

本ドキュメントは、[改善指示書v3.html](改善指示書v3.html) に記載された仕様に基づき、Google Colab（L4 GPU）上で一時的なMinecraft Java版サーバーを立ち上げ、**Qwen 2.5（14B）を頭脳とする2グループ全10名の用途別自律AIPlayer** および **総合行動モニターWebポータル** と共にサバイバル生活を進め、データ永続化と統括日報（YouTubeスライド）作成を行うシステムの実装計画です。

---

## 1. システム全体アーキテクチャ

```mermaid
flowchart TB
    subgraph LocalPC["ユーザー環境 (Local PC)"]
        MC_Client["Minecraft Java Client (1.21.x)\n(手元から zuyasi.playit.plus へ接続)"]
        Browser["Webブラウザ (PC / タブレット)\n(総合Webポータル: 新しいタブで自動展開)"]
    end

    subgraph Colab["Google Colab (L4 GPU / 24GB VRAM)"]
        subgraph Orchestrator["2セル完結ノートブック (Runner.ipynb)"]
            Cell1["ステップ1: ワンクリック起動 (Setup / Cache / PaperMC / Qwen2.5 / 10AI / Portal新タブ展開 / 常駐監視)"]
            Cell2["ステップ2: セーブ＆終了 (save-all / 深部DB・日誌二重同期 / GitPush)"]
        end

        subgraph MC_Server["Minecraft Server (PaperMC 1.21.1)"]
            Purpur["PaperMC Server (max-players=30)\n(Java 21 / RAM 5GB 最適化)"]
            Tunnel["playit.gg トンネル (zuyasi.playit.plus)\n(Minecraftポート 25565 公開)"]
            Radar["RadarMap Plugin (自動縮尺マップ配布)"]
        end

        subgraph AI_Cluster["AIPlayer クラスタ (2グループ全10名 / Mineflayer)"]
            subgraph Group1["第1グループ (5名: 拠点開拓・生活基盤)"]
                Gekitai["撃退隊長 (1名: 敵対モブ撃退・拠点納品・第1Gリーダー)"]
                Nogyo["農作業 (1名: 畑耕作・作物育成・収穫納品)"]
                Shizai["資材集め (2名ペア: 丸石/土/砂/石炭/露出鉱物/原木・ペア会話共同作業)"]
                Kari["モブ狩り (1名: 牛/羊/豚/鶏・ドロップ納品)"]
            end
            subgraph Group2["第2グループ (5名: 施設飼育・深部遠征)"]
                Shiiku["動物飼育 (1名: 4種専用ペン・繁殖・成果物納品)"]
                Dokutsu["洞窟発掘 (2名ペア: 松明配置・鉱脈採掘・廃坑探検・AI単独完遂)"]
                Nether["ネザー遠征 (2名ペア: ボート移動・ポータル修復・エンド資材・AI単独完遂)"]
            end
        end

        subgraph LLM_Engine["LLM推論基盤 (Qwen 2.5 on L4 GPU)"]
            Qwen["Qwen 2.5 14B (Ollama / VRAM ~9GB)\n・自然な日本語対話 (5W3H原則)\n・第1グループ内会話 & ペア会話協調\n・行動日誌学習 & 戦略的改善提案\n・YouTubeスライド用 統括日報作成"]
        end

        subgraph Web_Portal["総合行動モニター & Webポータル (ポート 3000 / Cloudflare)"]
            PortalServer["Express & WebSocket サーバー"]
            GroupControl["グループ管理 (第1G/第2G スポーン・デスポーン)"]
            DemandsPanel["道具・アイテム・食料要求パネル"]
            TaskReports["ユーザー指示達成状況レポート (司令等作成)"]
            RadarMap2D["2D レーダーマップ (全ボット座標リアルタイム追従)"]
            ChatConsole["リアルタイム対話 & コンソールコマンド"]
            SlideView["YouTube用 統括日報スライドプレゼンテーション"]
            ChestViewer["拠点チェスト・畑飼育場モニター"]
            DeepDB["深部システムデータベース エクスプローラー"]
        end
    end

    subgraph Storage["永続ストレージ & 高速キャッシュ"]
        GDrive["Google Drive (/content/drive/MyDrive/Minecraft_Colab)\n(二重保管 & 5分毎定期オートバックアップ)"]
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

## 2. 実装仕様一覧 (改善指示書v3 対応状況)

| 項目 | 要件仕様 | 実装内容 | ステータス |
| :--- | :--- | :--- | :---: |
| **AIPlayer** | 4AI(Gemini, ChatGPT, Claude, Grok)廃止 | 旧4AIを完全廃止・関連ログもクリーン消去 | ✅ 完了 |
| **AIPlayer** | Qwen 2.5 (Colab L4最高スペック) | L4 GPU (24GB VRAM) に最適化された `qwen2.5:14b` をOllamaローカル推論として導入 | ✅ 完了 |
| **AIPlayer** | 2グループ用途別クラスタ (全10名) | 第1グループ(5名: 撃退, 農作業, 資材集めペア, モブ狩り) / 第2グループ(5名: 飼育, 洞窟発掘ペア, ネザー遠征ペア) を実装 | ✅ 完了 |
| **AIPlayer** | 第1グループ内の会話・一体作業 | 第1グループ所属ボット間で作業進捗・安全確認の会話を自動交わし一体となって作業 | ✅ 完了 |
| **AIPlayer** | 2人ペア間の会話・共同作業 | 資材集め(1&2), 洞窟発掘(1&2), ネザー遠征(1&2) が互いに会話を交わし共同作業 | ✅ 完了 |
| **AIPlayer** | 洞窟発掘・ネザー遠征のAI単独完遂 | 松明配置・鉱脈採掘・廃坑探検、ボート移動・荒廃ポータル(278,63,94)修復・エンド資材回収をAIのみで完遂 | ✅ 完了 |
| **AIPlayer** | 道具・アイテム・食料の要求機能 | 必要なツール・食料が不足した際にプレイヤーへ要求チャットを発言し、ポータルへ通知 | ✅ 完了 |
| **AIPlayer** | 拠点チェストへの納品（満杯時ドロップ） | 収集アイテムを拠点チェストへ自動格納。チェスト満杯時は床面へドロップ納品 | ✅ 完了 |
| **記録機能** | 画面収録機能の廃止 | 録画モジュールおよび関連ログ・映像を完全廃止・削除 | ✅ 完了 |
| **記録機能** | 行動日誌のLLM学習 & 改善提案 | Qwen 2.5 が全ボット日誌と資材DBを自律分析し、具体的改善提案を出力 | ✅ 完了 |
| **ポータル** | 行動モニターWebポータルの新タブ展開 | Colab起動完了時に `window.open` プログラムにより新しいタブで自動展開 | ✅ 完了 |
| **ポータル** | AIPlayerのグループ管理 | 第1グループ・第2グループの一括スポーン/デスポーンおよび個別制御UI | ✅ 完了 |
| **ポータル** | 指示達成状況と報告レポート | 司令等（各グループ統括リーダー）がユーザー指示に対する進捗率・具体的成果をレポート化 | ✅ 完了 |
| **日報** | YouTubeスライド統括日報 | 起動セッションごとに実際の日付に基づき視覚的日報を作成、YouTubeスライド表示モード搭載 | ✅ 完了 |
| **Colab** | 2セル完結ノートブック | ワンクリック起動セルとセーブ＆終了セルの2つのみに集約 | ✅ 完了 |
| **堅牢性** | いつランタイムが切れても安全な設計 | バックグラウンド常駐、5分間隔の自動オートセーブ（Drive/XServer同期） | ✅ 完了 |
| **接続** | playit.gg 固定流用 | 既存の `playit.toml` (zuyasi.playit.plus) を完全流用 | ✅ 完了 |
| **ワールド** | ワールド再生成 & 既存ログ消去 | 起動時に旧ワールドと過去の行動日誌・ログをクリーン削除し再生成 | ✅ 完了 |

---

## 3. 運用手順

1. Google Colab上で [`Minecraft_Colab_Runner.ipynb`](Minecraft_Colab_Runner.ipynb) を開く。
2. ステップ1（起動セル）を実行（約40秒〜1分）。
3. 自動的に新しいタブで開いた **総合行動モニターWebポータル** および Minecraftアドレス **`zuyasi.playit.plus`** から接続・プレイ。
4. ポータル上でグループ管理（第1G/第2Gスポーン）、チャット指示、道具要求の充足確認、YouTubeスライド日報の確認等を実施。
5. 終了時はステップ2（セーブ＆終了セル）を実行。
