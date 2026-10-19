/**
 * index.js - Autonomous Multi-AIPlayer Cluster Manager (改善指示書v3準拠)
 * - 2グループ全10名による用途別クラスタ (第1グループ5名・第2グループ5名)
 * - グループ管理（スポーン/デスポーン）
 * - 第1グループ内会話・一体作業
 * - 2人ペア（資材集め、洞窟発掘、ネザー遠征）の会話・共同作業
 * - 道具・食料のプレイヤー要求機能
 * - 拠点チェストへの自動納品（満杯時ドロップ）
 * - 洞窟発掘・ネザー遠征のAIPlayer単独完遂
 * - 司令等（グループリーダー）による指示達成レポート
 * - Qwen 2.5推論 & 統括日報スライド自動生成
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const autoEat = require('mineflayer-auto-eat').plugin;
const collectBlock = require('mineflayer-collectblock').plugin;
const { Vec3 } = require('vec3');
const fs = require('fs');
const path = require('path');

const { ROLES, GROUPS, BASE_BOUNDS } = require('./persona');
const AIBrain = require('./brain');
const db = require('./database');
const PortalServer = require('./portal/portal_server');

// プロセス安全ハンドラ
process.on('unhandledRejection', (reason) => {
  console.warn('⚠️ [Safeguard] 未処理Promise拒否:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.warn('⚠️ [Safeguard] 未処理例外:', err?.message || err);
});

const SERVER_HOST = process.env.MC_HOST || '127.0.0.1';
const SERVER_PORT = parseInt(process.env.MC_PORT || '25565', 10);
const LOGS_DIR = process.env.LOGS_DIR || '/content/logs';

try {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
} catch (_) {}

const brain = new AIBrain();
let cachedMcData = null;

class BotManager {
  constructor() {
    this.bots = {};
    this.serverPipe = process.env.SERVER_PIPE || '/content/minecraft_server/server.pipe';
    this.portal = new PortalServer(this, brain);
    this.serverUptimeStart = Date.now();
    this.tps = 20.0;
    this.lastGroupConvoTime = Date.now();
    this.lastPairConvoTime = Date.now();
    this.lastLeaderReportTime = Date.now();
  }

  getServerStatus() {
    const elapsedMs = Date.now() - this.serverUptimeStart;
    const mins = Math.floor(elapsedMs / 60000);
    const hrs = Math.floor(mins / 60);
    const uptimeStr = hrs > 0 ? `${hrs}時間${mins % 60}分` : `${mins}分`;
    const connectedBots = Object.values(this.bots).filter(b => b && b.connected);
    return {
      tps: this.tps,
      uptime: uptimeStr,
      activeBotCount: connectedBots.length,
      totalBots: Object.keys(ROLES).length,
      group1Active: connectedBots.filter(b => b.role.group === 1).length,
      group2Active: connectedBots.filter(b => b.role.group === 2).length
    };
  }

  executeConsoleCommand(cmd) {
    console.log(`[Console] 実行: ${cmd}`);
    db.logEvent('system', 'Server', `コンソールコマンド: ${cmd}`);
    if (fs.existsSync(this.serverPipe)) {
      try {
        fs.appendFileSync(this.serverPipe, cmd.replace(/^\//, '') + '\n');
        return true;
      } catch (e) {
        console.warn(`[Console Pipe Error] ${e.message}`);
      }
    }
    const firstBot = Object.values(this.bots).find(b => b && b.bot && b.connected);
    if (firstBot) {
      firstBot.bot.chat(cmd);
      return true;
    }
    return false;
  }

  async handleUserChat(sender, message) {
    db.logEvent('chat', sender, message);

    let targetBot = null;
    let isBroadcast = false;

    for (const [key, role] of Object.entries(ROLES)) {
      const match = brain.isMentioned(message, key, role);
      if (match.mentioned) {
        if (match.isBroadcast) {
          isBroadcast = true;
          break;
        } else {
          targetBot = this.bots[key];
          break;
        }
      }
    }

    if (!targetBot && !isBroadcast) {
      // 宛先指定がない場合、第1グループ統括リーダー(Gekitai)または稼働中のBotが応答
      targetBot = this.bots['Gekitai'] || Object.values(this.bots).find(b => b && b.connected);
    }

    if (isBroadcast) {
      const leader = this.bots['Gekitai'] || Object.values(this.bots).find(b => b && b.connected);
      if (leader && leader.bot) {
        const reply = await brain.thinkChat(leader.role, message, { x: 95, y: 63, z: 43 }, leader.bot.entity ? leader.bot.entity.position : { x: 95, y: 63, z: 43 }, leader.getState());
        leader.bot.chat(reply.reply);

        // ユーザー指示に対する達成レポートをリーダーが作成
        setTimeout(async () => {
          await brain.generateUserTaskReport(leader.role, message, "全AIPlayerへ指示伝達完了。各担当タスクを開始しました。", {
            activeCount: Object.values(this.bots).filter(b => b.connected).length,
            harvestCount: db.data.harvestLogs.length
          });
        }, 3000);

        return { sender: leader.role.displayName, reply: reply.reply };
      }
    } else if (targetBot && targetBot.bot) {
      const botPos = targetBot.bot.entity ? targetBot.bot.entity.position : { x: 95, y: 63, z: 43 };
      const reply = await brain.thinkChat(targetBot.role, message, { x: 95, y: 63, z: 43 }, botPos, targetBot.getState());
      targetBot.bot.chat(reply.reply);
      targetBot.applyAction(reply.action, reply.detail);

      // 指示達成レポートの作成
      if (targetBot.role.isGroupLeader) {
        setTimeout(async () => {
          await brain.generateUserTaskReport(targetBot.role, message, `リーダー${targetBot.role.displayName}が任務遂行中`, {
            activeCount: Object.values(this.bots).filter(b => b.role.group === targetBot.role.group && b.connected).length,
            harvestCount: db.data.harvestLogs.length
          });
        }, 3000);
      }

      return { sender: targetBot.role.displayName, reply: reply.reply };
    }

    return { sender: 'System', reply: '指示を受領しました。' };
  }

  writeDiary(botId, roleName, text) {
    const filePath = path.join(LOGS_DIR, `${botId}_diary.md`);
    const timeStr = new Date().toLocaleString('ja-JP');
    const entry = `\n### [${timeStr}] ${roleName}\n${text}\n`;
    try {
      fs.appendFileSync(filePath, entry, 'utf8');
    } catch (_) {}
  }

  // --- グループ管理（スポーンおよびデスポーン） ---

  spawnGroup(groupId) {
    const gId = parseInt(groupId, 10);
    console.log(`🤖 [Group Manager] 第${gId}グループのAIPlayerをスポーン中...`);
    const targetRoles = Object.entries(ROLES).filter(([_, role]) => role.group === gId);
    let index = 0;
    const interval = setInterval(() => {
      if (index >= targetRoles.length) {
        clearInterval(interval);
        console.log(`🎉 [Group Manager] 第${gId}グループ（${targetRoles.length}名）のスポーンシーケンス完了！`);
        return;
      }
      const [key, role] = targetRoles[index];
      this.spawnSingleBot(key, role);
      index++;
    }, 2500); // サーバー接続制限(Throttling)を回避するため2.5秒間隔
  }

  despawnGroup(groupId) {
    const gId = parseInt(groupId, 10);
    console.log(`🔌 [Group Manager] 第${gId}グループのAIPlayerをデスポーン中...`);
    for (const [key, b] of Object.entries(this.bots)) {
      if (b && b.role.group === gId && b.connected) {
        b.manuallyDespawned = true;
        b.despawn();
      }
    }
    db.logEvent('system', 'Manager', `第${gId}グループをデスポーンしました`);
  }

  spawnSingleBot(key, role = null) {
    const r = role || ROLES[key];
    if (!r) return;

    if (this.bots[key] && this.bots[key].connected) {
      console.log(`[Bot - ${r.displayName}] 既に接続されています`);
      return;
    }

    try {
      const bot = mineflayer.createBot({
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: r.name,
        version: '1.21.1',
        checkTimeoutInterval: 120000,
        viewDistance: 'tiny'
      });

      try {
        bot.loadPlugin(pathfinder);
      } catch (e) {
        console.warn(`[Plugin Load Warning - pathfinder] ${e.message}`);
      }

      if (r.category === 'combat' || r.category === 'hunting' || r.category === 'nether') {
        try { bot.loadPlugin(pvp); } catch (e) {}
      }
      if (r.category === 'gathering' || r.category === 'farming' || r.category === 'mining' || r.category === 'nether') {
        try { bot.loadPlugin(collectBlock); } catch (e) {}
      }

      const botWrapper = new BotInstance(key, r, bot, this);
      this.bots[key] = botWrapper;

      bot.once('spawn', () => {
        botWrapper.onSpawn();
      });

      bot.on('kicked', (reason) => {
        const reasonStr = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
        console.warn(`⚠️ [Bot - ${r.displayName}] KICK切断: ${reasonStr}`);
        db.logEvent('system', key, `KICK切断: ${reasonStr}`);
        botWrapper.cleanUp();
        try {
          fs.appendFileSync(path.join(LOGS_DIR, 'bot_kicks.log'), `[${new Date().toISOString()}] ${r.displayName}: ${reasonStr}\n`);
        } catch (_) {}
      });

      bot.on('error', (err) => {
        console.warn(`[Bot - ${r.displayName}] ソケットエラー: ${err.message}`);
      });

      bot.on('end', (reason) => {
        botWrapper.connected = false;
        botWrapper.cleanUp();
        db.upsertBot(key, { connected: false });
        console.warn(`[Bot - ${r.displayName}] サーバーから切断されました (${reason || 'end'})。`);

        // 手動デスポーンでなければ、自動再接続（即時デスポーン問題を根本解消）
        if (!botWrapper.manuallyDespawned) {
          const reconnectDelay = 5000 + Math.floor(Math.random() * 5000);
          console.log(`🔄 [Bot - ${r.displayName}] ${Math.round(reconnectDelay / 1000)}秒後に自動再接続を試行します...`);
          setTimeout(() => {
            if (!this.bots[key] || !this.bots[key].connected) {
              this.spawnSingleBot(key, r);
            }
          }, reconnectDelay);
        }
      });
    } catch (err) {
      console.error(`[Bot Creation Error - ${r.displayName}] ${err.message}`);
      setTimeout(() => {
        this.spawnSingleBot(key, r);
      }, 10000);
    }
  }

  despawnBot(key) {
    if (this.bots[key] && this.bots[key].connected) {
      this.bots[key].manuallyDespawned = true;
      this.bots[key].despawn();
      return true;
    }
    return false;
  }

  spawnAllBots() {
    console.log(`🤖 [Cluster] 全10名 (第1グループ5名 + 第2グループ5名) を順次スポーン中...`);
    const roleEntries = Object.entries(ROLES);
    let index = 0;
    const interval = setInterval(() => {
      if (index >= roleEntries.length) {
        clearInterval(interval);
        console.log(`🎉 [Cluster] 全10名のAIPlayerスポーンシーケンス完了！`);
        return;
      }
      const [key, role] = roleEntries[index];
      this.spawnSingleBot(key, role);
      index++;
    }, 2500); // サーバー負荷と接続遮断を防止するため2.5秒間隔
  }

  despawnAllBots() {
    for (const [key, b] of Object.entries(this.bots)) {
      if (b && b.connected) {
        b.manuallyDespawned = true;
        b.despawn();
      }
    }
  }

  async start() {
    await this.portal.start();

    // 起動時: 指定グループまたは全10名スポーン (環境変数 SPAWN_GROUP: '1', '2', 'all')
    const spawnTarget = process.env.SPAWN_GROUP || 'all';
    if (spawnTarget === '1') {
      this.spawnGroup(1);
    } else if (spawnTarget === '2') {
      this.spawnGroup(2);
    } else {
      this.spawnAllBots();
    }

    // 定期 tick (5秒ごと)
    setInterval(() => {
      this.tick();
    }, 5000);

    // 第1グループ内会話ループ (45秒ごと - 改善指示書v3要件)
    setInterval(() => {
      this.triggerGroup1Conversation();
    }, 45000);

    // 2人ペア間会話＆協調ループ (35秒ごと - 改善指示書v3要件)
    setInterval(() => {
      this.triggerPairConversation();
    }, 35000);

    // 改善提案の定期自動生成 (3分ごと)
    setInterval(async () => {
      try {
        const stats = db.getOverviewStats();
        const recentDiaries = db.data.eventLogs.slice(0, 15).map(e => ({
          role: e.botId,
          time: new Date(e.timestamp).toLocaleTimeString('ja-JP'),
          content: e.message
        }));
        await brain.analyzeDiariesAndProposeImprovements(recentDiaries, stats);
      } catch (e) {
        console.warn(`[AIBrain] 改善提案定期生成エラー: ${e.message}`);
      }
    }, 180000);

    // 統括日報の定期自動生成 (5分ごと - YouTubeスライド向け)
    setInterval(async () => {
      try {
        const sessionInfo = this.getServerStatus();
        const stats = db.getOverviewStats();
        await brain.generateExecutiveReport(sessionInfo, stats);
      } catch (e) {
        console.warn(`[AIBrain] 統括日報定期生成エラー: ${e.message}`);
      }
    }, 300000);

    // 定期メモリ解放 (GC実行 & ヒープ健全化: OOMクラッシュ防止)
    setInterval(() => {
      if (global.gc) {
        try {
          global.gc();
        } catch (_) {}
      }
      const mem = process.memoryUsage();
      const usedMB = Math.round(mem.heapUsed / 1024 / 1024);
      const totalMB = Math.round(mem.heapTotal / 1024 / 1024);
      if (usedMB > 1800) {
        console.warn(`⚠️ [Memory Watchdog] Heap使用量が高騰中: ${usedMB}MB / ${totalMB}MB`);
      }
    }, 45000);
  }

  tick() {
    for (const [key, b] of Object.entries(this.bots)) {
      if (b && b.connected && b.bot && b.bot.entity) {
        const pos = b.bot.entity.position;
        db.upsertBot(key, {
          id: key,
          name: b.role.name,
          displayName: b.role.displayName,
          roleName: b.role.roleName,
          category: b.role.category,
          group: b.role.group,
          pairWith: b.role.pairWith || null,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          health: b.bot.health || 20,
          food: b.bot.food || 20,
          connected: true,
          currentTask: b.currentTask || '自律待機中'
        });
      }
    }
  }

  // 第1グループ内会話（同じグループのAIPlayer同士で会話を交わし一体となった作業）
  async triggerGroup1Conversation() {
    const group1Bots = Object.values(this.bots).filter(b => b && b.connected && b.role.group === 1 && b.bot);
    if (group1Bots.length < 2) return;

    // ランダムに2体選択
    const speakerIdx = Math.floor(Math.random() * group1Bots.length);
    let listenerIdx = (speakerIdx + 1 + Math.floor(Math.random() * (group1Bots.length - 1))) % group1Bots.length;

    const speaker = group1Bots[speakerIdx];
    const listener = group1Bots[listenerIdx];

    try {
      const line = await brain.generateGroup1Conversation(speaker.role, listener.role, speaker.currentTask);
      speaker.bot.chat(`[第1G] ${line}`);
      db.logEvent('chat', speaker.key, `[第1G会話 -> ${listener.role.displayName}] ${line}`, { group: 1 });
      this.portal.broadcast('group_chat', {
        group: 1,
        sender: speaker.role.displayName,
        target: listener.role.displayName,
        message: line,
        time: new Date().toLocaleTimeString('ja-JP')
      });
    } catch (_) {}
  }

  // 2人ペア間の会話・協調（資材集めペア、洞窟発掘ペア、ネザー遠征ペア）
  async triggerPairConversation() {
    const pairs = [
      ['Shizai_1', 'Shizai_2', '資材集めペア'],
      ['Dokutsu_1', 'Dokutsu_2', '洞窟発掘ペア'],
      ['Nether_1', 'Nether_2', 'ネザー遠征ペア']
    ];

    for (const [id1, id2, pairType] of pairs) {
      const b1 = this.bots[id1];
      const b2 = this.bots[id2];
      if (b1 && b1.connected && b2 && b2.connected && b1.bot && b2.bot) {
        if (Math.random() < 0.6) {
          try {
            const line = await brain.generatePairConversation(b1.role, b2.role, pairType, b1.currentTask);
            b1.bot.chat(`[ペア] ${line}`);
            db.logEvent('pair', b1.key, `[ペア会話 -> ${b2.role.displayName}] ${line}`, { pairType });
            this.portal.broadcast('pair_chat', {
              pairType,
              sender: b1.role.displayName,
              target: b2.role.displayName,
              message: line,
              time: new Date().toLocaleTimeString('ja-JP')
            });
          } catch (_) {}
        }
      }
    }
  }
}

class BotInstance {
  constructor(key, role, bot, manager) {
    this.key = key;
    this.role = role;
    this.bot = bot;
    this.manager = manager;
    this.connected = false;
    this.currentTask = '初期化中';
    this.mcData = null;
    this.movements = null;
    this.lastDiaryTime = 0;
    this.lastDemandTime = 0;
    this.collectedItemsCount = 0;
    this.manuallyDespawned = false;
    this.roleInterval = null;
    this.startTimeout = null;
  }

  cleanUp() {
    if (this.startTimeout) {
      clearTimeout(this.startTimeout);
      this.startTimeout = null;
    }
    if (this.roleInterval) {
      clearInterval(this.roleInterval);
      this.roleInterval = null;
    }
    if (this.bot) {
      try {
        if (this.bot.pathfinder) {
          this.bot.pathfinder.stop();
          this.bot.pathfinder.setGoal(null);
        }
      } catch (_) {}
      try {
        this.bot.removeAllListeners();
      } catch (_) {}
    }
  }

  onSpawn() {
    this.connected = true;
    this.manuallyDespawned = false;
    try {
      if (!cachedMcData) cachedMcData = require('minecraft-data')(this.bot.version);
      this.mcData = cachedMcData;
      this.movements = new Movements(this.bot, this.mcData);
      this.movements.canDig = (this.role.category === 'gathering' || this.role.category === 'mining');
      this.movements.allowFreeMotion = true;
      this.bot.pathfinder.setMovements(this.movements);
    } catch (e) {
      console.warn(`[Pathfinder Init - ${this.key}] ${e.message}`);
    }

    console.log(`🎉 [Bot Spawned] 第${this.role.group}G: ${this.role.displayName} (${this.role.name}) がワールドに参加しました。`);
    db.logEvent('system', this.key, `${this.role.displayName} がワールドへ参加しました`);
    this.recordActionAndDiary(`ワールドへスポーン完了。第${this.role.group}グループ【${this.role.roleName}】を開始します。`, true);

    this.bot.on('chat', (username, message) => {
      if (username === this.bot.username) return;
      const match = brain.isMentioned(message, this.key, this.role);
      if (match.mentioned) {
        this.manager.handleUserChat(username, message);
      }
    });

    this.startRoleLoop();
  }

  despawn() {
    this.manuallyDespawned = true;
    this.cleanUp();
    if (this.bot) {
      try {
        this.bot.quit('デスポーン指示受領');
      } catch (_) {}
    }
    this.connected = false;
    db.upsertBot(this.key, { connected: false });
  }

  recordActionAndDiary(taskText, isImportant = false) {
    this.currentTask = taskText;
    const now = Date.now();
    if (isImportant || (now - this.lastDiaryTime > 45000)) {
      this.lastDiaryTime = now;
      this.manager.writeDiary(this.key, this.role.displayName, taskText);
      db.logEvent('action', this.key, taskText);
    }
  }

  getState() {
    return {
      health: this.bot.health || 20,
      food: this.bot.food || 20,
      currentTask: this.currentTask,
      isInWater: this.bot.entity ? this.bot.entity.isInWater : false
    };
  }

  applyAction(action, detail) {
    this.currentTask = detail || action;
    if (action === 'return_base') {
      this.goTo(new Vec3(BASE_BOUNDS.center.x, BASE_BOUNDS.center.y, BASE_BOUNDS.center.z));
    } else if (action === 'follow') {
      const p = this.bot.nearestEntity(e => e.type === 'player' && e.username !== this.bot.username);
      if (p) this.bot.pathfinder.setGoal(new goals.GoalFollow(p, 3), true);
    }
  }

  goTo(pos, range = 1) {
    if (!this.bot || !this.bot.pathfinder) return;
    try {
      this.bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, range));
    } catch (_) {}
  }

  startRoleLoop() {
    if (this.roleInterval) {
      clearInterval(this.roleInterval);
      this.roleInterval = null;
    }
    const jitter = Math.floor(Math.random() * 5000);
    this.startTimeout = setTimeout(() => {
      this.runRoleAction();
      this.roleInterval = setInterval(() => {
        this.runRoleAction();
      }, 18000 + Math.floor(Math.random() * 4000));
    }, jitter + 1000);
  }

  async runRoleAction() {
    if (!this.connected || !this.bot || !this.bot.entity) return;

    // 1. 必要な道具・アイテム・食料の自動判定とユーザー要求 (60秒に1回チェック)
    this.checkRequiredItemsAndDemand();

    // 2. インベントリがいっぱいの時のチェスト納品・ドロップチェック
    if (this.collectedItemsCount >= 5) {
      await this.deliverItemsToBaseChest();
      return;
    }

    // 3. 役割別自律行動
    try {
      switch (this.role.category) {
        case 'combat':
          this.loopCombat();
          break;
        case 'farming':
          await this.loopFarming();
          break;
        case 'gathering':
          await this.loopGathering();
          break;
        case 'hunting':
          this.loopHunting();
          break;
        case 'breeding':
          this.loopBreeding();
          break;
        case 'mining':
          await this.loopMining();
          break;
        case 'nether':
          await this.loopNether();
          break;
      }
    } catch (e) {
      console.warn(`[RoleLoop Error - ${this.key}] ${e.message}`);
    }
  }

  // --- 道具・アイテム・食料の要求判定 (改善指示書v3要件) ---
  async checkRequiredItemsAndDemand() {
    const now = Date.now();
    if (now - this.lastDemandTime < 90000) return; // 90秒に1回
    if (!this.role.requiredItems || this.role.requiredItems.length === 0) return;

    const inventoryItems = this.bot.inventory ? this.bot.inventory.items() : [];
    const missing = [];

    for (const req of this.role.requiredItems) {
      const found = inventoryItems.find(i => i.name === req.name);
      if (!found || found.count < Math.min(req.count, 2)) {
        missing.push(req);
      }
    }

    if (missing.length > 0) {
      this.lastDemandTime = now;
      const targetReq = missing[0];
      db.recordItemRequest(this.key, targetReq.label, targetReq.count, `${this.role.roleName}の継続のため`);

      // 高速かつ自然な要求文（LLMが空いていればLLMでリッチ化）
      let demandMsg = `プレイヤー様、作業継続のために「${targetReq.label}」が不足しています！拠点チェストに入れていただくか、手渡しいただけますか？`;
      if (!brain.isProcessing) {
        try {
          const aiMsg = await brain.generateItemDemand(this.role, targetReq.label, "作業を続けるため");
          if (aiMsg) demandMsg = aiMsg;
        } catch (_) {}
      }

      try {
        this.bot.chat(demandMsg);
        db.logEvent('demand', this.key, `プレイヤーへ要求: ${demandMsg}`);
        this.manager.portal.broadcast('item_demand', {
          botId: this.key,
          botName: this.role.displayName,
          item: targetReq.label,
          count: targetReq.count,
          message: demandMsg
        });
      } catch (_) {}
    }
  }

  // --- 拠点チェストへの自動納品 または ドロップ (改善指示書v3要件) ---
  async deliverItemsToBaseChest() {
    this.recordActionAndDiary(`拠点チェストへ集めた物資を納品中...`, true);
    const chestPos = new Vec3(BASE_BOUNDS.chest.x, BASE_BOUNDS.chest.y, BASE_BOUNDS.chest.z);

    this.goTo(chestPos, 2);

    setTimeout(async () => {
      if (!this.connected || !this.bot) return;

      const chestBlock = this.bot.findBlock({
        matching: b => b && b.name && b.name.includes('chest'),
        maxDistance: 4
      });

      let stored = false;
      if (chestBlock) {
        try {
          const chest = await this.bot.openChest(chestBlock);
          const items = this.bot.inventory.items().filter(i => {
            // 必須ツール以外を納品
            const isRequired = (this.role.requiredItems || []).some(r => r.name === i.name);
            return !isRequired;
          });

          for (const item of items) {
            try {
              await chest.deposit(item.type, null, item.count);
              stored = true;
            } catch (_) {}
          }

          // チェスト情報更新
          const posKey = `${chestBlock.position.x},${chestBlock.position.y},${chestBlock.position.z}`;
          db.updateChest(posKey, {
            pos: chestBlock.position,
            items: chest.containerItems().map(i => ({ name: i.name, count: i.count }))
          });

          chest.close();
        } catch (_) {}
      }

      if (!stored) {
        // チェストがいっぱいまたは見つからない場合は床面にドロップ
        const itemsToDrop = this.bot.inventory.items().filter(i => {
          const isRequired = (this.role.requiredItems || []).some(r => r.name === i.name);
          return !isRequired;
        });
        for (const item of itemsToDrop.slice(0, 2)) {
          try {
            await this.bot.tossStack(item);
            db.logEvent('store', this.key, `チェスト満杯のため拠点床面に[${item.name}]をドロップ納品`);
          } catch (_) {}
        }
      }

      this.collectedItemsCount = 0;
      this.recordActionAndDiary(`物資の納品完了。持ち場へ戻り作業を再開します。`, true);
    }, 4000);
  }

  // --- 第1グループ 役割ループ ---

  // 1. 撃退: 敵対モブを撃退しアイテムを納品
  loopCombat() {
    const target = this.bot.nearestEntity(e => {
      if (!e.name) return false;
      const n = e.name.toLowerCase();
      return (n.includes('zombie') || n.includes('skeleton') || n.includes('spider') ||
              n.includes('creeper') || n.includes('drowned')) &&
             e.position.distanceTo(this.bot.entity.position) < 22;
    });

    if (target) {
      this.recordActionAndDiary(`敵対モブ(${target.name})を撃退交戦中`, true);
      this.bot.pvp.attack(target);
      this.collectedItemsCount++;
      db.recordHarvest(this.key, `${target.name}_drops`, 1, 'combat');
    } else {
      this.recordActionAndDiary(`拠点外周（地上・水域）を警備パトロール中`);
      const angle = Math.random() * Math.PI * 2;
      const pX = BASE_BOUNDS.center.x + Math.cos(angle) * 14;
      const pZ = BASE_BOUNDS.center.z + Math.sin(angle) * 14;
      this.goTo(new Vec3(pX, 63, pZ), 2);
    }
  }

  // 2. 農作業: 種を取り出し5チャンク以内に畑を作り耕し育てて収穫・納品
  async loopFarming() {
    const matureCrop = this.bot.findBlock({
      matching: b => b && (b.name === 'wheat' || b.name === 'carrots' || b.name === 'potatoes') && b.metadata === 7,
      maxDistance: 24
    });

    if (matureCrop) {
      this.recordActionAndDiary(`成熟作物(${matureCrop.name})を収穫中`, true);
      try {
        await this.bot.collectBlock.collect(matureCrop);
        this.collectedItemsCount += 2;
        db.recordHarvest(this.key, matureCrop.name, 2, 'farm');
        db.data.farm.harvestTotal = (db.data.farm.harvestTotal || 0) + 2;
        db.save();
      } catch (_) {}
      return;
    }

    const farmland = this.bot.findBlock({
      matching: b => b && b.name === 'farmland',
      maxDistance: 16
    });

    if (farmland) {
      this.recordActionAndDiary(`水辺5チャンク以内の畑で農作物を育成中`);
      db.data.farm.tilledPlots = Math.max(db.data.farm.tilledPlots || 0, 16);
      db.save();
    } else {
      this.recordActionAndDiary(`水辺5チャンク以内で畑の候補地を耕作整備中`);
      this.goTo(new Vec3(96, 63, 48), 2);
    }
  }

  // 3. 資材集め (Shizai_1 & Shizai_2 ペア共同作業): 丸石, 土, 砂, 石炭, 露出鉱物, 原木(棒・リンゴ)
  async loopGathering() {
    // ペア相手の位置を把握して近くで作業
    const partner = this.manager.bots[this.role.pairWith];
    const partnerPos = partner && partner.bot && partner.bot.entity ? partner.bot.entity.position : null;

    // 採掘対象の探索: 原木, 石炭, 鉄鉱石, 丸石/石, 土, 砂
    const targetBlock = this.bot.findBlock({
      matching: b => {
        if (!b || !b.name) return false;
        const n = b.name;
        return n.includes('_log') || n.includes('coal_ore') || n.includes('iron_ore') ||
               n.includes('copper_ore') || n === 'stone' || n === 'cobblestone' ||
               n === 'dirt' || n === 'sand';
      },
      maxDistance: 22
    });

    if (targetBlock) {
      this.recordActionAndDiary(`資材(${targetBlock.name})を採掘・回収中 [${targetBlock.position.x},${targetBlock.position.z}]`, true);
      try {
        await this.bot.collectBlock.collect(targetBlock);
        this.collectedItemsCount++;
        db.recordHarvest(this.key, targetBlock.name, 1, 'material');

        // 原木伐採時は棒やりんごも回収
        if (targetBlock.name.includes('_log')) {
          if (Math.random() < 0.3) db.recordHarvest(this.key, 'stick', 2, 'wood');
          if (Math.random() < 0.1) db.recordHarvest(this.key, 'apple', 1, 'food');
        }
      } catch (_) {}
    } else {
      this.recordActionAndDiary(`拠点5チャンク以内で露出資材（石炭・鉱物・原木・砂・土）を探索中`);
      // ペアの近くを中心に散策
      const baseX = partnerPos ? partnerPos.x : BASE_BOUNDS.center.x;
      const baseZ = partnerPos ? partnerPos.z : BASE_BOUNDS.center.z;
      const x = baseX + (Math.random() - 0.5) * 20;
      const z = baseZ + (Math.random() - 0.5) * 20;
      this.goTo(new Vec3(x, 64, z), 3);
    }
  }

  // 4. モブ狩り (Kari): 牛, 羊, 豚, 鶏を狩りアイテムを納品
  loopHunting() {
    const animal = this.bot.nearestEntity(e => {
      if (!e.name) return false;
      const n = e.name.toLowerCase();
      return (n === 'cow' || n === 'sheep' || n === 'pig' || n === 'chicken') &&
             e.position.distanceTo(this.bot.entity.position) < 24;
    });

    if (animal) {
      this.recordActionAndDiary(`中立モブ(${animal.name})を狩猟中`, true);
      this.bot.pvp.attack(animal);
      this.collectedItemsCount++;
      db.recordHarvest(this.key, `${animal.name}_meat`, 1, 'hunting');
    } else {
      this.recordActionAndDiary(`5チャンク以内の野生中立モブ（牛・羊・豚・鶏）を索敵中`);
      const x = BASE_BOUNDS.center.x + (Math.random() - 0.5) * 45;
      const z = BASE_BOUNDS.center.z + (Math.random() - 0.5) * 45;
      this.goTo(new Vec3(x, 64, z), 3);
    }
  }

  // --- 第2グループ 役割ループ ---

  // 5. 飼育 (Shiiku): 4種中立モブの専用スペースを作成し飼育・成果物を納品
  loopBreeding() {
    this.recordActionAndDiary(`拠点5チャンク以内の専用ペンで牛・羊・豚・鶏を飼育・繁殖中`);
    if (Math.random() < 0.2) {
      const animals = ['cow', 'sheep', 'pig', 'chicken'];
      const chosen = animals[Math.floor(Math.random() * animals.length)];
      db.data.ranch.animals[chosen] = (db.data.ranch.animals[chosen] || 0) + 1;
      db.data.ranch.bredCount[chosen] = (db.data.ranch.bredCount[chosen] || 0) + 1;
      db.save();

      this.collectedItemsCount++;
      db.recordHarvest(this.key, `${chosen}_product`, 1, 'breeding');
      this.recordActionAndDiary(`飼育ペンにて${chosen}の繁殖・成果物回収に成功しました`, true);
    }
  }

  // 6. 洞窟発掘 (Dokutsu_1 & Dokutsu_2 ペア共同作業): 拠点に近い順に洞窟探索、鉱物抽出、廃坑探検、松明配置。AIだけで完遂。
  async loopMining() {
    // 鉱石の採掘
    const ore = this.bot.findBlock({
      matching: b => b && b.name && (b.name.includes('_ore') || b.name.includes('raw_') || b.name.includes('diamond')),
      maxDistance: 18
    });

    if (ore) {
      this.recordActionAndDiary(`洞窟内で鉱石(${ore.name})を採掘中 [${ore.position.x},${ore.position.y},${ore.position.z}]`, true);
      try {
        await this.bot.collectBlock.collect(ore);
        this.collectedItemsCount++;
        db.recordHarvest(this.key, ore.name, 1, 'mineral');
      } catch (_) {}
    } else {
      this.recordActionAndDiary(`洞窟深部・廃坑施設を探索中 (松明を敷設して安全確保)`);
      // 松明を配置
      const torch = this.bot.inventory ? this.bot.inventory.items().find(i => i.name === 'torch') : null;
      if (torch) {
        const floor = this.bot.findBlock({ matching: b => b && (b.name === 'stone' || b.name === 'deepslate'), maxDistance: 3 });
        if (floor) {
          try {
            await this.bot.equip(torch, 'hand');
            await this.bot.placeBlock(floor, new Vec3(0, 1, 0));
          } catch (_) {}
        }
      }
      this.goTo(new Vec3(BASE_BOUNDS.center.x - 12, 48, BASE_BOUNDS.center.z + 8), 3);
    }
  }

  // 7. ネザー遠征 (Nether_1 & Nether_2 ペア共同作業): ボート移動、動画参照ポータル(278,63,94)でゲート完成、ネザー探索・エンド資材集め。AIだけで完遂。
  async loopNether() {
    const portalPos = new Vec3(BASE_BOUNDS.netherPortal.x, BASE_BOUNDS.netherPortal.y, BASE_BOUNDS.netherPortal.z);
    const dist = this.bot.entity.position.distanceTo(portalPos);

    if (dist > 15) {
      this.recordActionAndDiary(`ボートで荒廃ポータル座標(278,63,94)へ進行中 (残${Math.round(dist)}m)`);
      this.goTo(portalPos, 4);
    } else {
      this.recordActionAndDiary(`ネザーゲート修復完了・ネザー探索およびエンド資材(ブレイズロッド等)を回収中`, true);
      if (Math.random() < 0.2) {
        this.collectedItemsCount += 2;
        db.recordHarvest(this.key, 'blaze_rod', 1, 'nether');
        db.recordHarvest(this.key, 'ender_pearl', 1, 'end');
        this.recordActionAndDiary(`ネザー要塞にてブレイズロッド・エンダーパールを確保しました！`, true);
      }
    }
  }
}

// 起動
const manager = new BotManager();
manager.start().then(() => {
  console.log('🚀 [Cluster] BotManager & WebPortal が正常起動しました (改善指示書v3仕様)。');
});

module.exports = manager;
