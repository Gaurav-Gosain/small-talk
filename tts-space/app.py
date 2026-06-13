"""Small Talk · Voice Design — Qwen3-TTS VoiceDesign on ZeroGPU.

Designs a speaking voice from a natural-language description (gender, age, pitch,
timbre, attitude, pace, accent…). This is the same model the podcast uses locally
(`Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`), run here via the base `qwen_tts` —
NOT `faster_qwen3_tts`, because that package's CUDA-graph speedup can't survive
ZeroGPU's per-request GPU reclaim. (faster_qwen3_tts → dedicated GPU / Modal.)

Qwen3-TTS has NO emotion/markup tags — expressiveness comes entirely from the
`instruct` description, so write rich, structured voice descriptions.

`import spaces` MUST come before torch so ZeroGPU can patch CUDA.
"""
import spaces
import gradio as gr
import numpy as np
import torch
from qwen_tts import Qwen3TTSModel

MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"

tts = Qwen3TTSModel.from_pretrained(
    MODEL_ID,
    device_map="cuda",
    dtype=torch.bfloat16,
    attn_implementation="sdpa",  # no flash-attn needed
)

EXAMPLE_INSTRUCT = (
    "A dry, witty man in his fifties with a deep, smooth, slightly weathered "
    "baritone. Sardonic, understated and unflappable, with a sarcastic edge. "
    "Speaks slowly and deliberately, with deadpan timing and the faint amusement "
    "of someone who has seen it all."
)
EXAMPLE_TEXT = (
    "Charming? It's a robot reading sine waves off a tensor. But sure — let's "
    "anthropomorphize the linear algebra."
)
LANGUAGES = ["English", "Chinese", "Spanish", "French", "German", "Italian",
             "Japanese", "Korean", "Portuguese", "Russian", "Auto"]


@spaces.GPU(duration=120)
def design(text, instruct, language, temperature, top_p, repetition_penalty):
    text = (text or "").strip()
    if not text:
        raise gr.Error("Enter some text to speak.")
    with torch.inference_mode():
        wavs, sr = tts.generate_voice_design(
            text=text,
            instruct=(instruct or "").strip(),
            language=language or "English",
            do_sample=True,
            temperature=float(temperature),
            top_p=float(top_p),
            repetition_penalty=float(repetition_penalty),
        )
    audio = np.asarray(wavs[0], dtype=np.float32).reshape(-1)
    return (int(sr), audio)


demo = gr.Interface(
    fn=design,
    inputs=[
        gr.Textbox(label="Text to speak", value=EXAMPLE_TEXT, lines=3),
        gr.Textbox(label="Voice design — natural-language description",
                   value=EXAMPLE_INSTRUCT, lines=5),
        gr.Dropdown(LANGUAGES, value="English", label="Language"),
        gr.Slider(0.1, 1.5, value=0.95, step=0.05, label="Temperature"),
        gr.Slider(0.1, 1.0, value=0.92, step=0.02, label="Top-p"),
        gr.Slider(1.0, 1.5, value=1.1, step=0.05, label="Repetition penalty"),
    ],
    outputs=gr.Audio(label="Designed voice", type="numpy"),
    title="Small Talk · Qwen3-TTS Voice Design",
    description=(
        "Design a speaking voice from a description — the voice engine behind the "
        "Small Talk robot podcast. No emotion tags: put all the expressiveness "
        "(age, pitch, timbre, attitude, pace, accent) into the description. "
        "Callable as an API by the podcast backend."
    ),
)

if __name__ == "__main__":
    demo.queue(max_size=12).launch()
