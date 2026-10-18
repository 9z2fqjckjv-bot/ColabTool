/**
 * knowledge_base.js - Minecraft サバイバル & 改善指示書v2 知識ベース
 * 全41体のAIPlayerおよびQwen 2.5推論エンジン向け専門ナレッジ
 */

const fs = require('fs');
const path = require('path');

const MINECRAFT_KNOWLEDGE = [
  // --- 1. 拠点および動画解析座標 ---
  {
    id: 'base_coordinates_overview',
    category: 'base',
    tags: ['base', 'coordinates', 'bounds', 'door', 'chest', 'bed', '拠点', '座標', '範囲', 'ドア', 'チェスト'],
    title: '拠点の精密境界座標と生活ルール',
    content: '拠点外枠全体: X:[92, 97], Y:[62, 68], Z:[39, 47]。内部歩行領域: X:[93, 96], Y:63, Z:[40, 46]。出入り口ドア: (94, 63, 39) 北向き。拠点中心: (95, 63, 43)。夜間は日没時に北向きドアから入室し、ベッドで就寝する。朝は強制ログアウトせず常駐し外へ出動する。'
  },
  {
    id: 'water_defense_perimeter',
    category: 'combat',
    tags: ['water', 'drowned', 'perimeter', 'defense', '水中', 'ドラウンド', '迎撃', '防衛'],
    title: '拠点東側・南側水域の水中モブ迎撃境界',
    content: '動画(2026-10-15 12.45.18.mov)解析による水中迎撃エリアは拠点東側〜南側の水域(X:95〜125, Z:40〜75)。ドラウンド（溺死ゾンビ）やトライデント持ちモブを水面・水中で索敵し迎撃する。酸素ゲージに注意し、定期的に水面へ浮上して呼吸する。'
  },
  {
    id: 'nether_ruined_portal_journey',
    category: 'nether',
    tags: ['nether', 'portal', 'ruined_portal', 'boat', 'obsidian', 'blaze', 'ender_pearl', 'ネザー', 'ポータル', '荒廃ポータル', 'ボート', '黒曜石', 'ブレイズ', 'エンド資材'],
    title: '荒廃ポータル(278, 63, 94)の修復とネザー遠征',
    content: '動画(2026-10-18 19.03.11.mov)解析に基づくネザーポータル地点は (X:278, Y:63, Z:94)。拠点からボートで水上を進み到達可能。欠損した黒曜石を補填して4x5以上の枠を完成させ、火打石と打ち金またはファイヤーチャージで着火。ネザー内ではネザー要塞を探索しブレイズロッドを回収、ピグリンとの金インゴット交易でエンダーパールを確保し、エンド進入資材を整える。'
  },

  // --- 2. 役割別サバイバル手順 ---
  {
    id: 'lumberjack_10_chunks',
    category: 'gathering',
    tags: ['kikori', 'wood', 'log', 'sapling', 'axe', '木こり', '伐採', '原木', '苗木', '斧'],
    title: '拠点10チャンク以内の木こり作業手順',
    content: '拠点から半径160ブロック（10チャンク）以内を中心に活動。斧を装備して原木の根元から上に向かって伐採。落ちた原木、苗木、リンゴを回収し、伐採跡地に苗木を再植林して資源を維持する。'
  },
  {
    id: 'farming_5_chunks',
    category: 'farming',
    tags: ['farming', 'hoe', 'seeds', 'wheat', 'carrot', 'potato', '畑', '農業', '種', '小麦', 'ニンジン'],
    title: '拠点5チャンク以内の農作業とチェスト連携',
    content: '拠点内チェストから農作物アイテム（種・ジャガイモ・ニンジン）を取り出し、拠点から5チャンク以内（半径80ブロック）の水辺周囲4ブロック以内の土をクワで耕す。種を植え、完全に成長した作物を収穫後、即座に再植え付けを行う。'
  },
  {
    id: 'surface_ore_gathering',
    category: 'gathering',
    tags: ['ore', 'iron', 'coal', 'surface', 'vein', '鉱物', '地上露出', '鉱脈', '鉄鉱石'],
    title: '地上露出鉱物の発見と周囲鉱脈の一括採掘',
    content: '洞窟の外の崖、山肌、水辺に露出している鉱物（鉄、石炭、銅など）を発見した場合、露出した鉱石を採掘するだけでなく、周囲に隣接して埋まっている鉱石も完全に掘り出して回収する。'
  },
  {
    id: 'cave_mining_systematic',
    category: 'mining',
    tags: ['cave', 'mining', 'torch', 'iron', 'gold', 'diamond', 'mineshaft', '洞窟', '廃坑', '松明', '採掘'],
    title: '拠点近隣洞窟の順次探索と松明による安全確保',
    content: '拠点に近い洞窟入口から順に探検。迷子やモンスターのスポーンを防ぐため、進行方向の右側の壁や床に一定間隔で松明を設置。鉄、金、レッドストーン、ダイヤモンド鉱石を採掘し、廃坑やダンジョンを発見した場合はチェスト物資を略奪する。'
  },
  {
    id: 'boat_fishing_10_chunks',
    category: 'fishing',
    tags: ['fishing', 'boat', 'chest_boat', 'rod', 'water', '釣り', 'チェスト付きボート', '釣り竿'],
    title: 'チェスト付きボートによる水上移動と釣り作業',
    content: '拠点10チャンク以内の水域をチェスト付きボートに乗って移動。開けた水面で釣り竿をキャストし、浮きの沈み込みに合わせてリールを巻いて生魚、宝物（弓、本、名札、オウムガイの殻）を獲得する。インベントリがいっぱいになったらボートのチェストに収納。'
  },
  {
    id: 'breeding_pens_5_chunks',
    category: 'breeding',
    tags: ['breeding', 'pen', 'fence', 'cow', 'sheep', 'pig', 'chicken', '飼育', '牧場', 'フェンス', '繁殖'],
    title: '拠点5チャンク以内の中立モブ飼育場構築と繁殖',
    content: '拠点5チャンク以内にオークや白樺のフェンスとフェンスゲートで専用の飼育スペースを種族別（牛・羊・豚・鶏）に作成。好物（牛/羊: 小麦、豚: ニンジン/ジャガイモ、鶏: 種）を手に持って誘導し、2頭以上に餌を与えて繁殖（ラブホモード）させる。'
  },
  {
    id: 'commander_role_and_storage',
    category: 'commander',
    tags: ['commander', 'report', 'storage', 'chest', 'drop', '司令塔', '報告', 'チェスト収納', '物資回収'],
    title: '司令塔による現場AI統括と拠点チェスト収納・ドロップルール',
    content: '各司令塔AIは担当作業のAIPlayerとユーザー間の意思疎通、状況報告、指示伝達を統括。現場作業員が拠点に持ち帰った資材を回収し、拠点内チェストにカテゴリ別に整理して収納する。もし拠点チェストの収納スペースに空きがない場合は、拠点の指定床面にアイテムをドロップして一時保管する。'
  },
  {
    id: 'helper_specialized_execution',
    category: 'helper',
    tags: ['helper', 'custom_task', 'focus', 'ヘルパー', '個別指示', '特化完遂'],
    title: 'ヘルパーによるユーザー個別指示の完全完遂',
    content: 'ヘルパーは通常の定常業務を持たず、ユーザーからチャットやWebポータルで受領した指示（特定資材の調達、建築支援、特定地点の護衛など）に100%特化し、完了するまで全力で任務を遂行する。'
  }
];

class KnowledgeBase {
  constructor(options = {}) {
    this.logsDir = options.logsDir || process.env.LOGS_DIR || '/content/logs';
    this.historyFile = path.join(this.logsDir, 'chat_and_action_history.json');
    this.history = [];
    this.maxHistory = 1000;
    this.loadHistory();
  }

  loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const raw = fs.readFileSync(this.historyFile, 'utf8');
        this.history = JSON.parse(raw);
      }
    } catch (_) {}
  }

  saveHistory() {
    try {
      fs.mkdirSync(this.logsDir, { recursive: true });
      fs.writeFileSync(this.historyFile, JSON.stringify(this.history.slice(-this.maxHistory), null, 2), 'utf8');
    } catch (_) {}
  }

  recordHistory(type, sender, message, pos = null, extra = {}) {
    const entry = {
      timestamp: Date.now(),
      timeStr: new Date().toLocaleString('ja-JP'),
      type,
      sender,
      message,
      pos: pos ? { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) } : null,
      ...extra
    };
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.saveHistory();
    return entry;
  }

  search(query, state = {}, limit = 3) {
    const q = (query || '').toLowerCase();
    const scored = MINECRAFT_KNOWLEDGE.map(k => {
      let score = 0;
      for (const tag of k.tags) {
        if (q.includes(tag.toLowerCase())) score += 3;
      }
      if (q.includes(k.title.toLowerCase())) score += 5;
      if (k.content.toLowerCase().includes(q)) score += 2;
      return { k, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.filter(s => s.score > 0).slice(0, limit).map(s => s.k);
  }

  formatForPrompt(items) {
    if (!items || items.length === 0) return '';
    return items.map(i => `【${i.title}】\n${i.content}`).join('\n\n');
  }

  searchHistory(query, state = {}, limit = 5) {
    const q = (query || '').toLowerCase();
    const matched = this.history.filter(h => {
      return (h.message && h.message.toLowerCase().includes(q)) ||
             (h.sender && h.sender.toLowerCase().includes(q));
    });
    return (matched.length > 0 ? matched : this.history).slice(-limit);
  }

  formatHistoryForPrompt(items) {
    if (!items || items.length === 0) return 'なし';
    return items.map(i => `[${i.timeStr}] ${i.sender}: ${i.message}`).join('\n');
  }
}

module.exports = new KnowledgeBase();
