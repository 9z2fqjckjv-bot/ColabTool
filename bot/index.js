/**
 * index.js - Multi-AIPlayer Manager for Minecraft Colab
 * 4体のAIPlayer (Gemini, ChatGPT, Claude, Grok) を同時制御
 */

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const autoEat = require('mineflayer-auto-eat').plugin;
let mineflayerViewer = null;
try {
  mineflayerViewer = require('prismarine-viewer').mineflayer;
} catch (e) {
  console.warn('[Viewer] prismarine-viewer はスキップされました (Botの動作には影響ありません)');
}
const fs = require('fs');
const path = require('path');

const personas = require('./persona');
const AIBrain = require('./brain');

const SERVER_HOST = process.env.MC_HOST || 'localhost';
const SERVER_PORT = parseInt(process.env.MC_PORT || '25565', 10);
const DIARY_PATH = process.env.DIARY_PATH || '/content/diary.md';

const brain = new AIBrain();
const activeBots = [];

// 行動日誌の初期化
function appendDiary(text) {
  const line = `[${new Date().toISOString()}] ${text}\n`;
  try {
    fs.appendFileSync(DIARY_PATH, line, 'utf8');
  } catch (e) {
    // ignore
  }
}

function createBot(personaKey, index) {
  const persona = personas[personaKey];
  console.log(`[Manager] Bot作成中: ${persona.name} (${persona.role})`);

  const bot = mineflayer.createBot({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: persona.name,
    version: '1.20.4' // サーバー側のViaVersionが1.21.1と相互変換するため最高安定
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);
  bot.loadPlugin(autoEat);

  bot.once('spawn', () => {
    console.log(`[${persona.name}] サーバーにスポーンしました！`);
    appendDiary(`${persona.name} がサーバーにスポーンしました。`);

    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);

    // 1体目（Gemini）のみPrismarine-viewerの3D視点描画を有効化（ポート3000）
    if (index === 0 && mineflayerViewer) {
      try {
        mineflayerViewer(bot, { port: 3000, firstPerson: true });
        console.log(`[Viewer] Prismarine-Viewer がポート 3000 で起動しました (Bot: ${persona.name})`);
      } catch (err) {
        console.error('[Viewer] 起動エラー:', err.message);
      }
    }

    // 初回挨拶
    setTimeout(() => {
      bot.chat(persona.firstGreeting);
      brain.addHistory(persona.name, persona.firstGreeting);
    }, (index + 1) * 2000);
  });

  // チャット受信イベント
  bot.on('chat', async (username, message) => {
    // 自身の発言、または他のBotの発言なら無視
    if (username === bot.username || Object.keys(personas).some(k => personas[k].name === username)) {
      return;
    }

    console.log(`[Chat] <${username}> ${message}`);
    const lowerMsg = message.toLowerCase();
    const isTargeted =
      message.includes(persona.name) ||
      (personaKey === 'Gemini' && !Object.keys(personas).some(k => message.includes(personas[k].name)));

    // 自分宛ての指示、またはリーダー(Gemini)宛ての汎用発言の場合に対応
    if (isTargeted || message.includes('みんな') || message.includes('全員')) {
      const player = bot.players[username]?.entity;
      const playerPos = player ? player.position : bot.entity.position;
      const botPos = bot.entity.position;

      // 周囲のモブを取得
      const nearbyMobs = Object.values(bot.entities)
        .filter(e => e.type === 'mob' && e.position.distanceTo(botPos) < 16)
        .map(e => e.name);

      bot.chat(`思案中...`);
      const thought = await brain.think(persona, message, playerPos, botPos, nearbyMobs);

      // 返答
      if (thought.reply) {
        bot.chat(thought.reply);
        brain.addHistory(persona.name, thought.reply);
        appendDiary(`<${persona.name}> [返答]: ${thought.reply} (アクション: ${thought.action})`);
      }

      // 行動実行
      executeAction(bot, persona, thought, player);
    }
  });

  // 自動食事
  bot.on('health', () => {
    if (bot.food < 15) {
      bot.autoEat.eat().catch(() => {});
    }
  });

  bot.on('death', () => {
    console.log(`[${persona.name}] 倒れました。リスポーンします...`);
    appendDiary(`${persona.name} が倒れました。`);
  });

  bot.on('error', (err) => {
    console.error(`[${persona.name}] エラー:`, err.message);
  });

  return bot;
}

// 行動実行ロジック
function executeAction(bot, persona, thought, playerEntity) {
  const { action, target } = thought;
  if (!bot.pathfinder) return;

  switch (action) {
    case 'follow':
      if (playerEntity) {
        console.log(`[${persona.name}] プレイヤーを追従開始`);
        const goal = new goals.GoalFollow(playerEntity, 2);
        bot.pathfinder.setGoal(goal, true);
      }
      break;

    case 'stop':
      console.log(`[${persona.name}] 停止・待機`);
      bot.pathfinder.setGoal(null);
      if (bot.pvp) bot.pvp.stop();
      break;

    case 'attack':
      const targetMob = bot.nearestEntity(e => e.type === 'mob' && e.kind === 'Hostile');
      if (targetMob && bot.pvp) {
        console.log(`[${persona.name}] モブを攻撃: ${targetMob.name}`);
        bot.pvp.attack(targetMob);
      } else {
        bot.chat('周囲に敵は見当たりません！');
      }
      break;

    case 'collect':
    case 'explore':
      // 付近の安全なランダム座標へ移動
      const rx = bot.entity.position.x + (Math.random() * 20 - 10);
      const rz = bot.entity.position.z + (Math.random() * 20 - 10);
      const ry = bot.entity.position.y;
      bot.pathfinder.setGoal(new goals.GoalNear(rx, ry, rz, 1));
      break;

    default:
      break;
  }
}

// 4体のBotを順次起動
console.log('=== Minecraft AIPlayer クラスタ起動中 ===');
const personaKeys = ['Gemini', 'ChatGPT', 'Claude', 'Grok'];

personaKeys.forEach((key, idx) => {
  setTimeout(() => {
    const b = createBot(key, idx);
    activeBots.push(b);
  }, idx * 4000); // 接続が重ならないよう4秒間隔で参加
});
