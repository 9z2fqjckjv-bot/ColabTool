/**
 * index.js - Autonomous Multi-AIPlayer Manager for Minecraft Colab
 * 4体の自律AI (Gemini, ChatGPT, Claude, Grok) の同時制御・動的対話・個別視線収録・個別行動日誌
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const autoEat = require('mineflayer-auto-eat').plugin;
const collectBlock = require('mineflayer-collectblock').plugin;
let viewer = null;
try {
  viewer = require('prismarine-viewer').mineflayer;
} catch (e) {
  console.warn(`[Viewer Warning] prismarine-viewerの読み込みをスキップしました (${e.message})。Bot本体の動作を継続します。`);
}
const fs = require('fs');
const path = require('path');

const personas = require('./persona');
const AIBrain = require('./brain');

const SERVER_HOST = process.env.MC_HOST || 'localhost';
const SERVER_PORT = parseInt(process.env.MC_PORT || '25565', 10);
const LOGS_DIR = process.env.LOGS_DIR || '/content/logs';

// ログディレクトリの確保
try {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
} catch (e) {}

const brain = new AIBrain();
const activeBots = {};

/**
 * 個別および統合の行動日誌記録
 */
function recordDiary(botName, actionType, detail, pos = null) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('ja-JP');
  const isoStr = now.toISOString();
  const posStr = pos ? `${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}` : '不明';

  const row = `| ${timeStr} | \`${posStr}\` | **${actionType}** | ${detail.replace(/\|/g, '-')} |\n`;

  // 1. 各AIPlayer専用の日誌
  const botDiaryPath = path.join(LOGS_DIR, `${botName}_diary.md`);
  if (!fs.existsSync(botDiaryPath)) {
    const header = `# 📔 ${botName} のサバイバル行動日誌\n\n- **記録開始**: ${isoStr}\n- **サーバー**: ${SERVER_HOST}:${SERVER_PORT}\n\n| 時刻 | 座標 (X, Y, Z) | 行動種別 | 詳細・思考・対話 |\n| :--- | :--- | :--- | :--- |\n`;
    fs.writeFileSync(botDiaryPath, header, 'utf8');
  }
  fs.appendFileSync(botDiaryPath, row, 'utf8');

  // 2. 全体統合タイムライン日誌
  const combinedPath = path.join(LOGS_DIR, 'survival_diary_combined.md');
  if (!fs.existsSync(combinedPath)) {
    const header = `# 🌐 Minecraft AI 統合サバイバル活動日誌\n\n- **記録開始**: ${isoStr}\n\n| 時刻 | キャラクター | 座標 | 種別 | 内容 |\n| :--- | :--- | :--- | :--- | :--- |\n`;
    fs.writeFileSync(combinedPath, header, 'utf8');
  }
  const combinedRow = `| ${timeStr} | **${botName}** | \`${posStr}\` | ${actionType} | ${detail.replace(/\|/g, '-')} |\n`;
  fs.appendFileSync(combinedPath, combinedRow, 'utf8');
}

/**
 * 1体のAIPlayer Botを作成
 */
function createBot(personaKey, index) {
  const persona = personas[personaKey];
  const botName = persona.name;
  const viewerPort = 3001 + index;

  console.log(`[Manager] AIPlayer生成開始: ${botName} (ViewerPort: ${viewerPort})`);

  const bot = mineflayer.createBot({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: botName,
    version: '1.21.1',
    hideErrors: false
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);
  bot.loadPlugin(autoEat);
  bot.loadPlugin(collectBlock);

  // Bot個別ステート
  bot.customState = {
    isBusy: false,
    currentAction: 'idle',
    lastChatTime: 0,
    targetBlock: null
  };

  // スポーンイベント
  bot.once('spawn', () => {
    console.log(`🎉 [${botName}] スポーン完了！ (視線Viewer: http://localhost:${viewerPort})`);
    recordDiary(botName, 'スポーン', `ワールドにスポーンしました。初期挨拶を準備中。`, bot.entity.position);

    // パスファインダー設定
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    defaultMove.canDig = true;
    defaultMove.allow1by1towers = false;
    defaultMove.allowFreeMotion = true;
    defaultMove.liquidCost = 5; // 溺死やマグマダイブを防止
    bot.pathfinder.setMovements(defaultMove);

    // 視線 (First-Person POV) Prismarine-Viewer 起動
    if (viewer) {
      try {
        viewer(bot, { port: viewerPort, firstPerson: true });
        console.log(`🎥 [${botName}] 一人称視点Webストリーム配信中 -> ポート ${viewerPort}`);
      } catch (err) {
        console.warn(`[${botName}] Viewer起動スキップ:`, err.message);
      }
    }

    // 初回挨拶（接続負荷を避けて順次発言）
    setTimeout(() => {
      bot.chat(persona.firstGreeting);
      brain.addHistory(botName, persona.firstGreeting);
      recordDiary(botName, '挨拶', `初回発言: "${persona.firstGreeting}"`, bot.entity.position);
    }, (index + 1) * 2500);

    // 自律行動タイマーの開始 (各Bot少しずつズラして実行)
    setTimeout(() => {
      startAutonomousLoop(bot, personaKey);
    }, 10000 + index * 3000);
  });

  // チャット受信イベント (メンション・声掛け対応)
  bot.on('chat', async (username, message) => {
    // 自身の発言、または他のBotの発言ならスキップ
    if (username === bot.username || Object.keys(personas).some(k => personas[k].name === username)) {
      return;
    }

    const mentionInfo = brain.isMentioned(message, personaKey, persona);
    const playerEntity = bot.players[username]?.entity;
    const botPos = bot.entity ? bot.entity.position : { x: 0, y: 0, z: 0 };
    const playerPos = playerEntity ? playerEntity.position : botPos;
    const distanceToPlayer = playerEntity && bot.entity ? bot.entity.position.distanceTo(playerEntity.position) : 999;

    // 自分宛てのメンション、または全体メンション、または至近距離(8ブロック以内)での声掛けに対応
    const shouldRespond =
      mentionInfo.mentioned ||
      (!message.includes('@') && !message.includes('ジェミニ') && !message.includes('チャット') && !message.includes('クロード') && !message.includes('グロック') && distanceToPlayer < 8);

    if (shouldRespond) {
      console.log(`[Chat Target -> ${botName}] <${username}> ${message}`);

      // 周囲状況の集計
      const hostileMobs = Object.values(bot.entities)
        .filter(e => e.type === 'mob' && e.kind === 'Hostile' && e.position.distanceTo(botPos) < 18)
        .map(e => e.name);

      const botState = {
        health: bot.health,
        food: bot.food,
        isNight: bot.time ? (bot.time.timeOfDay >= 13000 && bot.time.timeOfDay <= 23000) : false,
        hostileMobs
      };

      // 全体発言時は発言順が重ならないようスタッガー
      const delayMs = mentionInfo.isBroadcast ? (index * 1500) : 300;
      setTimeout(async () => {
        try {
          const thought = await brain.thinkChat(persona, message, playerPos, botPos, botState);
          if (thought && thought.reply) {
            bot.chat(thought.reply);
            brain.addHistory(botName, thought.reply);
            recordDiary(botName, '対話・指示受信', `プレイヤー「${message}」へ返答: "${thought.reply}" (行動: ${thought.action})`, bot.entity.position);
          }
          executeAction(bot, persona, thought, playerEntity);
        } catch (err) {
          console.error(`[${botName}] チャット処理エラー:`, err.message);
        }
      }, delayMs);
    }
  });

  // 自動食事
  bot.on('health', () => {
    if (bot.food < 15 && bot.autoEat) {
      bot.autoEat.eat().catch(() => {});
    }
  });

  // 死亡ログ・リスポーン記録
  bot.on('death', () => {
    console.log(`⚠️ [${botName}] 倒れました。リスポーンします...`);
    recordDiary(botName, '死亡', `倒れました。リスポーン待機中。`, bot.entity.position);
  });

  bot.on('respawn', () => {
    recordDiary(botName, 'リスポーン', `再スポーンしました。`, bot.entity.position);
  });

  bot.on('kicked', reason => {
    console.warn(`[${botName}] KICKされました:`, JSON.stringify(reason));
  });

  bot.on('error', err => {
    console.error(`[${botName}] エラー:`, err.message);
  });

  activeBots[personaKey] = bot;
  return bot;
}

/**
 * 自律行動ループ (各Botが8〜12秒ごとに周囲を観察し自律タスクを実行)
 */
function startAutonomousLoop(bot, personaKey) {
  const persona = personas[personaKey];
  const botName = persona.name;

  setInterval(async () => {
    if (!bot.entity || bot.customState.isBusy) return;

    try {
      const botPos = bot.entity.position;
      const isNight = bot.time ? (bot.time.timeOfDay >= 13000 && bot.time.timeOfDay <= 23000) : false;

      // 周囲の敵対モブを検出
      const hostileEntity = bot.nearestEntity(e => e.type === 'mob' && e.kind === 'Hostile' && e.position.distanceTo(botPos) < 14);

      const botState = {
        health: bot.health,
        food: bot.food,
        isNight,
        hostileMobs: hostileEntity ? [hostileEntity.name] : []
      };

      const decision = await brain.thinkAutonomous(persona, botPos, botState);
      recordDiary(botName, '自律意思決定', `${decision.thought} (決定アクション: ${decision.action})`, botPos);

      // 自律アクションの実行
      executeAction(bot, persona, decision, null);
    } catch (e) {
      // 軽微なエラーはスキップして継続
    }
  }, 10000 + Math.random() * 4000);
}

/**
 * アクション実行ロジック
 */
function executeAction(bot, persona, thought, targetPlayer) {
  if (!bot.pathfinder || !thought) return;
  const { action, target } = thought;
  const botName = persona.name;

  switch (action) {
    case 'follow':
      // プレイヤーがいればプレイヤーを追従、いなければ最寄りのプレイヤーを探す
      const playerToFollow = targetPlayer || bot.nearestEntity(e => e.type === 'player' && e.username !== bot.username);
      if (playerToFollow) {
        bot.customState.isBusy = true;
        bot.pathfinder.setGoal(new goals.GoalFollow(playerToFollow, 3), true);
        setTimeout(() => { bot.customState.isBusy = false; }, 8000);
      }
      break;

    case 'collect_wood':
      // 付近の原木(log)を探して伐採
      const mcData = require('minecraft-data')(bot.version);
      const logBlocks = bot.findBlocks({
        matching: block => block.name.includes('_log') || block.name.includes('wood'),
        maxDistance: 24,
        count: 1
      });

      if (logBlocks.length > 0) {
        const targetBlock = bot.blockAt(logBlocks[0]);
        if (targetBlock && bot.collectBlock) {
          bot.customState.isBusy = true;
          console.log(`[${botName}] 木の伐採を開始: ${targetBlock.name}`);
          bot.collectBlock.collect(targetBlock, err => {
            bot.customState.isBusy = false;
            if (!err) {
              recordDiary(botName, '伐採完了', `原木「${targetBlock.name}」の伐採に成功しました。`, bot.entity.position);
            }
          });
        }
      } else {
        // 木が見当たらなければ付近を探索
        wanderNear(bot);
      }
      break;

    case 'mine':
      // 付近の石材または石炭・鉄鉱石を採掘
      const stoneBlocks = bot.findBlocks({
        matching: block => block.name.includes('stone') || block.name.includes('coal_ore') || block.name.includes('iron_ore'),
        maxDistance: 16,
        count: 1
      });
      if (stoneBlocks.length > 0) {
        const blk = bot.blockAt(stoneBlocks[0]);
        if (blk && bot.collectBlock) {
          bot.customState.isBusy = true;
          bot.collectBlock.collect(blk, () => {
            bot.customState.isBusy = false;
          });
        }
      } else {
        wanderNear(bot);
      }
      break;

    case 'attack':
      const hostile = bot.nearestEntity(e => e.type === 'mob' && e.kind === 'Hostile' && e.position.distanceTo(bot.entity.position) < 16);
      if (hostile && bot.pvp) {
        console.log(`[${botName}] 敵対モブと戦闘開始: ${hostile.name}`);
        bot.pvp.attack(hostile);
        recordDiary(botName, '戦闘', `モンスター「${hostile.name}」を迎撃中。`, bot.entity.position);
      }
      break;

    case 'explore':
      wanderNear(bot);
      break;

    case 'stop':
      bot.pathfinder.setGoal(null);
      if (bot.pvp) bot.pvp.stop();
      bot.customState.isBusy = false;
      break;

    default:
      break;
  }
}

function wanderNear(bot) {
  if (!bot.entity) return;
  const rx = bot.entity.position.x + (Math.random() * 24 - 12);
  const rz = bot.entity.position.z + (Math.random() * 24 - 12);
  const ry = bot.entity.position.y;
  bot.pathfinder.setGoal(new goals.GoalNear(rx, ry, rz, 1));
}

// 4体のBotを順次起動
console.log('=== Minecraft 自律AIPlayerクラスタ起動開始 ===');
const personaKeys = ['Gemini', 'ChatGPT', 'Claude', 'Grok'];

personaKeys.forEach((key, idx) => {
  setTimeout(() => {
    createBot(key, idx);
  }, idx * 5000);
});
