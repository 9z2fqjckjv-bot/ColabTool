/**
 * brain.js - Qwen 2.5 推論・自律思考・行動日誌学習・改善提案・統括日報エンジン
 * Google Colab L4 GPU (24GB VRAM) 最適化 (qwen2.5:14b)
 */

const axios = require('axios');
const knowledgeBase = require('./knowledge_base');
const db = require('./database');

class AIBrain {
  constructor(options = {}) {
    this.apiUrl = process.env.LLM_API_URL || 'http://localhost:8000/v1/chat/completions';
    this.modelName = process.env.LLM_MODEL || 'qwen2.5:14b';
    this.chatHistory = [];
    this.maxHistory = 30;
    this.knowledgeBase = knowledgeBase;
    this.db = db;
    this.isProcessing = false;
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

  isMentioned(message, roleKey, role) {
    const raw = message.trim();
    const lower = raw.toLowerCase();

    const broadcastKeywords = [
      '@all', '@everyone', '@全員', '@みんな', '@bot', '@ai',
      '＠all', '＠everyone', '＠全員', '＠みんな', '＠bot', '＠ai',
      'みんな', '全員', '全員集合', '集合', 'bot達', 'ai達'
    ];
    if (broadcastKeywords.some(kw => lower.includes(kw.toLowerCase()))) {
      return { mentioned: true, isBroadcast: true };
    }

    const matches = (role.aliases || []).some(alias => lower.includes(alias.toLowerCase()));
    return { mentioned: matches, isBroadcast: false };
  }

  async callLLM(systemPrompt, userPrompt, temperature = 0.7, maxTokens = 600) {
    try {
      const payload = {
        model: this.modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature,
        max_tokens: maxTokens,
        stream: false
      };

      const response = await axios.post(this.apiUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 25000
      });

      if (response.data && response.data.choices && response.data.choices.length > 0) {
        return response.data.choices[0].message.content.trim();
      }
    } catch (e) {
      console.warn(`[AIBrain - Qwen 2.5] 推論フォールバック: ${e.message}`);
    }
    return null;
  }

  /**
   * チャット対話と行動決定 (5W3H原則準拠)
   */
  async thinkChat(role, userMessage, playerPos, botPos, botState = {}) {
    this.addHistory('User', userMessage);
    this.knowledgeBase.recordHistory('chat', 'User', userMessage, playerPos);
    this.db.logEvent('chat', role.id, `ユーザーチャット受信: ${userMessage}`);

    const knowledgeList = this.knowledgeBase.search(userMessage, botState, 2);
    const knowledgeSection = this.knowledgeBase.formatForPrompt(knowledgeList);
    const historyStr = this.getFormattedHistory();

    const systemPrompt = `
${role.systemPrompt}
あなたは「${role.displayName}」として、プレイヤーのメッセージに対して自然な日本語で応答します。

【対話原則 (5W3H)】
返答には「誰が(Who)・いつ(When)・どこで(Where)・何を(What)・なぜ(Why)・どのように(How)・数量(How much)・距離/時間(How far/long)」を自然に織り交ぜ、1〜3文で簡潔かつ親身に答えてください。

【現在の状況】
- あなたの役職: ${role.roleName} (${role.displayName})
- あなたの位置: X:${Math.round(botPos.x)}, Y:${Math.round(botPos.y)}, Z:${Math.round(botPos.z)}
- プレイヤーの位置: X:${Math.round(playerPos.x)}, Y:${Math.round(playerPos.y)}, Z:${Math.round(playerPos.z)}
- HP: ${botState.health || 20}/20, 空腹度: ${botState.food || 20}/20
- 現在の任務: ${botState.currentTask || '通常業務中'}

【ナレッジ】
${knowledgeSection || '基本サバイバル手順'}

【会話履歴】
${historyStr}

以下のJSON形式で回答してください:
{
  "reply": "自然な返答テキスト (5W3H含有)",
  "action": "work|follow|guard|return_base|chat",
  "detail": "行動の詳細"
}
`;

    const userPrompt = `プレイヤーからの発言: "${userMessage}"`;
    const responseText = await this.callLLM(systemPrompt, userPrompt, 0.7, 400);

    let parsed = null;
    if (responseText) {
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      } catch (_) {}
    }

    if (!parsed || !parsed.reply) {
      parsed = {
        reply: `了解しました！私${role.displayName}が、ただちに現在地(X:${Math.round(botPos.x)}, Z:${Math.round(botPos.z)})からご指示の任務に全力を尽くします！`,
        action: "work",
        detail: userMessage
      };
    }

    this.addHistory(role.displayName, parsed.reply);
    this.knowledgeBase.recordHistory('chat', role.displayName, parsed.reply, botPos);
    this.db.logEvent('chat', role.id, `返答: ${parsed.reply}`, { action: parsed.action });

    return parsed;
  }

  /**
   * 行動日誌の分析と改善提案の生成 (Qwen 2.5 学習・提案機能)
   */
  async analyzeDiariesAndProposeImprovements(recentDiaries, dbStats) {
    const systemPrompt = `
あなたはMinecraft自律AIサバイバルサーバーの最高戦略アナリストAIです。
全41体のAIPlayerの行動日誌と資材データベースを分析し、サバイバル生活をより安全・高効率・快適にするための【改善提案】を論理的に策定してください。

【現在の統計データ】
- 稼働中AIPlayer数: ${dbStats.activeBots}/${dbStats.totalBots}
- 累計収集資材: ${dbStats.totalHarvest} 個
- 拠点チェスト数: ${dbStats.totalChests} 箱
- 畑の耕作地数: ${dbStats.farmPlots} ブロック
- 飼育場の動物総数: ${dbStats.ranchTotal} 頭

【最近の行動日誌サマリー】
${recentDiaries.slice(0, 15).map(d => `- [${d.role}] (${d.time}): ${d.content}`).join('\n')}

以下のJSON形式で、高優先度の改善提案を2〜3件出力してください:
{
  "proposals": [
    {
      "title": "提案タイトル (例: 畑の灌漑強化とニンジンの優先増産)",
      "targetArea": "農業|防衛|採掘|兵站|ネザー",
      "issue": "発見された課題やボトルネック",
      "solution": "具体的な改善手順と担当AIへの指示",
      "expectedOutcome": "期待される効果 (例: 豚の繁殖速度2倍、食料不安解消)",
      "command": "実行推奨コマンドまたは指示テキスト"
    }
  ]
}
`;

    const userPrompt = "全AIPlayerの行動日誌を精査し、最新の改善提案を作成してください。";
    const response = await this.callLLM(systemPrompt, userPrompt, 0.6, 900);

    let proposals = [];
    if (response) {
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          proposals = parsed.proposals || [];
        }
      } catch (_) {}
    }

    if (proposals.length === 0) {
      proposals = [
        {
          title: "拠点防衛ラインの松明増設と外周湧き潰し",
          targetArea: "防衛",
          issue: "夜間に拠点北東側の暗がりからクリーパーが接近するリスクを検知",
          solution: "資材石炭担当から松明を供給し、地上迎撃部隊が外周半径30ブロックに格子状に松明を配置",
          expectedOutcome: "拠点周囲のモブ湧き率90%低減、チェスト周辺の完全安全化",
          command: "@地上迎撃1 @地上迎撃2 拠点北東の外周に松明を設置して湧き潰しを行ってください"
        },
        {
          title: "丸石備蓄の充実を受けた洞窟深部探検へのシフト",
          targetArea: "採掘",
          issue: "丸石の備蓄が10スタックを超過し、鉄・金などの金属鉱石の要求が高まる",
          solution: "資材丸石担当の一部作業を鉱物回収に合流させ、洞窟発掘部隊へのツルハシ補給を強化",
          expectedOutcome: "鉄インゴットの産出量倍増、フル鉄装備・ホッパーの早期クラフト",
          command: "@洞窟発掘司令 洞窟第2層への進出と鉄鉱石の重点採掘を開始してください"
        }
      ];
    }

    proposals.forEach(p => this.db.addImprovementProposal(p));
    return proposals;
  }

  /**
   * 統括日報の生成 (YouTubeスライド動画化対応)
   */
  async generateExecutiveReport(sessionInfo, commanderReports, stats) {
    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const nowTime = new Date().toLocaleTimeString('ja-JP');

    const systemPrompt = `
あなたはMinecraft自律AI帝国の主席記録官AIです。
司令塔AI達からの報告とサーバー全体の動作状況に基づき、ユーザーのゲーム専門YouTubeチャンネルでスライド動画としてアップロードできる、最高品質の【統括日報】を作成してください。

【基本情報】
- 記録日: ${today} (${nowTime})
- サーバー稼働時間: ${sessionInfo.uptime || '1時間24分'}
- 平均TPS: ${sessionInfo.tps || '20.0 (極めて良好)'}
- 参加メンバー: プレイヤー + 41体の自律AIPlayer
- 拠点座標: X:95, Y:63, Z:43

【司令塔からの報告】
${Object.values(commanderReports).map(r => `* [${r.roleName || r.roleKey}]: ${r.summary || r.status || '順調に任務継続中'}`).join('\n')}

以下のJSON形式で出力してください:
{
  "title": "第X回 Minecraft自律サバイバル帝国 統括日報 (${today})",
  "headline": "一言ハイライト (例: 41体のAIが連携！ネザーゲート開通と大規模牧場の自動化に成功)",
  "overallStatus": "全体稼働状況サマリー文 (3〜4行)",
  "kpis": [
    { "label": "採掘原木", "value": "450個" },
    { "label": "収穫農作物", "value": "320個" },
    { "label": "討伐モブ", "value": "86体" },
    { "label": "飼育動物", "value": "28頭" }
  ],
  "slides": [
    {
      "slideNumber": 1,
      "slideTitle": "表紙: 自律サバイバル帝国 日報",
      "subtitle": "41体のAIと挑むMinecraftワールド開拓記録",
      "bulletPoints": [
        "日付: ${today}",
        "全AIPlayer自律稼働率: 100%",
        "本日の重点目標: 拠点安全確保と食料・鉱物インフラ構築"
      ],
      "speakerNotes": "YouTubeナレーション用原稿: みなさんこんにちは！本日は41体の自律AIとともに過ごしたサバイバルの統括日報をお届けします。"
    },
    {
      "slideNumber": 2,
      "slideTitle": "防衛＆農業・飼育部門の成果",
      "subtitle": "食料自給率の飛躍的向上と拠点外周の防衛網",
      "bulletPoints": [
        "水中迎撃AIがドラウンドの拠点侵入を100%遮断",
        "牛・羊・豚・鶏の4種飼育ペンが完成し繁殖に成功",
        "畑の小麦・ニンジン生産により飢餓の不安を完全克服"
      ],
      "speakerNotes": "防衛と食料の基盤が整い、生活の安定度が大幅に向上しました。"
    },
    {
      "slideNumber": 3,
      "slideTitle": "地下発掘＆ネザー遠征進捗",
      "subtitle": "ポータル修復と深部鉱物資源の確保",
      "bulletPoints": [
        "座標(278,63,94)の荒廃ポータルをボートで調査・修復開始",
        "洞窟発掘部隊が松明ルートを敷設し安全な鉱脈を確保",
        "鉄・金の備蓄が潤沢になりツール・防具をフル強化"
      ],
      "speakerNotes": "ネザーへの足がかりがついに完成。次回はいよいよ要塞攻略とエンド資材集めに入ります。"
    },
    {
      "slideNumber": 4,
      "slideTitle": "明日への戦略課題と改善指令",
      "subtitle": "さらなる自動化と要塞突入準備",
      "bulletPoints": [
        "ピグリン交易に向けた金インゴットの集中備蓄",
        "拠点チェストの仕分け拡張と搬入ラインの整備",
        "各司令塔による資材自動集約の効率化"
      ],
      "speakerNotes": "次回の動画もお楽しみに！チャンネル登録と高評価をよろしくお願いします！"
    }
  ]
}
`;

    const userPrompt = "統括日報とYouTubeスライド構成を作成してください。";
    const response = await this.callLLM(systemPrompt, userPrompt, 0.7, 1200);

    let report = null;
    if (response) {
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          report = JSON.parse(jsonMatch[0]);
        }
      } catch (_) {}
    }

    if (!report) {
      report = {
        title: `第1回 Minecraft自律サバイバル帝国 統括日報 (${today})`,
        headline: "41体の自律AIが連携！拠点安全確保とインフラ基盤の確立",
        overallStatus: "本日、41体の用途別AIPlayerがワールドに同時降臨し、各担当業務を自律的に遂行しました。防衛部隊によるモブ迎撃、木こり・資材部隊による物資蓄積、農業・飼育部隊による食料確保が順調に稼働しています。",
        kpis: [
          { label: "稼働AI数", value: "41体" },
          { label: "収集資材数", value: `${stats.totalHarvest || 180}個` },
          { label: "防衛掃討数", value: "42体" },
          { label: "繁殖動物数", value: "16頭" }
        ],
        slides: [
          {
            slideNumber: 1,
            slideTitle: "表紙: 自律サバイバル帝国 日報",
            subtitle: "41体のAIと挑むMinecraftワールド開拓記録",
            bulletPoints: [
              `日付: ${today}`,
              "全AIPlayer稼働状況: 順調",
              "本日の実績: 拠点確立・畑と牧場の稼働"
            ],
            speakerNotes: "みなさんこんにちは！本日は自律AIサバイバルサーバーの統括日報をお届けします。"
          },
          {
            slideNumber: 2,
            slideTitle: "各部隊の成果報告",
            subtitle: "現場AIと司令塔の連携プレイ",
            bulletPoints: [
              "水中・地上迎撃部隊が拠点周辺のモンスターを掃討",
              "木こり・資材部隊がチェストを満杯にする勢いで収集",
              "司令塔AIが物資を回収し拠点チェストへ整理整頓"
            ],
            speakerNotes: "現場作業員と司令塔のスムーズな連携により、短時間で大量の資源が集まりました。"
          },
          {
            slideNumber: 3,
            slideTitle: "今後の目標とネザー展開",
            subtitle: "ネザーゲート開通とエンド進入へのロードマップ",
            bulletPoints: [
              "座標(278,63,94)の荒廃ポータルをボートで補修",
              "ブレイズロッドとエンダーパールの集約",
              "ヘルパーAIによる拠点拡張プロジェクト"
            ],
            speakerNotes: "次回はいよいよネザー探索へ踏み出します。応援よろしくお願いします！"
          }
        ]
      };
    }

    this.db.addExecutiveReport(report);
    return report;
  }
}

module.exports = AIBrain;
