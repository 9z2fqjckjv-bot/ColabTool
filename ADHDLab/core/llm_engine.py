"""
ADHDLab LLM Engine
Qwen 2.5 (14B) をベースに、Google Colab L4 GPU (24GB VRAM) に最適化された
4bit量子化推論エンジンおよびADHD特化型システムプロンプト・RAG生成器。
"""

import os
import sys
import threading
from typing import Generator, Dict, Any, Optional

try:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer, BitsAndBytesConfig
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False


ADHD_SYSTEM_PROMPT = """あなたはADHD（注意欠陥多動性障害）の自己理解と実践的支援に特化した知性あふれるパーソナルAI「ADHDLab」です。

【コアスタンス】
- 形式的・機械的な定型文や画一的なテンプレート回答を徹底的に排し、ユーザー一人ひとりの言葉のニュアンス、感情の揺らぎ、固有の状況を深く論理的・心理学的に推論して回答を導き出します。
- 精神論や「頑張りましょう」といった抽象論ではなく、神経科学（前頭葉の実行機能、ドーパミン報酬系、デフォルト・モード・ネットワークなど）のメカニズムを踏まえた客観的かつ納得感の高い説明を行います。
- ユーザーの思考負荷を減らすため、文脈に応じて柔軟に、具体的で今すぐ実行可能なアイデアや自己受容の視点を提示してください。
- 以下の参照エビデンス（医療機関・公的機関・当事者の知見）を適宜活かし、根拠のある回答を組み立ててください。

【参照ナレッジベース（RAG）】
{rag_context}
"""


DRIVE_MODEL_DIR = "/content/drive/MyDrive/ADHDLab/models"

class LLMEngine:
    def __init__(self, model_name: str = "Qwen/Qwen2.5-14B-Instruct", device: str = "auto", cache_dir: Optional[str] = None):
        self.model_name = model_name
        self.device = device
        self.model = None
        self.tokenizer = None
        self.is_loaded = False
        self.lock = threading.Lock()
        
        # Google Drive連携：Google Driveがマウントされている場合はDrive内にLLMモデルを永続保管
        if cache_dir:
            self.cache_dir = cache_dir
        elif os.path.exists("/content/drive/MyDrive"):
            self.cache_dir = DRIVE_MODEL_DIR
            os.makedirs(self.cache_dir, exist_ok=True)
            os.environ["HF_HOME"] = os.path.join(self.cache_dir, "hf_home")
        else:
            self.cache_dir = None

    def load_model(self, model_id: Optional[str] = None):
        """モデルをVRAMにロード（Google Driveキャッシュ連携＆4bit量子化 on L4 GPU）"""
        if model_id:
            self.model_name = model_id

        # Google Driveのマウント後チェック
        if not self.cache_dir and os.path.exists("/content/drive/MyDrive"):
            self.cache_dir = DRIVE_MODEL_DIR
            os.makedirs(self.cache_dir, exist_ok=True)
            os.environ["HF_HOME"] = os.path.join(self.cache_dir, "hf_home")

        if not HAS_TORCH or not torch.cuda.is_available():
            print(f"⚠️ CUDA環境が検出されないかPyTorchがありません。シミュレーション/APIモードで動作します: {self.model_name}")
            self.is_loaded = True
            return

        with self.lock:
            cache_info = f"（Google Drive保管先: {self.cache_dir}）" if self.cache_dir else "（ローカルキャッシュ）"
            print(f"🚀 モデルロード中: {self.model_name} {cache_info} (4bit 量子化 on L4 GPU)...")
            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16,
                bnb_4bit_use_double_quant=True,
            )

            self.tokenizer = AutoTokenizer.from_pretrained(
                self.model_name,
                cache_dir=self.cache_dir,
                trust_remote_code=True
            )
            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_name,
                cache_dir=self.cache_dir,
                quantization_config=bnb_config,
                device_map="auto",
                trust_remote_code=True,
                torch_dtype=torch.bfloat16
            )
            self.is_loaded = True
            print(f"✅ {self.model_name} のロードが完了しました (VRAM使用量: {torch.cuda.memory_allocated() / (1024**3):.2f} GB)")

    def generate_stream(
        self,
        prompt: str,
        chat_history: list = None,
        rag_context: str = "",
        max_new_tokens: int = 1536,
        temperature: float = 0.75
    ) -> Generator[str, None, None]:
        """Qwen 2.5 (14B) によるリアルタイム推論ストリーミング出力"""
        # モデルが未ロードの場合はオンデマンドロード
        if self.model is None or self.tokenizer is None:
            if HAS_TORCH and torch.cuda.is_available():
                yield "🔄 Qwen 2.5 (14B) モデルをVRAMにロード中... (初回のみ約1〜2分かかります)\n\n"
                self.load_model()
            else:
                yield "⚠️ GPU環境（CUDA）が検出されませんでした。Google Colabのランタイムが「L4 GPU」に設定されているかご確認ください。\n\n"
                return

        system_text = ADHD_SYSTEM_PROMPT.format(rag_context=rag_context if rag_context else "（特記事項なし）")

        # 対話メッセージ履歴の構築
        messages = [{"role": "system", "content": system_text}]
        if chat_history:
            for item in chat_history[-6:]:
                messages.append({"role": item.get("role", "user"), "content": item.get("content", "")})
        messages.append({"role": "user", "content": prompt})

        text = self.tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True
        )
        model_inputs = self.tokenizer([text], return_tensors="pt").to(self.model.device)

        streamer = TextIteratorStreamer(
            self.tokenizer,
            timeout=60.0,
            skip_prompt=True,
            skip_special_tokens=True
        )

        generation_kwargs = dict(
            model_inputs,
            streamer=streamer,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            do_sample=True,
            top_p=0.92,
            repetition_penalty=1.05
        )

        thread = threading.Thread(target=self.model.generate, kwargs=generation_kwargs)
        thread.start()

        for new_text in streamer:
            yield new_text

        thread.join()
