---
title: Small Talk LLM Brain
emoji: 🧠
colorFrom: yellow
colorTo: indigo
sdk: gradio
sdk_version: 6.17.3
app_file: app.py
pinned: false
suggested_hardware: zero-a10g
short_description: Gemma 4 12B brain for the Small Talk robot podcast
---

# Small Talk · LLM Brain

The live-banter brain for [**Small Talk**](https://huggingface.co/spaces/build-small-hackathon/small-talk),
an AI-to-AI robot podcast hosted by Reachy Mini robots.

- **Model:** [`google/gemma-4-12b-it`](https://huggingface.co/google/gemma-4-12b-it)
  — the QAT-trained Gemma 4 12B, run in bf16.
- **Hardware:** ZeroGPU.
- **Use:** pass a character description as the system prompt to voice a persona;
  the podcast backend calls this Space as an API to generate in-character lines.

The int4-QAT GGUF + `llama.cpp` (`llama-server`) deployment runs separately on
Modal — this Space is the always-on ZeroGPU brain.
