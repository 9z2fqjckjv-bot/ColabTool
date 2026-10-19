/**
 * brain.js - Qwen 2.5 推論・自律思考・グループ会話・ペア協調・改善提案・統括日報エンジン
 * Google Colab L4 GPU (24GB VRAM) 最適化 (qwen2.5:14b) - 改善指示書v3準拠
 */

const axios = require('axios');
const knowledgeBase = require('./knowledge_base');
const db = require('./database');

class AIBrain {
  constructor(options = {}) {
    this.apiUrl = process.env.LLM_API_URL || 'http://localhost:8000/v1/chat/completions';
    this.modelName = process.env.LLM_MODEL || 'qwen2.5:7b';
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

  async callLLM(systemPrompt, userPrompt, temperature = 0.7, maxTokens = 400) {
    if (this.isProcessing) {
      return null;
    }
    this.isProcessing = true;
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
        timeout: 15000
      });

      if (response.data && response.data.choices && response.data.choices.length > 0) {
        return response.data.choices[0].message.content.trim();
      }
    } catch (e) {
      // OpenAI互換エンドポイントで失敗した場合、Ollamaネイティブ /api/chat を試行
      try {
        const ollamaNativeUrl = this.apiUrl.replace('/v1/chat/completions', '/api/chat');
        const nativePayload = {
          model: this.modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          stream: false,
          options: { temperature, num_predict: maxTokens }
        };
        const res2 = await axios.post(ollamaNativeUrl, nativePayload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 12000
        });
        if (res2.data && res2.data.message && res2.data.message.content) {
          return res2.data.message.content.trim();
        }
      } catch (err2) {
        // フォールバック失敗時はnullを返す
      }
    } finally {
      this.isProcessing = false;
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
必要な道具や食料が足りない場合は、遠慮なくプレイヤーに要求してください。

【現在の状況】
- あなたの役職: ${role.roleName} (${role.displayName})
- グループ: 第${role.group || 1}グループ
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
   * 第1グループ内の会話生成（改善指示書v3要件: グループ一体の作業）
   */
  async generateGroup1Conversation(speakerRole, listenerRole, taskContext) {
    const systemPrompt = `
あなたはMinecraftの第1グループ（拠点開拓・生活基盤部隊）に所属する自律AI「${speakerRole.displayName}」です。
同じ第1グループの仲間「${listenerRole.displayName}」に向けて、作業の連携・状況報告・安全確認の短い会話（1文程度）を交わしてください。
例:
「周囲のゾンビを掃討しました！今のうちに畑の作業を進めてください！」
「原木を1スタック集めました。チェストに納品してきます！」
「食料の備蓄が増えてきましたね。今日も安全第一でいきましょう！」
`;
    const userPrompt = `現在の状況: ${taskContext}。仲間への声掛けを一言作成してください。`;
    const response = await this.callLLM(systemPrompt, userPrompt, 0.8, 150);
    return response ? response.replace(/["“”]/g, '').trim() : `${listenerRole.displayName}、順調に作業進んでいます！引き続き協力していきましょう！`;
  }

  /**
   * 2人ペア間の会話生成（資材集めペア、洞窟発掘ペア、ネザー遠征ペアの共同作業）
   */
  async generatePairConversation(bot1Role, bot2Role, pairType, situation) {
    const systemPrompt = `
あなたはMinecraftの2人ペア共同作業（${pairType}）を担当する「${bot1Role.displayName}」です。
相棒の「${bot2Role.displayName}」と息の合った共同作業をするための声掛け（1文程度）を行ってください。
- 資材集めペア: 採掘箇所の分担や収集状況の連絡
- 洞窟発掘ペア: 松明設置、鉱脈発見、敵対モブ警戒、深部探索の連携
- ネザー遠征ペア: ボート移動、ゲート修復、ネザー要塞探索、ブレイズ戦のカバー
`;
    const userPrompt = `現在のペア作業状況: ${situation}。相棒への短い声掛けを作成してください。`;
    const response = await this.callLLM(systemPrompt, userPrompt, 0.8, 150);
    return response ? response.replace(/["“”]/g, '').trim() : `${bot2Role.displayName}、足元に気をつけて！一緒にしっかり進めよう！`;
  }

  /**
   * 必要な道具・アイテム・食料の要求文言生成
   */
  async generateItemDemand(role, missingItem, reason) {
    const systemPrompt = `
あなたはMinecraftの自律AI「${role.displayName}」(${role.roleName})です。
作業を円滑に進めるために必要なアイテム「${missingItem}」が不足しています。
プレイヤーに対して、敬意を払いつつ必要なアイテムを拠点チェストに入れてもらうか手渡ししてもらうよう要求するメッセージ（1〜2文）を作成してください。
`;
    const userPrompt = `不足アイテム: ${missingItem}、理由: ${reason}。要求メッセージを作成してください。`;
    const response = await this.callLLM(systemPrompt, userPrompt, 0.7, 180);
    return response ? response.replace(/["“”]/g, '').trim() : `プレイヤー様、作業続行のために「${missingItem}」が必要です！拠点チェストに入れていただくか、お渡しいただけると助かります！`;
  }

  /**
   * 司令等（グループリーダー）によるユーザー指示達成状況レポート作成
   */
  async generateUserTaskReport(leaderRole, instruction, currentStatus, stats) {
    const systemPrompt = `
あなたは第${leaderRole.group}グループ統括リーダー「${leaderRole.displayName}」です。
プレイヤーから受けた指示に対する【達成状況と報告レポート】を論理的かつ詳細に作成してください。

【指示内容】
${instruction}

【現在の進捗状況】
${currentStatus}

【グループ実績】
- 稼働メンバー数: ${stats.activeCount}名
- 収集・成果物総数: ${stats.harvestCount}個
- 拠点チェスト格納状況: 正常

以下のJSON形式でレポートを出力してください:
{
  "taskTitle": "指示の要約タイトル",
  "commanderName": "${leaderRole.displayName}",
  "groupNumber": ${leaderRole.group},
  "progressPercent": 85,
  "status": "進行中|達成完了|支援要請",
  "achievements": [
    "達成された具体的成果1",
    "達成された具体的成果2"
  ],
  "nextSteps": "次のアクション計画",
  "requestsToUser": "ユーザーへのお願いや追加要望（なければ「なし」）"
}
`;
    const userPrompt = "指示達成レポートを作成してください。";
    const response = await this.callLLM(systemPrompt, userPrompt, 0.7, 600);

    let parsed = null;
    if (response) {
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch (_) {}
    }

    if (!parsed) {
      parsed = {
        taskTitle: instruction.substring(0, 30),
        commanderName: leaderRole.displayName,
        groupNumber: leaderRole.group,
        progressPercent: 75,
        status: "進行中",
        achievements: ["担当メンバーが現場に急行し作業を推進中", "資材の拠点チェスト搬入を順次実行中"],
        nextSteps: "目標数量の達成まで継続作業を実施します",
        requestsToUser: "作業用のツルハシと食料の補充をお願いします"
      };
    }

    this.db.addUserTaskReport(parsed);
    return parsed;
  }

  /**
   * 行動日誌の分析と改善提案の生成 (Qwen 2.5 学習・提案機能)
   */
  async analyzeDiariesAndProposeImprovements(recentDiaries, dbStats) {
    const systemPrompt = `
あなたはMinecraft自律AIサバイバルサーバーの最高戦略アナリストAIです。
全10体のAIPlayer（第1グループ: 拠点開拓5名、第2グループ: 施設飼育・遠征5名）の行動日誌と資材データベースを分析し、
サバイバル生活をより安全・高効率・快適にするための【改善提案】を論理的に策定してください。

【現在の統計データ】
- 稼働中AIPlayer数: ${dbStats.activeBots}/${dbStats.totalBots}
- 累計収集資材: ${dbStats.totalHarvest} 個
- 拠点チェスト数: ${dbStats.totalChests} 箱
- 畑の耕作地数: ${dbStats.farmPlots} ブロック
- 飼育場の動物総数: ${dbStats.ranchTotal} 頭

【最近の行動日誌サマリー】
${recentDiaries.slice(0, 15).map(d => `- [${d.role}] (${d.time || '記録'}): ${d.content}`).join('\n')}

以下のJSON形式で、高優先度の改善提案を2〜3件出力してください:
{
  "proposals": [
    {
      "title": "提案タイトル (例: 畑の灌漑拡張と洞窟探検用の松明集中備蓄)",
      "targetArea": "農業|防衛|採掘|飼育|ネザー",
      "issue": "発見された課題やボトルネック",
      "solution": "具体的な改善手順と担当グループへの指示",
      "expectedOutcome": "期待される効果 (例: 食料生産速度2倍、洞窟内事故ゼロ)",
      "command": "実行推奨コマンドまたは指示テキスト"
    }
  ]
}
`;

    const userPrompt = "行動日誌を分析し、具体的かつ実践的な改善提案を2〜3件策定してください。";
    const response = await this.callLLM(systemPrompt, userPrompt, 0.7, 800);

    let parsed = null;
    if (response) {
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch (_) {}
    }

    if (!parsed || !parsed.proposals) {
      parsed = {
        proposals: [
          {
            title: "拠点周囲の照明増設とチェスト仕分けの標準化",
            targetArea: "防衛",
            issue: "夜間に拠点北東の水辺からドラウンドやスケルトンが接近しやすい",
            solution: "撃退隊長のパトロール範囲に松明を増設し、資材集めペアが集めた丸石で防壁を補強する",
            expectedOutcome: "拠点内へのモブ湧きゼロ化と安全な搬入路の確保",
            command: "@撃退 拠点北側の警戒を強化し、松明を配置してください"
          },
          {
            title: "洞窟発掘ペアの松明・ツルハシ集中補給と深部鉄鉱石抽出",
            targetArea: "採掘",
            issue: "洞窟探検1・2のツール消耗速度が早く、鉄の在庫が逼迫している",
            solution: "資材集めペアがかまどで鉄鉱石を精錬し、アイアンツールを予備チェストに2セット常備する",
            expectedOutcome: "洞窟発掘の探検継続時間を2倍に延伸",
            command: "@資材1 鉄鉱石を優先精錬し、チェストに鉄のツルハシを補充してください"
          }
        ]
      };
    }

    for (const p of parsed.proposals) {
      this.db.addImprovementProposal(p);
    }
    return parsed.proposals;
  }

  /**
   * 統括日報の自動生成 (YouTubeスライド表示対応・改善指示書v3仕様)
   */
  async generateExecutiveReport(sessionInfo, stats) {
    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
    const nowTime = new Date().toLocaleTimeString('ja-JP');

    const systemPrompt = `
あなたはMinecraft自律サバイバルサーバーの統括AIです。
YouTubeゲーム専門チャンネルにアップロードするための【統括日報 (プレゼンテーションスライド形式)】を作成してください。
実際の日付: ${today} (${nowTime})

【全体状況データ】
- 稼働時間: ${sessionInfo.uptime || '1時間20分'}
- サーバーTPS: ${sessionInfo.tps || 20.0} (安定動作)
- 参加AIPlayer: 全10名（第1グループ: 拠点開拓5名、第2グループ: 施設飼育・遠征5名）
- 累計資材収集数: ${stats.totalHarvest || 150}個
- 拠点チェスト数: ${stats.totalChests || 4}箱
- 畑耕作ブロック数: ${stats.farmPlots || 45}
- 飼育家畜数: ${stats.ranchTotal || 18}頭

以下のJSON形式で、YouTubeスライドとして映える4枚のスライド構成と統括日報を出力してください:
{
  "title": "${today} Minecraft自律サバイバル帝国 統括日報",
  "headline": "10体の自律AIが織りなす完全自動開拓生活",
  "date": "${today}",
  "overallStatus": "サーバー全体の稼働状況サマリー",
  "kpis": [
    { "label": "第1グループ稼働", "value": "5名 (100%)" },
    { "label": "第2グループ稼働", "value": "5名 (100%)" },
    { "label": "累計収穫資材", "value": "${stats.totalHarvest || 150}個" },
    { "label": "サーバー健全度", "value": "TPS 20.0" }
  ],
  "slides": [
    {
      "slideNumber": 1,
      "slideTitle": "表紙: 自律サバイバル開拓日報",
      "subtitle": "2つの専門グループと挑む新世界",
      "bulletPoints": [
        "実施日: ${today}",
        "第1グループ (生活開拓5名) & 第2グループ (飼育遠征5名)",
        "本日の重点課題: 食料インフラと洞窟・ネザー探検の準備"
      ],
      "speakerNotes": "YouTubeナレーション用原稿: みなさんこんにちは！本日は新体制10体の自律AIで挑むサバイバル統括日報をお届けします。"
    },
    {
      "slideNumber": 2,
      "slideTitle": "第1グループ: 拠点開拓＆生活基盤の成果",
      "subtitle": "防衛・農作業・資材ペア・モブ狩りの連携プレイ",
      "bulletPoints": [
        "撃退隊長が拠点周囲の敵対モブを完封し安全地帯を確立",
        "農作業AIが小麦・ニンジン畑を耕作し食料自給を開始",
        "資材集め1&2がペア会話で連携し、原木・丸石・石炭を大量納品",
        "モブ狩りAIが野生の中立モブから食肉と革を確保"
      ],
      "speakerNotes": "第1グループのチームワークが光り、短時間で強固な生活基盤が整いました。"
    },
    {
      "slideNumber": 3,
      "slideTitle": "第2グループ: 動物飼育＆深部探検の進捗",
      "subtitle": "家畜繁殖と自律型洞窟・ネザー攻略",
      "bulletPoints": [
        "飼育AIが牛・羊・豚・鶏の4種専用ペンを建設し飼育開始",
        "洞窟発掘ペア(1&2)が松明ルートを敷設し鉱物資源を採掘",
        "ネザー遠征ペア(1&2)がボートで座標(278,63,94)へ展開、ゲート修復を推進",
        "人間不在でもAI単独で危険地域を完遂するルーチンを実証"
      ],
      "speakerNotes": "第2グループは飼育と探検を担当。AIだけで洞窟とネザーを攻略する驚異の進捗を見せています。"
    },
    {
      "slideNumber": 4,
      "slideTitle": "次回への展望とYouTube視聴者へのメッセージ",
      "subtitle": "エンドポータル発見と帝国の完全自動化へ",
      "bulletPoints": [
        "ネザー要塞のブレイズロッド回収とエンダーアイの精製",
        "拠点大型倉庫へのチェスト自動仕分け機構の導入",
        "高評価＆チャンネル登録よろしくお願いします！"
      ],
      "speakerNotes": "次回はいよいよエンドへの突入準備に入ります。ぜひチャンネル登録と高評価をお願いします！"
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
        if (jsonMatch) report = JSON.parse(jsonMatch[0]);
      } catch (_) {}
    }

    if (!report) {
      report = {
        title: `${today} Minecraft自律サバイバル帝国 統括日報`,
        headline: "10体の自律AIが織りなす完全自動開拓生活",
        date: today,
        overallStatus: "第1グループ（5名）および第2グループ（5名）がワールド内で連携し、拠点防衛、農業、資材採集、家畜飼育、洞窟・ネザー探検を自律的に遂行しました。",
        kpis: [
          { label: "第1グループ", value: "5名稼働" },
          { label: "第2グループ", value: "5名稼働" },
          { label: "累計収集資材", value: `${stats.totalHarvest || 150}個` },
          { label: "サーバーTPS", value: "20.0" }
        ],
        slides: [
          {
            slideNumber: 1,
            slideTitle: "表紙: 自律サバイバル開拓日報",
            subtitle: "2つの専門グループと挑む新世界",
            bulletPoints: [
              `実施日: ${today}`,
              "第1グループ (生活開拓5名) & 第2グループ (飼育遠征5名)",
              "本日の重点課題: 食料インフラと洞窟・ネザー探検の推進"
            ],
            speakerNotes: "みなさんこんにちは！本日は新体制10体の自律AIで挑むサバイバル統括日報をお届けします。"
          },
          {
            slideNumber: 2,
            slideTitle: "第1グループ: 拠点開拓＆生活基盤の成果",
            subtitle: "防衛・農作業・資材ペア・モブ狩りの連携プレイ",
            bulletPoints: [
              "撃退隊長が拠点周囲のモンスターを排除し安全を確立",
              "農作業AIが畑を耕作し作物の収穫サイクルを始動",
              "資材集めペアが連携し原木・丸石・石炭をチェストへ納品",
              "モブ狩りAIが野生動物から食料を調達"
            ],
            speakerNotes: "第1グループの一体となった作業により、生活基盤が強固に整いました。"
          },
          {
            slideNumber: 3,
            slideTitle: "第2グループ: 動物飼育＆深部探検の進捗",
            subtitle: "家畜繁殖と自律型洞窟・ネザー攻略",
            bulletPoints: [
              "飼育AIが牛・羊・豚・鶏の専用ペンを建設し飼育・繁殖",
              "洞窟発掘ペアが松明を設置しながら地下資源を採掘",
              "ネザー遠征ペアがボートでポータル座標へ到達し修復作業",
              "AIのみによる深部探検の完遂を確認"
            ],
            speakerNotes: "第2グループは飼育と探検を担当。AIだけで洞窟とネザーを攻略する成果を上げています。"
          },
          {
            slideNumber: 4,
            slideTitle: "次回への展望とYouTube視聴者へのメッセージ",
            subtitle: "エンドポータル発見と帝国の完全自動化へ",
            bulletPoints: [
              "ネザー要塞の攻略とブレイズロッド・エンド資材の回収",
              "拠点インフラの強化とチェスト収納の最適化",
              "高評価＆チャンネル登録よろしくお願いします！"
            ],
            speakerNotes: "次回はいよいよエンド突入準備です。ぜひチャンネル登録をお願いします！"
          }
        ]
      };
    }

    this.db.addExecutiveReport(report);
    return report;
  }
}

module.exports = AIBrain;
