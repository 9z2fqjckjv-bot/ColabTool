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
    id: 'craft_torches',
    category: 'survival',
    tags: ['torch', 'coal', 'charcoal', 'light', '松明', '石炭', '木炭', '明かり'],
    title: '松明による湧き潰しと視界確保',
    content: '石炭（または原木をかまどで焼いた木炭）1個＋棒1本で松明4本を作成。モンスターは明るさ0の暗所にのみ湧くため、拠点周囲や洞窟に松明を設置して安全地帯（湧き潰し）を構築する。'
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
