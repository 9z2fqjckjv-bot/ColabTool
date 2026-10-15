/**
 * vision_capturer.js - AIPlayer 一人称視線スクリーンショット自動取得エンジン
 * prismarine-viewer (Three.js WebGL) のポートから定期的に画面をキャプチャし、
 * Gemini Vision / マルチモーダルLLM向けに最適化された画像バッファ(Base64/JPEG)を提供します。
 */

const { createCanvas, loadImage } = require('canvas');

class VisionCapturer {
  constructor(options = {}) {
    this.viewerPort = options.port || 3001;
    this.botName = options.botName || 'AIPlayer';
    this.intervalMs = options.intervalMs || 3000;
    this.browser = null;
    this.page = null;
    this.latestScreenshot = null; // Buffer (JPEG)
    this.latestBase64 = null;     // String (Base64)
    this.lastCaptureTime = 0;
    this.isCapturing = false;
    this.puppeteerAvailable = false;
    this.timer = null;

    // Puppeteerの読み込み確認
    try {
      this.puppeteer = require('puppeteer');
      this.puppeteerAvailable = true;
    } catch (e) {
      console.warn(`[VisionCapturer - ${this.botName}] puppeteer未ロード (${e.message})。Canvas高速視覚レンダラーで動作します。`);
    }
  }

  /**
   * ブラウザセッションの初期化 (Prismarine-Viewerへ接続)
   */
  async initBrowser() {
    if (!this.puppeteerAvailable || this.browser) return;

    try {
      this.browser = await this.puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--enable-webgl',
          '--ignore-gpu-blocklist',
          '--use-gl=angle',
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader',
          '--no-first-run',
          '--no-zygote',
          '--single-process'
        ]
      });

      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 480, height: 320 });
      
      const viewerUrl = `http://127.0.0.1:${this.viewerPort}`;
      console.log(`[VisionCapturer - ${this.botName}] Viewer接続待機中: ${viewerUrl}`);
      
      // Viewerページへの接続（リトライ付き）
      await this.page.goto(viewerUrl, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(err => {
        // 初回ロードエラー時は次サイクルで自動再接続
      });

      console.log(`📸 [VisionCapturer - ${this.botName}] 一人称視点キャプチャ準備完了 (Port: ${this.viewerPort})`);
    } catch (err) {
      console.warn(`[VisionCapturer - ${this.botName}] ブラウザ初期化スキップ (${err.message})。代替視覚レンダラーを使用します。`);
      if (this.browser) {
        try { await this.browser.close(); } catch (_) {}
        this.browser = null;
        this.page = null;
      }
    }
  }

  /**
   * 1フレームのスクリーンショットを取得 (チャットオーバーレイ合成)
   * @param {Object} bot - Mineflayer botインスタンス
   * @param {Array} chatMessages - 直近のチャット履歴 [{sender, text, time}]
   * @returns {Promise<{buffer: Buffer, base64: string}>}
   */
  async capture(bot = null, chatMessages = []) {
    if (this.isCapturing) {
      return { buffer: this.latestScreenshot, base64: this.latestBase64 };
    }
    this.isCapturing = true;

    try {
      // 1. PuppeteerによるWebGLビューアの直接スクショ + チャットオーバーレイ合成
      if (this.page) {
        try {
          const rawBuffer = await this.page.screenshot({
            type: 'jpeg',
            quality: 70
          });
          if (rawBuffer && rawBuffer.length > 0) {
            const composite = await this.overlayChatOnImage(rawBuffer, chatMessages, bot);
            this.latestScreenshot = composite;
            this.latestBase64 = composite.toString('base64');
            this.lastCaptureTime = Date.now();
            return { buffer: this.latestScreenshot, base64: this.latestBase64 };
          }
        } catch (pageErr) {
          // ページ再接続が必要な場合
          this.page = null;
        }
      }

      // 2. ブラウザ初期化がまだなら試行
      if (this.puppeteerAvailable && !this.browser) {
        this.initBrowser().catch(() => {});
      }

      // 3. 高速Canvas視覚HUD生成 (チャットオーバーレイ付き)
      const fallbackBuffer = this.renderVisualHud(bot, chatMessages);
      this.latestScreenshot = fallbackBuffer;
      this.latestBase64 = fallbackBuffer.toString('base64');
      this.lastCaptureTime = Date.now();
      return { buffer: this.latestScreenshot, base64: this.latestBase64 };
    } finally {
      this.isCapturing = false;
    }
  }

  /**
   * Puppeteer画像の上にチャットログとHUDをオーバーレイ合成
   */
  async overlayChatOnImage(rawBuffer, chatMessages, bot) {
    try {
      const img = await loadImage(rawBuffer);
      const width = img.width || 480;
      const height = img.height || 320;
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');

      // 背景に元のWebGLスクショを描画
      ctx.drawImage(img, 0, 0, width, height);

      // 上部HUD (HP / 空腹度 / 座標)
      if (bot && bot.entity) {
        const pos = bot.entity.position;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(5, 5, width - 10, 24);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`POV: ${this.botName} | X:${Math.round(pos.x)} Y:${Math.round(pos.y)} Z:${Math.round(pos.z)} | HP:${bot.health || 20} Food:${bot.food || 20}`, 10, 21);
      }

      // 下部チャットログオーバーレイ描画
      this.drawChatBox(ctx, width, height, chatMessages);

      return canvas.toBuffer('image/jpeg', { quality: 0.75 });
    } catch (_) {
      return rawBuffer;
    }
  }

  /**
   * チャットボックスの描画共通処理
   */
  drawChatBox(ctx, width, height, chatMessages) {
    if (!chatMessages || chatMessages.length === 0) return;

    const chatSlice = chatMessages.slice(-4);
    const boxHeight = chatSlice.length * 18 + 20;
    const boxY = height - boxHeight - 8;

    // 半透明背景
    ctx.fillStyle = 'rgba(10, 15, 25, 0.65)';
    ctx.fillRect(8, boxY, width - 16, boxHeight);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(8, boxY, width - 16, boxHeight);

    // タイトルバー
    ctx.fillStyle = '#ced6e0';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('💬 MINECRAFT LIVE CHAT & LOG', 14, boxY + 13);

    // チャットメッセージ各行
    let lineY = boxY + 28;
    ctx.font = '12px sans-serif';
    chatSlice.forEach(msg => {
      const sender = msg.sender || 'Player';
      const text = msg.text || '';
      const time = msg.time ? `[${msg.time}] ` : '';

      if (sender === 'User' || sender === 'Player') {
        ctx.fillStyle = '#70a1ff'; // プレイヤー色（ライトブルー）
      } else {
        ctx.fillStyle = '#2ed573'; // Bot色（ライトグリーン）
      }
      ctx.fillText(`${time}<${sender}> ${text}`.slice(0, 52), 14, lineY);
      lineY += 18;
    });
  }

  /**
   * Mineflayerの客観データをもとに、Gemini Visionが状況認識できる視界オーバーレイ画像を生成
   */
  renderVisualHud(bot, chatMessages = []) {
    const width = 480;
    const height = 320;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 背景：時間帯・環境による空・地面のグラデーション
    const isNight = bot?.time?.isDay === false;
    const isInWater = bot?.entity?.isInWater;
    
    if (isInWater) {
      ctx.fillStyle = '#0a3d62'; // 水中ブルー
    } else if (isNight) {
      ctx.fillStyle = '#0c1021'; // 深夜ダーク
    } else {
      ctx.fillStyle = '#6897bb'; // 昼間の空色
    }
    ctx.fillRect(0, 0, width, height);

    // 地面
    ctx.fillStyle = isNight ? '#1b2d18' : '#3d6e2e';
    ctx.fillRect(0, height / 2, width, height / 2);

    // HUDテキスト & 視界情報
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`POV: ${this.botName} (Minecraft 1.21.1)`, 15, 25);

    ctx.font = '13px sans-serif';
    if (bot && bot.entity) {
      const pos = bot.entity.position;
      const yaw = Math.round((bot.entity.yaw * 180 / Math.PI) % 360);
      const pitch = Math.round(bot.entity.pitch * 180 / Math.PI);
      ctx.fillText(`Pos: X:${Math.round(pos.x)} Y:${Math.round(pos.y)} Z:${Math.round(pos.z)} | Yaw:${yaw}° Pitch:${pitch}°`, 15, 45);
      ctx.fillText(`HP: ${bot.health || 20}/20 | Food: ${bot.food || 20}/20 | Air: ${bot.oxygenLevel || 20}/20`, 15, 65);

      // 視界正面のブロック情報
      const targetBlock = bot.blockAtCursor ? bot.blockAtCursor(5) : null;
      if (targetBlock) {
        ctx.fillStyle = '#ffd32a';
        ctx.fillText(`Looking At: [${targetBlock.name}] at distance ${Math.round(targetBlock.position.distanceTo(pos))}m`, 15, 90);
      }

      // 視界内のモブ描画（マーカー）
      const nearby = Object.values(bot.entities || {})
        .filter(e => e !== bot.entity && e.position.distanceTo(pos) < 18);

      let yOffset = 115;
      ctx.fillStyle = '#ff5e57';
      nearby.slice(0, 5).forEach(e => {
        const dist = Math.round(e.position.distanceTo(pos));
        const kind = e.type === 'player' ? '👤 Player' : (e.kind === 'Hostile' ? '🚨 Hostile' : '🐾 Animal');
        ctx.fillText(`${kind}: ${e.name || e.username} (${dist}m away)`, 15, yOffset);
        yOffset += 20;
      });
    }

    // クロスヘア（照準）
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width / 2 - 10, height / 2);
    ctx.lineTo(width / 2 + 10, height / 2);
    ctx.moveTo(width / 2, height / 2 - 10);
    ctx.lineTo(width / 2, height / 2 + 10);
    ctx.stroke();

    // チャットログ表示エリア描画
    this.drawChatBox(ctx, width, height, chatMessages);

    return canvas.toBuffer('image/jpeg', { quality: 0.75 });
  }

  /**
   * 定期キャプチャループの開始 (3秒おき)
   */
  startLoop(bot, intervalMs = 3000) {
    if (this.timer) clearInterval(this.timer);
    this.intervalMs = intervalMs;
    this.initBrowser().catch(() => {});

    this.timer = setInterval(async () => {
      try {
        await this.capture(bot);
      } catch (err) {
        // キャプチャループ内の例外は安全に吸収
      }
    }, this.intervalMs);

    console.log(`⏱️ [VisionCapturer - ${this.botName}] 3秒ごとの定期視界撮影ループを開始しました。`);
  }

  /**
   * 終了処理
   */
  async close() {
    if (this.timer) clearInterval(this.timer);
    if (this.browser) {
      try { await this.browser.close(); } catch (_) {}
      this.browser = null;
      this.page = null;
    }
  }
}

module.exports = VisionCapturer;
