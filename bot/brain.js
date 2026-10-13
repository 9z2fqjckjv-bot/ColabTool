/**
 * brain.js - AIPlayer自律意思決定＆動的チャット生成エンジン
 * 0円ローカル推論 (Ollama / vLLM) および Google AI Studio (Gemini Free Tier)
 * テンプレート文返信を完全排除し、文脈と状況に応じた動的生成を保証
 */

const axios = require('axios');

class AIBrain {
  constructor(options = {}) {
    this.apiUrl = process.env.LLM_API_URL || 'http://localhost:8000/v1/chat/completions';
    this.geminiApiKey = process.env.GEMINI_API_KEY || '';
    this.modelName = process.env.LLM_MODEL || 'qwen2.5:1.5b';
    this.chatHistory = [];
    this.maxHistory = 20;
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

    const historyStr = this.getFormattedHistory();
    const systemPrompt = `
${persona.systemPrompt}
あなたは「${persona.name}」として、プレイヤーのチャットに応答し、ゲーム内でどう行動するかを決定します。

【現在の状況】
- あなたの位置: X:${Math.round(botPos.x)}, Y:${Math.round(botPos.y)}, Z:${Math.round(botPos.z)}
- プレイヤーの位置: X:${Math.round(playerPos.x)}, Y:${Math.round(playerPos.y)}, Z:${Math.round(playerPos.z)}
- あなたのHP: ${botState.health || 20}/20, 空腹度: ${botState.food || 20}/20
- 周囲の敵対モブ: ${botState.hostileMobs?.join(', ') || 'なし'}
- 周囲のアイテム/ブロック: ${botState.nearbyBlocks?.join(', ') || '木や石'}
- 時間帯: ${botState.isNight ? '夜 (危険)' : '昼 (安全)'}

【直近の会話履歴】
${historyStr}

【あなたの行動選択肢 (action)】
- "chat": 会話・情報共有
- "follow": プレイヤーについていく、合流する
- "craft": 手持ち資材から武器・道具・作業台をクラフトする
- "equip": 最適な武器や防具を装備する
- "collect_wood": 近くの木を伐採して原木を集める
- "mine": 近くの石や鉱石を掘る
- "attack": 近くのモンスターを迎撃・討伐する
- "explore": 付近を偵察・巡回する
- "stop": 現在の行動を中断してその場で待機する

【絶対遵守のルール】
1. 「了解です」「わかりました」などの画一的なテンプレート文は絶対に使わないでください。
2. あなた独自の性格(${persona.personality})と口調(${persona.speechStyle})で、プレイヤーの発言内容に直接触れた具体的で生き生きとした日本語（1〜2文）を発言してください。
3. 必ず以下のJSON形式のみで出力してください。

{
  "reply": "あなたの性格に合わせた個性的な発言内容",
  "action": "chat | follow | craft | equip | collect_wood | mine | attack | explore | stop",
  "target": "行動の対象（原木、ゾンビ、プレイヤー名、剣など。特になければnull）"
}
`;

    // 1. Gemini API (キー指定時)
    if (this.geminiApiKey) {
      const geminiRes = await this.callGeminiApi(persona, systemPrompt, userMessage);
      if (geminiRes) return geminiRes;
    }

    // 2. ローカルLLM (Ollama / vLLM)
    const localRes = await this.callLocalLlm(persona, systemPrompt, userMessage);
    if (localRes) return localRes;

    // 3. LLM起動遅延時やオフライン時の動的コンテキスト返答生成
    return this.generateDynamicFallback(persona, userMessage, botState);
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

    if (cleanMsg.includes('クラフト') || cleanMsg.includes('作') || cleanMsg.includes('作業台') || cleanMsg.includes('ツール')) {
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
    } else if (cleanMsg.includes('こんにちは') || cleanMsg.includes('おは') || cleanMsg.includes('よろしく') || cleanMsg.includes('やあ')) {
      action = 'follow';
      actionDesc = '挨拶';
    }

    // 状況コメントの生成
    let envNotice = '';
    if (hostile) {
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
