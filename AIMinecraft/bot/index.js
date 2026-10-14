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

// 拠点座標の定義 (ユーザー指定画像 F3: Block 95 63 44 / 看板「拠点」)
const BASE_COORDINATES = {
  x: parseFloat(process.env.BASE_X || '95'),
  y: parseFloat(process.env.BASE_Y || '63'),
  z: parseFloat(process.env.BASE_Z || '44')
};

/**
 * 拠点の位置を特定（看板「拠点」があれば優先、なければ指定座標 95, 63, 44）
 */
function findBaseLocation(bot) {
  const { Vec3 } = require('vec3');
  try {
    const signPositions = bot.findBlocks({
      matching: block => block && block.name && block.name.includes('sign'),
      maxDistance: 32,
      count: 8
    });
    for (const pos of signPositions) {
      const signBlock = bot.blockAt(pos);
      if (signBlock && signBlock.signText && signBlock.signText.includes('拠点')) {
        return signBlock.position;
      }
    }
  } catch (_) {}
  return new Vec3(BASE_COORDINATES.x, BASE_COORDINATES.y, BASE_COORDINATES.z);
}

/**
 * 対象ブロックが木製ドア・フェンスゲート・トラップドアか判定
 * （鉄製ドア・鉄製トラップドアは手動開閉できないため除外）
 */
function isDoorOrGate(block) {
  if (!block || !block.name) return false;
  const n = block.name;
  if (n.includes('iron_door') || n.includes('iron_trapdoor')) return false;
  return n.endsWith('_door') || n.endsWith('_fence_gate') || n.endsWith('_trapdoor');
}

/**
 * ブロックが開いている（open === true）かを判定
 */
function isBlockOpen(block) {
  if (!block) return false;
  try {
    if (typeof block.getProperties === 'function') {
      const props = block.getProperties();
      if (props && props.open !== undefined) {
        return String(props.open) === 'true';
      }
    }
    if (block._properties && block._properties.open !== undefined) {
      return String(block._properties.open) === 'true';
    }
  } catch (_) {}
  return false;
}

/**
 * 個別および統合の行動日誌記録
 */
function recordDiary(botName, actionType, detail, pos = null) {
  try {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ja-JP');
    const isoStr = now.toISOString();
    let posStr = '不明';
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number' && typeof pos.z === 'number') {
      posStr = `${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}`;
    }

    const safeDetail = (detail !== null && detail !== undefined) 
      ? String(detail).replace(/\|/g, '-').replace(/\r?\n/g, ' ') 
      : '詳細なし';
    const row = `| ${timeStr} | \`${posStr}\` | **${actionType}** | ${safeDetail} |\n`;

    // ディレクトリの再確認
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

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
    const combinedRow = `| ${timeStr} | **${botName}** | \`${posStr}\` | ${actionType} | ${safeDetail} |\n`;
    fs.appendFileSync(combinedPath, combinedRow, 'utf8');

    // 直近の日誌記録時刻を更新
    if (activeBots[botName]) {
      activeBots[botName]._lastDiaryTime = Date.now();
    }

    // 3. AIの頭脳（知識・履歴データベース）へも自動蓄積
    try {
      const isChat = actionType.includes('対話') || actionType.includes('発言') || actionType.includes('挨拶');
      const histType = isChat ? 'chat' : 'action';
      brain.knowledgeBase.recordHistory(histType, botName, `${actionType}: ${safeDetail}`, pos);
    } catch (_) {}
  } catch (err) {
    console.error(`[Diary Error - ${botName}] 日誌書き込み例外:`, err.message);
  }
}

/**
 * 定期的な生存・周辺警戒日誌記録ループ (45秒ごと)
 */
function startDiaryHeartbeatLoop(bot, botName) {
  setInterval(() => {
    try {
      if (!bot.entity || bot.isSleeping) return;
      const now = Date.now();
      const lastTime = bot._lastDiaryTime || 0;
      // 直近40秒以内に日誌が記録されていればスキップ
      if (now - lastTime < 40000) return;

      const pos = bot.entity.position;
      const hp = bot.health !== undefined ? Math.round(bot.health) : 20;
      const food = bot.food !== undefined ? Math.round(bot.food) : 20;
      const action = bot.customState ? bot.customState.currentAction : 'idle';
      const looking = bot.blockAtCursor ? (bot.blockAtCursor(4)?.name || '前方警戒') : '探索中';

      recordDiary(botName, '生存・警戒活動', `ステータス健全 (HP:${hp}/20, 満腹度:${food}/20) | 現在の活動: ${action} | 注視: ${looking}`, pos);
    } catch (_) {}
  }, 45000);
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

  const timeOfDay = bot.time ? bot.time.timeOfDay : 0;
  const isSunsetApproaching = bot.time ? (timeOfDay >= 11500 && timeOfDay < 23000) : false;
  const isNight = bot.time ? (timeOfDay >= 13000 && timeOfDay <= 23000) : false;

  return {
    health: bot.health,
    food: bot.food,
    timeOfDay,
    isSunsetApproaching,
    isNight,
    isSleeping: bot.isSleeping || false,
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
    if (bot.isSleeping) return; // 就寝中はベッドで安全に休むため解除しない
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
 * 村人と同様のドア・柵（フェンスゲート）・トラップドア自動開閉ループ
 * 1. 進行方向の閉じたドア/ゲートに近づいた際、右クリックで開けて通り抜ける
 * 2. 通過後、振り返って必ずドア/ゲートを閉める（モンスター侵入防止・村人アクション）
 */
function startVillagerDoorLoop(bot) {
  const openedDoors = new Map(); // posKey -> { block, openedAt, botPosAtOpen }
  const doorCooldowns = new Map(); // posKey -> lastToggledTime
  let isToggling = false;

  setInterval(async () => {
    if (!bot.entity || bot.isSleeping || isToggling) return;
    const botPos = bot.entity.position;
    const now = Date.now();

    // 1. 通過後のドア・フェンスゲートを閉める（村人の最重要行動）
    for (const [posKey, info] of openedDoors.entries()) {
      const doorPos = info.block.position;
      const currentBlock = bot.blockAt(doorPos);

      // ブロックが破壊されたか別のブロックになった場合
      if (!currentBlock || !isDoorOrGate(currentBlock)) {
        openedDoors.delete(posKey);
        continue;
      }

      const dist = botPos.distanceTo(doorPos);
      const timeSinceOpen = now - info.openedAt;

      // ドアがまだ開いていて、Botが通り抜けて少し離れた（1.3m〜3.2m以内）かつ400ms以上経過
      if (isBlockOpen(currentBlock)) {
        if (timeSinceOpen > 400 && dist >= 1.3 && dist <= 3.2) {
          // 周囲1.2m以内に他のBotやプレイヤーがいないか確認（挟み込み防止）
          const isAnotherPlayerClose = Object.values(bot.entities).some(e => {
            if (!e || e === bot.entity) return false;
            return (e.type === 'player' || e.type === 'mob') && e.position.distanceTo(doorPos) < 1.2;
          });

          if (!isAnotherPlayerClose) {
            isToggling = true;
            try {
              await bot.lookAt(doorPos.offset(0.5, 0.5, 0.5));
              await bot.activateBlock(currentBlock);
              doorCooldowns.set(posKey, now);
              openedDoors.delete(posKey);
              console.log(`🚪 [${bot.username}] 通過後に${currentBlock.name}を閉めました（村人アクション）。`);
              recordDiary(bot.username, '村人ドア閉め', `通過後に${currentBlock.name}を閉めました。`, botPos);
            } catch (_) {}
            isToggling = false;
            return;
          }
        }
      } else {
        // すでに誰かが閉めた場合
        openedDoors.delete(posKey);
      }

      // 10秒以上経過した古い追跡は削除
      if (timeSinceOpen > 10000) {
        openedDoors.delete(posKey);
      }
    }

    // 2. 進行方向の閉じたドア・フェンスゲートを開ける
    // 周囲2.5m以内の閉じたドア・ゲートを探索
    const nearbyDoorPos = bot.findBlocks({
      matching: block => {
        if (!isDoorOrGate(block)) return false;
        return !isBlockOpen(block);
      },
      maxDistance: 2.6,
      count: 3
    });

    if (nearbyDoorPos.length > 0) {
      for (const pos of nearbyDoorPos) {
        const posKey = `${pos.x},${pos.y},${pos.z}`;
        const lastToggle = doorCooldowns.get(posKey) || 0;
        if (now - lastToggle < 800) continue; // 連続操作防止

        const doorBlock = bot.blockAt(pos);
        if (!doorBlock || isBlockOpen(doorBlock)) continue;

        const dist = botPos.distanceTo(pos);
        if (dist <= 2.4) {
          isToggling = true;
          try {
            await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
            await bot.activateBlock(doorBlock);
            doorCooldowns.set(posKey, now);
            openedDoors.set(posKey, {
              block: doorBlock,
              openedAt: now,
              botPosAtOpen: botPos.clone()
            });
            console.log(`🚪 [${bot.username}] 前方の${doorBlock.name}を開けました。`);
            recordDiary(bot.username, '村人ドア開け', `前方の${doorBlock.name}を開けて通り抜けます。`, botPos);
          } catch (_) {}
          isToggling = false;
          break;
        }
      }
    }
  }, 250);
}

/**
 * 周囲のドア・フェンスゲートを開閉するヘルパー
 */
async function toggleNearbyDoors(bot, closeOnly = false) {
  const nearbyDoorPos = bot.findBlocks({
    matching: block => isDoorOrGate(block),
    maxDistance: 4.5,
    count: 5
  });
  if (nearbyDoorPos.length === 0) {
    bot.chat('周囲にドアやフェンスゲートが見当たりません。');
    return;
  }
  let count = 0;
  for (const pos of nearbyDoorPos) {
    const blk = bot.blockAt(pos);
    if (!blk) continue;
    const open = isBlockOpen(blk);
    if (closeOnly && !open) continue; // 閉じる指示で既に閉じているならスキップ
    try {
      await bot.lookAt(pos.offset(0.5, 0.5, 0.5));
      await bot.activateBlock(blk);
      count++;
      await new Promise(r => setTimeout(r, 200));
    } catch (_) {}
  }
  if (count > 0) {
    bot.chat(closeOnly ? 'ドア・フェンスゲートを閉めました！' : 'ドア・フェンスゲートを操作しました！');
  }
}

/**
 * 障害物迂回・スマート脱出ループ (Smart Obstacle Bypass & Detour System)
 * 進行方向にブロックや段差などの障害物がある際、壊さずに
 * 「段差のジャンプ乗り越え」「サイドステップによる回り込み」「後退して別ルート再計算」を実行
 */
function startSmartObstacleBypassLoop(bot) {
  let lastPos = null;
  let stuckCount = 0;
  let isBypassing = false;

  setInterval(async () => {
    if (!bot.entity || bot.isSleeping || isBypassing) return;
    const currentPos = bot.entity.position;

    // パスファインダーが移動中、または移動速度がある場合
    const isMoving = (bot.pathfinder && bot.pathfinder.isMoving()) ||
                     (bot.entity.velocity && bot.entity.velocity.norm() > 0.01);

    if (isMoving && lastPos) {
      const movedDist = currentPos.distanceTo(lastPos);

      // 移動中判定なのに1秒間でほぼ前進していない（障害物に引っかかっている）
      if (movedDist < 0.12) {
        stuckCount++;
      } else {
        stuckCount = Math.max(0, stuckCount - 1);
        bot.setControlState('jump', false);
      }

      // 1.5秒〜2秒以上引っかかった場合（障害物に直面）
      if (stuckCount >= 3) {
        stuckCount = 0;
        isBypassing = true;

        try {
          const yaw = bot.entity.yaw;

          // 1. まず1ブロックの段差をジャンプで乗り越えられるか試行（壊さずに飛び越える）
          bot.setControlState('jump', true);
          await new Promise(r => setTimeout(r, 300));
          bot.setControlState('jump', false);

          // 2. 依然として進めない場合、左右どちらかにサイドステップして障害物の角を回り込む（迂回）
          const sideAngle = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
          const detourAngle = yaw + sideAngle;
          const detourX = currentPos.x - Math.sin(detourAngle) * 1.6;
          const detourZ = currentPos.z + Math.cos(detourAngle) * 1.6;

          console.log(`🔄 [${bot.username}] 障害物を検知。ブロックを壊さず横へ迂回します (${Math.round(detourX)}, ${Math.round(detourZ)})`);
          recordDiary(bot.username, '障害物迂回', '進路上の障害物を壊さず、横へ回り込んで迂回移動しました。', currentPos);

          // 現在の目標ゴールを保持
          const currentGoal = bot.pathfinder.goal;

          // 横方向へ短距離迂回
          bot.pathfinder.setGoal(new goals.GoalNear(detourX, currentPos.y, detourZ, 0.6));
          await new Promise(r => setTimeout(r, 1000));

          // 元のゴールがあれば再設定（別の経路から再探索）
          if (currentGoal) {
            bot.pathfinder.setGoal(currentGoal);
          }
        } catch (_) {}

        isBypassing = false;
      }
    } else {
      stuckCount = 0;
    }

    lastPos = currentPos.clone();
  }, 500);
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
    busyTimer: null,
    routineState: 'day', // 'day' | 'night' | 'sleeping'
    lastRoutineDay: -1
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

    // パスファインダー設定 (障害物を壊さず、迂回・ジャンプ・パルクールでスマートに進む)
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    defaultMove.canDig = false; // 障害物を壊すことを禁止！迂回路・回り道を最優先で探索
    defaultMove.allowParkour = true; // 1ブロックの段差や溝をジャンプして乗り越える
    defaultMove.allowSprinting = true; // 追従・移動時にダッシュ
    defaultMove.liquidCost = 5; // 溺死やマグマ侵入防止
    defaultMove.canOpenDoors = true; // 村人と同様のドア・フェンスゲート開閉通行を有効化

    // 草・花・ツタなど当たり判定のないブロックを「壊さずにそのまま通行可能」として登録
    if (defaultMove.passableBlocks) {
      Object.values(mcData.blocks).forEach(b => {
        if (!b || !b.name) return;
        const n = b.name;
        if (n.includes('grass') || n.includes('flower') || n.includes('fern') ||
            n.includes('tulip') || n.includes('rose') || n.includes('daisy') ||
            n.includes('orchid') || n.includes('allium') || n.includes('dandelion') ||
            n.includes('vine') || n.includes('hanging_roots') || n.includes('sapling') ||
            n.includes('carpet') || n === 'torch' || n === 'wall_torch') {
          defaultMove.passableBlocks.add(b.id);
        }
      });
    }

    // フェンスゲートや木製ドア・トラップドアを開閉・通行可能リストに登録
    if (defaultMove.doors) {
      Object.values(mcData.blocks).forEach(b => {
        if (b && isDoorOrGate(b)) {
          defaultMove.doors.add(b.id);
        }
      });
    }

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
    } else {
      console.warn(`[${botName}] prismarine-viewer未ロードのためWeb配信スキップ (代替HUD機能で動作中)`);
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

    // 村人と同様のドア・柵（フェンスゲート）の自動開閉＆通過後閉鎖ループ
    startVillagerDoorLoop(bot);

    // 障害物非破壊・スマート迂回（回り込み・ジャンプ脱出）ループ
    startSmartObstacleBypassLoop(bot);

    // 日没・夕暮れ時の拠点帰還＆チェスト全収納＆ベッド就寝、朝の探検出発ルーチン監視
    startTimeWatcher(bot, personaKey, index);

    // 定期的な生存・周辺警戒日誌記録ループ (45秒ごと)
    startDiaryHeartbeatLoop(bot, botName);

    // 3秒おきの視覚＋知識ベース(RAG)自律意思決定＆高速行動ループ
    setTimeout(() => {
      startVisionAutonomousLoop(bot, personaKey);
    }, 8000 + index * 2500);
  });

  // インベントリ更新イベント (bot.inventory はスポーン後に生成されるため spawn イベントで監視登録)
  let equipDebounce = null;
  bot.on('spawn', () => {
    try {
      if (bot.inventory && typeof bot.inventory.on === 'function' && !bot.inventory._hasAutoEquipListener) {
        bot.inventory._hasAutoEquipListener = true;
        bot.inventory.on('updateSlot', (slot, oldItem, newItem) => {
          if (equipDebounce) clearTimeout(equipDebounce);
          equipDebounce = setTimeout(() => {
            try { autoEquipAll(bot, 'idle'); } catch (_) {}
          }, 300);
        });
      }
    } catch (_) {}
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

    // 0. 即時チャットコマンドの判定 (LLM推論を待たずに即時実行)
    const strippedMsg = cleanMessage.replace(/[@＠][a-zA-Z0-9_\u3040-\u30ff\u4e00-\u9faf]+/g, '').trim();
    if (strippedMsg.startsWith('!drop') || strippedMsg.startsWith('!give')) {
      const parts = strippedMsg.split(/\s+/);
      const targetItem = parts[1] || 'all';
      bot.chat(`所持品をお渡しします！`);
      recordDiary(botName, 'コマンド実行', `!drop/!giveコマンドによりプレイヤーへアイテム受け渡しを開始。`, bot.entity.position);
      giveItemsToPlayer(bot, playerEntity, targetItem);
      return;
    }
    if (strippedMsg.startsWith('!base') || strippedMsg.startsWith('!sleep') || strippedMsg.startsWith('!拠点') || strippedMsg.startsWith('!寝て') || strippedMsg.startsWith('!おやすみ')) {
      bot.chat(`拠点(95, 63, 44)へ戻り、所持品をチェストへ預けて寝ます！`);
      recordDiary(botName, 'コマンド実行', `!base/!sleepコマンドにより拠点帰還＆チェスト収納＆就寝を開始。`, bot.entity.position);
      executeNightRoutine(bot, personaKey);
      return;
    }
    if (strippedMsg.startsWith('!explore') || strippedMsg.startsWith('!探検') || strippedMsg.startsWith('!冒険')) {
      bot.chat(`チェストには触らず、所持品空っぽのまま探検に出発します！`);
      recordDiary(botName, 'コマンド実行', `!exploreコマンドにより手ぶら探検を開始。`, bot.entity.position);
      executeMorningRoutine(bot, personaKey);
      return;
    }
    if (strippedMsg.startsWith('!door') || strippedMsg.startsWith('!gate') || strippedMsg.startsWith('!ドア') || strippedMsg.startsWith('!ゲート')) {
      const isClose = strippedMsg.includes('close') || strippedMsg.includes('閉') || strippedMsg.includes('しめ');
      bot.chat(isClose ? '周囲のドア・フェンスゲートを閉めます！' : '周囲のドア・フェンスゲートを開閉します！');
      toggleNearbyDoors(bot, isClose);
      return;
    }

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
 * プレイヤーに近づいて指定アイテム（または全所持品）をドロップして手渡す
 */
async function giveItemsToPlayer(bot, targetPlayer, targetItem = 'all') {
  if (!bot.entity || !bot.inventory) return;
  const botName = bot.username;
  if (bot.setBotBusy) bot.setBotBusy('give', 15000);

  try {
    // プレイヤーが明示されていない場合、最寄りの他プレイヤーを特定
    let recipient = targetPlayer;
    if (!recipient || !recipient.position) {
      recipient = bot.nearestEntity(e => e.type === 'player' && e.username !== bot.username);
    }

    if (recipient && recipient.position) {
      // プレイヤーの近く（約2ブロック）まで移動して顔を向ける
      try {
        bot.pathfinder.setGoal(new goals.GoalNear(recipient.position.x, recipient.position.y, recipient.position.z, 2.0));
        // 到着まで少し待機 (最大2秒)
        for (let i = 0; i < 10; i++) {
          if (!bot.entity) break;
          if (bot.entity.position.distanceTo(recipient.position) <= 2.8) break;
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (_) {}

      try {
        await bot.lookAt(recipient.position.offset(0, 1.4, 0));
      } catch (_) {}
    }

    const allItems = bot.inventory.items();
    if (!allItems || allItems.length === 0) {
      bot.chat('渡せるアイテムを持っていません。');
      if (bot.clearBotBusy) bot.clearBotBusy();
      return;
    }

    const filter = (typeof targetItem === 'string' && targetItem !== 'all' && targetItem !== 'null' && targetItem !== '')
      ? targetItem.toLowerCase()
      : null;

    const targetItems = allItems.filter(item => {
      if (!filter) return true;
      const n = item.name.toLowerCase();
      if (n.includes(filter)) return true;
      if (filter.includes('木') || filter.includes('wood') || filter.includes('log')) {
        return n.includes('log') || n.includes('wood') || n.includes('planks');
      }
      if (filter.includes('石') || filter.includes('stone') || filter.includes('cobble')) {
        return n.includes('stone') || n.includes('cobble');
      }
      if (filter.includes('鉄') || filter.includes('iron')) {
        return n.includes('iron');
      }
      if (filter.includes('肉') || filter.includes('food') || filter.includes('食') || filter.includes('飯')) {
        return n.includes('beef') || n.includes('pork') || n.includes('mutton') || n.includes('chicken') || n.includes('bread') || n.includes('apple') || n.includes('fish');
      }
      if (filter.includes('鉱石') || filter.includes('ore')) {
        return n.includes('ore') || n.includes('raw_') || n.includes('coal') || n.includes('iron') || n.includes('copper') || n.includes('gold') || n.includes('diamond');
      }
      return false;
    });

    if (targetItems.length === 0) {
      bot.chat(`「${targetItem}」は持っていません。`);
      if (bot.clearBotBusy) bot.clearBotBusy();
      return;
    }

    // 自身が落としたアイテムを直後に再回収しないようクールダウンを設定
    bot.customState.lastDroppedTime = Date.now();

    let droppedCount = 0;
    for (const item of targetItems) {
      try {
        const current = bot.inventory.items().find(i => i.type === item.type);
        if (current) {
          await bot.tossStack(current);
          droppedCount += current.count;
          await new Promise(r => setTimeout(r, 150));
        }
      } catch (err) {}
    }

    if (droppedCount > 0) {
      console.log(`🎁 [${botName}] プレイヤーへアイテム (${droppedCount}個) をドロップしました。`);
      recordDiary(botName, 'アイテム受け渡し', `プレイヤーへアイテム (${droppedCount}個) をドロップして渡しました。`, bot.entity.position);

      // プレイヤーが足元のアイテムを拾いやすいよう、少し後退
      if (recipient && recipient.position && bot.entity) {
        try {
          const diff = bot.entity.position.minus(recipient.position);
          diff.y = 0;
          if (diff.norm() > 0.1) {
            const backPos = bot.entity.position.plus(diff.normalize().scaled(2.0));
            bot.pathfinder.setGoal(new goals.GoalNear(backPos.x, backPos.y, backPos.z, 0.5));
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    console.error(`[${botName}] アイテム受け渡し中にエラー:`, e.message);
  } finally {
    if (bot.clearBotBusy) bot.clearBotBusy();
  }
}

/**
 * 拠点内の最寄りチェストに全所持品・装備品をすべて収納してインベントリを空にする
 */
async function depositAllItemsToChest(bot, basePos) {
  if (!bot.entity || !bot.inventory) return false;
  const botName = bot.username;
  const mcData = require('minecraft-data')(bot.version);

  console.log(`📦 [${botName}] 最寄りのチェストを探索中...`);

  // 1. 装備品（頭・胴・脚・足・オフハンド・メインハンド）をすべて外してインベントリに戻す
  const equipSlots = ['head', 'torso', 'legs', 'feet', 'off-hand', 'hand'];
  for (const slot of equipSlots) {
    try {
      await bot.unequip(slot);
      await new Promise(r => setTimeout(r, 100));
    } catch (_) {}
  }

  // 2. 拠点周辺（半径16ブロック以内）のチェストを探索
  const chestBlock = bot.findBlock({
    matching: [
      mcData.blocksByName.chest?.id,
      mcData.blocksByName.trapped_chest?.id,
      mcData.blocksByName.barrel?.id
    ].filter(Boolean),
    maxDistance: 16
  });

  if (!chestBlock) {
    console.warn(`⚠️ [${botName}] 拠点付近にチェストが見つかりませんでした。`);
    recordDiary(botName, 'チェスト探索', '拠点付近にチェストが見つかりませんでした。', bot.entity.position);
    return false;
  }

  // 3. チェストに近づく（約1.8ブロック）
  try {
    bot.pathfinder.setGoal(new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 1.8));
    for (let i = 0; i < 20; i++) {
      if (!bot.entity) break;
      if (bot.entity.position.distanceTo(chestBlock.position) <= 2.5) break;
      await new Promise(r => setTimeout(r, 200));
    }
    bot.pathfinder.setGoal(null);
    await bot.lookAt(chestBlock.position.offset(0.5, 0.5, 0.5));
  } catch (_) {}

  // 4. チェストを開いてすべての所持品を預ける
  let chest = null;
  try {
    chest = await bot.openContainer(chestBlock);
  } catch (err) {
    console.warn(`[${botName}] チェストを開けませんでした:`, err.message);
    return false;
  }

  let depositedCount = 0;
  try {
    const items = bot.inventory.items();
    for (const item of items) {
      try {
        const currentItem = bot.inventory.items().find(i => i.type === item.type);
        if (currentItem) {
          await chest.deposit(currentItem.type, null, currentItem.count);
          depositedCount += currentItem.count;
          await new Promise(r => setTimeout(r, 120));
        }
      } catch (depErr) {
        console.warn(`[${botName}] アイテム預け入れスキップ (${item.name}):`, depErr.message);
      }
    }
  } finally {
    try {
      chest.close();
    } catch (_) {}
  }

  console.log(`✅ [${botName}] チェストへの全アイテム収納完了 (${depositedCount}個)`);
  recordDiary(botName, 'チェスト収納完了', `最寄りのチェストに全ての所持品 (${depositedCount}個) を収納しました。インベントリを空にしました。`, bot.entity.position);
  bot.chat('所持品をすべてチェストに預けました！');
  return true;
}

/**
 * 拠点内のベッドを探して就寝可能時刻に就寝
 */
async function goToBedAndSleep(bot, basePos, personaKey) {
  if (!bot.entity) return false;
  const botName = bot.username;

  console.log(`🛏️ [${botName}] ベッドを探索中...`);

  // 周囲のベッドを検索
  const bedBlockPositions = bot.findBlocks({
    matching: block => block && block.name && block.name.endsWith('_bed'),
    maxDistance: 16,
    count: 8
  });

  if (!bedBlockPositions || bedBlockPositions.length === 0) {
    console.warn(`⚠️ [${botName}] 拠点付近にベッドが見つかりませんでした。拠点内で安全に朝を待ちます。`);
    recordDiary(botName, '待機', 'ベッドが見当たらないため、拠点内で朝まで警戒待機します。', bot.entity.position);
    bot.chat('ベッドが見当たらないため、拠点内で見張りをして朝を待ちますね。');
    return false;
  }

  // 他のBotがすでに就寝中または接近中のベッドを避けて選択
  let chosenBedPos = null;
  for (const bPos of bedBlockPositions) {
    const isOccupied = Object.values(activeBots).some(otherBot => {
      if (otherBot === bot || !otherBot.entity) return false;
      return (otherBot.isSleeping || otherBot.customState?.targetBedPos?.equals?.(bPos)) &&
        otherBot.entity.position.distanceTo(bPos) < 2.0;
    });
    if (!isOccupied) {
      chosenBedPos = bPos;
      break;
    }
  }
  if (!chosenBedPos) chosenBedPos = bedBlockPositions[0];
  bot.customState.targetBedPos = chosenBedPos;

  const bedBlock = bot.blockAt(chosenBedPos);

  // ベッドに接近
  try {
    bot.pathfinder.setGoal(new goals.GoalNear(chosenBedPos.x, chosenBedPos.y, chosenBedPos.z, 1.4));
    for (let i = 0; i < 20; i++) {
      if (!bot.entity) break;
      if (bot.entity.position.distanceTo(chosenBedPos) <= 1.8) break;
      await new Promise(r => setTimeout(r, 200));
    }
    bot.pathfinder.setGoal(null);
    await bot.lookAt(chosenBedPos.offset(0.5, 0.5, 0.5));
  } catch (_) {}

  // 就寝可能時刻（12542 ticks）までベッド横で待機
  const startWait = Date.now();
  while (bot.time && (bot.time.timeOfDay < 12542 || bot.time.timeOfDay > 23000) && !bot.isRaining) {
    if (Date.now() - startWait > 60000) break; // 最大1分待機
    await new Promise(r => setTimeout(r, 1000));
  }

  // 就寝を試みる
  for (let attempt = 0; attempt < 5; attempt++) {
    if (bot.isSleeping) break;
    try {
      await bot.sleep(bedBlock);
      console.log(`😴 [${botName}] ベッドに入り就寝しました。`);
      recordDiary(botName, '就寝', '拠点のベッドで眠りにつきました。', bot.entity.position);
      bot.chat('おやすみなさい…朝まで寝ます。');
      break;
    } catch (sleepErr) {
      console.warn(`[${botName}] 就寝試行 (${attempt + 1}/5):`, sleepErr.message);
      if (sleepErr.message.includes('monsters')) {
        // 周囲のモンスターを迎撃
        const mob = bot.nearestEntity(e => e.type === 'mob' && e.kind === 'Hostile' && e.position.distanceTo(bot.entity.position) < 8);
        if (mob && bot.pvp) {
          bot.pvp.attack(mob);
          await new Promise(r => setTimeout(r, 4000));
        }
      } else {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  return true;
}

/**
 * 日没ルーチン:
 * 1. 拠点(95, 63, 44)へ戻る
 * 2. 最寄りのチェストに全ての所持品を入れ込む
 * 3. ベッドで寝る
 */
async function executeNightRoutine(bot, personaKey) {
  const persona = personas[personaKey] || { name: bot.username };
  const botName = persona.name;
  if (!bot.entity) return;

  bot.setBotBusy('night_routine', 120000);
  console.log(`🌇 [${botName}] 日没が近づきました。拠点(95, 63, 44)へ帰還を開始します。`);

  const sunsetQuotes = {
    Gemini: '日が暮れてきましたね。安全のため、座標(95, 63, 44)の拠点に戻って荷物を整理し、休みましょう。',
    ChatGPT: '日没が近づいています！拠点に帰還して、集めた物資をチェストに預けてベッドで寝る準備をしますね。',
    Claude: '夕暮れです。モンスターの活動が活発になる前に拠点へ戻り、所持品をチェストへ納めて就寝しましょう。',
    Grok: 'おっと、太陽が沈みそうだぜ！拠点に戻って戦利品をチェストにぶち込んで、ベッドでグッスリ眠るぜ！'
  };
  bot.chat(sunsetQuotes[personaKey] || '日が沈む前に拠点へ戻り、荷物をチェストに預けて寝ます！');
  recordDiary(botName, '日没・拠点帰還', '日没が近づいたため、指定座標(95, 63, 44)の拠点へ帰還を開始しました。', bot.entity.position);

  // 1. 拠点へ移動
  const baseTarget = findBaseLocation(bot);
  try {
    bot.pathfinder.setGoal(new goals.GoalNear(baseTarget.x, baseTarget.y, baseTarget.z, 2.5));
    const arriveStart = Date.now();
    while (bot.entity && bot.entity.position.distanceTo(baseTarget) > 3.5) {
      if (Date.now() - arriveStart > 40000) break;
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (err) {
    console.warn(`[${botName}] 拠点移動注意:`, err.message);
  }

  // 2. 最寄りのチェストに全ての所持品を入れ込み
  await depositAllItemsToChest(bot, baseTarget);

  // 3. ベッドで寝る
  await goToBedAndSleep(bot, baseTarget, personaKey);
}

/**
 * 朝のルーチン:
 * 朝が来たら、チェストの中身を取ることはせず、所持品が空っぽのまま探検する
 */
function executeMorningRoutine(bot, personaKey) {
  const persona = personas[personaKey] || { name: bot.username };
  const botName = persona.name;
  if (!bot.entity) return;

  // 起床しているか確認（寝ていたら起こす）
  if (bot.isSleeping) {
    try {
      bot.wake();
    } catch (_) {}
  }

  console.log(`🌅 [${botName}] 朝が来ました！所持品は空っぽのまま探検に出発します。`);

  const morningQuotes = {
    Gemini: 'おはようございます！朝になりましたね。チェストの物は取らず、身軽な状態のまま探検を始めましょう！',
    ChatGPT: 'おはようございます！夜が明けました。所持品は空っぽのまま、新たな探検に出発します！',
    Claude: '気持ちの良い朝ですね。チェストの中身はそのままで、手ぶらで周囲の探検へ出かけましょう。',
    Grok: 'よっしゃ朝だぜ！チェストのアイテムには手を付けず、身一つで大冒険の始まりだ！'
  };

  bot.chat(morningQuotes[personaKey] || '朝が来ました！チェストには触らず、所持品が空っぽのまま探検に出発します！');
  recordDiary(botName, '朝の探検出発', '朝を迎えました。チェストのアイテムは取らず、所持品が空っぽのまま周辺の探検に出発しました。', bot.entity.position);

  if (bot.clearBotBusy) bot.clearBotBusy();
  bot.customState.targetBedPos = null;

  // 拠点から離れる方向（20〜35ブロック先）へ探検出発
  setTimeout(() => {
    exploreOutward(bot);
  }, 1500);
}

/**
 * 拠点から離れた外側へ探検移動する
 */
function exploreOutward(bot) {
  if (!bot.entity) return;
  const baseTarget = findBaseLocation(bot);

  // 拠点から外側へランダムな角度で20〜35ブロック離れた座標を計算
  const angle = Math.random() * Math.PI * 2;
  const dist = 22 + Math.random() * 15;
  const targetX = Math.round(baseTarget.x + Math.cos(angle) * dist);
  const targetZ = Math.round(baseTarget.z + Math.sin(angle) * dist);
  const targetY = bot.entity.position.y;

  console.log(`🧭 [${bot.username}] 拠点から探検へ出発: 目標 (${targetX}, ${targetY}, ${targetZ})`);
  bot.pathfinder.setGoal(new goals.GoalNear(targetX, targetY, targetZ, 2.0));
}

/**
 * 日没と朝の時間をリアルタイム監視するウォッチャー
 */
function startTimeWatcher(bot, personaKey, index) {
  let isExecutingRoutine = false;

  bot.on('time', async () => {
    if (!bot.entity || !bot.time) return;

    const timeOfDay = bot.time.timeOfDay;
    const currentDay = Math.floor(bot.time.age / 24000);

    // 1. 日没が近づいた（夕暮れ: 11500 ticks 〜 23000 ticks）
    const isSunsetApproaching = timeOfDay >= 11500 && timeOfDay < 23000;

    if (isSunsetApproaching && bot.customState.routineState !== 'night' && bot.customState.lastRoutineDay !== currentDay) {
      if (isExecutingRoutine) return;
      isExecutingRoutine = true;
      bot.customState.routineState = 'night';
      bot.customState.lastRoutineDay = currentDay;

      // 各Botが順番にチェスト・ベッドへ向かうようスタッガー待機
      const delayMs = index * 2500;
      setTimeout(async () => {
        try {
          await executeNightRoutine(bot, personaKey);
        } catch (e) {
          console.error(`[${bot.username}] 夜ルーチン実行エラー:`, e.message);
        } finally {
          isExecutingRoutine = false;
        }
      }, delayMs);
    }

    // 2. 朝が来た（日の出後: 0 ticks 〜 11500 ticks）
    const isMorning = timeOfDay >= 0 && timeOfDay < 11500;
    if (isMorning && bot.customState.routineState === 'night') {
      bot.customState.routineState = 'day';
      executeMorningRoutine(bot, personaKey);
    }
  });

  // 起床イベント（ベッドから起きた時）
  bot.on('wake', () => {
    console.log(`☀️ [${botName}] 目が覚めました。`);
    if (bot.customState.routineState === 'night') {
      bot.customState.routineState = 'day';
      setTimeout(() => {
        executeMorningRoutine(bot, personaKey);
      }, 1000 + index * 1000);
    }
  });
}

/**
 * 高頻度コンパニオンループ (カクつきを解消し、自然な追従・視線・アイテム回収を実現)
 */
function startCompanionLoop(bot) {
  setInterval(async () => {
    if (!bot.entity || bot.customState.isBusy || bot.isSleeping) return;
    if (bot.customState.currentAction === 'night_routine') return;
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

      // 2. プレイヤーから投げられたアイテムや近くのドロップ品を自分から回収 (直近にアイテムを渡した後は6秒間自粛)
      const canCollect = !bot.customState.lastDroppedTime || (Date.now() - bot.customState.lastDroppedTime > 6000);
      const droppedItem = canCollect ? bot.nearestEntity(e => {
        const isItem = e.name === 'item' || e.type === 'object';
        return isItem && e.position.distanceTo(botPos) < 5.5;
      }) : null;

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
    if (!bot.entity || bot.isSleeping) return;
    if (bot.customState.currentAction === 'night_routine') return;

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
      console.warn(`[VisionLoop - ${botName}] 意思決定スキップ (${e.message})`);
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
    case 'return_base':
      executeNightRoutine(bot, persona.name);
      break;

    case 'explore_morning':
      executeMorningRoutine(bot, persona.name);
      break;

    case 'give':
      const recipient = targetPlayer || bot.nearestEntity(e => e.type === 'player' && e.username !== bot.username);
      giveItemsToPlayer(bot, recipient, target);
      break;

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

