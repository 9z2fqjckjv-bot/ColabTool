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
const VisionCapturer = require('./vision_capturer');

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

  // 3. AIの頭脳（知識・履歴データベース）へも自動蓄積
  try {
    const isChat = actionType.includes('対話') || actionType.includes('発言') || actionType.includes('挨拶');
    const histType = isChat ? 'chat' : 'action';
    brain.knowledgeBase.recordHistory(histType, botName, `${actionType}: ${detail}`, pos);
  } catch (_) {}
}

/**
 * Botの現在地・環境・周辺設備を客観的・リアルタイムに集計
 */
function getBotEnvironmentalState(bot) {
  const botPos = bot.entity ? bot.entity.position : { x: 0, y: 0, z: 0 };
  const mcData = require('minecraft-data')(bot.version);

  // 1. 水没・溶岩・窒息の客観的ステータス
  const headBlock = bot.blockAt(botPos.offset(0, 1.6, 0));
  const isInWater = bot.entity ? bot.entity.isInWater : false;
  const isInLava = bot.entity ? bot.entity.isInLava : false;
  const isHeadSubmerged = headBlock ? (headBlock.name === 'water' || headBlock.name === 'flowing_water') : false;
  const oxygenLevel = bot.oxygenLevel !== undefined ? bot.oxygenLevel : 20;

  // 2. 敵対モブ
  const hostileMobs = Object.values(bot.entities)
    .filter(e => e.type === 'mob' && e.kind === 'Hostile' && e.position.distanceTo(botPos) < 18)
    .map(e => e.name);

  // 3. インベントリ
  const inventoryItems = bot.inventory ? bot.inventory.items().map(i => i.name) : [];

  // 4. 周囲の既存設備（作業台・かまど・焚き火）の高速検出
  const nearbyUtilities = [];
  const utilityTargetIds = [];
  ['crafting_table', 'furnace', 'blast_furnace', 'smoker', 'campfire', 'soul_campfire'].forEach(name => {
    const b = mcData.blocksByName[name];
    if (b) utilityTargetIds.push(b.id);
  });

  const foundBlocks = bot.findBlocks({
    matching: utilityTargetIds,
    maxDistance: 16,
    count: 3
  });

  for (const pos of foundBlocks) {
    const blk = bot.blockAt(pos);
    if (blk) {
      const dist = Math.round(botPos.distanceTo(pos));
      nearbyUtilities.push(`${blk.name}(${dist}m)`);
    }
  }

  // 5. 正面注視ブロックの検出 (視界レイキャスト)
  let lookingAt = null;
  try {
    const cursor = bot.blockAtCursor ? bot.blockAtCursor(5) : null;
    if (cursor) lookingAt = cursor.name;
  } catch (e) {}

  return {
    health: bot.health,
    food: bot.food,
    isNight: bot.time ? (bot.time.timeOfDay >= 13000 && bot.time.timeOfDay <= 23000) : false,
    isInWater: isInWater || isHeadSubmerged,
    isInLava,
    oxygenLevel,
    nearbyUtilities,
    hostileMobs,
    inventoryItems,
    lookingAt
  };
}

/**
 * 緊急自衛ループ (客観的現在地検知: 水没・溺死・溶岩・窒息からの超高速自動退避)
 * 250ms間隔で監視し、LLM思考に関係なく反射的に生命を保護
 */
function startSafetyWatchdog(bot) {
  let isEscapingWater = false;

  setInterval(() => {
    if (!bot.entity) return;
    const botPos = bot.entity.position;
    const headBlock = bot.blockAt(botPos.offset(0, 1.6, 0));
    const isHeadInWater = headBlock && (headBlock.name === 'water' || headBlock.name === 'flowing_water');
    const isInWater = bot.entity.isInWater || isHeadInWater;
    const oxygen = bot.oxygenLevel !== undefined ? bot.oxygenLevel : 20;

    // A. 溶岩接触時: 最優先で緊急脱出
    if (bot.entity.isInLava) {
      console.warn(`🚨 [${bot.username}] 溶岩に接触！緊急退避中！`);
      bot.setControlState('jump', true);
      bot.setControlState('sprint', true);
      wanderNear(bot);
      return;
    }

    // B. 水没・溺死の危機
    if (isInWater) {
      // 1. まず息継ぎのため水面へ素早く浮上 (ジャンプ制御)
      bot.setControlState('jump', true);

      // 2. 酸素が低下しているか、潜水中の場合、最寄りの安全な乾燥陸地へダッシュ
      if (oxygen < 19 || isHeadInWater) {
        if (!isEscapingWater) {
          isEscapingWater = true;
          // 最寄りの非水ブロック（土・石・砂など）を探索
          const landBlockPos = bot.findBlock({
            matching: block => {
              if (!block || !block.name || !block.position || typeof block.position.offset !== 'function') return false;
              if (block.name.includes('water') || block.name === 'air') return false;
              try {
                const above = bot.blockAt(block.position.offset(0, 1, 0));
                const above2 = bot.blockAt(block.position.offset(0, 2, 0));
                return above && above.name === 'air' && above2 && above2.name === 'air';
              } catch (_) {
                return false;
              }
            },
            maxDistance: 16
          });

          if (landBlockPos) {
            console.log(`🏊 [${bot.username}] 水没を検知: 陸地(${landBlockPos.position.x}, ${landBlockPos.position.y}, ${landBlockPos.position.z})へ脱出します！`);
            bot.pathfinder.setGoal(new goals.GoalNear(landBlockPos.position.x, landBlockPos.position.y + 1, landBlockPos.position.z, 0.5));
          }
        }
      }
    } else {
      // 陸上に上がったらジャンプ解除 & 脱出フラグ解除
      if (isEscapingWater) {
        isEscapingWater = false;
        console.log(`✅ [${bot.username}] 陸上への脱出に成功しました。`);
      }
      bot.setControlState('jump', false);
    }
  }, 250);
}

/**
 * 1体のAIPlayer Botを作成
 */
function createBot(personaKey, index) {
  const persona = personas[personaKey];
  const botName = persona.name;
  const viewerPort = 3001 + index;

  console.log(`[Manager] AIPlayer生成開始: ${botName} (ViewerPort: ${viewerPort})`);

  // 一人称視線スクリーンショットキャプチャエンジンの初期化
  const visionCapturer = new VisionCapturer({
    port: viewerPort,
    botName: botName,
    intervalMs: 3000
  });

  const bot = mineflayer.createBot({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: botName,
    version: '1.21.1',
    hideErrors: false
  });

  bot.visionCapturer = visionCapturer;

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);
  bot.loadPlugin(autoEat);
  bot.loadPlugin(collectBlock);

  // Bot個別ステート
  bot.customState = {
    isBusy: false,
    currentAction: 'idle',
    lastChatTime: 0,
    targetBlock: null,
    busyTimer: null
  };

  bot.setBotBusy = function(actionName, timeoutMs = 15000) {
    bot.customState.isBusy = true;
    bot.customState.currentAction = actionName;
    if (bot.customState.busyTimer) clearTimeout(bot.customState.busyTimer);
    bot.customState.busyTimer = setTimeout(() => {
      bot.customState.isBusy = false;
      bot.customState.currentAction = 'idle';
    }, timeoutMs);
  };

  bot.clearBotBusy = function() {
    bot.customState.isBusy = false;
    bot.customState.currentAction = 'idle';
    if (bot.customState.busyTimer) clearTimeout(bot.customState.busyTimer);
  };

  // スポーンイベント
  bot.once('spawn', () => {
    console.log(`🎉 [${botName}] スポーン完了！ (視線Viewer: http://localhost:${viewerPort})`);
    recordDiary(botName, 'スポーン', `ワールドにスポーンしました。初期挨拶を準備中。`, bot.entity.position);

    // パスファインダー設定 (草や花でフリーズするのを防ぎ、スムーズな踏破を実現)
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    defaultMove.canDig = true; // 草・花・ツタなどを壊して通行可能にする（移動不能フリーズの根本防止）
    defaultMove.allowParkour = true; // 1ブロックの段差や溝をジャンプして乗り越える
    defaultMove.allowSprinting = true; // 追従時にダッシュ
    defaultMove.liquidCost = 5; // 溺死やマグマ侵入防止
    // 通常移動時に地面や建築ブロックを不用意に掘り崩さないよう保護
    const protectBlocks = ['dirt', 'grass_block', 'stone', 'deepslate', 'sand', 'gravel', 'bedrock', 'cobblestone', 'oak_planks', 'spruce_planks', 'birch_planks'];
    for (const bName of protectBlocks) {
      const b = mcData.blocksByName[bName];
      if (b) defaultMove.blocksCantBreak.add(b.id);
    }
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

    // 3秒おきの一人称視界スクリーンショット自動取得を開始
    visionCapturer.startLoop(bot, 3000);

    // 初回挨拶（接続負荷を避けて順次発言）
    setTimeout(() => {
      bot.chat(persona.firstGreeting);
      brain.addHistory(botName, persona.firstGreeting);
      recordDiary(botName, '挨拶', `初回発言: "${persona.firstGreeting}"`, bot.entity.position);
      // 初回装備チェック
      autoEquipAll(bot, 'idle');
    }, (index + 1) * 2500);

    // 緊急自衛ループ (水没・溺死・溶岩からの250ms反射的超高速脱出)
    startSafetyWatchdog(bot);

    // 高頻度コンパニオン追従＆アイテム回収ループ (滑らかな人間らしい動作)
    startCompanionLoop(bot);

    // 3秒おきの視覚＋知識ベース(RAG)自律意思決定＆高速行動ループ
    setTimeout(() => {
      startVisionAutonomousLoop(bot, personaKey);
    }, 8000 + index * 2500);
  });

  // インベントリ更新イベント (bot.inventory はスポーン後に生成されるため spawn イベントで監視登録)
  let equipDebounce = null;
  bot.on('spawn', () => {
    if (bot.inventory && !bot.inventory._hasAutoEquipListener) {
      bot.inventory._hasAutoEquipListener = true;
      bot.inventory.on('updateSlot', (slot, oldItem, newItem) => {
        if (equipDebounce) clearTimeout(equipDebounce);
        equipDebounce = setTimeout(() => {
          autoEquipAll(bot, 'idle');
        }, 300);
      });
    }
  });

  // アイテム回収時にも即座に自動装備をトリガー
  bot.on('playerCollect', (collector) => {
    if (collector && bot.entity && collector.id === bot.entity.id) {
      if (equipDebounce) clearTimeout(equipDebounce);
      equipDebounce = setTimeout(() => {
        autoEquipAll(bot, 'idle');
      }, 300);
    }
  });

  // チャット処理の共通ロジック (chatイベント & messagestrイベント両対応)
  let lastHandledChatMsg = '';
  let lastHandledChatTime = 0;

  const handleIncomingChat = async (username, message) => {
    if (!message || typeof message !== 'string') return;
    const cleanMessage = message.trim();
    if (!cleanMessage) return;

    // 自身の発言、または他のBotの発言ならスキップ
    if (username === bot.username || Object.keys(personas).some(k => personas[k].name === username)) {
      return;
    }

    // 重複チャット処理防止 (直近1秒の完全一致)
    const now = Date.now();
    if (cleanMessage === lastHandledChatMsg && now - lastHandledChatTime < 1000) {
      return;
    }

    const mentionInfo = brain.isMentioned(cleanMessage, personaKey, persona);
    const playerEntity = bot.players[username]?.entity;
    const botPos = bot.entity ? bot.entity.position : { x: 0, y: 0, z: 0 };
    const playerPos = playerEntity ? playerEntity.position : botPos;
    const distanceToPlayer = playerEntity && bot.entity ? bot.entity.position.distanceTo(playerEntity.position) : 999;

    // メンションがない場合、24ブロック以内のプレイヤーに対して「最も近いBot」が代表で応答
    let isClosestRepresentative = false;
    if (!mentionInfo.mentioned && !mentionInfo.isBroadcast && distanceToPlayer < 24) {
      let closestKey = null;
      let minDistance = 9999;
      for (const [k, b] of Object.entries(activeBots)) {
        if (b && b.entity && playerEntity) {
          const d = b.entity.position.distanceTo(playerEntity.position);
          if (d < minDistance) {
            minDistance = d;
            closestKey = k;
          }
        }
      }
      if (closestKey === personaKey) {
        isClosestRepresentative = true;
      }
    }

    const shouldRespond = mentionInfo.mentioned || mentionInfo.isBroadcast || isClosestRepresentative;
    if (!shouldRespond) return;

    lastHandledChatMsg = cleanMessage;
    lastHandledChatTime = now;

    console.log(`[Chat Target -> ${botName}] <${username}> ${cleanMessage} (メンション: ${mentionInfo.mentioned}, 一斉: ${mentionInfo.isBroadcast}, 代表: ${isClosestRepresentative})`);

    // 客観的環境・現在地ステータスのリアルタイム集計 (水没・溶岩・作業台/かまど有無)
    const botState = getBotEnvironmentalState(bot);

    // 全体発言時は発言順が重ならないようスタッガー (300ms〜)
    const delayMs = mentionInfo.isBroadcast ? (index * 1400 + 200) : 250;
    setTimeout(async () => {
      try {
        const thought = await brain.thinkChat(persona, cleanMessage, playerPos, botPos, botState);
        if (thought && thought.reply) {
          bot.chat(thought.reply);
          brain.addHistory(botName, thought.reply);
          recordDiary(botName, '対話・指示受信', `プレイヤー「${cleanMessage}」へ返答: "${thought.reply}" (行動: ${thought.action})`, bot.entity.position);
        }
        executeAction(bot, persona, thought, playerEntity);
      } catch (err) {
        console.error(`[${botName}] チャット処理エラー:`, err.message);
      }
    }, delayMs);
  };

  // 標準チャットイベント
  bot.on('chat', (username, message) => {
    handleIncomingChat(username, message);
  });

  // Paper/Spigot環境でのチャットプラグイン対策 (messagestr フォールバック)
  bot.on('messagestr', (msgStr) => {
    if (!msgStr) return;
    // <PlayerName> message または PlayerName: message を抽出
    const match = msgStr.match(/^<([^>]+)>\s*(.*)$/) || msgStr.match(/^([a-zA-Z0-9_]{3,16}):\s*(.*)$/);
    if (match) {
      handleIncomingChat(match[1], match[2]);
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
 * 武器・防具・ツールの賢い自動装備 (Auto-Equip Engine)
 */
async function autoEquipAll(bot, mode = 'combat') {
  if (!bot.inventory) return;

  try {
    const items = bot.inventory.items();

    // 1. 防具の自動装備 (Tier順: netherite > diamond > iron > chainmail > golden > leather)
    const armorTiers = ['netherite', 'diamond', 'iron', 'chainmail', 'golden', 'leather'];
    const armorSlots = [
      { name: 'helmet', dest: 'head', alt: 'cap' },
      { name: 'chestplate', dest: 'torso', alt: 'tunic' },
      { name: 'leggings', dest: 'legs', alt: 'pants' },
      { name: 'boots', dest: 'feet', alt: 'boots' }
    ];

    for (const slot of armorSlots) {
      const candidates = items.filter(i => i.name.includes(slot.name) || i.name.includes(slot.alt));
      if (candidates.length > 0) {
        // 最上位Tierの防具を選択
        candidates.sort((a, b) => {
          const aTier = armorTiers.findIndex(t => a.name.includes(t));
          const bTier = armorTiers.findIndex(t => b.name.includes(t));
          return (aTier === -1 ? 99 : aTier) - (bTier === -1 ? 99 : bTier);
        });
        const bestArmor = candidates[0];
        try {
          await bot.equip(bestArmor, slot.dest);
        } catch (e) {}
      }
    }

    // 2. 盾・オフハンド装備
    const shield = items.find(i => i.name === 'shield' || i.name === 'totem_of_undying');
    if (shield) {
      try {
        await bot.equip(shield, 'off-hand');
      } catch (e) {}
    }

    // 3. メインハンド（武器・ツール）の装備
    if (mode === 'wood') {
      // 斧を優先
      const axes = items.filter(i => i.name.includes('_axe'));
      if (axes.length > 0) {
        axes.sort((a, b) => {
          const aTier = armorTiers.findIndex(t => a.name.includes(t));
          const bTier = armorTiers.findIndex(t => b.name.includes(t));
          return (aTier === -1 ? 99 : aTier) - (bTier === -1 ? 99 : bTier);
        });
        await bot.equip(axes[0], 'hand');
        return;
      }
    } else if (mode === 'mine') {
      // ツルハシを優先
      const picks = items.filter(i => i.name.includes('_pickaxe'));
      if (picks.length > 0) {
        picks.sort((a, b) => {
          const aTier = armorTiers.findIndex(t => a.name.includes(t));
          const bTier = armorTiers.findIndex(t => b.name.includes(t));
          return (aTier === -1 ? 99 : aTier) - (bTier === -1 ? 99 : bTier);
        });
        await bot.equip(picks[0], 'hand');
        return;
      }
    }

    // デフォルト/戦闘時: 剣または最上位の武器を装備
    const weapons = items.filter(i => i.name.includes('_sword') || i.name.includes('_axe') || i.name === 'trident' || i.name === 'mace');
    if (weapons.length > 0) {
      weapons.sort((a, b) => {
        // 剣を最優先
        const aIsSword = a.name.includes('_sword') ? 0 : 1;
        const bIsSword = b.name.includes('_sword') ? 0 : 1;
        if (aIsSword !== bIsSword) return aIsSword - bIsSword;
        const aTier = armorTiers.findIndex(t => a.name.includes(t));
        const bTier = armorTiers.findIndex(t => b.name.includes(t));
        return (aTier === -1 ? 99 : aTier) - (bTier === -1 ? 99 : bTier);
      });
      await bot.equip(weapons[0], 'hand');
    } else {
      // 武器がなければ地図などを持たせる
      const mapItem = items.find(i => i.name.includes('map'));
      if (mapItem) {
        try { await bot.equip(mapItem, 'hand'); } catch (e) {}
      }
    }
  } catch (err) {
    // 装備エラーは安全に無視
  }
}

/**
 * 基本サバイバルクラフト (原木 -> 木材 -> 棒 -> 作業台 -> 木の剣/ツルハシ)
 */
async function craftSurvivalKit(bot) {
  if (!bot.inventory) return;
  const mcData = require('minecraft-data')(bot.version);
  bot.customState.isBusy = true;
  const botName = bot.username;

  try {
    const items = bot.inventory.items();
    const logs = items.filter(i => i.name.includes('_log') || i.name.includes('_wood'));

    if (logs.length > 0) {
      const log = logs[0];
      // 原木から木材をクラフト
      const plankName = log.name.replace('_log', '_planks').replace('_wood', '_planks');
      const plankItem = mcData.itemsByName[plankName] || mcData.itemsByName.oak_planks;

      if (plankItem) {
        const recipes = bot.recipesFor(plankItem.id, null, 1, null);
        if (recipes.length > 0) {
          console.log(`[${botName}] 木材(${plankName})をクラフト中...`);
          await bot.craft(recipes[0], 1, null);
        }
      }

      // 木材から棒をクラフト
      const sticks = bot.inventory.items().find(i => i.name === 'stick');
      if (!sticks || sticks.count < 4) {
        const stickItem = mcData.itemsByName.stick;
        const stickRecipes = bot.recipesFor(stickItem.id, null, 1, null);
        if (stickRecipes.length > 0) {
          console.log(`[${botName}] 棒(stick)をクラフト中...`);
          await bot.craft(stickRecipes[0], 1, null);
        }
      }

      // 作業台をクラフト
      const hasTable = bot.inventory.items().some(i => i.name === 'crafting_table');
      if (!hasTable) {
        const tableItem = mcData.itemsByName.crafting_table;
        const tableRecipes = bot.recipesFor(tableItem.id, null, 1, null);
        if (tableRecipes.length > 0) {
          console.log(`[${botName}] 作業台(crafting_table)をクラフト中...`);
          await bot.craft(tableRecipes[0], 1, null);
        }
      }

      // 1. 周囲16ブロック以内の既存の作業台を最優先で探索して活用
      let tableBlock = bot.findBlock({
        matching: mcData.blocksByName.crafting_table.id,
        maxDistance: 16
      });

      if (tableBlock) {
        console.log(`[${botName}] 周囲の既存作業台を発見！移動して使用します: X:${tableBlock.position.x}, Y:${tableBlock.position.y}, Z:${tableBlock.position.z}`);
        bot.pathfinder.setGoal(new goals.GoalNear(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 2));
        await new Promise(r => setTimeout(r, 1200));
      } else if (tableItemInInv) {
        // 既存のものがなければ足元付近の設置可能な面を探して設置
        const groundBlock = bot.blockAt(bot.entity.position.offset(1, -1, 0)) || bot.blockAt(bot.entity.position.offset(0, -1, 1));
        if (groundBlock && groundBlock.name !== 'air') {
          try {
            await bot.equip(tableItemInInv, 'hand');
            await bot.placeBlock(groundBlock, { x: 0, y: 1, z: 0 });
            tableBlock = bot.findBlock({
              matching: mcData.blocksByName.crafting_table.id,
              maxDistance: 4
            });
          } catch (e) {}
        }
      }

      if (tableBlock) {
        // 木の剣のクラフト (レシピ本展開)
        const swordItem = mcData.itemsByName.wooden_sword;
        const swordRecipes = bot.recipesFor(swordItem.id, null, 1, tableBlock);
        if (swordRecipes.length > 0) {
          console.log(`[${botName}] 木の剣(wooden_sword)をクラフト中...`);
          await bot.craft(swordRecipes[0], 1, tableBlock);
        }

        // 木のツルハシのクラフト
        const pickItem = mcData.itemsByName.wooden_pickaxe;
        const pickRecipes = bot.recipesFor(pickItem.id, null, 1, tableBlock);
        if (pickRecipes.length > 0) {
          console.log(`[${botName}] 木のツルハシ(wooden_pickaxe)をクラフト中...`);
          await bot.craft(pickRecipes[0], 1, tableBlock);
        }
      }

      // クラフトした武器・ツールを即時装備！
      await autoEquipAll(bot, 'combat');
      recordDiary(botName, 'クラフト完了', `作業台を活用して木の剣とツルハシをクラフト・装備しました！`, bot.entity.position);
    }
  } catch (err) {
    console.warn(`[${botName}] クラフト処理一部スキップ:`, err.message);
  } finally {
    if (bot.clearBotBusy) bot.clearBotBusy();
  }
}

/**
 * 既存のかまど・焚き火を利用した調理・精錬
 */
async function cookFoodAtUtility(bot) {
  if (!bot.inventory) return;
  const mcData = require('minecraft-data')(bot.version);
  const botName = bot.username;
  const items = bot.inventory.items();

  // 生肉や調理可能アイテムのチェック
  const rawFoods = items.filter(i => 
    i.name.includes('raw_') || i.name === 'beef' || i.name === 'porkchop' || i.name === 'chicken' || i.name === 'mutton' || i.name === 'cod' || i.name === 'salmon' || i.name === 'potato'
  );
  if (rawFoods.length === 0) return;

  // 1. 焚き火 (campfire / soul_campfire) の検索
  const campfireBlock = bot.findBlock({
    matching: [mcData.blocksByName.campfire?.id, mcData.blocksByName.soul_campfire?.id].filter(Boolean),
    maxDistance: 16
  });

  if (campfireBlock) {
    console.log(`[${botName}] 近くの焚き火を発見！生肉を調理します。`);
    if (bot.setBotBusy) bot.setBotBusy('cook', 10000);
    bot.pathfinder.setGoal(new goals.GoalNear(campfireBlock.position.x, campfireBlock.position.y, campfireBlock.position.z, 2));
    setTimeout(async () => {
      try {
        await bot.equip(rawFoods[0], 'hand');
        await bot.activateBlock(campfireBlock);
        recordDiary(botName, '調理', `焚き火に「${rawFoods[0].name}」を置いて調理を開始しました。`, bot.entity.position);
      } catch (e) {}
      if (bot.clearBotBusy) bot.clearBotBusy();
    }, 2000);
    return;
  }

  // 2. かまど (furnace / smoker / blast_furnace) の検索
  const furnaceBlock = bot.findBlock({
    matching: [mcData.blocksByName.furnace?.id, mcData.blocksByName.smoker?.id, mcData.blocksByName.blast_furnace?.id].filter(Boolean),
    maxDistance: 16
  });

  if (furnaceBlock) {
    console.log(`[${botName}] 近くのかまどを発見！精錬・調理を試みます。`);
    if (bot.setBotBusy) bot.setBotBusy('cook', 15000);
    bot.pathfinder.setGoal(new goals.GoalNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2));
    setTimeout(async () => {
      try {
        const furnace = await bot.openFurnace(furnaceBlock);
        const fuels = bot.inventory.items().filter(i => i.name.includes('coal') || i.name.includes('charcoal') || i.name.includes('_planks') || i.name.includes('_log'));
        if (fuels.length > 0) {
          await furnace.putFuel(fuels[0].type, null, 1);
        }
        await furnace.putInput(rawFoods[0].type, null, Math.min(rawFoods[0].count, 4));
        recordDiary(botName, '精錬・調理', `かまどに「${rawFoods[0].name}」と燃料を投入しました。`, bot.entity.position);
        furnace.close();
      } catch (e) {}
      if (bot.clearBotBusy) bot.clearBotBusy();
    }, 2000);
  }
}

/**
 * 高頻度コンパニオンループ (カクつきを解消し、自然な追従・視線・アイテム回収を実現)
 */
function startCompanionLoop(bot) {
  setInterval(async () => {
    if (!bot.entity || bot.customState.isBusy) return;
    // 自律タスク実行中はプレイヤー追従で上書きしない
    if (bot.customState.currentAction !== 'idle' && bot.customState.currentAction !== 'follow') return;

    try {
      const botPos = bot.entity.position;

      // 1. 周囲の敵対モブを最優先で警戒・迎撃準備
      const hostile = bot.nearestEntity(e => e.type === 'mob' && e.kind === 'Hostile' && e.position.distanceTo(botPos) < 12);
      if (hostile) {
        autoEquipAll(bot, 'combat');
        if (bot.pvp && !bot.pvp.target) {
          bot.pvp.attack(hostile);
        }
        return;
      }

      // 2. プレイヤーから投げられたアイテムや近くのドロップ品を自分から回収
      const droppedItem = bot.nearestEntity(e => {
        const isItem = e.name === 'item' || e.type === 'object';
        return isItem && e.position.distanceTo(botPos) < 5.5;
      });

      if (droppedItem) {
        bot.pathfinder.setGoal(new goals.GoalNear(droppedItem.position.x, droppedItem.position.y, droppedItem.position.z, 0.4));
        return;
      }

      // 3. プレイヤーへの自然な追従 (距離が離れたらスムーズについていく)
      const player = bot.nearestEntity(e => e.type === 'player' && e.username !== bot.username);
      if (player) {
        const dist = botPos.distanceTo(player.position);
        if (dist > 6.0) {
          // 少し離れたら自然にダッシュ/歩行で合流
          bot.pathfinder.setGoal(new goals.GoalFollow(player, 2.5), false);
        } else if (dist <= 2.8) {
          // 追いついたら立ち止まって見守る (頻繁なクリアを避けて安定化)
          if (bot.pathfinder.isMoving()) {
            bot.pathfinder.setGoal(null);
          }
          // ときどきプレイヤーへ自然に顔を向ける
          if (Math.random() < 0.3) {
            bot.lookAt(player.position.offset(0, 1.6, 0));
          }
        }
      }
    } catch (e) {}
  }, 1200);
}

/**
 * 3秒おきの視覚スクリーンショット ＋ Minecraft知識ベース(RAG) ＋ 高速行動実行ループ
 */
function startVisionAutonomousLoop(bot, personaKey) {
  const persona = personas[personaKey];
  const botName = persona.name;
  let lastVisionActionTime = 0;
  let lastChatSpokenTime = 0;

  // 3秒間隔で視覚と思考をチェック
  setInterval(async () => {
    if (!bot.entity) return;

    // 行動中（移動中・ブロック破壊中・戦闘中）は割り込まず完了を待つ
    if (bot.customState.isBusy && bot.customState.currentAction !== 'idle') {
      return;
    }

    const now = Date.now();
    // 3秒のインターバルを担保
    if (now - lastVisionActionTime < 3000) return;

    try {
      lastVisionActionTime = now;
      const botPos = bot.entity.position;
      const botState = getBotEnvironmentalState(bot);

      // 1. 直近のチャット履歴を取得し、一人称視線スクリーンショットにHUDオーバーレイ合成
      const recentChats = brain.chatHistory.slice(-4);
      const screenshot = bot.visionCapturer ? await bot.visionCapturer.capture(bot, recentChats) : { base64: null };

      // 2. Vision LLM + 今までの履歴DB + Minecraft知識ベース(RAG) による高速意思決定 (1〜3秒)
      const decision = await brain.thinkWithVision(persona, screenshot.base64, botPos, botState, recentChats);
      if (!decision) return;

      // 3. 行動日誌に「視界認知・参照知識・決定行動」を克明に記録
      const diaryDetail = `【視界】${decision.observed || '周囲確認'} | 【知識】${decision.knowledge_used || '基本サバイバル'} | 【行動】${decision.action} (${decision.reason || '即時実行'})`;
      recordDiary(botName, '視覚・知識意思決定', diaryDetail, botPos);

      // 4. チャット発言（独り言・プレイヤーへの報告、スパム防止で25秒以上の間隔またはモンスター遭遇時）
      const isUrgent = decision.action === 'attack' || decision.action === 'escape_water';
      if (decision.reply && (now - lastChatSpokenTime > 25000 || isUrgent)) {
        bot.chat(decision.reply);
        brain.addHistory(botName, decision.reply);
        lastChatSpokenTime = now;
      }

      // 5. 決定されたアクションを直ちに実行
      console.log(`🤖 [${botName}] 視覚+知識判断完了: ${decision.action} (理由: ${decision.reason || '知識参照'})`);
      executeAction(bot, persona, decision, null);
    } catch (e) {
      // 軽微なエラーは安全にスキップして次サイクルへ
    }
  }, 3000);
}

/**
 * アクション実行ロジック
 */
function executeAction(bot, persona, thought, targetPlayer) {
  if (!bot.pathfinder || !thought) return;
  const { action, target } = thought;
  const botName = persona.name;

  switch (action) {
    case 'craft':
      if (bot.setBotBusy) bot.setBotBusy('craft', 15000);
      craftSurvivalKit(bot);
      break;

    case 'cook':
      cookFoodAtUtility(bot);
      break;

    case 'escape_water':
      bot.setControlState('jump', true);
      const safeLand = bot.findBlock({
        matching: b => b && b.name && !b.name.includes('water') && b.name !== 'air',
        maxDistance: 16
      });
      if (safeLand) {
        bot.pathfinder.setGoal(new goals.GoalNear(safeLand.position.x, safeLand.position.y + 1, safeLand.position.z, 0.5));
      }
      break;

    case 'equip':
      autoEquipAll(bot, 'combat');
      break;

    case 'follow':
      const playerToFollow = targetPlayer || bot.nearestEntity(e => e.type === 'player' && e.username !== bot.username);
      if (playerToFollow) {
        if (bot.setBotBusy) bot.setBotBusy('follow', 10000);
        bot.pathfinder.setGoal(new goals.GoalFollow(playerToFollow, 2.5), true);
      }
      break;

    case 'collect_wood':
      autoEquipAll(bot, 'wood');
      const mcData = require('minecraft-data')(bot.version);
      const logBlocks = bot.findBlocks({
        matching: block => block && block.name && (block.name.includes('_log') || block.name.includes('wood')),
        maxDistance: 24,
        count: 1
      });

      if (logBlocks.length > 0) {
        const targetBlock = bot.blockAt(logBlocks[0]);
        if (targetBlock && bot.collectBlock) {
          if (bot.setBotBusy) bot.setBotBusy('collect_wood', 15000);
          console.log(`[${botName}] 木の伐採を開始: ${targetBlock.name}`);
          bot.collectBlock.collect(targetBlock, err => {
            if (bot.clearBotBusy) bot.clearBotBusy();
            if (!err) {
              recordDiary(botName, '伐採完了', `原木「${targetBlock.name}」の伐採に成功しました。クラフトを試みます。`, bot.entity.position);
              // 伐採できたら直ちにクラフトと装備を試みる
              setTimeout(() => { craftSurvivalKit(bot); }, 800);
            }
          });
        }
      } else {
        if (bot.setBotBusy) bot.setBotBusy('explore', 8000);
        wanderNear(bot);
      }
      break;

    case 'mine':
      autoEquipAll(bot, 'mine');
      const stoneBlocks = bot.findBlocks({
        matching: block => block && block.name && (block.name.includes('stone') || block.name.includes('coal_ore') || block.name.includes('iron_ore')),
        maxDistance: 16,
        count: 1
      });
      if (stoneBlocks.length > 0) {
        const blk = bot.blockAt(stoneBlocks[0]);
        if (blk && bot.collectBlock) {
          if (bot.setBotBusy) bot.setBotBusy('mine', 15000);
          bot.collectBlock.collect(blk, () => {
            if (bot.clearBotBusy) bot.clearBotBusy();
            autoEquipAll(bot, 'combat');
          });
        }
      } else {
        if (bot.setBotBusy) bot.setBotBusy('explore', 8000);
        wanderNear(bot);
      }
      break;

    case 'attack':
      autoEquipAll(bot, 'combat');
      const hostile = bot.nearestEntity(e => e.type === 'mob' && e.kind === 'Hostile' && e.position.distanceTo(bot.entity.position) < 16);
      if (hostile && bot.pvp) {
        console.log(`[${botName}] 敵対モブと戦闘開始: ${hostile.name}`);
        if (bot.setBotBusy) bot.setBotBusy('attack', 12000);
        bot.pvp.attack(hostile);
        recordDiary(botName, '戦闘', `武器を構えてモンスター「${hostile.name}」を迎撃中。`, bot.entity.position);
      }
      break;

    case 'explore':
      if (bot.setBotBusy) bot.setBotBusy('explore', 8000);
      wanderNear(bot);
      break;

    case 'stop':
      if (bot.clearBotBusy) bot.clearBotBusy();
      bot.pathfinder.setGoal(null);
      if (bot.pvp) bot.pvp.stop();
      break;

    default:
      break;
  }
}

function wanderNear(bot) {
  if (!bot.entity) return;
  const rx = bot.entity.position.x + (Math.random() * 18 - 9);
  const rz = bot.entity.position.z + (Math.random() * 18 - 9);
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

