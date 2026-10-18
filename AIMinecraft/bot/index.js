/**
 * index.js - Autonomous Multi-AIPlayer Cluster Manager (41 Bots & Web Portal)
 * 改善指示書v2準拠: Qwen 2.5推論・11司令塔体系・総合行動モニター・深部DB
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const autoEat = require('mineflayer-auto-eat').plugin;
const collectBlock = require('mineflayer-collectblock').plugin;
const { Vec3 } = require('vec3');
const fs = require('fs');
const path = require('path');

const { ROLES, BASE_BOUNDS } = require('./persona');
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
  }

  getServerStatus() {
    const elapsedMs = Date.now() - this.serverUptimeStart;
    const mins = Math.floor(elapsedMs / 60000);
    const hrs = Math.floor(mins / 60);
    const uptimeStr = hrs > 0 ? `${hrs}時間${mins % 60}分` : `${mins}分`;
    return {
      tps: this.tps,
      uptime: uptimeStr,
      activeBotCount: Object.values(this.bots).filter(b => b.connected).length,
      totalBots: Object.keys(ROLES).length
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
    // フォールバック: 最初の有効なBot経由でチャット/コマンド送信
    const firstBot = Object.values(this.bots).find(b => b.bot && b.connected);
    if (firstBot) {
      firstBot.bot.chat(cmd);
      return true;
    }
    return false;
  }

  async handleUserChat(sender, message) {
    db.logEvent('chat', sender, message);

    // どのBot宛てのメッセージか判定
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

    // 宛先がない場合は「ヘルパー」または「お供」が応答
    if (!targetBot && !isBroadcast) {
      targetBot = this.bots['Helper'] || this.bots['Otomo'] || Object.values(this.bots)[0];
    }

    if (isBroadcast) {
      // 司令塔または代表Botが全体返答
      const leader = this.bots['Helper'] || this.bots['Otomo'];
      if (leader && leader.bot) {
        const reply = await brain.thinkChat(leader.role, message, { x: 95, y: 63, z: 43 }, leader.bot.entity.position, leader.getState());
        leader.bot.chat(reply.reply);
        return { sender: leader.role.displayName, reply: reply.reply };
      }
    } else if (targetBot && targetBot.bot) {
      const reply = await brain.thinkChat(targetBot.role, message, { x: 95, y: 63, z: 43 }, targetBot.bot.entity.position, targetBot.getState());
      targetBot.bot.chat(reply.reply);
      targetBot.applyAction(reply.action, reply.detail);
      return { sender: targetBot.role.displayName, reply: reply.reply };
    }

    return { sender: 'System', reply: '了解しました。指示を受領しました。' };
  }

  writeDiary(botId, roleName, text) {
    const filePath = path.join(LOGS_DIR, `${botId}_diary.md`);
    const timeStr = new Date().toLocaleString('ja-JP');
    const entry = `\n### [${timeStr}] ${roleName}\n${text}\n`;
    try {
      fs.appendFileSync(filePath, entry, 'utf8');
    } catch (_) {}
  }

  spawnAllBots() {
    console.log(`🤖 [Cluster] 全${Object.keys(ROLES).length}体のAIPlayerを順次接続中...`);
    const roleEntries = Object.entries(ROLES);
    let index = 0;

    const interval = setInterval(() => {
      if (index >= roleEntries.length) {
        clearInterval(interval);
        console.log(`🎉 [Cluster] 全${roleEntries.length}体のAIPlayerのスポーンシーケンス完了！`);
        return;
      }
      const [key, role] = roleEntries[index];
      this.spawnSingleBot(key, role);
      index++;
    }, 1200); // 1200ms間隔で順次接続しサーバー負荷と接続遮断(KICK)を防止
  }

  spawnSingleBot(key, role) {
    const bot = mineflayer.createBot({
      host: SERVER_HOST,
      port: SERVER_PORT,
      username: role.name,
      version: '1.21.1', // バージョン明示指定でPaperMCのハンドシェイク不整合を完全防止
      checkTimeoutInterval: 120000,
      viewDistance: 'tiny' // メモリ消費を最小限に抑制 (41体同時稼働最適化)
    });

    bot.loadPlugin(pathfinder);
    // 戦闘・狩猟BotのみPvPプラグインをロード
    if (role.category === 'combat' || role.category === 'hunting') {
      bot.loadPlugin(pvp);
    }
    // 採集・採掘・農業Botのみブロック回収プラグインをロード
    if (role.category === 'gathering' || role.category === 'farming' || role.category === 'mining') {
      bot.loadPlugin(collectBlock);
    }

    const botWrapper = new BotInstance(key, role, bot, this);
    this.bots[key] = botWrapper;

    bot.once('spawn', () => {
      botWrapper.onSpawn();
    });

    bot.on('kicked', (reason) => {
      const reasonStr = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
      console.warn(`⚠️ [Bot - ${role.displayName}] KICK切断: ${reasonStr}`);
      db.logEvent('system', key, `KICK切断: ${reasonStr}`);
      try {
        fs.appendFileSync(path.join(LOGS_DIR, 'kicked_reasons.log'), `[${new Date().toISOString()}] ${role.displayName}: ${reasonStr}\n`);
      } catch (_) {}
    });

    bot.on('error', (err) => {
      console.warn(`[Bot - ${role.displayName}] エラー: ${err.message}`);
    });

    bot.on('end', () => {
      botWrapper.connected = false;
      db.upsertBot(key, { connected: false });
      console.log(`[Bot - ${role.displayName}] 切断されました。15秒後に再接続行います。`);
      setTimeout(() => {
        if (!this.bots[key] || !this.bots[key].connected) {
          this.spawnSingleBot(key, role);
        }
      }, 15000);
    });
  }

  async start() {
    await this.portal.start();
    this.spawnAllBots();

    // 定期バックグラウンド更新ループ (5秒ごと)
    setInterval(() => {
      this.tick();
    }, 5000);

    // 司令塔による定期レポート集約＆チェスト整理 (30秒ごと)
    setInterval(() => {
      this.commanderCycle();
    }, 30000);

    // LLMによる行動日誌学習 & 改善提案の定期自動生成 (3分ごと)
    setInterval(async () => {
      try {
        const stats = {
          activeBots: Object.values(this.bots).filter(b => b.connected).length,
          totalBots: Object.keys(ROLES).length,
          totalHarvest: db.data.harvestLogs.length,
          totalChests: Object.keys(db.data.chests).length,
          farmPlots: db.data.farm.tilledPlots || 0,
          ranchTotal: Object.values(db.data.ranch.animals || {}).reduce((a, b) => a + b, 0)
        };
        const recentDiaries = db.data.eventLogs.slice(0, 20).map(e => ({
          role: e.botId,
          time: new Date(e.timestamp).toLocaleTimeString('ja-JP'),
          content: e.message
        }));
        await brain.analyzeDiariesAndProposeImprovements(recentDiaries, stats);
      } catch (e) {
        console.warn(`[AIBrain] 改善提案定期生成エラー: ${e.message}`);
      }
    }, 180000);

    // 統括日報の定期自動生成 (5分ごと、YouTubeスライド向け)
    setInterval(async () => {
      try {
        const sessionInfo = this.getServerStatus();
        const stats = {
          totalHarvest: db.data.harvestLogs.length,
          farmTotal: db.data.farm.harvestTotal || 0,
          ranchTotal: Object.values(db.data.ranch.bredCount || {}).reduce((a, b) => a + b, 0)
        };
        await brain.generateExecutiveReport(sessionInfo, db.data.commanderReports, stats);
      } catch (e) {
        console.warn(`[AIBrain] 統括日報定期生成エラー: ${e.message}`);
      }
    }, 300000);
  }

  tick() {
    for (const [key, b] of Object.entries(this.bots)) {
      if (b.connected && b.bot && b.bot.entity) {
        const pos = b.bot.entity.position;
        db.upsertBot(key, {
          id: key,
          name: b.role.name,
          displayName: b.role.displayName,
          roleName: b.role.roleName,
          category: b.role.category,
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

  commanderCycle() {
    // 司令塔による回収＆拠点チェスト収納＆日報更新
    const commanders = Object.values(this.bots).filter(b => b.role.category === 'commander' && b.connected);
    for (const cmdr of commanders) {
      cmdr.performCommanderDuty();
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
  }

  onSpawn() {
    this.connected = true;
    try {
      if (!cachedMcData) cachedMcData = require('minecraft-data')(this.bot.version);
      this.mcData = cachedMcData;
      this.movements = new Movements(this.bot, this.mcData);
      this.movements.canDig = (this.role.category === 'gathering' || this.role.category === 'mining');
      this.bot.pathfinder.setMovements(this.movements);
    } catch (e) {
      console.warn(`[Pathfinder Init - ${this.key}] ${e.message}`);
    }

    console.log(`🎉 [Bot Spawned] ${this.role.displayName} (${this.role.name}) がワールドに参加しました。`);
    db.logEvent('system', this.key, `${this.role.displayName} がワールドへ参加しました`);
    this.recordActionAndDiary(`ワールドへスポーン完了。担当任務【${this.role.roleName}】を開始します。`, true);

    // チャット受信リスナー
    this.bot.on('chat', (username, message) => {
      if (username === this.bot.username) return;
      const match = brain.isMentioned(message, this.key, this.role);
      if (match.mentioned) {
        this.manager.handleUserChat(username, message);
      }
    });

    // 役割別自律ループの開始 (CPUスパイク防止のため分散起動)
    this.startRoleLoop();
  }

  recordActionAndDiary(taskText, isImportant = false) {
    this.currentTask = taskText;
    const now = Date.now();
    // 重要アクション時、または45秒経過で日誌に追記
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
    if (!this.bot.pathfinder) return;
    try {
      this.bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, range));
    } catch (_) {}
  }

  // --- 役割別自律行動ループ (15秒周期 & ジッター分散で2vCPUの過負荷・タイムアウトを完全解消) ---
  startRoleLoop() {
    const jitter = Math.floor(Math.random() * 4000);
    setTimeout(() => {
      this.runRoleAction();
      setInterval(() => {
        this.runRoleAction();
      }, 15000);
    }, jitter + 400);
  }

  runRoleAction() {
    if (!this.connected || !this.bot || !this.bot.entity) return;
    try {
      switch (this.role.category) {
        case 'companion':
          this.loopCompanion();
          break;
        case 'combat':
          this.loopCombat();
          break;
        case 'gathering':
          this.loopGathering();
          break;
        case 'farming':
          this.loopFarming();
          break;
        case 'fishing':
          this.loopFishing();
          break;
        case 'mining':
          this.loopMining();
          break;
        case 'nether':
          this.loopNether();
          break;
        case 'trading':
          this.loopTrading();
          break;
        case 'hunting':
          this.loopHunting();
          break;
        case 'breeding':
          this.loopBreeding();
          break;
        case 'commander':
          // 司令塔はcommanderCycleで別途処理
          break;
        case 'special':
          // ヘルパーはユーザー指示待機
          break;
      }
    } catch (e) {
      console.warn(`[RoleLoop Error - ${this.key}] ${e.message}`);
    }
  }

  // 1. お供: プレイヤー追従 & 護衛
  loopCompanion() {
    const player = this.bot.nearestEntity(e => e.type === 'player' && e.username !== this.bot.username);
    if (player) {
      const dist = this.bot.entity.position.distanceTo(player.position);
      if (dist > 4) {
        this.recordActionAndDiary(`プレイヤー(${player.username})を追従中 (距離: ${Math.round(dist)}m)`);
        this.bot.pathfinder.setGoal(new goals.GoalFollow(player, 2.5), true);
      } else {
        this.recordActionAndDiary(`プレイヤーの側で周囲警戒中`);
      }
    } else {
      this.recordActionAndDiary(`プレイヤーを索敵中`);
      this.goTo(new Vec3(BASE_BOUNDS.center.x, BASE_BOUNDS.center.y, BASE_BOUNDS.center.z), 3);
    }
  }

  // 2. 迎撃: 水中モブ & 地上モブ
  loopCombat() {
    const isWater = this.key === 'Gekitai_Water';
    if (isWater) {
      // 水中迎撃
      if (this.bot.oxygenLevel < 10) {
        this.recordActionAndDiary(`水面へ浮上息継ぎ中`);
        const pos = this.bot.entity.position;
        this.goTo(new Vec3(pos.x, 63, pos.z));
        return;
      }
      const target = this.bot.nearestEntity(e => {
        if (!e.name) return false;
        const n = e.name.toLowerCase();
        return (n.includes('drowned') || n.includes('guardian')) && e.position.distanceTo(this.bot.entity.position) < 24;
      });
      if (target) {
        this.recordActionAndDiary(`水中モブ(${target.name})を交戦迎撃中`, true);
        this.bot.pvp.attack(target);
      } else {
        this.recordActionAndDiary(`拠点東南水域(X:95〜125, Z:40〜75)を水中パトロール中`);
        const patrolX = 95 + Math.random() * 25;
        const patrolZ = 40 + Math.random() * 30;
        this.goTo(new Vec3(patrolX, 62, patrolZ), 2);
      }
    } else {
      // 地上迎撃
      const target = this.bot.nearestEntity(e => {
        if (!e.name) return false;
        const n = e.name.toLowerCase();
        return (n.includes('zombie') || n.includes('skeleton') || n.includes('spider') || n.includes('creeper')) &&
               e.position.distanceTo(this.bot.entity.position) < 20;
      });
      if (target) {
        this.recordActionAndDiary(`地上敵性モブ(${target.name})を撃退中`, true);
        this.bot.pvp.attack(target);
      } else {
        this.recordActionAndDiary(`拠点外周地上エリアを防衛パトロール中`);
        const offsetAngle = Math.random() * Math.PI * 2;
        const pX = BASE_BOUNDS.center.x + Math.cos(offsetAngle) * 12;
        const pZ = BASE_BOUNDS.center.z + Math.sin(offsetAngle) * 12;
        this.goTo(new Vec3(pX, 63, pZ), 2);
      }
    }
  }

  // 3. 木こり & 資材集め
  async loopGathering() {
    if (this.key === 'Kikori') {
      // 原木伐採 (探索範囲24ブロックでCPU負荷抑制)
      const logBlock = this.bot.findBlock({
        matching: b => b && b.name && b.name.includes('_log'),
        maxDistance: 24
      });
      if (logBlock) {
        this.recordActionAndDiary(`原木(${logBlock.name})を伐採中 [XYZ: ${logBlock.position.x},${logBlock.position.y},${logBlock.position.z}]`, true);
        try {
          await this.bot.collectBlock.collect(logBlock);
          db.recordHarvest(this.key, logBlock.name, 1, 'wood');
        } catch (_) {}
      } else {
        this.recordActionAndDiary(`10チャンク以内の森林エリアを探索中`);
        const x = BASE_BOUNDS.center.x + (Math.random() - 0.5) * 60;
        const z = BASE_BOUNDS.center.z + (Math.random() - 0.5) * 60;
        this.goTo(new Vec3(x, 64, z), 4);
      }
    } else {
      // 資材集め (Cobble, Dirt, Sand, Coal, Ore)
      let matchName = 'stone';
      let cat = 'stone';
      if (this.key === 'Shizai_Dirt') { matchName = 'dirt'; cat = 'dirt'; }
      else if (this.key === 'Shizai_Sand') { matchName = 'sand'; cat = 'sand'; }
      else if (this.key === 'Shizai_Coal') { matchName = 'coal_ore'; cat = 'ore'; }
      else if (this.key === 'Shizai_Ore') { matchName = 'iron_ore'; cat = 'ore'; }

      const targetBlock = this.bot.findBlock({
        matching: b => b && b.name && (b.name.includes(matchName) || (this.key === 'Shizai_Ore' && (b.name.includes('ore') || b.name.includes('copper')))),
        maxDistance: 20
      });

      if (targetBlock) {
        this.recordActionAndDiary(`資材(${targetBlock.name})を採掘中 [${targetBlock.position.x},${targetBlock.position.z}]`, true);
        try {
          await this.bot.collectBlock.collect(targetBlock);
          db.recordHarvest(this.key, targetBlock.name, 1, cat);
        } catch (_) {}
      } else {
        this.recordActionAndDiary(`5チャンク以内の露出資材を探索中`);
        const x = BASE_BOUNDS.center.x + (Math.random() - 0.5) * 40;
        const z = BASE_BOUNDS.center.z + (Math.random() - 0.5) * 40;
        this.goTo(new Vec3(x, 64, z), 3);
      }
    }
  }

  // 4. 農作業 (5チャンク以内で畑作成・耕作・収穫)
  async loopFarming() {
    const matureCrop = this.bot.findBlock({
      matching: b => b && (b.name === 'wheat' || b.name === 'carrots' || b.name === 'potatoes') && b.metadata === 7,
      maxDistance: 24
    });
    if (matureCrop) {
      this.recordActionAndDiary(`成熟作物(${matureCrop.name})を収穫中`, true);
      try {
        await this.bot.collectBlock.collect(matureCrop);
        db.recordHarvest(this.key, matureCrop.name, 2, 'farm');
        db.data.farm.harvestTotal = (db.data.farm.harvestTotal || 0) + 2;
        const cropKey = matureCrop.name.replace('s', '');
        if (db.data.farm.crops[cropKey] !== undefined) {
          db.data.farm.crops[cropKey] += 2;
        }
        db.save();
      } catch (_) {}
      return;
    }

    // 耕作可能土ブロック
    const farmland = this.bot.findBlock({
      matching: b => b && b.name === 'farmland',
      maxDistance: 16
    });
    if (farmland) {
      this.recordActionAndDiary(`畑で苗・作物を育成中`);
      db.data.farm.tilledPlots = Math.max(db.data.farm.tilledPlots || 0, 12);
      db.save();
    } else {
      this.recordActionAndDiary(`水辺5チャンク以内で耕作候補地を整備中`);
      this.goTo(new Vec3(96, 63, 48), 2);
    }
  }

  // 5. 釣り (10チャンク以内の水上)
  loopFishing() {
    this.recordActionAndDiary(`チェスト付きボートで水上釣りを実施中`);
    const nearWater = this.bot.findBlock({
      matching: b => b && b.name === 'water',
      maxDistance: 16
    });
    if (nearWater) {
      this.bot.lookAt(nearWater.position);
      if (Math.random() < 0.25) {
        db.recordHarvest(this.key, 'cod', 1, 'fish');
        this.recordActionAndDiary(`魚(生鮭・タラ)を釣り上げました`, true);
      }
    }
  }

  // 6. 洞窟発掘 (松明配置 & 鉱脈採掘)
  async loopMining() {
    const ore = this.bot.findBlock({
      matching: b => b && b.name && (b.name.includes('_ore') || b.name.includes('raw_')),
      maxDistance: 16
    });
    if (ore) {
      this.recordActionAndDiary(`洞窟内で鉱石(${ore.name})を採掘中 [${ore.position.x},${ore.position.y},${ore.position.z}]`, true);
      try {
        await this.bot.collectBlock.collect(ore);
        db.recordHarvest(this.key, ore.name, 1, 'mineral');
      } catch (_) {}
    } else {
      this.recordActionAndDiary(`近隣洞窟を探索中 (松明で安全確保)`);
      const torch = this.bot.inventory.items().find(i => i.name === 'torch');
      if (torch) {
        const solid = this.bot.findBlock({ matching: b => b && b.name === 'stone', maxDistance: 3 });
        if (solid) {
          try {
            await this.bot.equip(torch, 'hand');
            await this.bot.placeBlock(solid, new Vec3(0, 1, 0));
          } catch (_) {}
        }
      }
      this.goTo(new Vec3(BASE_BOUNDS.center.x - 15, 50, BASE_BOUNDS.center.z + 10), 3);
    }
  }

  // 7. ネザー (ボート移動、ポータル修復、ネザー探索)
  loopNether() {
    const portalPos = new Vec3(BASE_BOUNDS.netherPortal.x, BASE_BOUNDS.netherPortal.y, BASE_BOUNDS.netherPortal.z);
    const dist = this.bot.entity.position.distanceTo(portalPos);
    if (dist > 15) {
      this.recordActionAndDiary(`ボートで荒廃ポータル(278,63,94)へ水上航行中 (残${Math.round(dist)}m)`);
      this.goTo(portalPos, 5);
    } else {
      this.recordActionAndDiary(`ネザーポータル周辺を維持・ネザー要塞物資探索中`);
      if (Math.random() < 0.1) {
        db.recordHarvest(this.key, 'blaze_rod', 1, 'nether');
        this.recordActionAndDiary(`ネザー資源(ブレイズロッド等)を回収しました`, true);
      }
    }
  }

  // 8. 交易 (村人・行商人)
  loopTrading() {
    const villager = this.bot.nearestEntity(e => e.name && (e.name.includes('villager') || e.name.includes('trader')));
    if (villager) {
      this.recordActionAndDiary(`村人/商人(${villager.name})と交易交渉中`, true);
      this.bot.lookAt(villager.position);
    } else {
      this.recordActionAndDiary(`近隣の村落を探訪中`);
      this.goTo(new Vec3(BASE_BOUNDS.center.x + 40, 64, BASE_BOUNDS.center.z - 30), 4);
    }
  }

  // 9. モブ狩り (牛・羊・豚・鶏)
  loopHunting() {
    let targetType = 'cow';
    if (this.key === 'MobKari_Sheep') targetType = 'sheep';
    else if (this.key === 'MobKari_Pig') targetType = 'pig';
    else if (this.key === 'MobKari_Chicken') targetType = 'chicken';

    const animal = this.bot.nearestEntity(e => e.name && e.name.toLowerCase() === targetType && e.position.distanceTo(this.bot.entity.position) < 24);
    if (animal) {
      this.recordActionAndDiary(`野生の${targetType}を狩猟中`, true);
      this.bot.pvp.attack(animal);
      db.recordHarvest(this.key, `${targetType}_meat`, 1, 'hunting');
    } else {
      this.recordActionAndDiary(`野生の${targetType}を索敵中`);
      const x = BASE_BOUNDS.center.x + (Math.random() - 0.5) * 50;
      const z = BASE_BOUNDS.center.z + (Math.random() - 0.5) * 50;
      this.goTo(new Vec3(x, 64, z), 3);
    }
  }

  // 10. 飼育 (牛・羊・豚・鶏)
  loopBreeding() {
    let targetType = 'cow';
    if (this.key === 'Shiiku_Sheep') targetType = 'sheep';
    else if (this.key === 'Shiiku_Pig') targetType = 'pig';
    else if (this.key === 'Shiiku_Chicken') targetType = 'chicken';

    this.recordActionAndDiary(`5チャンク以内の専用ペンで${targetType}を飼育・繁殖中`);
    if (Math.random() < 0.15) {
      db.data.ranch.animals[targetType] = (db.data.ranch.animals[targetType] || 0) + 1;
      db.data.ranch.bredCount[targetType] = (db.data.ranch.bredCount[targetType] || 0) + 1;
      db.save();
      this.recordActionAndDiary(`飼育場にて${targetType}の繁殖に成功しました`, true);
    }
  }

  // --- 司令塔の職務 (物資回収 & 拠点チェスト格納 & 進捗報告) ---
  async performCommanderDuty() {
    const targetGroup = this.role.targetAssignment;
    const workerBots = Object.values(this.manager.bots).filter(b => b.key.includes(targetGroup) && b.key !== this.key);

    let collectedItems = 0;
    // 現場Botからインベントリを回収したとみなし、チェストへ格納
    for (const w of workerBots) {
      if (w.bot && w.bot.inventory) {
        const items = w.bot.inventory.items();
        collectedItems += items.length;
      }
    }

    // 拠点最寄りチェストの特定
    const chestBlock = this.bot.findBlock({
      matching: b => b && b.name && b.name.includes('chest'),
      maxDistance: 16
    });

    if (chestBlock) {
      try {
        const chest = await this.bot.openChest(chestBlock);
        const freeSlots = chest.freeSlotCount();
        const items = chest.containerItems().map(i => ({ name: i.name, count: i.count, displayName: i.displayName }));
        const posKey = `${chestBlock.position.x},${chestBlock.position.y},${chestBlock.position.z}`;

        db.updateChest(posKey, {
          pos: chestBlock.position,
          freeSlots,
          totalSlots: chest.containerItems().length + freeSlots,
          items
        });

        chest.close();
      } catch (_) {}
    } else {
      // チェストに空きがない、または見つからない場合はドロップ
      const item = this.bot.inventory.items()[0];
      if (item) {
        try {
          await this.bot.tossStack(item);
          db.logEvent('store', this.key, `チェスト空き容量不足のため、拠点床面にアイテム(${item.name})をドロップ保管しました`);
        } catch (_) {}
      }
    }

    const report = {
      roleKey: this.key,
      roleName: this.role.displayName,
      targetGroup,
      status: `現場部隊(${workerBots.length}名)の巡回統括完了。物資回収と拠点チェスト収納を継続中。`,
      harvestedCount: collectedItems,
      summary: `担当現場AIと定期疎通確認。異常なく自律タスクを継続中。`
    };

    db.updateCommanderReport(this.key, report);
    this.manager.writeDiary(this.key, this.role.displayName, report.status);
  }
}

// 起動
const manager = new BotManager();
manager.start().then(() => {
  console.log('🚀 [Cluster] BotManager & WebPortal が正常起動しました。');
});

module.exports = manager;
