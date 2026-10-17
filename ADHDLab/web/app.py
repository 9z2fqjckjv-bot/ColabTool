"""
ADHDLab Web Application Server
FastAPIバックエンド。GeminiライクなモダンWeb UIを提供し、
リアルタイムストリーミングチャット、データベース探索、Webデータ収集、外部同期を統合。
"""

import os
import sys
import json
import asyncio
from typing import Optional, List
from fastapi import FastAPI, Request, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# core モジュールのインポート
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from core.database_manager import DatabaseManager
from core.data_collector import DataCollector
from core.llm_engine import LLMEngine
from core.storage_sync import StorageSyncManager

app = FastAPI(title="ADHDLab - Colab AI Specialist")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# パスの定義
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "adhdlab.db")
EXCEL_PATH = os.path.join(DATA_DIR, "ソース一覧.xlsx")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# コンポーネント初期化
db_manager = DatabaseManager(db_path=DB_PATH, excel_path=EXCEL_PATH)
data_collector = DataCollector(db_manager)
llm_engine = LLMEngine(model_name="Qwen/Qwen2.5-14B-Instruct")
storage_sync = StorageSyncManager(local_data_dir=DATA_DIR)

# 静的ファイルのホスティング
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.on_event("startup")
async def startup_event():
    import threading

    def _background_init():
        try:
            # 1. 既存ソースが0件なら初期シードを投入
            sources = db_manager.get_all_sources_sorted()
            if not sources:
                print("🌱 初期シードデータを登録中...")
                data_collector._seed_default_data()
                db_manager.rebuild_and_export_excel()

            # 2. Google Driveからの自動復元を試行
            storage_sync.restore_from_google_drive()

            # 3. LLMモデル (Qwen 2.5 14B) を自動ロード
            llm_engine.load_model()
        except Exception as e:
            print(f"バックグラウンド初期化エラー: {e}")

    threading.Thread(target=_background_init, daemon=True).start()


# --- API エンドポイント ---

class ChatRequest(BaseModel):
    message: str
    session_id: str
    model: str = "Qwen/Qwen2.5-14B-Instruct"
    use_rag: bool = True


@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>ADHDLab UI is loading...</h1>"


@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest, background_tasks: BackgroundTasks):
    """リアルタイムストリーミングチャット"""
    # 1. ユーザー発言を保存
    db_manager.save_chat_message(
        session_id=req.session_id,
        role="user",
        content=req.message,
        model=req.model
    )

    # 2. RAGエビデンスの取得
    rag_context = ""
    if req.use_rag:
        rag_context = db_manager.get_rag_context(req.message, limit=4)

    # 3. チャット履歴の取得
    history = db_manager.get_chat_history(req.session_id)

    # モデルの切り替えチェック
    if req.model and req.model != llm_engine.model_name:
        llm_engine.load_model(req.model)

    # 4. ストリーミングジェネレータ
    def event_stream():
        full_response = []
        try:
            for chunk in llm_engine.generate_stream(
                prompt=req.message,
                chat_history=history,
                rag_context=rag_context,
                max_new_tokens=1536
            ):
                full_response.append(chunk)
                yield f"data: {json.dumps({'chunk': chunk}, ensure_ascii=False)}\n\n"
        except Exception as e:
            err_msg = f"エラーが発生しました: {str(e)}"
            yield f"data: {json.dumps({'error': err_msg}, ensure_ascii=False)}\n\n"

        # 完了後にアシスタント発言をDB保存
        assistant_reply = "".join(full_response)
        db_manager.save_chat_message(
            session_id=req.session_id,
            role="assistant",
            content=assistant_reply,
            model=req.model
        )
        yield f"data: {json.dumps({'done': True, 'rag': rag_context}, ensure_ascii=False)}\n\n"

    # バックグラウンドで自動同期をスケジュール
    background_tasks.add_task(storage_sync.sync_to_google_drive)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/api/sessions")
async def get_sessions():
    """セッション履歴一覧"""
    return db_manager.get_all_sessions()


@app.get("/api/history/{session_id}")
async def get_history(session_id: str):
    """特定セッションの発言履歴"""
    return db_manager.get_chat_history(session_id)


@app.get("/api/sources")
async def list_sources(query: str = "", category: str = "", limit: int = 100):
    """ナレッジベース（ソース一覧）の検索・一覧取得"""
    return db_manager.search_sources(query=query, category=category, limit=limit)


@app.post("/api/collect")
async def trigger_collection(background_tasks: BackgroundTasks):
    """最新ADHD情報のWeb自動収集をバックグラウンドで開始"""
    def run_collect():
        data_collector.search_and_ingest()
        db_manager.rebuild_and_export_excel()
        storage_sync.full_sync(commit_msg="Update ADHDLab knowledge sources via auto-collector")

    background_tasks.add_task(run_collect)
    return {"status": "started", "message": "最新のADHD情報をWebから自動収集中です..."}


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """メディア（画像・ドキュメント）のアップロード"""
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as f:
        f.write(await file.read())
    return {"filename": file.filename, "url": f"/static/uploads/{file.filename}"}


@app.post("/api/sync")
async def trigger_sync():
    """Google Drive, GitHub, XServerへの即時バックアップ"""
    res = storage_sync.full_sync()
    return res


@app.get("/api/status")
async def get_system_status():
    """システムステータス（GPU, メモリ, モデル情報）"""
    import torch
    gpu_info = "CPU / Simulation"
    if torch.cuda.is_available():
        gpu_name = torch.cuda.get_device_name(0)
        vram_alloc = torch.cuda.memory_allocated() / (1024**3)
        vram_total = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        gpu_info = f"{gpu_name} (VRAM: {vram_alloc:.1f}GB / {vram_total:.1f}GB)"

    return {
        "status": "online",
        "gpu": gpu_info,
        "model": llm_engine.model_name,
        "is_loaded": llm_engine.is_loaded,
        "google_ai_ultra": "GoogleOne AI Ultra 20TB連携対応",
        "excel_path": EXCEL_PATH
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
