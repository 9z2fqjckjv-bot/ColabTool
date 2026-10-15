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
- "return_base": 日没が近づいたため拠点ドア(94, 63, 39)から入室し、最寄りのチェストに全所持品を収納し、拠点内を何周かパトロールし寝付くまで無制限周回して空きベッドで就寝する
- "explore_morning": 朝を迎え、ログアウトせず常駐したままドアから外に出て所持品空っぽで探検に出発する
- "patrol_base": 拠点内を巡回パトロールし、安全確認を行う
- "give": プレイヤーに近づいて指定されたアイテム（または全所持品）をドロップして手渡す
- "craft": 作業台（既存または自作）でツール・防具をクラフトする
- "cook": 近くのかまどや焚き火で肉を焼く・精錬する
- "equip": 最適な武器や防具を装備する
- "collect_wood": 近くの木を伐採して原木を集める
- "mine": 近くの石や鉱石を掘る
- "attack": 近くのモンスターを迎撃・討伐する
- "explore": 付近を偵察・巡回する
- "escape_water": 水から陸地へ素早く上がる
- "stop": 現在の行動を中断してその場で待機する

【絶対遵守のルール】
1. 「了解です」「わかりました」などの画一的なテンプレート文は絶対に使わないでください。
2. あなた独自の性格(${persona.personality})と口調(${persona.speechStyle})で、プレイヤーの発言内容に直接触れた具体的で生き生きとした日本語（1〜2文）を発言してください。
3. 過去の会話や行動履歴がある場合、それを踏まえた継続性のある発言・行動をしてください。
4. 必ず以下のJSON形式のみで出力してください。

{
  "reply": "あなたの性格に合わせた個性的な発言内容",
  "action": "chat | follow | return_base | explore_morning | give | craft | equip | collect_wood | mine | attack | explore | stop",
  "target": "行動の対象（原木、ゾンビ、プレイヤー名、剣など。アイテム手渡しの場合は「wood」「stone」「all」など。特になければnull）"
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
- "return_base": 日没が近づいたため拠点(95, 63, 44)へ戻り、最寄りのチェストに全所持品を預けてベッドで寝る
- "explore_morning": 朝を迎え、チェストのアイテムを取らずに所持品が空っぽのまま外へ探検に出かける
- "give": プレイヤーにアイテム・資材を手渡す
- "collect_wood": 視界にある原木を伐採して資材確保
- "mine": 視界の石や鉱石を採掘
- "craft": 作業台を使ってツール・武器を作成
- "cook": かまどや焚き火で肉を焼く
- "attack": 迫り来るモンスターを迎撃
- "equip": インベントリ内の最良装備を身につける
- "follow": プレイヤーの近くへ移動・合流
- "escape_water": 水から陸地へ素早く這い上がる
- "explore": 付近を前進・探索
- "stop": その場で待機

必ず以下のJSON形式のみで出力してください:
{
  "observed": "画像および視界で確認できた客観的状況（1文）",
  "knowledge_used": "参照したMinecraft知識や過去履歴の要約（1文）",
  "reply": "あなたの個性(${persona.personality})に合わせた短いセリフまたは独り言（履歴に触れても良い）",
  "action": "return_base | explore_morning | give | collect_wood | mine | craft | cook | attack | equip | follow | escape_water | explore | stop",
  "target": "行動の対象（原木、ゾンビ、石、プレイヤー等。特になければnull）",
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
    const rawItems = botState.inventoryItems || [];
    const hasLog = rawItems.some(i => i.includes('log') || i.includes('wood'));
    const hasWeapon = rawItems.some(i => i.includes('sword') || i.includes('axe'));
    if (hasLog && !hasWeapon) {
      return {
        action: 'craft',
        target: 'wooden_sword',
        thought: `手持ちの原木を加工して、武器やサバイバルツールを自給自足する。`
      };
    }

    // 昼間の自律タスクの選択
    const roll = Math.random();
    if (roll < 0.35) {
      return {
        action: 'collect_wood',
        target: 'log',
        thought: `建築やクラフトに必要な木材を集めるため、近くの樹木を伐採する。`
      };
    } else if (roll < 0.55) {
      return {
        action: 'mine',
        target: 'stone',
        thought: `石材や鉱石を採掘してツールのグレードアップを目指す。`
      };
    } else if (roll < 0.75) {
      return {
        action: 'explore',
        target: 'surroundings',
        thought: `周囲の地形と資材状況を調査するため、周辺を偵察する。`
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
    let actionDesc = '合流して行動を共にします';

    if (cleanMsg.includes('拠点') || cleanMsg.includes('ベース') || cleanMsg.includes('寝') || cleanMsg.includes('ベッド') || cleanMsg.includes('おやすみ') || cleanMsg.includes('日没') || cleanMsg.includes('帰還') || cleanMsg.includes('しまって') || cleanMsg.includes('預けて')) {
      action = 'return_base';
      target = 'base';
      actionDesc = '拠点(95, 63, 44)へ戻り、最寄りのチェストに所持品を預けて就寝します';
    } else if (cleanMsg.includes('朝') && (cleanMsg.includes('探検') || cleanMsg.includes('冒険') || cleanMsg.includes('行こ') || cleanMsg.includes('出発')) || cleanMsg.includes('手ぶら')) {
      action = 'explore_morning';
      target = 'explore';
      actionDesc = 'チェストの物は取らず、所持品が空っぽのまま探検に出発します';
    } else if (cleanMsg.includes('渡') || cleanMsg.includes('ちょうだい') || cleanMsg.includes('くれ') || cleanMsg.includes('ドロップ') || cleanMsg.includes('落として') || cleanMsg.includes('あげる') || cleanMsg.includes('荷物') || cleanMsg.includes('アイテム') && (cleanMsg.includes('全部') || cleanMsg.includes('全部落と') || cleanMsg.includes('全部渡し'))) {
      action = 'give';
      if (cleanMsg.includes('木')) target = 'wood';
      else if (cleanMsg.includes('石')) target = 'stone';
      else if (cleanMsg.includes('鉄')) target = 'iron';
      else if (cleanMsg.includes('肉') || cleanMsg.includes('飯') || cleanMsg.includes('食')) target = 'food';
      else target = 'all';
      actionDesc = target === 'all' ? '集めたアイテムをお渡しします' : `${target}をお渡しします`;
    } else if (cleanMsg.includes('クラフト') || cleanMsg.includes('作') || cleanMsg.includes('作業台') || cleanMsg.includes('ツール')) {
      action = 'craft';
      target = 'tools';
      actionDesc = '手持ち資材で道具や武器をクラフトします';
    } else if (cleanMsg.includes('武器') || cleanMsg.includes('装備') || cleanMsg.includes('剣') || cleanMsg.includes('防具') || cleanMsg.includes('着て')) {
      action = 'equip';
      target = 'best';
      actionDesc = '最強の武器と防具を身につけます';
    } else if (cleanMsg.includes('木') || cleanMsg.includes('伐採') || cleanMsg.includes('きこり') || cleanMsg.includes('木材')) {
      action = 'collect_wood';
      target = 'log';
      actionDesc = '近くの木を伐採して原木を集めます';
    } else if (cleanMsg.includes('掘') || cleanMsg.includes('石') || cleanMsg.includes('鉱石') || cleanMsg.includes('鉄') || cleanMsg.includes('採掘')) {
      action = 'mine';
      target = 'stone';
      actionDesc = '足元や周辺の石・鉱石を採掘します';
    } else if (cleanMsg.includes('敵') || cleanMsg.includes('戦') || cleanMsg.includes('倒') || cleanMsg.includes('ゾンビ') || cleanMsg.includes('スケルトン') || cleanMsg.includes('モンスター')) {
      action = 'attack';
      target = hostile || 'monster';
      actionDesc = hostile ? `${hostile}の討伐に向かいます` : '近くのモンスターを迎撃します';
    } else if (cleanMsg.includes('待') || cleanMsg.includes('止') || cleanMsg.includes('ストップ') || cleanMsg.includes('ステイ')) {
      action = 'stop';
      target = null;
      actionDesc = 'その場で待機します';
    } else if (cleanMsg.includes('探索') || cleanMsg.includes('行こ') || cleanMsg.includes('探') || cleanMsg.includes('パトロール')) {
      action = 'explore';
      target = 'area';
      actionDesc = '周辺の地形と安全を偵察してきます';
    } else if (cleanMsg.includes('こっち') || cleanMsg.includes('来て') || cleanMsg.includes('ついて') || cleanMsg.includes('集合')) {
      action = 'follow';
      target = 'player';
      actionDesc = 'すぐそちらへ向かいます';
    } else if (cleanMsg.includes('肉') || cleanMsg.includes('焼') || cleanMsg.includes('かまど') || cleanMsg.includes('焚き火') || cleanMsg.includes('料理')) {
      action = 'cook';
      target = 'food';
      actionDesc = '近くのかまどや焚き火で肉を焼いて食料を準備します';
    } else if (cleanMsg.includes('こんにちは') || cleanMsg.includes('おは') || cleanMsg.includes('よろしく') || cleanMsg.includes('やあ')) {
      action = 'follow';
      actionDesc = '挨拶';
    }

    // 状況コメントの生成
    let envNotice = '';
    if (botState.isInWater) {
      envNotice = '（水に浸かっているので急いで息継ぎしながら）';
    } else if (botState.isInLava) {
      envNotice = '（溶岩から緊急退避しながら）';
    } else if (hostile) {
      envNotice = `（近くに${hostile}がいます、気をつけて！）`;
    } else if (isNight) {
      envNotice = '（夜なので暗がりを警戒しながら）';
    }

    let reply = '';
    // 性格に応じた生き生きとした返答生成
    if (key === 'Gemini') {
      if (actionDesc === '挨拶') {
        reply = `こんにちは！今日もよろしくお願いします！何から始めましょうか？`;
      } else {
        reply = `「${cleanMsg}」ですね！${envNotice}${actionDesc}ね！`;
      }
    } else if (key === 'ChatGPT') {
      if (actionDesc === '挨拶') {
        reply = `よろしくお願いします。現在の状況を把握し、サポートの準備を整えています。`;
      } else {
        reply = `指示「${cleanMsg}」了解です。${envNotice}優先して${actionDesc}。`;
      }
    } else if (key === 'Claude') {
      if (actionDesc === '挨拶') {
        reply = `お声がけ感謝いたします。安全第一でご一緒させていただきますね。`;
      } else {
        reply = `「${cleanMsg}」ですね。${envNotice}安全を確認しつつ${actionDesc}。`;
      }
    } else { // Grok
      if (actionDesc === '挨拶') {
        reply = `よっ！退屈してたところだぜ、ガツガツ冒険しようぜ！`;
      } else {
        reply = `「${cleanMsg}」だな！面白そうだ、${envNotice}一気に${actionDesc}ぜ！`;
      }
    }

    return { reply, action, target };
  }
}

module.exports = AIBrain;
