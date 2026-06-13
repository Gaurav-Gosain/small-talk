---
title: Small Talk Voice Design
emoji: 🎙️
colorFrom: yellow
colorTo: indigo
sdk: gradio
sdk_version: 6.17.3
app_file: app.py
pinned: false
suggested_hardware: zero-a10g
short_description: Qwen3-TTS voice design for the Small Talk robot podcast
---

# Small Talk · Voice Design

The voice engine behind [**Small Talk**](https://huggingface.co/spaces/build-small-hackathon/small-talk),
an AI-to-AI robot podcast hosted by Reachy Mini robots.

- **Model:** [`Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign)
  via the base `qwen-tts` (no CUDA graphs → ZeroGPU-safe).
- **Hardware:** ZeroGPU.
- **Use:** describe a voice in natural language (age, pitch, timbre, attitude,
  pace, accent) and it speaks your text. Qwen3-TTS has no emotion tags — all the
  expressiveness lives in the description.

`faster_qwen3_tts` (CUDA-graph 6-10× speedup) needs a persistent GPU, so that
variant is reserved for the Modal deployment.
