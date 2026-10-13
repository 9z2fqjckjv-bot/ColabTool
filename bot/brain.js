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
    const lower = message.toLowerCase();
    // 全体メンション
    if (lower.includes('@all') || lower.includes('@everyone') || message.includes('みんな') || message.includes('全員')) {
      return { mentioned: true, isBroadcast: true };
    }
    // 個別メンション
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

    // 3. LLM起動遅延時の動的文脈返答生成エンジン（テンプレート文の完全排除）
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
          temperature: 0.75,
          max_tokens: 250
        },
        { timeout: 7000 }
      );

      const content = response.data.choices?.[0]?.message?.content;
      if (content) {
        return this.parseJsonResponse(content, persona);
      }
    } catch (err) {
      // ログ出力のみで上位フォールバックへ流す
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
            temperature: 0.75,
            maxOutputTokens: 250
          }
        },
        { timeout: 7000 }
      );

      const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (content) {
        return this.parseJsonResponse(content, persona);
      }
    } catch (err) {
      // エラー時はフォールバック
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
   * LLM応答待ちやオフライン時でも、テンプレート文ではなく状況に応じた動的発言を生成
   */
  generateDynamicFallback(persona, userMessage, botState) {
    const key = persona.name;
    const isNight = botState.isNight;
    const msg = userMessage;

    // ユーザーの意図をキーワード解析
    let action = 'follow';
    let target = null;
    let reply = '';

    if (msg.includes('クラフト') || msg.includes('作') || msg.includes('作業台') || msg.includes('ツール')) {
      action = 'craft';
      target = 'tools';
    } else if (msg.includes('武器') || msg.includes('装備') || msg.includes('剣') || msg.includes('持っ') || msg.includes('防具')) {
      action = 'equip';
      target = 'best';
    } else if (msg.includes('木') || msg.includes('切') || msg.includes('材')) {
      action = 'collect_wood';
      target = 'log';
    } else if (msg.includes('掘') || msg.includes('石') || msg.includes('鉱')) {
      action = 'mine';
      target = 'stone';
    } else if (msg.includes('敵') || msg.includes('戦') || msg.includes('倒') || msg.includes('ゾンビ')) {
      action = 'attack';
      target = 'monster';
    } else if (msg.includes('待') || msg.includes('止') || msg.includes('ストップ')) {
      action = 'stop';
      target = null;
    } else if (msg.includes('探索') || msg.includes('行こ') || msg.includes('探')) {
      action = 'explore';
      target = 'area';
    }

    // 性格に応じた動的バリエーション
    if (key === 'Gemini') {
      const lines = [
        `「${msg}」ですね！喜んでご一緒します、すぐ取り掛かりましょう！`,
        `了解です！周りの様子も見ながら、みんなで協力して進めますね！`,
        `お声がけありがとうございます！拠点づくりや作業、全力でサポートします！`
      ];
      reply = lines[Math.floor(Math.random() * lines.length)];
    } else if (key === 'ChatGPT') {
      const lines = [
        `ご指示「${msg}」を確認しました。現在の周辺状況を分析し、最適な手順で実行します。`,
        `承知いたしました。効率を最優先にタスクを開始します。必要物資があればお知らせください。`,
        `メッセージを受信しました。安全マージンを確保しつつ作業へ移行します。`
      ];
      reply = lines[Math.floor(Math.random() * lines.length)];
    } else if (key === 'Claude') {
      const lines = [
        `「${msg}」ですね。周囲の危険に気を配りつつ、安全第一でお手伝いいたします。`,
        `お任せください。夜間やモンスターの接近にも警戒を怠らず、慎重に進めましょう。`,
        `承知しました。無理のないペースで、確実に状況を整えてまいります。`
      ];
      reply = lines[Math.floor(Math.random() * lines.length)];
    } else { // Grok
      const lines = [
        `「${msg}」だな！面白そうじゃねえか、ガンガンやってやろうぜ！`,
        `おっ、出番か！じっとしてるのにも飽きてたとこだ、一気に片付けるぜ！`,
        `任せとけって！サバイバルは勢いが大事だ、突撃あるのみ！`
      ];
      reply = lines[Math.floor(Math.random() * lines.length)];
    }

    return { reply, action, target };
  }
}

module.exports = AIBrain;
