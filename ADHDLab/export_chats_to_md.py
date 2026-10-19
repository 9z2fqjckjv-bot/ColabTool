#!/usr/bin/env python3
"""
ADHDLab Chat Logs Exporter
adhdlab.db の chat_logs テーブルからすべての対話履歴を抽出し、
読みやすい Markdown 形式（.md）で ADHDLab/Chats/ に出力します。
"""

import os
import sqlite3
import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "adhdlab.db")
OUTPUT_DIR = os.path.join(BASE_DIR, "Chats")

def export_chats():
    if not os.path.exists(DB_PATH):
        # Google Drive 等も探索
        gdrive_db = os.path.expanduser("~/Library/CloudStorage/GoogleDrive-zuyasi4025@gmail.com/マイドライブ/ADHDLab/adhdlab.db")
        if os.path.exists(gdrive_db):
            import shutil
            os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
            shutil.copy2(gdrive_db, DB_PATH)
        else:
            print(f"❌ エラー: データベースが見つかりません: {DB_PATH}")
            return

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("SELECT session_id, count(*), min(timestamp), max(timestamp) FROM chat_logs GROUP BY session_id ORDER BY min(timestamp) ASC")
    sessions = cur.fetchall()

    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    index_lines = [
        "# 💬 ADHDLab チャット履歴アーカイブ",
        "",
        "> `adhdlab.db` から抽出・生成された対話セッションのMarkdownアーカイブです。",
        f"> **エクスポート日時**: `{now_str}`  ",
        f"> **総セッション数**: `{len(sessions)}` セッション  ",
        "",
        "---",
        "",
        "## 📑 セッション一覧",
        "",
        "| No. | セッションID | 開始日時 | 件数 | 主な相談テーマ / 質問 | リンク |",
        "| :--- | :--- | :--- | :--- | :--- | :--- |"
    ]

    all_chats_lines = [
        "# 🧠 ADHDLab 全チャット履歴ログ (統合版)",
        "",
        f"> **エクスポート日時**: `{now_str}`  ",
        f"> **総セッション数**: `{len(sessions)}`  ",
        "",
        "---",
        ""
    ]

    for idx, (sid, count, min_time, max_time) in enumerate(sessions, 1):
        cur.execute("SELECT id, role, content, media_url, model, timestamp FROM chat_logs WHERE session_id = ? ORDER BY id ASC", (sid,))
        msgs = cur.fetchall()

        # 最初のユーザーメッセージからタイトルを生成
        user_first_msg = ""
        for m in msgs:
            if m[1] == "user" and m[2].strip():
                user_first_msg = m[2].strip().replace("\n", " ")
                break
        if not user_first_msg:
            user_first_msg = "（メッセージなし）"

        short_title = user_first_msg[:35] + ("..." if len(user_first_msg) > 35 else "")
        clean_date = min_time.replace(":", "-").replace(" ", "_")
        md_filename = f"{idx:02d}_{clean_date}_{sid}.md"
        md_filepath = os.path.join(OUTPUT_DIR, md_filename)

        session_md = [
            f"# 💬 セッション: {sid}",
            "",
            f"- **開始日時**: `{min_time}`",
            f"- **最終更新**: `{max_time}`",
            f"- **メッセージ件数**: {len(msgs)} 件",
            f"- **主なトピック**: {user_first_msg}",
            "",
            "---",
            ""
        ]

        all_chats_lines.append(f"## 📌 セッション {idx}: {short_title}")
        all_chats_lines.append(f"- **ID**: `{sid}` | **開始日時**: `{min_time}` | **件数**: {len(msgs)} 件\n")

        for m_id, role, content, media_url, model, ts in msgs:
            role_label = "👤 **ユーザー (USER)**" if role == "user" else "🧠 **ADHDLab AI (ASSISTANT)**"

            session_md.append(f"### {role_label}  ")
            session_md.append(f"<small>🕒 {ts} | ID: #{m_id}</small>\n")
            if content:
                session_md.append(content)
            else:
                session_md.append("*(空のメッセージ)*")
            session_md.append("")
            if media_url:
                session_md.append(f"> 📎 **添付メディア**: `{media_url}`\n")
            session_md.append("---")
            session_md.append("")

            # 統合版にも追記
            all_chats_lines.append(f"### {role_label} `[{ts}]`")
            all_chats_lines.append("")
            all_chats_lines.append(content if content else "*(空のメッセージ)*")
            all_chats_lines.append("")
            if media_url:
                all_chats_lines.append(f"> 📎 **添付メディア**: `{media_url}`\n")

        all_chats_lines.append("\n---\n")

        with open(md_filepath, "w", encoding="utf-8") as f:
            f.write("\n".join(session_md))

        index_lines.append(f"| {idx} | `{sid}` | `{min_time}` | {len(msgs)} | {short_title} | [{md_filename}](./{md_filename}) |")

    # README.md と all_chats.md を書き出し
    with open(os.path.join(OUTPUT_DIR, "README.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(index_lines))

    with open(os.path.join(OUTPUT_DIR, "all_chats.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(all_chats_lines))

    print(f"🎉 書き出し完了: {len(sessions)} セッションを {OUTPUT_DIR} に出力しました！")

if __name__ == "__main__":
    export_chats()
