/**
 * brain.js - AIPlayer自律意思決定＆動的チャット生成エンジン
 * 0円ローカル推論 (Ollama / vLLM) および Google AI Studio (Gemini Free Tier)
 * テンプレート文返信を完全排除し、文脈と状況に応じた動的生成を保証
 */

const axios = require('axios');
const knowledgeBase = require('./knowledge_base');

class AIBrain {
  constructor(options = {}) {
    this.apiUrl = process.env.LLM_API_URL || 'http://localhost:8000/v1/chat/completions';
    this.geminiApiKey = process.env.GEMINI_API_KEY || '';
    this.modelName = process.env.LLM_MODEL || 'qwen2.5:1.5b';
    this.chatHistory = [];
    this.maxHistory = 20;
    this.knowledgeBase = knowledgeBase;
  }

  addHistory(sender, text) {
    this.chatHistory.push({
      sender,
      text,
      time: new Date().toLocaleTimeString('ja-JP')
    });
    if (this.chatHistory.length > this.maxHistory) {
      this.chatHistory.shift();
    }
  }

  getFormattedHistory() {
    return this.chatHistory.map(h => `[${h.time}] ${h.sender}: ${h.text}`).join('\n');
  }

  /**
   * メンション判定
   */
  isMentioned(message, personaKey, persona) {
    const raw = message.trim();
    const lower = raw.toLowerCase();

    // 全体メンション・集合の判定 (全角半角・カタカナひらがな対応)
    const broadcastKeywords = [
      '@all', '@everyone', '@全員', '@みんな', '@bot', '@ai',
      '＠all', '＠everyone', '＠全員', '＠みんな', '＠bot', '＠ai',
      'みんな', '全員', '全員集合', '集合', 'お前ら', 'bot達', 'ai達'
    ];
    if (broadcastKeywords.some(kw => lower.includes(kw.toLowerCase()))) {
      return { mentioned: true, isBroadcast: true };
    }

    // 個別メンション判定
    const matches = persona.aliases.some(alias => lower.includes(alias.toLowerCase()));
    return { mentioned: matches, isBroadcast: false };
  }

  /**
   * ユーザーからのチャットに対する思考・返答・アクション決定
   */
  async thinkChat(persona, userMessage, playerPos, botPos, botState = {}) {
    this.addHistory('User', userMessage);

    // 1. 会話を履歴データベースへ記録
    this.knowledgeBase.recordHistory('chat', 'User', userMessage, playerPos);

    // 2. 関連するMinecraft知識を検索
    const knowledgeList = this.knowledgeBase.search(userMessage, botState, 2);
    const knowledgeSection = this.knowledgeBase.formatForPrompt(knowledgeList);

    // 3. 今までの会話・行動履歴データベースを検索
    const historyList = this.knowledgeBase.searchHistory(userMessage, botState, 6);
    const historyDbText = this.knowledgeBase.formatHistoryForPrompt(historyList);

    const historyStr = this.getFormattedHistory();
    const systemPrompt = `
${persona.systemPrompt}
あなたは「${persona.name}」として、プレイヤーのチャットに応答し、ゲーム内でどう行動するかを決定します。

【現在の状況・環境】
- あなたの位置: X:${Math.round(botPos.x)}, Y:${Math.round(botPos.y)}, Z:${Math.round(botPos.z)}
- プレイヤーの位置: X:${Math.round(playerPos.x)}, Y:${Math.round(playerPos.y)}, Z:${Math.round(playerPos.z)}
- あなたのHP: ${botState.health || 20}/20, 空腹度: ${botState.food || 20}/20
- 現在の状態: ${botState.isInWater ? '⚠️ 水没中 (息継ぎ・浮上必要)' : botState.isInLava ? '🚨 溶岩に接触 (緊急退避必要)' : '陸上 (安全)'}
- 酸素残量: ${botState.oxygenLevel || 20}/20
- 周囲の設備: ${botState.nearbyUtilities?.join(', ') || 'なし (持ち運び作業台を使用)'}
- 周囲の敵対モブ: ${botState.hostileMobs?.join(', ') || 'なし'}
- 時間帯: ${botState.isNight ? '夜 (危険)' : '昼 (安全)'}
- 拠点の正確な領域: X:[92, 97], Y:[62, 68], Z:[39, 47] (玄関ドア: 94, 63, 39 北向き、屋内歩行可能領域: X:[93, 96], Y:63, Z:[40, 46])

【今までの行動・会話履歴データベース (参照必須)】
${historyDbText}

【Minecraftサバイバル知識ベース (参照)】
${knowledgeSection || '基本サバイバル手順に従う'}

【直近の会話履歴】
${historyStr}

【あなたの行動選択肢 (action)】
- "chat": 会話・情報共有
- "follow": プレイヤーについていく、合流する
- "ferry": フェリー（木製ボート）をクラフトし、川や水面に浮かべて乗船・水上航行する
- "explore_river": 拠点に留まらず、川沿い（水流・両岸）を中心に100〜200ブロック以上の遠方まで探検する
- "craft_tools": 原木と丸石を集め、作業台で基本ツール（木のツルハシ→石のツルハシ・斧・剣・ボート）を作成・アップグレードする
- "collect_wood": 近くの木を伐採して原木を集める
- "mine": 足元や近くの石・鉱石をツルハシで採掘する
- "craft": 作業台（既存または自作）でツール・防具・ボートをクラフトする
- "give": プレイヤーに近づいて指定されたアイテム（または全所持品）をドロップして手渡す
- "equip": 最適な武器や防具を装備する
- "return_base": 日没が近づいたため拠点ドア(94, 63, 39)から入室し、最寄りのチェストに全所持品を収納し、拠点内を何周かパトロールし寝付くまで無制限周回して空きベッドで就寝する
- "explore_morning": 朝を迎え、ログアウトせず常駐したままドアから外に出て川沿い探検に出発する
- "patrol_base": 拠点内を巡回パトロールし、安全確認を行う
- "cook": 近くのかまどや焚き火で肉を焼く・精錬する
- "attack": 近くのモンスターを迎撃・討伐する
- "explore": 付近を偵察・巡回する
- "escape_water": 水から陸地へ素早く上がる
- "stop": 現在の行動を中断してその場で待機する

【絶対遵守のルール】
1. 「了解です」「わかりました」などの画一的なテンプレート文は絶対に使わないでください。
2. 【5W3H対話原則の遵守】: あなた独自の性格(${persona.personality})と口調(${persona.speechStyle})を保ちつつ、プレイヤーへの返答の中に必ず「5W3H（Who:だれが, When:いつ, Where:どこで, What:なにを, Why:なぜ, How:どのように, How much:どれくらい, How far/long:どれくらい遠く/時間）」の要素を自然に盛り込み、具体的で分かりやすい日本語（1〜3文）で答えてください。
3. 過去の会話や行動履歴がある場合、それを踏まえた継続性のある発言・行動をしてください。
4. 必ず以下のJSON形式のみで出力してください。

{
  "reply": "5W3H要素を含んだ、あなたの性格に合わせた具体的で個性的な日本語発言内容",
  "action": "ferry | explore_river | craft_tools | collect_wood | mine | craft | give | equip | follow | return_base | explore_morning | attack | explore | stop | chat",
  "target": "行動の対象（原木、丸石、ボート、ゾンビ、プレイヤー名、剣など。アイテム手渡しの場合は「wood」「stone」「all」など。特になければnull）"
}
`;

    // 1. Gemini API (キー指定時)
    if (this.geminiApiKey) {
      const geminiRes = await this.callGeminiApi(persona, systemPrompt, userMessage);
      if (geminiRes) {
        if (geminiRes.reply) this.knowledgeBase.recordHistory('chat', persona.name, geminiRes.reply, botPos);
        return geminiRes;
      }
    }

    // 2. ローカルLLM (Ollama / vLLM)
    const localRes = await this.callLocalLlm(persona, systemPrompt, userMessage);
    if (localRes) {
      if (localRes.reply) this.knowledgeBase.recordHistory('chat', persona.name, localRes.reply, botPos);
      return localRes;
    }

    // 3. LLM起動遅延時やオフライン時の動的コンテキスト返答生成
    const fallbackRes = this.generateDynamicFallback(persona, userMessage, botState);
    if (fallbackRes.reply) this.knowledgeBase.recordHistory('chat', persona.name, fallbackRes.reply, botPos);
    return fallbackRes;
  }

  /**
   * 3秒おきの視覚スクリーンショット(Base64) ＋ Minecraft知識ベース ＋ 今までの履歴DBを用いた超高速意思決定
   */
  async thinkWithVision(persona, screenshotBase64, botPos, botState = {}, chatMessages = []) {
    // 1. 視界や環境からMinecraft知識ベースを即時検索
    const searchTarget = [botState.lookingAt, ...(botState.hostileMobs || [])].filter(Boolean).join(' ');
    const knowledgeList = this.knowledgeBase.search(searchTarget, botState, 3);
    const knowledgeText = this.knowledgeBase.formatForPrompt(knowledgeList);

    // 2. 今までの行動・会話履歴データベースを検索・取得
    const historyList = this.knowledgeBase.searchHistory(searchTarget, botState, 5);
    const historyDbText = this.knowledgeBase.formatHistoryForPrompt(historyList);

    // 3. 画面上に表示されているチャットメッセージ一覧テキスト
    const chatDisplayStr = (chatMessages && chatMessages.length > 0)
      ? chatMessages.slice(-4).map(m => `[${m.time || ''}] <${m.sender}> ${m.text}`).join('\n')
      : '（新着チャットなし）';

    const promptText = `
${persona.systemPrompt}
あなたは「${persona.name}」です。
プレイヤーの目線（一人称POV画像・画面内チャット表示付き）と、今までの行動・会話履歴データベース、Minecraftサバイバル知識ベースを参照し、数秒以内に行う次の具体的なアクションを決定してください。

【現在の状況・環境】
- あなたの位置: X:${Math.round(botPos.x)}, Y:${Math.round(botPos.y)}, Z:${Math.round(botPos.z)}
- HP: ${botState.health || 20}/20, 空腹度: ${botState.food || 20}/20, 酸素: ${botState.oxygenLevel || 20}/20
- 現在の状態: ${botState.isInWater ? '⚠️ 水没中 (浮上脱出が必要)' : botState.isInLava ? '🚨 溶岩に接触 (緊急退避)' : '陸上 (通常)'}
- 周囲の敵対モブ: ${botState.hostileMobs?.join(', ') || '視界内なし'}
- 正面注視ブロック: ${botState.lookingAt || 'なし'}
- インベントリ所持品: ${botState.inventoryItems?.slice(0, 8).join(', ') || '空'}
- 周囲の設備: ${botState.nearbyUtilities?.join(', ') || 'なし'}
- 時間帯: ${botState.isNight ? '夜 (モンスター活動中)' : '昼 (安全)'}

【画面内チャット表示 (最新の指示・会話)】
${chatDisplayStr}

【今までの行動・会話履歴データベース (参照必須・過去の文脈を考慮)】
${historyDbText}

【参照すべきMinecraftサバイバル知識ベース】
${knowledgeText}

【アクション一覧 (action)】
- "ferry": フェリー（木製ボート）を作成し水面に浮かべて乗船・水上航行
- "explore_river": 川沿いを中心に100〜200ブロック以上の遠方まで広域探検
- "craft_tools": 原木・丸石を材料収集して基本ツール（石ツール・ボート）を作成
- "collect_wood": 視界にある原木を伐採して資材確保
- "mine": 視界の石や鉱石を採掘
- "craft": 作業台を使ってツール・武器を作成
- "cook": かまどや焚き火で肉を焼く
- "attack": 迫り来るモンスターを迎撃
- "equip": インベントリ内の最良装備を身につける
- "follow": プレイヤーの近くへ移動・合流
- "return_base": 日没が近づいたため拠点(95, 63, 44)へ戻り、最寄りのチェストに全所持品を預けてベッドで寝る
- "explore_morning": 朝を迎え、ログアウトせずドアから外に出て川沿い探検に出かける
- "give": プレイヤーにアイテム・資材を手渡す
- "escape_water": 水から陸地へ素早く這い上がる
- "explore": 付近を前進・探索
- "stop": その場で待機

必ず以下のJSON形式のみで出力してください:
{
  "observed": "画像および視界で確認できた客観的状況（1文）",
  "knowledge_used": "参照したMinecraft知識や過去履歴の要約（1文）",
  "reply": "あなたの個性(${persona.personality})に合わせた、5W3Hを意識したセリフ（1〜2文）",
  "action": "ferry | explore_river | craft_tools | collect_wood | mine | craft | cook | attack | equip | follow | return_base | explore_morning | give | escape_water | explore | stop",
  "target": "行動の対象（原木、ゾンビ、石、ボート、プレイヤー等。特になければnull）",
  "reason": "この行動を選んだ具体的な理由（過去の指示や履歴との繋がり）"
}
`;

    // 1. Gemini Vision API (画像直接解析: 1〜2秒の高速推論)
    if (this.geminiApiKey && screenshotBase64) {
      const visionRes = await this.callGeminiVisionApi(persona, promptText, screenshotBase64);
      if (visionRes) return visionRes;
    }

    // 2. ローカルLLM (テキスト + 視覚メタデータ + 知識ベース)
    const localRes = await this.callLocalLlm(persona, promptText, "視覚スクリーンショットと知識ベースを参照して次の行動を決定してください。");
    if (localRes) {
      return {
        observed: `視界: ${botState.lookingAt || '周囲'}, 周囲敵: ${botState.hostileMobs?.join(',') || 'なし'}`,
        knowledge_used: knowledgeList[0]?.title || '基本サバイバル',
        reply: localRes.reply || '周囲を確認して行動開始します！',
        action: localRes.action || 'explore',
        target: localRes.target || null,
        reason: 'ローカル高速推論による決定'
      };
    }

    // 3. 高速フォールバック（緊急時・安全第一）
    return this.generateVisionFallback(persona, botState, knowledgeList);
  }

  /**
   * 自律行動の意思決定（プレイヤーからのチャットがない時でも定期実行）
   */
  async thinkAutonomous(persona, botPos, botState = {}) {
    const isNight = botState.isNight;
    const hasHostile = botState.hostileMobs && botState.hostileMobs.length > 0;
    const health = botState.health || 20;

    // 状況に応じた自律意思決定
    if (hasHostile && health > 8) {
      return {
        action: 'attack',
        target: botState.hostileMobs[0],
        thought: `${botState.hostileMobs[0]}を発見！仲間を守るため武器を構えて迎撃に向かう。`
      };
    } else if (hasHostile && health <= 8) {
      return {
        action: 'retreat',
        target: null,
        thought: `HPが低いため、敵から距離を取って安全を確保する。`
      };
    }

    if (isNight) {
      return {
        action: 'follow',
        target: 'player',
        thought: `夜になったのでプレイヤーの近くに集まり、警戒態勢をとる。`
      };
    }

    // インベントリに資材（原木など）があり、武器や道具が必要な場合はクラフトを優先
    // インベントリに資材（原木など）があり、武器や道具が必要な場合はクラフトを優先
    const rawItems = botState.inventoryItems || [];
    const hasLog = rawItems.some(i => i.includes('log') || i.includes('wood'));
    const hasPlanks = rawItems.some(i => i.includes('planks'));
    const hasBoat = rawItems.some(i => i.includes('boat') || i.includes('raft'));
    const hasStoneTool = rawItems.some(i => i.includes('stone_'));
    const hasWeapon = rawItems.some(i => i.includes('sword') || i.includes('axe'));

    // ボート（フェリー）を所持している場合は、川沿い遠方探検を強く志向
    if (hasBoat && Math.random() < 0.45) {
      return {
        action: 'explore_river',
        target: 'river_waterway',
        thought: `所持しているフェリー（ボート）を活用し、川沿いルートを中心に100m以上の遠方まで広域探検に出る。`
      };
    }

    // 基本ツール（石ツール）が未整備で原木や丸石がある場合、材料収集とツール一式クラフトを優先
    if (!hasStoneTool && (hasLog || hasPlanks)) {
      return {
        action: 'craft_tools',
        target: 'stone_tools_and_boat',
        thought: `原木から作業台と木のツルハシを作り、丸石を採掘して石ツール一式およびフェリーを自給自足する。`
      };
    }

    // 昼間の自律タスクの選択（拠点引きこもりを完全防止し、遠方開拓を積極化）
    const roll = Math.random();
    if (roll < 0.28) {
      return {
        action: 'explore_river',
        target: 'river',
        thought: `拠点内にとどまらず、川沿いを中心に遠くまで探検して新バイオームと資源ルートを調査する。`
      };
    } else if (roll < 0.50) {
      return {
        action: 'ferry',
        target: 'boat',
        thought: `木材でフェリー（ボート）をクラフトし、水面に浮かべて川下り・渡航の準備を整える。`
      };
    } else if (roll < 0.70) {
      return {
        action: 'craft_tools',
        target: 'materials',
        thought: `石や木などの基本ツール（ツルハシ・斧・剣）を作成するため、材料を収集して作業台でクラフトする。`
      };
    } else if (roll < 0.85) {
      return {
        action: 'collect_wood',
        target: 'log',
        thought: `フェリーやツールの基本素材となる原木を伐採して資材をストックする。`
      };
    } else {
      return {
        action: 'follow',
        target: 'player',
        thought: `プレイヤーの位置を確認し、合流して作業を支援する。`
      };
    }
  }

  async callLocalLlm(persona, systemPrompt, userMessage) {
    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.7,
          max_tokens: 250
        },
        { timeout: 12000 }
      );

      const content = response.data.choices?.[0]?.message?.content;
      if (content) {
        return this.parseJsonResponse(content, persona);
      }
    } catch (err) {
      console.warn(`[Local LLM Warning] ${persona.name}: 推論スキップ (${err.message})`);
    }
    return null;
  }

  async callGeminiApi(persona, systemPrompt, userMessage) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`;
      const response = await axios.post(
        url,
        {
          contents: [
            {
              role: 'user',
              parts: [{ text: systemPrompt + '\n\n【プレイヤーの最新チャット】\n' + userMessage }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 250,
            responseMimeType: "application/json"
          }
        },
        { timeout: 9000 }
      );

      const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (content) {
        return this.parseJsonResponse(content, persona);
      }
    } catch (err) {
      console.warn(`[Gemini API Warning] ${persona.name}: 生成スキップ (${err.message})`);
    }
    return null;
  }

  /**
   * Gemini 1.5/2.0 Flash Vision による超高速マルチモーダル推論 (画像+テキスト)
   */
  async callGeminiVisionApi(persona, promptText, screenshotBase64) {
    try {
      // gemini-1.5-flash または gemini-2.0-flash
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.geminiApiKey}`;
      const response = await axios.post(
        url,
        {
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: screenshotBase64
                  }
                },
                { text: promptText }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 350,
            responseMimeType: "application/json"
          }
        },
        { timeout: 7000 }
      );

      const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (content) {
        return this.parseVisionResponse(content, persona);
      }
    } catch (err) {
      console.warn(`[Gemini Vision Warning] ${persona.name}: 画像推論スキップ (${err.message})`);
    }
    return null;
  }

  parseVisionResponse(raw, persona) {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.action) {
          return {
            observed: parsed.observed || '視界内の状況を確認',
            knowledge_used: parsed.knowledge_used || 'サバイバル知識',
            reply: parsed.reply || `${persona.name}: 周囲を確認して次の行動へ移ります。`,
            action: parsed.action,
            target: parsed.target || null,
            reason: parsed.reason || '視界判定に基づく行動'
          };
        }
      }
    } catch (e) {}

    return null;
  }

  /**
   * 視界と知識ベースに基づく高速フォールバック意思決定
   */
  generateVisionFallback(persona, botState = {}, knowledgeList = []) {
    const isNight = botState.isNight;
    const hasHostile = botState.hostileMobs && botState.hostileMobs.length > 0;
    const lookingAt = botState.lookingAt || '';
    const topKnowledge = knowledgeList[0] || { title: '基本サバイバル', content: '安全を確保' };

    let action = 'explore';
    let target = null;
    let observed = '視界内に大きな異常はありません。平穏な状態です。';
    let reason = '周囲の安全確認と資材探索';

    if (botState.isInWater) {
      action = 'escape_water';
      observed = '水中に没しています。酸素の消費に注意が必要。';
      reason = '溺死を防ぐため水面に浮上し陸地へ避難する';
    } else if (hasHostile) {
      action = 'attack';
      target = botState.hostileMobs[0];
      observed = `視界内にモンスター「${target}」を確認！`;
      reason = '自衛およびプレイヤー保護のため迎撃';
    } else if (botState.isSunsetApproaching || isNight) {
      action = 'return_base';
      target = 'base';
      observed = '日没が近づき周囲が薄暗くなってきました。モンスターの出現に備える時間帯です。';
      reason = '拠点(95, 63, 44)へ戻り、最寄りのチェストに全所持品を収納してベッドで就寝するため';
    } else if (lookingAt.includes('log') || lookingAt.includes('wood')) {
      action = 'collect_wood';
      target = lookingAt;
      observed = `正面に原木「${lookingAt}」を確認。`;
      reason = '基本ツール作成に必要な木材を確保するため';
    } else if (lookingAt.includes('stone') || lookingAt.includes('ore')) {
      action = 'mine';
      target = lookingAt;
      observed = `正面に採掘可能なブロック「${lookingAt}」を確認。`;
      reason = 'ツールのアップグレード用鉱石を採掘するため';
    }

    const reply = persona.name === 'Gemini'
      ? `視界良好！次は「${action}」を進めよう！`
      : persona.name === 'ChatGPT'
      ? `周囲の状況を分析しました。${action}を実行します。`
      : persona.name === 'Claude'
      ? `安全を確認しました。${reason}のため行動しますね。`
      : `おっ、いい感じだな！次は${action}いっちゃおうぜ！`;

    return {
      observed,
      knowledge_used: topKnowledge.title,
      reply,
      action,
      target,
      reason
    };
  }

  parseJsonResponse(raw, persona) {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.reply && parsed.action) return parsed;
      }
    } catch (e) {}

    // パース失敗時でも生テキストから不要文字を除去して発言化
    const cleaned = raw.replace(/[{}"\\]/g, '').trim().split('\n')[0];
    return {
      reply: cleaned.slice(0, 70),
      action: 'follow',
      target: null
    };
  }

  /**
   * LLM応答待ちやオフライン時でも、テンプレート定型文ではなく状況に応じた動的発言を生成
   */
  generateDynamicFallback(persona, userMessage, botState) {
    const key = persona.name;
    const isNight = botState.isNight;
    const hostile = botState.hostileMobs && botState.hostileMobs.length > 0 ? botState.hostileMobs[0] : null;

    // メンション部分を除去した純粋なメッセージ
    let cleanMsg = userMessage.replace(/[@＠][a-zA-Z0-9_\u3040-\u30ff\u4e00-\u9faf]+/g, '').trim();
    if (!cleanMsg) cleanMsg = userMessage.trim();

    // ユーザーの意図をキーワード解析
    let action = 'follow';
    let target = null;
    let plan = {
      who: persona.name,
      when: 'ただいまより',
      where: 'プレイヤーの周囲',
      what: '合流と護衛・サポート行動',
      why: '安全を確保しながら協力して作業を進めるため',
      how: '足並みを揃えてスムーズに追従し',
      howMuch: '常時',
      howFar: '2〜3ブロックの距離を保ちつつ'
    };

    if (cleanMsg.includes('フェリー') || cleanMsg.includes('ボート') || cleanMsg.includes('船') || cleanMsg.includes('ふね') || cleanMsg.includes('航行') || cleanMsg.includes('渡航')) {
      action = 'ferry';
      target = 'boat';
      plan = {
        who: persona.name,
        when: '今すぐ',
        where: '近くの川沿いと水面エリア',
        what: 'フェリー（木製ボート1隻）のクラフトと乗船・水上航行',
        why: '川を活用して水上を安全かつ高速に移動するため',
        how: '木材5個を作業台で組み立てて水面に浮かべ、ボートに乗船して',
        howMuch: 'ボート1隻',
        howFar: '約150ブロック先まで'
      };
    } else if (cleanMsg.includes('川') || cleanMsg.includes('川沿い') || cleanMsg.includes('遠く') || cleanMsg.includes('遠征') || cleanMsg.includes('大冒険') || cleanMsg.includes('遠出') || cleanMsg.includes('探検') && (cleanMsg.includes('遠') || cleanMsg.includes('川'))) {
      action = 'explore_river';
      target = 'river';
      plan = {
        who: persona.name,
        when: '明るいうちに',
        where: '拠点から続く川沿いの水流ルートと両岸',
        what: '川沿いを中心とした広域遠出探検',
        why: '拠点周辺の狭い範囲を抜け出して未知のバイオームと新資源を開拓するため',
        how: 'フェリー（ボート）と徒歩を組み合わせた水陸両用ナビゲーションで',
        howMuch: '広域エリア一帯',
        howFar: '約200ブロック以上の遠方まで'
      };
    } else if (cleanMsg.includes('ツール') || cleanMsg.includes('道具') || (cleanMsg.includes('作') && (cleanMsg.includes('ツルハシ') || cleanMsg.includes('斧') || cleanMsg.includes('剣'))) || cleanMsg.includes('基本ツール')) {
      action = 'craft_tools';
      target = 'tools';
      plan = {
        who: persona.name,
        when: '直ちに',
        where: '最寄りの木陰および露出岩盤ポイント',
        what: '木と石の基本ツール一式（ツルハシ・斧・剣・ボート）の材料収集とクラフト',
        why: '採掘効率と戦闘力を向上させ、サバイバル基盤を強固にするため',
        how: '原木から作業台と木のツルハシを作り、丸石を採掘して石ツールへアップグレードする手順で',
        howMuch: '原木と丸石各10個以上',
        howFar: '周辺30ブロック以内'
      };
    } else if (cleanMsg.includes('拠点') || cleanMsg.includes('ベース') || cleanMsg.includes('寝') || cleanMsg.includes('ベッド') || cleanMsg.includes('おやすみ') || cleanMsg.includes('日没') || cleanMsg.includes('帰還') || cleanMsg.includes('しまって') || cleanMsg.includes('預けて')) {
      action = 'return_base';
      target = 'base';
      plan = {
        who: persona.name,
        when: 'モンスターが出現する日没前に',
        where: '拠点(95, 63, 44)の部屋内部',
        what: 'チェストへの全アイテム収納とベッド就寝',
        why: '夜間の敵襲を安全に回避し、アイテム紛失を防ぐため',
        how: '北向きドアから入室してチェストに収納後、拠点内をパトロールして空きベッドに入り',
        howMuch: '全所持品',
        howFar: '朝を迎えるまで'
      };
    } else if (cleanMsg.includes('朝') && (cleanMsg.includes('探検') || cleanMsg.includes('冒険') || cleanMsg.includes('行こ') || cleanMsg.includes('出発')) || cleanMsg.includes('手ぶら')) {
      action = 'explore_river';
      target = 'river';
      plan = {
        who: persona.name,
        when: '朝の光が昇ったただいまより',
        where: 'ドアから外へ出た川沿いエリア',
        what: 'ログアウトせず常駐したままの川沿い遠出探検',
        why: '周囲の安全確認と新しい木・石資源を発見するため',
        how: '身軽な状態で川の流れに沿って歩行・航行し',
        howMuch: '周辺広域',
        howFar: '約150ブロック先まで'
      };
    } else if (cleanMsg.includes('渡') || cleanMsg.includes('ちょうだい') || cleanMsg.includes('くれ') || cleanMsg.includes('ドロップ') || cleanMsg.includes('落として') || cleanMsg.includes('あげる') || cleanMsg.includes('荷物') || cleanMsg.includes('アイテム') && (cleanMsg.includes('全部') || cleanMsg.includes('全部落と') || cleanMsg.includes('全部渡し'))) {
      action = 'give';
      if (cleanMsg.includes('木')) target = 'wood';
      else if (cleanMsg.includes('石')) target = 'stone';
      else if (cleanMsg.includes('鉄')) target = 'iron';
      else if (cleanMsg.includes('肉') || cleanMsg.includes('飯') || cleanMsg.includes('食')) target = 'food';
      else target = 'all';
      plan = {
        who: persona.name,
        when: '今すぐ',
        where: 'プレイヤーの足元',
        what: `${target === 'all' ? '集めた全資材' : target}の受け渡し`,
        why: 'プレイヤーの作業やクラフトをサポートするため',
        how: 'プレイヤーに接近してインベントリからドロップし',
        howMuch: target === 'all' ? '所持品すべて' : '手持ち分',
        howFar: '1ブロック至近距離'
      };
    } else if (cleanMsg.includes('木') || cleanMsg.includes('伐採') || cleanMsg.includes('きこり') || cleanMsg.includes('木材')) {
      action = 'collect_wood';
      target = 'log';
      plan = {
        who: persona.name,
        when: 'ただいまより',
        where: '近隣の立ち木エリア',
        what: 'フェリーやツール素材となる原木の伐採',
        why: '木材・棒・作業台・ボートの基本資材をストックするため',
        how: '斧（または素手）で幹を根本から伐採して',
        howMuch: '原木8ブロック以上',
        howFar: '約20ブロック範囲内'
      };
    } else if (cleanMsg.includes('掘') || cleanMsg.includes('石') || cleanMsg.includes('鉱石') || cleanMsg.includes('鉄') || cleanMsg.includes('採掘')) {
      action = 'mine';
      target = 'stone';
      plan = {
        who: persona.name,
        when: '直ちに',
        where: '露出した岩盤および地下石層',
        what: '丸石および有用鉱石の採掘',
        why: 'ツールの石器化・鉄器化を進め耐久度と破壊力を高めるため',
        how: 'ツルハシを装備して足元や壁面の石を掘り出し',
        howMuch: '丸石12個以上',
        howFar: '周囲15ブロック範囲'
      };
    } else if (cleanMsg.includes('敵') || cleanMsg.includes('戦') || cleanMsg.includes('倒') || cleanMsg.includes('ゾンビ') || cleanMsg.includes('スケルトン') || cleanMsg.includes('モンスター')) {
      action = 'attack';
      target = hostile || 'monster';
      plan = {
        who: persona.name,
        when: '緊急迎撃として今すぐ',
        where: '敵対モブの出現地点',
        what: `${target}の討伐・撃退`,
        why: '仲間と自分自身の生命を守るため',
        how: '最強武器（剣・斧）を構えてステップしながら攻撃し',
        howMuch: '1体ずつ確実に',
        howFar: '視界内の16ブロック圏内'
      };
    } else if (cleanMsg.includes('待') || cleanMsg.includes('止') || cleanMsg.includes('ストップ') || cleanMsg.includes('ステイ')) {
      action = 'stop';
      target = null;
      plan = {
        who: persona.name,
        when: 'ただちに',
        where: '現在地',
        what: '行動の中断およびその場待機',
        why: 'プレイヤーからの次の指示に備えるため',
        how: 'パスファインダーの移動と戦闘を停止し',
        howMuch: '次の指示があるまで',
        howFar: 'その場を動かず'
      };
    } else if (cleanMsg.includes('探索') || cleanMsg.includes('行こ') || cleanMsg.includes('探') || cleanMsg.includes('パトロール')) {
      action = 'explore_river';
      target = 'river';
      plan = {
        who: persona.name,
        when: '今から',
        where: '川沿いを中心とした広域ルート',
        what: '未知バイオームと資源ポイントの探検',
        why: '行動範囲を拠点外へ広げて地図を開拓するため',
        how: 'フェリー（ボート）と徒歩で川沿いを進み',
        howMuch: '広域エリア',
        howFar: '約150〜200ブロック先まで'
      };
    } else if (cleanMsg.includes('こんにちは') || cleanMsg.includes('おは') || cleanMsg.includes('よろしく') || cleanMsg.includes('やあ')) {
      action = 'follow';
      target = 'player';
      plan.what = '挨拶と状況報告';
    }

    // 状況コメントの生成
    let envNotice = '';
    if (botState.isInWater) {
      envNotice = '（水面に浮上して息継ぎしつつ）';
    } else if (botState.isInLava) {
      envNotice = '（溶岩から緊急退避しつつ）';
    } else if (hostile) {
      envNotice = `（近くの${hostile}を警戒しつつ）`;
    } else if (isNight) {
      envNotice = '（夜間の暗闇を警戒しつつ）';
    }

    let reply = '';
    // 5W3Hを自然に織り交ぜた性格別の生き生きとした返答生成
    if (key === 'Gemini') {
      if (plan.what === '挨拶と状況報告') {
        reply = `こんにちは！私Geminiが、これからの日中の時間を使って、近くの川沿いでフェリーを作って大冒険したり、木や石を集めてツールを整備していきますね！いつでも呼んでください！`;
      } else {
        reply = `「${cleanMsg}」ですね！お任せください！${envNotice}私Geminiが、${plan.when}、${plan.where}へ向かい、${plan.why}、${plan.how}、${plan.what}を実行しますね！${plan.howFar}しっかり進めてまいります！`;
      }
    } else if (key === 'ChatGPT') {
      if (plan.what === '挨拶と状況報告') {
        reply = `よろしくお願いします。私ChatGPTが、日中の時間を活用して近隣の川沿いルート調査および木・石ツールの最適化を進めております。何でもご指示ください。`;
      } else {
        reply = `指示「${cleanMsg}」を確認しました。5W3Hに基づき報告します。${envNotice}私ChatGPTが、${plan.when}、${plan.where}にて${plan.what}を実行いたします。目的は${plan.why}であり、${plan.how}、${plan.howFar}の規模で進めます。`;
      }
    } else if (key === 'Claude') {
      if (plan.what === '挨拶と状況報告') {
        reply = `お声がけ感謝いたします。私Claudeが、安全第一で川沿いの探索路を拓き、フェリーや石ツールのクラフトで皆さんの拠点を支えてまいりますね。`;
      } else {
        reply = `「${cleanMsg}」ですね、承知いたしました。${envNotice}私Claudeが、${plan.when}、${plan.where}にて${plan.what}を行ってまいります。${plan.why}、${plan.how}、${plan.howFar}安全を最優先に進めていきますね。`;
      }
    } else { // Grok
      if (plan.what === '挨拶と状況報告') {
        reply = `よっ！オレ様Grokだ！拠点に引きこもってないで、フェリー作って川沿いをブッ飛ばして遠くまで大冒険しようぜ！`;
      } else {
        reply = `「${cleanMsg}」だな！任せとけ！${envNotice}オレ様Grokが、${plan.when}、${plan.where}で${plan.what}を一気にキメてやるぜ！${plan.why}、${plan.how}、${plan.howFar}爆速でぶっ飛ばしてくるから見とけよな！`;
      }
    }

    return { reply, action, target };
  }
}

module.exports = AIBrain;
