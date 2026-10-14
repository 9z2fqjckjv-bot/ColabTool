# 🎮 Colab Gaming PC (L4 GPU / High-Memory)

Google Colabの **NVIDIA L4 GPU (24GB VRAM) & ハイメモリ (53GB RAM)** を活用し、本格的なクラウドゲーミングワークステーションおよび自立型Minecraftサーバーをワンクリックで構築・稼働させる自動化プロジェクトです。

---

## 🌟 主な機能とアーキテクチャ

`GamingPC/Note.html` および `GamingPC/実行したいタスクとプロセス.md` の要件に基づき設計されています。

### 1. 🖥️ デスクトップ＆高互換リモート接続
- **Xfce4 デスクトップ**: 1920x1080 (Full HD 24bit) の高速・軽量グラフィカル環境。
- **PulseAudio 仮想サウンド**: ゲーム音・Discord音声・BGMを扱う仮想オーディオデバイス（VirtualSink）を完備。
- **noVNC (Webブラウザ直接アクセス)**: 専用アプリのインストール不要。自動発行されるCloudflare HTTPSリンクからブラウザ内で即座に操作可能。
- **Chrome Remote Desktop (CRD)**: ゲームプレイに最適な高フレームレート・低遅延・全画面表示対応。

### 2. 🌐 Google Chrome マルチプロファイル
- デスクトップ上に **Profile 1 / Profile 2 / Profile 3** の独立ショートカットを完備。
- アカウントや作業ごとの分離、5〜10個前後のタブ展開を快適にサポート。

### 3. 🎮 ゲーミング＆中継ソフト環境
- **Steam**: Linux / Proton互換環境。Hearts of Iron IV (Hoi4) やChillwithYouなどのSteamゲームをバックグラウンド実行・プレイ可能。
- **Minecraft (Prism Launcher)**: ModrinthやCurseForgeのMODパックをワンクリックで導入できる高性能Minecraftクライアント。
- **CurseForge**: MOD・アドオン管理。
- **Xbox Cloud Gaming**: 専用WebAppショートカットからブラウザ経由で即座にクラウドゲームを起動。
- **Roblox**: デスクトップショートカットから直接アクセス。
- **ChillwithYou**: 作業・リラックス用BGMコンパニオン。
- **Discord**: 音声通話・テキストチャット。

### 4. ⛏️ セル非依存・独立稼働型 Minecraft サーバー
- **PaperMC 1.21.1 (最新安定版)** をバックグラウンドデーモンとして起動。
- **Colabセルの実行をブロックしない設計**: セル終了後もサーバーは独立して稼働を継続。
- コマンド送信用のFIFOパイプ（`server.pipe`）を備え、ノートブックのステップ3から `say` や `op`、`save-all` などのコマンドを直接送信可能。
- **playit.gg トンネル** により、外部からのマルチプレイ接続にも対応。

### 5. 🎥 L4 GPU NVENC ハードウェアアクセラレーション画面収録 (60fps)
- NVIDIA L4 GPUのNVENCエンジンを活用し、ゲーム描画やCPUに負荷をかけずに **1080p 60fps** のデスクトップ＆音声録画が可能。
- デスクトップ上のショートカット「🎥 画面収録」またはノートブックの「ステップ 4」からワンクリックで開始/停止。
- OBS Studioも完備。

### 6. 💾 Google Drive 完全データ永続化（シャットダウン対策）
- セーブデータ、ワールド、Chromeプロファイル、Steam設定、録画動画を `/content/drive/MyDrive/GamingPC/` に自動同期。
- 15分ごとの定期自動バックアップに加え、シャットダウン時に完全同期。次回起動時にシームレスに復元されます。

---

## 🚀 使い方 (Google Colab)

1. [Google Colab](https://colab.research.google.com/) で [`GamingPC_Colab.ipynb`](GamingPC_Colab.ipynb) を開きます。
2. ランタイムのタイプを **「L4 GPU」かつ「ハイメモリ」** に設定します。
3. **ステップ 1: 【ワンクリック起動】** を実行します（約1〜2分で環境構築・起動が完了し、セルが終了します）。
4. セル実行結果に表示されるカードから接続します：
   - **noVNC の場合**: 表示されたリンクをクリックすると、ブラウザ内にデスクトップが開きます。
   - **Chrome Remote Desktop の場合**: 事前に [remotedesktop.google.com/headless](https://remotedesktop.google.com/headless) で取得したコードを入力して起動し、Remote Desktopから接続します。
   - **Minecraft サーバー**: 表示された外部アドレスを手元のMinecraftに入力して参加できます。
5. プレイ終了時は、**ステップ 5: 【ワンクリック安全停止】** を実行すると、全セーブデータと録画がGoogle Driveへ安全に保存されます。

---

## 📁 ディレクトリ構成

```text
GamingPC/
├── Note.html                  # 構成仕様・注意点
├── 実行したいタスクとプロセス.md  # 実行対象タスク定義
├── README.md                  # 本仕様・解説書
├── GamingPC_Colab.ipynb       # Colab用ワンクリック自動化ノートブック
└── scripts/
    ├── setup_environment.sh   # Xfce4・Chrome・Steam・Discord・PrismLauncher環境構築
    ├── start_desktop.sh       # Xvfb・PulseAudio・noVNC・Cloudflare・CRD起動
    ├── start_mc_server.sh     # 独立型PaperMCサーバー & playit.gg トンネル起動
    ├── record_screen.sh       # L4 GPU NVENC 1080p 60fps 画面収録スクリプト
    ├── backup_restore.py      # Google Drive 自動同期・セーブデータ復元
    └── shutdown.sh            # 安全停止・セーブ同期・プロセス終了
```
