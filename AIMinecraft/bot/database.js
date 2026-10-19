/**
 * database.js - Minecraft AI Cluster Deep System Database (改善指示書v3準拠)
 * システム深部まで深掘りできるデータベースエンジン
 * ボット情報、2グループ管理、インベントリ、アイテム要求、拠点チェスト、畑・飼育場、
 * 収集実績、日誌、司令等達成レポート、統括日報を管理
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
        version: "3.0.0",
        worldSessionId: Date.now().toString(36)
      },
      bots: {},
      groupSettings: {
        group1Active: true,
        group2Active: true
      },
      itemRequests: {}, // { [botId]: [ { id, itemName, count, reason, requestedAt, fulfilled } ] }
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
      commanderReports: {}, // グループリーダーによる統括レポート
      userTaskReports: [], // ユーザー指示に対する達成状況レポート
      improvementProposals: [],
      eventLogs: [],
      executiveReports: [] // 統括日報 (YouTubeスライド用)
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

  // --- アイテム要求管理 ---
  recordItemRequest(botId, itemName, count = 1, reason = '作業続行のため') {
    if (!this.data.itemRequests[botId]) {
      this.data.itemRequests[botId] = [];
    }
    const req = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 4),
      botId,
      itemName,
      count,
      reason,
      requestedAt: new Date().toISOString(),
      fulfilled: false
    };
    // 重複を避けて最新に更新
    const idx = this.data.itemRequests[botId].findIndex(r => r.itemName === itemName && !r.fulfilled);
    if (idx >= 0) {
      this.data.itemRequests[botId][idx] = req;
    } else {
      this.data.itemRequests[botId].unshift(req);
    }
    // 上限保持
    if (this.data.itemRequests[botId].length > 10) {
      this.data.itemRequests[botId].pop();
    }
    this.save();
    return req;
  }

  fulfillItemRequest(botId, itemName) {
    if (this.data.itemRequests[botId]) {
      for (const req of this.data.itemRequests[botId]) {
        if (req.itemName === itemName && !req.fulfilled) {
          req.fulfilled = true;
          req.fulfilledAt = new Date().toISOString();
        }
      }
      this.save();
    }
  }

  getAllItemRequests() {
    return this.data.itemRequests;
  }

  // --- イベントログ ---
  logEvent(category, botId, message, details = {}) {
    const entry = {
      id: Date.now() + Math.random().toString(36).substring(2, 6),
      time: new Date().toISOString(),
      timestamp: Date.now(),
      category, // 'chat', 'combat', 'harvest', 'store', 'move', 'system', 'commander', 'demand', 'pair'
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

  // --- 司令塔 / グループリーダーレポート ---
  updateCommanderReport(roleKey, report) {
    this.data.commanderReports[roleKey] = {
      ...report,
      roleKey,
      updatedAt: new Date().toISOString()
    };
    this.save();
  }

  // --- ユーザー指示達成レポート ---
  addUserTaskReport(report) {
    const entry = {
      id: Date.now().toString(36),
      timestamp: new Date().toISOString(),
      ...report
    };
    this.data.userTaskReports.unshift(entry);
    if (this.data.userTaskReports.length > 50) {
      this.data.userTaskReports.pop();
    }
    this.save();
    return entry;
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
    else if (table === 'user_task_reports') source = this.data.userTaskReports;
    else if (table === 'item_requests') {
      source = Object.entries(this.data.itemRequests).flatMap(([botId, reqs]) => reqs);
    }
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
    const allBots = Object.values(this.data.bots);
    const activeBots = allBots.filter(b => b.connected).length;
    const group1Active = allBots.filter(b => b.group === 1 && b.connected).length;
    const group2Active = allBots.filter(b => b.group === 2 && b.connected).length;

    let pendingRequestsCount = 0;
    for (const reqs of Object.values(this.data.itemRequests)) {
      pendingRequestsCount += reqs.filter(r => !r.fulfilled).length;
    }

    return {
      activeBots,
      totalBots: allBots.length,
      group1Active,
      group2Active,
      pendingRequestsCount,
      totalHarvest,
      totalChests,
      farmPlots: this.data.farm.tilledPlots,
      ranchTotal: Object.values(this.data.ranch.animals).reduce((a, b) => a + b, 0),
      totalEvents: this.data.eventLogs.length,
      proposalsCount: this.data.improvementProposals.length,
      reportsCount: this.data.executiveReports.length,
      taskReportsCount: this.data.userTaskReports.length
    };
  }
}

module.exports = new SystemDatabase();
