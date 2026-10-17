"""
ADHDLab Database Manager
「ソース一覧.xlsx」の仕様及びsampleシート4行目・5行目の規則に完全準拠したデータベース管理モジュール。
"""

import os
import json
import sqlite3
import datetime
from typing import List, Dict, Any, Optional

try:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False


# シート優先順位（sampleシート行4記載: 医療機関＞公的機関＞SNS＞Blog＞Other）
SHEET_PRIORITY = {
    "医療機関": 1,
    "公的機関": 2,
    "SNS": 3,
    "Blog": 4,
    "Other": 5
}

SHEETS_LIST = ["総合", "医療機関", "公的機関", "SNS", "Blog", "Other"]

# 各シートのカラム定義
SHEET_HEADERS = {
    "総合": ["ソースNo", "シート", "サービス名/サイト名", "URL", "投稿者/作成者", "投稿日/作成年月日", "概要（内容要約）", "備考"],
    "SNS": ["ソースNo", "シート", "サービス名", "URL", "投稿者", "投稿日", "概要（内容要約）", "備考"],
    "医療機関": ["ソースNo", "シート", "サイト名", "URL", "作成者", "作成年月日", "概要（内容要約）", "備考"],
    "公的機関": ["ソースNo", "シート", "サイト名", "URL", "作成者", "作成年月日", "概要（内容要約）", "備考"],
    "Blog": ["ソースNo", "サイト名", "URL", "投稿者/作成者", "作成年月日", "概要（内容要約）", "備考"],
    "Other": ["ソースNo", "シート", "サービス名/サイト名", "URL", "投稿者/作成者", "投稿日/作成年月日", "概要（内容要約）", "備考"]
}


class DatabaseManager:
    def __init__(self, db_path: str = "data/adhdlab.db", excel_path: str = "data/ソース一覧.xlsx"):
        self.db_path = db_path
        self.excel_path = excel_path
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        os.makedirs(os.path.dirname(os.path.abspath(self.excel_path)), exist_ok=True)
        self._init_sqlite()

    def _init_sqlite(self):
        """SQLiteデータベースの初期化"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sources (
                    source_no INTEGER PRIMARY KEY,
                    category TEXT NOT NULL,
                    site_name TEXT NOT NULL,
                    url TEXT NOT NULL UNIQUE,
                    author TEXT,
                    published_date TEXT NOT NULL,
                    summary TEXT,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS chat_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    media_url TEXT,
                    model TEXT,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_published_date ON sources(published_date DESC);
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_category ON sources(category);
            """)
            conn.commit()

    def add_or_update_source(self, item: Dict[str, Any], export_excel: bool = True) -> int:
        """
        単一のソース情報を追加または更新。
        item: {
            "category": "SNS" | "医療機関" | "公的機関" | "Blog" | "Other",
            "site_name": str,
            "url": str,
            "author": str,
            "published_date": str (YYYY-MM-DD or YYYY/MM/DD),
            "summary": str,
            "notes": str
        }
        """
        category = item.get("category", "Other")
        if category not in SHEET_PRIORITY:
            category = "Other"

        pub_date = str(item.get("published_date", datetime.date.today().isoformat()))
        pub_date = pub_date.replace("/", "-").strip()

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            # 既存URLチェック
            cursor.execute("SELECT source_no FROM sources WHERE url = ?", (item.get("url", ""),))
            row = cursor.fetchone()
            if row:
                source_no = row[0]
                cursor.execute("""
                    UPDATE sources SET
                        category = ?,
                        site_name = ?,
                        author = ?,
                        published_date = ?,
                        summary = ?,
                        notes = ?
                    WHERE source_no = ?
                """, (
                    category,
                    item.get("site_name", ""),
                    item.get("author", ""),
                    pub_date,
                    item.get("summary", ""),
                    item.get("notes", ""),
                    source_no
                ))
            else:
                cursor.execute("SELECT COALESCE(MAX(source_no), 0) + 1 FROM sources")
                source_no = cursor.fetchone()[0]
                cursor.execute("""
                    INSERT INTO sources (
                        source_no, category, site_name, url, author, published_date, summary, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    source_no,
                    category,
                    item.get("site_name", ""),
                    item.get("url", ""),
                    item.get("author", ""),
                    pub_date,
                    item.get("summary", ""),
                    item.get("notes", "")
                ))
            conn.commit()

        # Excelの再エクスポート
        if export_excel:
            self.rebuild_and_export_excel()
        return source_no

    def bulk_add_sources(self, items: List[Dict[str, Any]]):
        """複数のソースを一括追加・ソート・再採番"""
        for item in items:
            self.add_or_update_source(item, export_excel=False)
        self.rebuild_and_export_excel()

    def get_all_sources_sorted(self) -> List[Dict[str, Any]]:
        """
        指示書ルールに沿ったソート順で全レコードを取得。
        優先順位:
        1. 投稿日 / 作成年月日 の新しい順 (DESC)
        2. シート優先順位 (医療機関 > 公的機関 > SNS > Blog > Other)
        3. 投稿者/作成者 (ASC)
        4. サービス名/サイト名 (ASC)
        5. URL (ASC)
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM sources")
            rows = [dict(r) for r in cursor.fetchall()]

        def sort_key(r):
            date_val = r.get("published_date") or "1900-01-01"
            sheet_rank = SHEET_PRIORITY.get(r.get("category", "Other"), 99)
            author = r.get("author") or ""
            site = r.get("site_name") or ""
            url = r.get("url") or ""
            # 日付は降順（新しい順）なので反転比較、その他は昇順
            return (-int(date_val.replace("-", "")[:8]) if date_val.replace("-", "")[:8].isdigit() else 0,
                    sheet_rank,
                    author,
                    site,
                    url)

        sorted_rows = sorted(rows, key=sort_key)

        # 統一番号（source_no）の整合性を保つ（一意制約の衝突を防ぐため2段階更新）
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            for idx, item in enumerate(sorted_rows, start=1):
                cursor.execute("UPDATE sources SET source_no = ? WHERE url = ?", (-idx, item["url"]))
            for idx, item in enumerate(sorted_rows, start=1):
                item["source_no"] = idx
                cursor.execute("UPDATE sources SET source_no = ? WHERE url = ?", (idx, item["url"]))
            conn.commit()

        return sorted_rows

    def search_sources(self, query: str = "", category: str = "", limit: int = 50) -> List[Dict[str, Any]]:
        """キーワードやカテゴリによる検索"""
        all_sources = self.get_all_sources_sorted()
        results = []
        q = query.lower().strip()
        for item in all_sources:
            if category and category != "総合" and item.get("category") != category:
                continue
            if q:
                match = (
                    q in (item.get("site_name") or "").lower() or
                    q in (item.get("summary") or "").lower() or
                    q in (item.get("author") or "").lower() or
                    q in (item.get("notes") or "").lower() or
                    q in (item.get("url") or "").lower()
                )
                if not match:
                    continue
            results.append(item)
            if len(results) >= limit:
                break
        return results

    def get_rag_context(self, query: str, limit: int = 5) -> str:
        """LLMのプロンプトに注入するエビデンスコンテキストを生成"""
        hits = self.search_sources(query=query, limit=limit)
        if not hits:
            # クエリに関連するものがなければ最新の医療・公的機関のデータを取得
            hits = self.search_sources(limit=limit)
        
        context_lines = []
        for h in hits:
            line = (
                f"- [No.{h['source_no']} / {h['category']}] 《{h['site_name']}》 "
                f"（著者/作成: {h.get('author') or '不明'}, 日付: {h.get('published_date')}）: "
                f"{h.get('summary', '')} (URL: {h.get('url')})"
            )
            context_lines.append(line)
        return "\n".join(context_lines)

    def rebuild_and_export_excel(self) -> str:
        """
        openpyxl を用いて「ソース一覧.xlsx」の仕様に完全準拠したワークブックを生成・保存。
        """
        if not HAS_OPENPYXL:
            # openpyxl がない場合はJSONダンプのみ
            json_path = self.excel_path.replace(".xlsx", ".json")
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(self.get_all_sources_sorted(), f, ensure_ascii=False, indent=2)
            return json_path

        wb = openpyxl.Workbook()
        # デフォルトシートの名前変更
        ws_sample = wb.active
        ws_sample.title = "sample"

        # スタイリングの準備
        header_fill = PatternFill(start_color="3B82F6", end_color="3B82F6", fill_type="solid")
        header_font = Font(name="Meiryo", size=10, bold=True, color="FFFFFF")
        regular_font = Font(name="Meiryo", size=9)
        thin_border = Border(
            left=Side(style='thin', color='E5E7EB'),
            right=Side(style='thin', color='E5E7EB'),
            top=Side(style='thin', color='E5E7EB'),
            bottom=Side(style='thin', color='E5E7EB')
        )

        # 1. sample シートの構成（元の仕様を忠実に再現）
        sample_headers = ["ソースNo", "シート", "サービス名/サイト名", "URL", "投稿者/作成者", "投稿日/作成年月日", "概要（内容要約）", "備考", "見出し"]
        ws_sample.append(sample_headers)
        ws_sample.append(["数値", "SNS,医療機関,公的機関,Blog,Otherのいずれか", "SNSの場合は、サービス名称。医療機関や公的機関の場合は、機関名。Blogの場合は、ブログタイトル。Otherの場合は、見出し。", "url", "氏名(name)", "Date", "Text", "Memo(Text)", "形式"])
        ws_sample.append(["ex", "SNS", "X", "https://x.com", "example", "2026-10-01", "ADHDのライフハックまとめ", "", "例"])
        ws_sample.append([
            "データの並び順に関しては、投稿日あるいは、作成年月日の新しい順を原則とする。また、LLM上のデータベース上に記憶し、いつでも呼び出して確認できるようにする。また、ソースNoは、全シートの統一番号として重複しないように管理する。（そのため、総合以外のシートでは、ソースNoの割り振りが飛び飛びになる。同じ投稿日あるいは作成年月日の場合、の優先順位は5行目の列を参照し、50音順あるいはABC順に表示する。また、シートの優先順位は、次のとおりである。医療機関＞公的機関＞SNS＞Blog＞Other。なお、これは、同じ投稿日あるいは作成年月日であり、複数のカテゴリーと記事が出てきた場合に利用する。）また、GoogleAppScriptを用いた高度な検索や絞り込み機能など本格的なデータベース機能を実装する。",
            "", "", "", "", "", "", "", ""
        ])
        ws_sample.append(["優先順位", "2.0", "4.0", "5.0", "3.0", "1.0", "6.0", "7.0", ""])

        # 全データ（新しい順・優先順位ソート済み）
        sorted_sources = self.get_all_sources_sorted()

        # 2. 各シートの作成
        for sheet_name in SHEETS_LIST:
            ws = wb.create_sheet(title=sheet_name)
            headers = SHEET_HEADERS[sheet_name]
            ws.append(headers)

            # ヘッダースタイル適用
            for col_idx in range(1, len(headers) + 1):
                cell = ws.cell(row=1, column=col_idx)
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal="center", vertical="center")

            # データの挿入
            for item in sorted_sources:
                if sheet_name != "総合" and item.get("category") != sheet_name:
                    continue

                if sheet_name == "総合":
                    row = [
                        item.get("source_no"),
                        item.get("category"),
                        item.get("site_name"),
                        item.get("url"),
                        item.get("author"),
                        item.get("published_date"),
                        item.get("summary"),
                        item.get("notes")
                    ]
                elif sheet_name == "SNS":
                    row = [
                        item.get("source_no"),
                        item.get("category"),
                        item.get("site_name"),
                        item.get("url"),
                        item.get("author"),
                        item.get("published_date"),
                        item.get("summary"),
                        item.get("notes")
                    ]
                elif sheet_name in ["医療機関", "公的機関"]:
                    row = [
                        item.get("source_no"),
                        item.get("category"),
                        item.get("site_name"),
                        item.get("url"),
                        item.get("author"),
                        item.get("published_date"),
                        item.get("summary"),
                        item.get("notes")
                    ]
                elif sheet_name == "Blog":
                    row = [
                        item.get("source_no"),
                        item.get("site_name"),
                        item.get("url"),
                        item.get("author"),
                        item.get("published_date"),
                        item.get("summary"),
                        item.get("notes")
                    ]
                else:  # Other
                    row = [
                        item.get("source_no"),
                        item.get("category"),
                        item.get("site_name"),
                        item.get("url"),
                        item.get("author"),
                        item.get("published_date"),
                        item.get("summary"),
                        item.get("notes")
                    ]
                ws.append(row)

                # データ行スタイル
                current_row = ws.max_row
                for c_idx in range(1, len(row) + 1):
                    c = ws.cell(row=current_row, column=c_idx)
                    c.font = regular_font
                    c.border = thin_border

            # 列幅の自動調整
            for col in ws.columns:
                max_len = 0
                col_letter = col[0].column_letter
                for cell in col:
                    val_str = str(cell.value or "")
                    max_len = max(max_len, len(val_str.encode('utf-8', 'ignore')))
                ws.column_dimensions[col_letter].width = min(max(max_len + 2, 12), 50)

        wb.save(self.excel_path)
        return self.excel_path

    # チャットログ管理
    def save_chat_message(self, session_id: str, role: str, content: str, media_url: Optional[str] = None, model: Optional[str] = None):
        """チャット発言を保存"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO chat_logs (session_id, role, content, media_url, model)
                VALUES (?, ?, ?, ?, ?)
            """, (session_id, role, content, media_url, model))
            conn.commit()

    def get_chat_history(self, session_id: str) -> List[Dict[str, Any]]:
        """セッション毎のチャット履歴を取得"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM chat_logs WHERE session_id = ? ORDER BY timestamp ASC
            """, (session_id,))
            return [dict(r) for r in cursor.fetchall()]

    def get_all_sessions(self) -> List[Dict[str, Any]]:
        """全セッションの一覧を取得"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT session_id, MIN(timestamp) as started_at, MAX(timestamp) as last_at,
                       (SELECT content FROM chat_logs c2 WHERE c2.session_id = c1.session_id AND role = 'user' LIMIT 1) as title
                FROM chat_logs c1
                GROUP BY session_id
                ORDER BY last_at DESC
            """)
            rows = cursor.fetchall()
            return [
                {
                    "session_id": r[0],
                    "started_at": r[1],
                    "last_at": r[2],
                    "title": (r[3][:30] + "...") if r[3] else "新しいチャット"
                }
                for r in rows
            ]
