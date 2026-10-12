/**
 * brain.js - LLM推論基盤・文脈管理・行動コマンド抽出
 * ローカル推論(vLLM/Ollama) 0円 または Google AI Studio Free Tier
 */

const axios = require('axios');

class AIBrain {
  constructor(options = {}) {
    // ローカルvLLM/Ollama (OpenAI互換API) または Google AI Studio
    this.apiUrl = process.env.LLM_API_URL || 'http://localhost:8000/v1/chat/completions';
    this.geminiApiKey = process.env.GEMINI_API_KEY || '';
    this.modelName = process.env.LLM_MODEL || 'default';
    this.chatHistory = []; // 直近のチャット・行動履歴
    this.maxHistory = 15;
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
   * ユーザーのチャットに対してLLMで思考し、返答と行動コマンドを決定する
   */
  async think(persona, userMessage, playerPos, botPos, nearbyEntities = []) {
    this.addHistory('User', userMessage);

    const historyStr = this.getFormattedHistory();
    const contextPrompt = `
あなたはMinecraftのAI仲間「${persona.name}」(${persona.role})です。
プレイヤーの発言には誤字・脱字や口語、あいまいな表現が含まれている場合があります。
前後の文脈や現在の状況からプレイヤーの真意を推測し、柔軟に対応してください。

【現在の状況】
- あなたの位置: X:${Math.round(botPos.x)}, Y:${Math.round(botPos.y)}, Z:${Math.round(botPos.z)}
- プレイヤーの位置: X:${Math.round(playerPos.x)}, Y:${Math.round(playerPos.y)}, Z:${Math.round(playerPos.z)}
- 周囲の生物/モブ: ${nearbyEntities.join(', ') || '特になし'}

【直近の会話履歴】
${historyStr}

【あなたの行動選択肢 (action)】
- "chat": ただ会話する、返事をする
- "follow": プレイヤーについていく
- "collect": 木や石などの素材を集める
- "attack": 近くの敵対モブを攻撃する・護衛する
- "explore": 付近を探索・見回りする
- "stop": 現在の行動を中止して待機する

必ず以下のJSON形式でのみ出力してください。余計な解説は不要です。
{
  "reply": "Minecraftのゲーム内チャットで発言する日本語（1〜2文）",
  "action": "chat | follow | collect | attack | explore | stop",
  "target": "アクションの対象（木材、ゾンビ、探索方向など。なければnull）"
}
`;

    // 1. Google AI Studio (Gemini Free Tier) が指定されている場合
    if (this.geminiApiKey) {
      return await this.callGeminiApi(persona, contextPrompt, userMessage);
    }

    // 2. ローカルL4推論 (vLLM / Ollama: コスト0円)
    return await this.callLocalLlm(persona, contextPrompt, userMessage);
  }

  async callLocalLlm(persona, systemPrompt, userMessage) {
    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.modelName,
          messages: [
            { role: 'system', content: persona.systemPrompt + '\n' + systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.7,
          max_tokens: 300
        },
        { timeout: 15000 }
      );

      const content = response.data.choices[0].message.content;
      return this.parseJsonResponse(content, persona);
    } catch (err) {
      console.error(`[${persona.name}] LLM推論エラー:`, err.message);
      // フォールバック返答
      return {
        reply: `了解です！まかせてください！`,
        action: 'follow',
        target: null
      };
    }
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
              parts: [{ text: persona.systemPrompt + '\n' + systemPrompt + '\nユーザー発言: ' + userMessage }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 300
          }
        },
        { timeout: 15000 }
      );

      const content = response.data.candidates[0].content.parts[0].text;
      return this.parseJsonResponse(content, persona);
    } catch (err) {
      console.error(`[${persona.name}] Gemini APIエラー:`, err.message);
      return {
        reply: `はい、了解しました！`,
        action: 'follow',
        target: null
      };
    }
  }

  parseJsonResponse(raw, persona) {
    try {
      // JSONブロック抽出
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.reply) return parsed;
      }
    } catch (e) {
      // パース失敗時は生の文字列から適当にトリミング
    }
    // 文字列そのままの場合
    return {
      reply: raw.replace(/["{}\\]/g, '').trim().slice(0, 80),
      action: 'chat',
      target: null
    };
  }
}

module.exports = AIBrain;
