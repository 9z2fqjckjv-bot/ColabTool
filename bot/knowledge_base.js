/**
 * knowledge_base.js - Minecraft サバイバル & クラフト戦略ナレッジベース (RAGエンジン)
 * 初動サバイバル、クラフトツリー、モブ対処法、危険回避、ツール適正の専門知識を保持し、
 * Botの現在状況や視界認識結果に応じて最適な知識を動的に抽出します。
 */

const MINECRAFT_KNOWLEDGE = [
  // --- 1. クラフトツリー・初動サバイバル ---
  {
    id: 'craft_basics_wood',
    category: 'crafting',
    tags: ['log', 'wood', 'planks', 'stick', 'crafting_table', '木', '原木', '木材', '作業台', '棒'],
    title: '木材から基本ツールのクラフト',
    content: '原木1つから木材4つを作成可能。木材2つから棒4つを作成。木材4つで作業台を作成。作業台を使うことで3x3グリッドでのツール（木の剣、木のツルハシ、斧、シャベル）がクラフト可能になる。'
  },
  {
    id: 'craft_stone_tools',
    category: 'crafting',
    tags: ['stone', 'cobblestone', 'stone_pickaxe', 'stone_sword', '石', '丸石', 'ツルハシ', '石ツール'],
    title: '石製ツールと採掘の進化',
    content: '木のツルハシで丸石を採掘すると石製ツール（石のツルハシ、石の剣、石の斧）が作れる。石のツルハシがあれば鉄鉱石やラピスラズリを採掘できるようになる。素手や木のツールで石を掘るとブロックがドロップしないので注意。'
  },
  {
    id: 'craft_furnace_cook',
    category: 'survival',
    tags: ['furnace', 'campfire', 'cook', 'food', 'beef', 'porkchop', 'mutton', 'chicken', '肉', 'かまど', '焚き火', '料理'],
    title: '食料の調理とかまど・焚き火の活用',
    content: '丸石8個でかまどを作成。木材や木炭・石炭を燃料にして生肉を焼くと、回復量と隠し満腹度が2〜3倍に向上する。焚き火は燃料不要で上に4つの肉を置くだけで自動調理できるため最序盤に最適。'
  },
  {
    id: 'craft_bed_shelter',
    category: 'survival',
    tags: ['bed', 'wool', 'night', 'sleep', 'ベッド', '羊毛', '夜', '睡眠'],
    title: 'ベッドの作成と夜のスキップ',
    content: '羊毛3つ＋木材3つでベッドを作成。夜間にベッドを右クリックして眠ると、モンスターが湧く危険な夜を一瞬で朝にスキップできる。またリスポーン地点を固定できる。'
  },
  {
    id: 'base_night_cycle_chest_bed',
    category: 'survival',
    tags: ['base', 'chest', 'bed', 'sleep', 'night', 'sunset', 'morning', 'explore', 'patrol', 'logout', '拠点', 'チェスト', 'ベッド', '就寝', '日没', '朝', '探検', '所持品', 'パトロール', 'ログアウト廃止'],
    title: '拠点の夜間生活サイクル（チェスト収納・周回パトロール・就寝・朝の継続探検）',
    content: '日没が近づいたら（時間11500以降）、北向きドア(94, 63, 39)から拠点(X:92〜97, Z:39〜47)へ入室。最寄りのチェストに全ての所持品を収納してインベントリを空にする。その後、拠点内部を何周かパトロールし、ベッドで寝付くまで無制限に周回しながら空いているベッドで就寝する。朝が来たら強制ログアウトされる仕様は完全廃止されており、切断せずドアから外に出て身軽なまま探検へ出発する。'
  },
  {
    id: 'base_exact_bounds_and_patrol',
    category: 'survival',
    tags: ['base', 'coordinates', 'bounds', 'door', 'patrol', 'chest', 'bed', 'sleep', 'night', 'morning', 'wake', 'logout', '拠点', '範囲', '座標', '境界', 'ドア', '周回', 'パトロール', '部屋', '朝', 'ログアウト廃止'],
    title: '拠点の精密境界座標と夜間周回パトロール＆朝の常駐仕様',
    content: '動画(2026-10-15 12.45.18.mov)解析に基づく拠点の正確な領域は X:[92, 97], Y:[62, 68], Z:[39, 47]。部屋内部の歩行可能エリアは X:[93, 96], Y:63, Z:[40, 46]。入り口ドアは北向き(94, 63, 39)。夜間はドアを通って入室しチェストにアイテムを収納後、拠点内の4隅および中央（94,63,41 → 96,63,41 → 96,63,45 → 94,63,45 → 95,63,43）を何周かパトロールし、空いているベッドで寝付くまで無制限に周回する。朝を迎えてベッドから起床した後は強制ログアウトせず、常駐したままドアから外に出て探検活動を継続する。'
  },
  {
    id: 'villager_door_gate_behavior',
    category: 'survival',
    tags: ['door', 'gate', 'fence_gate', 'trapdoor', 'open', 'close', 'villager', 'ドア', 'フェンス', '柵', 'ゲート', '開閉', '村人'],
    title: '村人動作によるドアと柵（フェンスゲート）の開閉マナー',
    content: '移動時に閉まっている木製ドアやフェンスゲート、トラップドアがあれば右クリックで開けて通り抜ける。そして通り抜けた後は必ず後ろを振り返ってドアやフェンスゲートを閉める（村人と同様の動作）。これによりモンスターの拠点侵入を防ぎ、安全を保つ。'
  },
  {
    id: 'obstacle_bypass_navigation',
    category: 'survival',
    tags: ['obstacle', 'bypass', 'detour', 'jump', 'parkour', 'dig', '壊さない', '障害物', '迂回', '回り道', 'ジャンプ'],
    title: '障害物の非破壊・迂回（回り道）ナビゲーション',
    content: '進路に壁やフェンス、段差などの障害物がある際、すぐにブロックを壊して進むのではなく、ジャンプで乗り越えるか、左右へサイドステップして回り込む（迂回する）ことで、建築物や地形を破壊せずにスマートに進む。'
  },
  {
    id: 'craft_torches',
    category: 'survival',
    tags: ['torch', 'coal', 'charcoal', 'light', '松明', '石炭', '木炭', '明かり'],
    title: '松明による湧き潰しと視界確保',
    content: '石炭（または原木をかまどで焼いた木炭）1個＋棒1本で松明4本を作成。モンスターは明るさ0の暗所にのみ湧くため、拠点周囲や洞窟に松明を設置して安全地帯（湧き潰し）を構築する。'
  },
  {
    id: 'craft_ferry_boat',
    category: 'crafting',
    tags: ['boat', 'ferry', 'water', 'river', 'planks', 'craft', 'ボート', 'フェリー', '船', '川', '水上', '木材'],
    title: 'フェリー（木製ボート）のクラフトと川の渡航・水上活用',
    content: '木材5個を作業台でU字型に並べてボート（フェリー）をクラフト。川や湖の水面に浮かべて乗船（右クリック）することで、水上を歩行の数倍のスピードでノーコスト航行可能。溺死や水流のリスクを完全排除し、遠方探検の最重要足となる。'
  },
  {
    id: 'river_exploration_expedition',
    category: 'exploration',
    tags: ['river', 'explore', 'water', 'far', 'expedition', '川', '川沿い', '探検', '遠出', '遠征', '航行', '行動範囲'],
    title: '川沿いを中心とした広域遠征・水上探検戦略',
    content: '川はバイオームや地形を繋ぐ天然の高速移動ルート。拠点内に留まることなく、川沿いや水面をフェリー（ボート）や徒歩で下ることで、100〜300ブロック以上離れた新バイオーム、露出鉱石、未開拓林を安全・高速に発見可能。夜間前に拠点へ帰還するか安全な野営地を確保する。'
  },
  {
    id: 'tools_progression_wood_to_stone',
    category: 'crafting',
    tags: ['wood', 'stone', 'pickaxe', 'axe', 'sword', 'craft', 'gather', '木', '石', '丸石', 'ツルハシ', '基本ツール', '材料収集'],
    title: '木から石への基本ツール材料収集と段階的クラフト手順',
    content: '①原木を伐採して木材・棒・作業台を作成。②木のツルハシを作成。③木のツルハシで丸石を最低3〜11個採掘（素手では石がドロップしない）。④石のツルハシ、石の斧、石の剣、石のシャベルをクラフト。これにより採掘速度と攻撃力が飛躍的に向上し、鉄鉱石の採掘も可能になる。'
  },
  {
    id: 'communication_5w3h_protocol',
    category: 'communication',
    tags: ['5w3h', 'chat', 'whisper', 'communication', 'japanese', '報告', 'ささやき', 'チャット', '日本語'],
    title: '5W3H（だれが・いつ・どこで・なにを・なぜ・どのように・どれくらい・どの距離）対話報告原則',
    content: 'プレイヤーとのチャットおよびゲーム画面からのささやき（/tell, /msg, /whisper）への応答では、5W3Hを自然に取り入れて「【Who:私】【When:今すぐ/朝のうちに】【Where:川沿い/拠点東の森で】【What:フェリーや石ツールを】【Why:遠征路を開拓するため】【How:作業台と手作りツールを使って】【How much/many:ボート1隻と丸石10個】【How long/far:150ブロック先まで】」を明確に伝え、状況と次のアクションを透明化する。'
  },

  // --- 2. 敵対モブ攻略 & 戦闘戦術 ---
  {
    id: 'mob_zombie',
    category: 'combat',
    tags: ['zombie', 'drowned', 'husk', 'ゾンビ', '溺死ゾンビ'],
    title: 'ゾンビ・溺死ゾンビの対処法',
    content: '近接攻撃のみを行う。日光を浴びると自然発火して死亡するが、水場や木陰では燃えない。リーチはこちらの剣の方が長いため、バックしながら攻撃（引き撃ち）すればノーダメージで撃破可能。'
  },
  {
    id: 'mob_skeleton',
    category: 'combat',
    tags: ['skeleton', 'stray', 'bow', 'arrow', 'スケルトン', '弓', '矢'],
    title: 'スケルトンの対処法（弓矢対策）',
    content: '遠距離から弓矢で狙撃してくる。開けた場所では直線的に走らず、左右にジグザグ移動（ストレイフ）しながら距離を詰めて近接攻撃する。木やブロックの陰に隠れておびき寄せるのが有効。'
  },
  {
    id: 'mob_creeper',
    category: 'combat',
    tags: ['creeper', 'explosion', 'tnt', 'クリーパー', '爆発'],
    title: 'クリーパーの対処法（最重要警戒）',
    content: '音もなく接近し、約3ブロック以内で「シュー」という音とともに白色に点滅し爆発する。即死リスクがあるため、1回叩いたら即座に後方へダッシュ（ヒット＆アウェイ）するか、弓矢で遠隔処理する。'
  },
  {
    id: 'mob_spider',
    category: 'combat',
    tags: ['spider', 'cave_spider', 'クモ', '蜘蛛'],
    title: 'クモ・洞窟グモの対処法',
    content: '壁を登り、低姿勢で飛びかかって攻撃してくる。夜間・暗所では敵対するが、昼間の明るい場所では中立。ジャンプしてきたところを下から見上げて迎撃すると倒しやすい。糸は弓や釣竿の素材になる。'
  },
  {
    id: 'mob_enderman',
    category: 'combat',
    tags: ['enderman', 'pearl', 'エンダーマン'],
    title: 'エンダーマンの対処法',
    content: '視線（照準のクロスヘア）を頭に合わせると敵対して高速ワープ接近してくる。視線を合わせないこと。戦う場合は水に弱いため水場に入るか、高さ2ブロックの天井を作るとエンダーマンは侵入できず一方的に攻撃可能。'
  },

  // --- 3. 環境危険回避 & 安全ルール ---
  {
    id: 'env_water_drowning',
    category: 'safety',
    tags: ['water', 'drown', 'oxygen', 'swim', '水', '水中', '溺れる', '酸素'],
    title: '水没・溺死からの緊急脱出',
    content: '水中に潜ると酸素ゲージが減少し、ゼロになると継続ダメージを受ける。スペースキー（ジャンプ操作）を押し続けて水面に浮上し息継ぎをする。最寄りの乾燥した土・石などの陸地に上がり体勢を立て直す。'
  },
  {
    id: 'env_lava_fire',
    category: 'safety',
    tags: ['lava', 'fire', 'burn', 'マグマ', '溶岩', '炎', '火災'],
    title: '溶岩・マグマ接触時の緊急対応',
    content: '溶岩に触れると極めて高い継続ダメージを受ける。即座に後退して水に入るか、水バケツを足元に流して消火する。真下掘り（直下掘り）は溶岩ダイブの危険があるため絶対に行ってはならない。'
  },
  {
    id: 'env_fall_damage',
    category: 'safety',
    tags: ['fall', 'cliff', 'height', '落下', '崖', '高所'],
    title: '落下ダメージの防止',
    content: '高所からの落下は3ブロック以上でダメージを受ける。崖の縁を歩くときはしゃがみ（スニーク）を維持すると転落しない。水たまりや干草の俵に落ちると落下ダメージを無効化・大幅軽減できる。'
  },

  // --- 4. 資源採掘・ツール適正 ---
  {
    id: 'mine_iron_tier',
    category: 'mining',
    tags: ['iron_ore', 'raw_iron', 'iron_ingot', '鉄', '鉄鉱石', '精錬'],
    title: '鉄の採掘とツール更新',
    content: '石のツルハシ以上で鉄鉱石を採掘可能。かまどで原鉄を精錬して鉄インゴットにする。鉄のツルハシ、鉄の剣、鉄の防具一式を揃えることで生存能力が劇的に跳ね上がる。'
  },
  {
    id: 'mine_tool_matching',
    category: 'mining',
    tags: ['tool', 'pickaxe', 'axe', 'shovel', 'hoe', '適正ツール', 'ツルハシ', '斧', 'シャベル'],
    title: 'ブロックごとの適正ツールの使い分け',
    content: '木・原木・木製品には斧。石・鉱石・金属にはツルハシ。土・砂・砂利にはシャベル。葉っぱや羊毛にはハサミ。適正ツールを使用することで破壊速度が格段に速くなり、耐久度の消耗も抑えられる。'
  }
];

class MinecraftKnowledgeBase {
  constructor() {
    this.entries = MINECRAFT_KNOWLEDGE;
    this.historyDatabase = [];
    this.maxHistory = 100;
  }

  /**
   * チャットや行動、出来事のエピソード記憶を履歴データベースに登録
   */
  recordHistory(type, sender, text, location = null, metadata = {}) {
    const entry = {
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type, // 'chat' | 'action' | 'event' | 'discovery'
      sender: sender || 'System',
      text: text || '',
      time: new Date().toLocaleTimeString('ja-JP'),
      pos: location ? { x: Math.round(location.x), y: Math.round(location.y), z: Math.round(location.z) } : null,
      metadata,
      timestamp: Date.now()
    };

    this.historyDatabase.push(entry);
    if (this.historyDatabase.length > this.maxHistory) {
      this.historyDatabase.shift();
    }
    return entry;
  }

  /**
   * 履歴データベースから直近履歴＋文脈関連履歴を抽出
   */
  searchHistory(query = '', context = {}, limit = 5) {
    if (this.historyDatabase.length === 0) return [];

    // 直近の履歴（最新3件）を優先保持
    const recent = this.historyDatabase.slice(-3);

    // クエリや周辺環境に関連する過去の履歴をスコアリング
    const terms = typeof query === 'string' ? query.toLowerCase().split(/[\s,]+/) : [];
    if (context.lookingAt) terms.push(context.lookingAt.toLowerCase());
    if (context.hostileMobs) context.hostileMobs.forEach(m => terms.push(m.toLowerCase()));

    const scored = this.historyDatabase.slice(0, -3).map(item => {
      let score = 0;
      const fullText = `${item.sender} ${item.text} ${item.type}`.toLowerCase();
      for (const t of terms) {
        if (t && t.length > 1 && fullText.includes(t)) {
          score += 5;
        }
      }
      return { item, score };
    });

    const relevant = scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit - recent.length))
      .map(s => s.item);

    // 重複除去して結合（時系列順）
    const combined = [...relevant, ...recent];
    const unique = Array.from(new Set(combined.map(e => e.id)))
      .map(id => combined.find(e => e.id === id))
      .sort((a, b) => a.timestamp - b.timestamp);

    return unique.slice(-limit);
  }

  /**
   * LLMプロンプト用に履歴データベースをフォーマット
   */
  formatHistoryForPrompt(historyList) {
    if (!historyList || historyList.length === 0) {
      return '（過去の行動・対話履歴はまだありません）';
    }
    return historyList.map(h => {
      const typeTag = h.type === 'chat' ? '💬発言' : (h.type === 'action' ? '🛠️行動' : '📌出来事');
      const posStr = h.pos ? ` (X:${h.pos.x},Y:${h.pos.y},Z:${h.pos.z})` : '';
      return `[${h.time}] ${typeTag} ${h.sender}: ${h.text}${posStr}`;
    }).join('\n');
  }

  /**
   * クエリ文字列やコンテキスト（モブ名、ブロック名、状態）から関連する知識を検索
   * @param {string|string[]} query - 検索クエリやタグ配列
   * @param {Object} context - 周辺環境（isNight, inWater, hostileMobsなど）
   * @param {number} limit - 最大取得件数
   * @returns {Array<Object>} 関連知識エントリーのリスト
   */
  search(query, context = {}, limit = 3) {
    const searchTerms = [];

    if (typeof query === 'string') {
      searchTerms.push(...query.toLowerCase().split(/[\s,]+/));
    } else if (Array.isArray(query)) {
      query.forEach(q => searchTerms.push(String(q).toLowerCase()));
    }

    // コンテキストからの自動タグ注入
    if (context.isInWater) searchTerms.push('water', 'drown', '酸素');
    if (context.isInLava) searchTerms.push('lava', 'fire', '溶岩');
    if (context.isNight) searchTerms.push('night', 'bed', 'sleep', '夜');
    if (context.hostileMobs && context.hostileMobs.length > 0) {
      context.hostileMobs.forEach(m => searchTerms.push(m.toLowerCase()));
    }
    if (context.lookingAt) {
      searchTerms.push(context.lookingAt.toLowerCase());
    }

    // スコアリング (タグ一致度 + タイトル/本文のキーワード一致度)
    const scored = this.entries.map(entry => {
      let score = 0;
      for (const term of searchTerms) {
        if (!term || term.length < 2) continue;

        // タグ一致
        if (entry.tags.some(t => t.toLowerCase().includes(term) || term.includes(t.toLowerCase()))) {
          score += 10;
        }
        // タイトル一致
        if (entry.title.toLowerCase().includes(term)) {
          score += 6;
        }
        // 本文一致
        if (entry.content.toLowerCase().includes(term)) {
          score += 2;
        }
      }
      return { entry, score };
    });

    // スコア降順にソートし、関連度のある上位を抽出
    const results = scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.entry);

    // 該当がなければ基本サバイバルナレッジを返す
    if (results.length === 0) {
      return [
        this.entries.find(e => e.id === 'craft_basics_wood'),
        this.entries.find(e => e.id === 'mob_creeper')
      ].filter(Boolean);
    }

    return results;
  }

  /**
   * LLMプロンプト用に整形された知識スニペットテキストを生成
   */
  formatForPrompt(entries) {
    if (!entries || entries.length === 0) return '';
    return entries.map((e, idx) => {
      return `【知識 ${idx + 1}: ${e.title}】\n${e.content}`;
    }).join('\n\n');
  }
}

module.exports = new MinecraftKnowledgeBase();
