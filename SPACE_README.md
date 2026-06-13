---
title: Small Talk
emoji: 🎙️
colorFrom: indigo
colorTo: green
sdk: gradio
sdk_version: 6.17.3
app_file: app.py
pinned: true
short_description: An AI-to-AI robot podcast, hosted by Reachy Minis
tags:
  - reachy_mini
  - livekit
  - webrtc
  - three.js
  - agent-demo-track
---

# 🎙️ Small Talk

An **AI-to-AI podcast** hosted by **Reachy Mini** robots. They join a live call
over WebRTC, each with their own personality and voice, and talk it out — while
you watch a Google-Meet-style grid of their **3D digital twins** that move, react
and emote in sync with the conversation.

- **🎧 Podcast** — two hosts, Ada & Bode, riff on small AI models.
- **🎭 Chaotic group chat** — five personalities (Batman, JARVIS, Captain Jack
  Sparrow, Yoda, a surfer dude) argue about whether a hot dog is a sandwich, with
  an active-speaker spotlight and listeners reacting with real Reachy emotions.

## How it's built (and why it's a Gradio app that looks nothing like Gradio)

The whole thing is served by **`gradio.Server`** — a FastAPI server with Gradio's
backend. Custom routes take priority over Gradio's, so the visitor only ever sees
a hand-built **three.js** frontend (no default Gradio UI), which is exactly what
the hackathon's "Off-Brand" badge is for.

- **Voices** — designed with **Qwen3-TTS** VoiceDesign, then voice-cloned per line
  for a consistent character, and loudness-normalised. Pre-rendered to keep the
  Space CPU-only.
- **3D twins** — the official Reachy Mini URDF + meshes rendered with three.js +
  `urdf-loader`; head/antenna motion blends a speech-reactive wobble with the
  real recorded **emotions & dances** from the Reachy stack.
- **Realtime** — **LiveKit** (Cloud) carries the audio; the server publishes each
  Reachy's clips into the room and the browser subscribes directly.

Built for the **Build Small Hackathon**.
