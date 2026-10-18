/**
 * portal_server.js - Minecraft AI Cluster 総合行動モニター & Webポータル
 * Express + WebSocket サーバー (ポート 3000)
 */

const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const db = require('../database');
const fs = require('fs');

class PortalServer {
  constructor(botManager = null, brain = null, options = {}) {
    this.port = parseInt(process.env.PORT || options.port || '3000', 10);
    this.botManager = botManager;
    this.brain = brain;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    this.clients = new Set();
    this.logsDir = process.env.LOGS_DIR || '/content/logs';

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSockets();
  }

  setBotManager(bm) {
    this.botManager = bm;
  }

  setBrain(b) {
    this.brain = b;
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(express.static(path.join(__dirname, 'public')));
  }

  setupRoutes() {
    // 統計サマリー
    this.app.get('/api/stats', (req, res) => {
      const stats = db.getOverviewStats();
      const serverStatus = this.botManager ? this.botManager.getServerStatus() : { tps: 20.0, time: 'day', weather: 'clear' };
      res.json({ success: true, stats, serverStatus });
    });

    // ボット一覧
    this.app.get('/api/bots', (req, res) => {
      const bots = db.getBots();
      res.json({ success: true, bots });
    });

    // 拠点チェスト
    this.app.get('/api/chests', (req, res) => {
      const chests = db.getChests();
      res.json({ success: true, chests });
    });

    // 畑と飼育場
    this.app.get('/api/farm-ranch', (req, res) => {
      res.json({
        success: true,
        farm: db.data.farm,
        ranch: db.data.ranch
      });
    });

    // 行動日誌一覧と取得
    this.app.get('/api/diaries', (req, res) => {
      const botId = req.query.botId;
      const diaries = [];
      try {
        if (fs.existsSync(this.logsDir)) {
          const files = fs.readdirSync(this.logsDir).filter(f => f.endsWith('_diary.md'));
          for (const f of files) {
            const role = f.replace('_diary.md', '');
            if (botId && role !== botId) continue;
            const content = fs.readFileSync(path.join(this.logsDir, f), 'utf8');
            diaries.push({ role, filename: f, content });
          }
        }
      } catch (e) {
        console.warn(`[Portal] 日誌読み込みエラー: ${e.message}`);
      }
      res.json({ success: true, diaries });
    });

    // リアルタイムログ
    this.app.get('/api/logs', (req, res) => {
      const category = req.query.category;
      const limit = parseInt(req.query.limit || '100', 10);
      let logs = db.data.eventLogs;
      if (category && category !== 'all') {
        logs = logs.filter(l => l.category === category);
      }
      res.json({ success: true, logs: logs.slice(0, limit) });
    });

    // 司令塔レポート
    this.app.get('/api/command-reports', (req, res) => {
      res.json({ success: true, reports: db.data.commanderReports });
    });

    // 改善提案
    this.app.get('/api/proposals', (req, res) => {
      res.json({ success: true, proposals: db.data.improvementProposals });
    });

    // 改善提案の手動/自動生成
    this.app.post('/api/proposals/generate', async (req, res) => {
      if (!this.brain) return res.status(503).json({ success: false, message: 'LLMエンジン未初期化' });
      const diaries = [];
      try {
        if (fs.existsSync(this.logsDir)) {
          const files = fs.readdirSync(this.logsDir).filter(f => f.endsWith('_diary.md'));
          for (const f of files.slice(0, 10)) {
            const lines = fs.readFileSync(path.join(this.logsDir, f), 'utf8').split('\n').filter(Boolean);
            diaries.push({ role: f.replace('_diary.md', ''), content: lines.slice(-3).join(' ') });
          }
        }
      } catch (_) {}
      const proposals = await this.brain.analyzeDiariesAndProposeImprovements(diaries, db.getOverviewStats());
      this.broadcast('new_proposals', proposals);
      res.json({ success: true, proposals });
    });

    // 統括日報一覧
    this.app.get('/api/reports', (req, res) => {
      res.json({ success: true, reports: db.data.executiveReports });
    });

    // 統括日報の生成
    this.app.post('/api/reports/generate', async (req, res) => {
      if (!this.brain) return res.status(503).json({ success: false, message: 'LLMエンジン未初期化' });
      const sessionInfo = this.botManager ? this.botManager.getServerStatus() : { uptime: '1時間', tps: 20.0 };
      const report = await this.brain.generateExecutiveReport(sessionInfo, db.data.commanderReports, db.getOverviewStats());
      this.broadcast('new_report', report);
      res.json({ success: true, report });
    });

    // サーバーコマンド送信
    this.app.post('/api/command', (req, res) => {
      const { command } = req.body;
      if (!command) return res.status(400).json({ success: false, message: 'コマンドが指定されていません' });
      if (this.botManager) {
        this.botManager.executeConsoleCommand(command);
        db.logEvent('system', 'Console', `コマンド実行: ${command}`);
        res.json({ success: true, message: `コマンドを送信しました: ${command}` });
      } else {
        res.status(503).json({ success: false, message: 'BotManager未接続' });
      }
    });

    // チャット送信
    this.app.post('/api/chat', async (req, res) => {
      const { message, sender = 'User' } = req.body;
      if (!message) return res.status(400).json({ success: false, message: 'メッセージが空です' });
      if (this.botManager) {
        const reply = await this.botManager.handleUserChat(sender, message);
        this.broadcast('chat_message', { sender, message, reply, time: new Date().toLocaleTimeString('ja-JP') });
        res.json({ success: true, reply });
      } else {
        res.status(503).json({ success: false, message: 'BotManager未接続' });
      }
    });

    // 深部データベースクエリ
    this.app.get('/api/db/query', (req, res) => {
      const table = req.query.table || 'bots';
      const limit = parseInt(req.query.limit || '50', 10);
      const offset = parseInt(req.query.offset || '0', 10);
      let filter = {};
      try {
        if (req.query.filter) filter = JSON.parse(req.query.filter);
      } catch (_) {}
      const result = db.query(table, filter, limit, offset);
      res.json({ success: true, table, ...result });
    });
  }

  setupWebSockets() {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      // 初回接続時に初期データを送信
      ws.send(JSON.stringify({
        type: 'init',
        stats: db.getOverviewStats(),
        bots: db.getBots(),
        reports: db.data.commanderReports
      }));

      ws.on('close', () => {
        this.clients.delete(ws);
      });
      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });
  }

  broadcast(type, data) {
    const message = JSON.stringify({ type, data, timestamp: Date.now() });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (_) {}
      }
    }
  }

  start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, '0.0.0.0', () => {
        console.log(`🌐 [WebPortal] 統合行動モニターポータルが起動しました: http://0.0.0.0:${this.port}`);
        resolve();
      });
    });
  }
}

module.exports = PortalServer;
