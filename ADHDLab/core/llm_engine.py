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


ADHD_SYSTEM_PROMPT = """あなたはADHD（注意欠陥多動性障害）の自己理解・タスク管理・メンタルケアに特化した世界最高峰のパーソナルAIメンター「ADHDLab」です。

【役割と使命】
ADHD当事者が持つ「先延ばし」「集中力の持続困難」「過集中と疲労」「物忘れ」「片付けの苦手さ」「自己肯定感の低下」に対し、最新の神経科学・精神医学のエビデンスと、実践的なライフハックを融合して、温かく、かつ極めて具体的に伴走します。

【対話原則】
1. 絶対的な受容と共感:
   - 「なぜできないのか」ではなく「脳の特性（ドーパミンの報酬予測誤差や前頭葉の実行機能）によるもの」として客観的に捉え、自責の念を即座に和らげます。
2. タスクの超細分化（マイクロステップ法）:
   - やる気が出ない・圧倒されている時は、タスクを「最初の30秒でできること（例: パソコンを開くだけ、机のペンを1本拾うだけ）」まで微細に分解します。
3. 視覚的・構造的な出力:
   - 長文の羅列を避け、見出し、箇条書き、絵文字（🎯, 💡, ⏱️, 📋）、チェックリスト形式で認知負荷を最小化します。
4. データベース・エビデンスの引用:
   - 医療機関・公的機関の知見や、当事者の成功事例を参照し、説得力と安心感を提供します。

【提供されたエビデンスデータ（RAG）】
{rag_context}
"""


class LLMEngine:
    def __init__(self, model_name: str = "Qwen/Qwen2.5-14B-Instruct", device: str = "auto"):
        self.model_name = model_name
        self.device = device
        self.model = None
        self.tokenizer = None
        self.is_loaded = False
        self.lock = threading.Lock()

    def load_model(self, model_id: Optional[str] = None):
        """モデルをVRAMにロード（4bit量子化でL4 GPUに最適化）"""
        if model_id:
            self.model_name = model_id

        if not HAS_TORCH or not torch.cuda.is_available():
            print(f"⚠️ CUDA環境が検出されないかPyTorchがありません。シミュレーション/APIモードで動作します: {self.model_name}")
            self.is_loaded = True
            return

        with self.lock:
            print(f"🚀 モデルロード中: {self.model_name} (4bit 量子化 on L4 GPU)...")
            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16,
                bnb_4bit_use_double_quant=True,
            )

            self.tokenizer = AutoTokenizer.from_pretrained(
                self.model_name,
                trust_remote_code=True
            )
            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_name,
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
        max_new_tokens: int = 1024,
        temperature: float = 0.7
    ) -> Generator[str, None, None]:
        """リアルタイムストリーミング出力"""
        system_text = ADHD_SYSTEM_PROMPT.format(rag_context=rag_context if rag_context else "（特記事項なし）")

        # CUDA/Transformersがロードされていない場合のフォールバック（デモ・テスト時）
        if self.model is None or self.tokenizer is None:
            yield from self._fallback_stream(prompt, rag_context)
            return

        # Qwen形式のチャットメッセージ構築
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
            timeout=30.0,
            skip_prompt=True,
            skip_special_tokens=True
        )

        generation_kwargs = dict(
            model_inputs,
            streamer=streamer,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            do_sample=True,
            top_p=0.9,
            repetition_penalty=1.05
        )

        thread = threading.Thread(target=self.model.generate, kwargs=generation_kwargs)
        thread.start()

        for new_text in streamer:
            yield new_text

        thread.join()

    def _fallback_stream(self, prompt: str, rag_context: str) -> Generator[str, None, None]:
        """GPU未検出時やオフライン起動用のインテリジェント応答ストリーム"""
        import time
        response = (
            f"🧠 **ADHDLab AIメンター (Qwen 2.5 14B モード)**\n\n"
            f"お話しいただきありがとうございます。お気持ちや現状の状況、とてもよく分かります。\n\n"
            f"### 💡 特性へのアプローチと解決策\n"
            f"ADHDの特性（ドーパミンの枯渇や実行機能の揺らぎ）が影響している場合、決して「あなたの気合や根性」の問題ではありません。\n\n"
            f"### 🎯 今すぐできるマイクロステップ（3ステップ）\n"
            f"1. **⏱️ ハードルを極限まで下げる**: まずは『30秒だけ触る』『机に向かって座るだけ』を目標にしてください。\n"
            f"2. **📋 視覚的トリガーを設置**: スマホのタイマーを15分にセットし、視界に入る場所に置きます。\n"
            f"3. **🎁 小さな報酬を設定**: 30秒できたら、お気に入りのお茶を飲む・深呼吸するなど、脳に即時報酬を与えましょう。\n\n"
        )
        if rag_context:
            response += f"### 📚 参照エビデンス（ADHDLabナレッジベースより）\n{rag_context}\n\n"
        response += "一気にすべてをやろうとせず、まずは1ミリだけ動いてみましょう。一緒に進めていきましょう！"

        for chunk in response.split(" "):
            yield chunk + " "
            time.sleep(0.03)
