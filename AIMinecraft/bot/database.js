/**
 * database.js - Minecraft AI Cluster Deep System Database
 * システム深部まで深掘りできるデータベースエンジン
 * ボット情報、インベントリ、拠点チェスト、畑・飼育場、収集実績、日誌、司令塔レポートを管理
 */

const fs = require('fs');
const path = require('path');

class SystemDatabase {
  constructor(options = {}) {
    this.logsDir = options.logsDir || process.env.LOGS_DIR || '/content/logs';
    this.dbFile = path.join(this.logsDir, 'deep_system_database.json');
    this.data = {
      meta: {
        created: new Date().toISOString(),
        version: "2.0.0",
        worldSessionId: Date.now().toString(36)
      },
      bots: {},
      chests: {},
      farm: {
        tilledPlots: 0,
        crops: { wheat: 0, carrot: 0, potato: 0, beetroot: 0 },
        harvestTotal: 0,
        lastUpdated: new Date().toISOString()
      },
      ranch: {
        pens: [],
        animals: { cow: 0, sheep: 0, pig: 0, chicken: 0 },
        bredCount: { cow: 0, sheep: 0, pig: 0, chicken: 0 },
        lastUpdated: new Date().toISOString()
      },
      harvestLogs: [],
      commanderReports: {},
      improvementProposals: [],
      eventLogs: [],
      executiveReports: []
    };

    this.maxEvents = 1000;
    this.maxHarvestLogs = 2000;
    this.saveDebounce = null;

    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.dbFile)) {
        const raw = fs.readFileSync(this.dbFile, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = { ...this.data, ...parsed };
      }
    } catch (e) {
      console.warn(`[Database] 読み込みエラー (新規作成): ${e.message}`);
    }
  }

  save() {
    if (this.saveDebounce) return;
    this.saveDebounce = setTimeout(() => {
      this.saveDebounce = null;
      try {
        fs.mkdirSync(this.logsDir, { recursive: true });
        fs.writeFileSync(this.dbFile, JSON.stringify(this.data, null, 2), 'utf8');
      } catch (e) {
        console.error(`[Database] 保存失敗: ${e.message}`);
      }
    }, 1500);
  }

  saveSync() {
    try {
      fs.mkdirSync(this.logsDir, { recursive: true });
      fs.writeFileSync(this.dbFile, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error(`[Database] 同期保存失敗: ${e.message}`);
    }
  }

  // --- ボット状態の更新 ---
  upsertBot(id, botInfo) {
    const existing = this.data.bots[id] || {};
    this.data.bots[id] = {
      ...existing,
      ...botInfo,
      lastUpdated: new Date().toISOString()
    };
    this.save();
  }

  getBots() {
    return Object.values(this.data.bots);
  }

  getBot(id) {
    return this.data.bots[id] || null;
  }

  // --- イベントログ ---
  logEvent(category, botId, message, details = {}) {
    const entry = {
      id: Date.now() + Math.random().toString(36).substring(2, 6),
      time: new Date().toISOString(),
      timestamp: Date.now(),
      category, // 'chat', 'combat', 'harvest', 'store', 'move', 'system', 'commander'
      botId,
      message,
      details
    };
    this.data.eventLogs.unshift(entry);
    if (this.data.eventLogs.length > this.maxEvents) {
      this.data.eventLogs.pop();
    }
    this.save();
    return entry;
  }

  // --- 収集アイテム記録 ---
  recordHarvest(botId, itemName, count = 1, category = 'material') {
    const entry = {
      id: Date.now() + Math.random().toString(36).substring(2, 6),
      time: new Date().toISOString(),
      botId,
      itemName,
      count,
      category
    };
    this.data.harvestLogs.unshift(entry);
    if (this.data.harvestLogs.length > this.maxHarvestLogs) {
      this.data.harvestLogs.pop();
    }
    this.save();
  }

  // --- 拠点チェスト状態 ---
  updateChest(posKey, chestData) {
    this.data.chests[posKey] = {
      ...chestData,
      lastUpdated: new Date().toISOString()
    };
    this.save();
  }

  getChests() {
    return this.data.chests;
  }

  // --- 畑と飼育場 ---
  updateFarm(farmData) {
    this.data.farm = {
      ...this.data.farm,
      ...farmData,
      lastUpdated: new Date().toISOString()
    };
    this.save();
  }

  updateRanch(ranchData) {
    this.data.ranch = {
      ...this.data.ranch,
      ...ranchData,
      lastUpdated: new Date().toISOString()
    };
    this.save();
  }

  // --- 司令塔レポート ---
  updateCommanderReport(roleKey, report) {
    this.data.commanderReports[roleKey] = {
      ...report,
      roleKey,
      updatedAt: new Date().toISOString()
    };
    this.save();
  }

  // --- 改善提案 ---
  addImprovementProposal(proposal) {
    this.data.improvementProposals.unshift({
      id: Date.now().toString(36),
      createdAt: new Date().toISOString(),
      ...proposal
    });
    this.save();
  }

  // --- 統括日報 ---
  addExecutiveReport(report) {
    this.data.executiveReports.unshift({
      id: Date.now().toString(36),
      date: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
      ...report
    });
    this.save();
  }

  // --- 深部データベースクエリAPI ---
  query(table, filter = {}, limit = 100, offset = 0) {
    let source = [];
    if (table === 'bots') source = Object.values(this.data.bots);
    else if (table === 'harvest_logs') source = this.data.harvestLogs;
    else if (table === 'events') source = this.data.eventLogs;
    else if (table === 'chests') source = Object.values(this.data.chests);
    else if (table === 'commander_reports') source = Object.values(this.data.commanderReports);
    else if (table === 'improvement_proposals') source = this.data.improvementProposals;
    else if (table === 'executive_reports') source = this.data.executiveReports;
    else if (table === 'farm') source = [this.data.farm];
    else if (table === 'ranch') source = [this.data.ranch];
    else return { total: 0, rows: [] };

    let filtered = source.filter(item => {
      for (const [k, v] of Object.entries(filter)) {
        if (v === undefined || v === null || v === '') continue;
        if (typeof v === 'string') {
          if (!String(item[k] || '').toLowerCase().includes(v.toLowerCase())) return false;
        } else if (item[k] !== v) {
          return false;
        }
      }
      return true;
    });

    const total = filtered.length;
    const rows = filtered.slice(offset, offset + limit);
    return { total, rows };
  }

  getOverviewStats() {
    const totalHarvest = this.data.harvestLogs.reduce((acc, cur) => acc + (cur.count || 1), 0);
    const totalChests = Object.keys(this.data.chests).length;
    const activeBots = Object.values(this.data.bots).filter(b => b.connected).length;
    return {
      activeBots,
      totalBots: Object.keys(this.data.bots).length,
      totalHarvest,
      totalChests,
      farmPlots: this.data.farm.tilledPlots,
      ranchTotal: Object.values(this.data.ranch.animals).reduce((a, b) => a + b, 0),
      totalEvents: this.data.eventLogs.length,
      proposalsCount: this.data.improvementProposals.length,
      reportsCount: this.data.executiveReports.length
    };
  }
}

module.exports = new SystemDatabase();
