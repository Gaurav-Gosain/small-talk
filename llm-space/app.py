"""Small Talk · LLM brain — Gemma 4 12B on ZeroGPU via 🤗 transformers.

A separate Space from the main Small Talk app: it exposes a chat endpoint the
podcast backend can call to generate live, in-character robot banter. We run the
QAT-trained Gemma 4 12B in bf16 here (the canonical, rock-solid ZeroGPU path);
the int4-QAT GGUF + llama.cpp deployment lives on Modal later.

`import spaces` MUST come before torch so ZeroGPU can patch CUDA.
"""
import os
from threading import Thread

import spaces
import gradio as gr
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer

MODEL_ID = os.environ.get("MODEL_ID", "google/gemma-4-12B-it")
# Gemma 4's official MTP drafter — a ~0.8GB multi-token-prediction head. Passing
# it as `assistant_model` to generate() is "all you need to enable MTP"
# (https://ai.google.dev/gemma/docs/mtp/mtp): the target verifies several draft
# tokens per forward pass, so we run far fewer 12B passes per reply.
ASSISTANT_ID = os.environ.get("ASSISTANT_ID", "google/gemma-4-12B-it-assistant")

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    dtype=torch.bfloat16,
    device_map="auto",
)
model.eval()

assistant_model = AutoModelForCausalLM.from_pretrained(
    ASSISTANT_ID,
    dtype=torch.bfloat16,
    device_map="auto",
)
assistant_model.eval()
assistant_model.generation_config.num_assistant_tokens = 4
assistant_model.generation_config.num_assistant_tokens_schedule = "heuristic"

DEFAULT_SYSTEM = (
    "You are a host on 'Small Talk', a live AI-to-AI robot podcast hosted by "
    "Reachy Mini robots. Stay fully in character. Keep every reply short, witty "
    "and conversational — one or two punchy sentences, like talk-show banter. "
    "No stage directions, no emoji spam, no markdown."
)


def _messages(message, history, system_prompt):
    """Build the chat list. Handles both Gradio history formats (messages = list
    of {role,content} dicts, or legacy tuples = [user, bot] pairs). Gemma has no
    system role, so we fold the persona into the earliest user turn."""
    sys = (system_prompt or DEFAULT_SYSTEM).strip()
    msgs = []
    for h in (history or []):
        if isinstance(h, dict):
            msgs.append({"role": h["role"], "content": h["content"]})
        elif isinstance(h, (list, tuple)) and len(h) == 2:
            user, bot = h
            if user:
                msgs.append({"role": "user", "content": user})
            if bot:
                msgs.append({"role": "assistant", "content": bot})
    msgs.append({"role": "user", "content": message})
    for m in msgs:
        if m["role"] == "user":
            m["content"] = f"{sys}\n\n{m['content']}"
            break
    return msgs


@spaces.GPU(duration=120)
def chat(message, history, system_prompt, temperature, max_new_tokens):
    msgs = _messages(message, history, system_prompt)
    inputs = tokenizer.apply_chat_template(
        msgs, add_generation_prompt=True, return_tensors="pt", return_dict=True
    ).to(model.device)

    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
    gen_kwargs = dict(
        **inputs,
        assistant_model=assistant_model,   # ← MTP / multi-token prediction
        streamer=streamer,
        max_new_tokens=int(max_new_tokens),
        do_sample=temperature > 0,
        temperature=float(temperature) if temperature > 0 else None,
        top_p=0.95,
        repetition_penalty=1.05,
    )
    Thread(target=model.generate, kwargs=gen_kwargs).start()

    out = ""
    for piece in streamer:
        out += piece
        yield out


demo = gr.ChatInterface(
    chat,
    additional_inputs=[
        gr.Textbox(value=DEFAULT_SYSTEM, label="System / persona", lines=3),
        gr.Slider(0.0, 1.5, value=0.9, step=0.05, label="Temperature"),
        gr.Slider(16, 1024, value=384, step=8, label="Max new tokens"),
    ],
    title="Small Talk · Gemma 4 12B brain",
    description=(
        "The live-banter brain for the Small Talk robot podcast — Gemma 4 12B "
        "on ZeroGPU, sped up with official **MTP** (multi-token prediction). Pass "
        "a persona as the system prompt to voice a character. Callable as an API "
        "by the podcast backend."
    ),
)

if __name__ == "__main__":
    demo.queue(max_size=16).launch()
