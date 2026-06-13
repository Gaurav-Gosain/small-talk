# 🎙️ Small Talk — an AI-to-AI robot podcast

**Reachy Mini** robots host live shows: each one has its own voice, personality
and a **3D digital twin** that animates in sync with its speech. Give the robots
a topic and they write the script, design their own voices, dress themselves and
go live — and a real Reachy Mini can join the call as one of the hosts.

**▶ Live demo:** https://build-small-hackathon-small-talk.hf.space

Built for the Build Small Hackathon.

## What's inside

- **Live generated shows** — pick a topic, the LLM writes a cast + speaker→dialogue
  script in one structured call, then each line is voiced by TTS with the next
  line generating while the current one plays (a cascade, no dead air). Subtitles,
  a "writers' room" pre-show, and continuations keep it going.
- **Pick your cast** — a slider sets how many robots host (2–5), or how many
  simulated co-hosts fill in around your physical Reachys.
- **3D digital twins** — every robot is a live three.js model (the real Reachy
  Mini URDF) that bobs, emotes and dances to the audio. Design your own: name,
  personality, voice, shell colour and props (hats, glasses, ties…).
- **Reachy FM** 📻 — a prerecorded radio station: AI-written songs with synced
  karaoke lyrics, a spinning vinyl deck, an audio-reactive visualizer, and a DJ
  robot in headphones who bops and does mic breaks between tracks.
- **Physical Reachy companion** — a single Go binary you drop onto a real Reachy
  Mini so it joins a show as a real cast member and speaks its own lines through
  the robot, head and antennas moving with the speech. See
  [`companion/README.md`](companion/README.md).
- **Themes, mission-control admin, topic moderation**, and a self-hosted LiveKit
  SFU for the WebRTC transport.

## Architecture

```
 topic ─► LLM (Nemotron, one structured call) ─► cast + script
                                                    │
              per line:  TTS (Qwen3-TTS) ──► ReachyPublisher ──► LiveKit room ──► browser
              (line N+1 renders while N plays)   (Python)          (WebRTC SFU)      │
                                                                                     ├─► <audio> out
              subtitles/status ──► LiveKit data messages ──────────────────────────┤
                                                                                     └─► three.js twin
                                                                                          (RTP level → motion)
 physical Reachy ◄── companion binary (Go) ◄── its own host's audio track ◄──────────────┘
```

## Run the companion binary locally (no robot needed)

You can try the companion on your own machine — it joins a live show and plays
the robots through your speakers:

```sh
cd companion
go build -o smalltalk-reachy .
./smalltalk-reachy -room hot-dog-court -no-motors
```

Add `-player "cat > /dev/null"` to mute the audio, or `-space http://localhost:7860`
to point at a local backend. Full flags and the on-robot install are in
[`companion/README.md`](companion/README.md).

## Run the full app locally

```sh
uv sync                                  # Python deps
cd frontend && pnpm install && pnpm build && cd ..
./scripts/fetch-assets.sh                # Reachy URDF + meshes (Apache-2.0, kept out of git)
cp .env.example .env                     # then fill in LiveKit + Modal creds
uv run python app.py                     # serves the SPA + /api at http://localhost:7860
```

Secrets (LiveKit + Modal endpoint URLs/keys, admin token) live in `.env`
(gitignored) and as Space secrets — never in the repo. `scripts/deploy-space.py`
pushes the built app to Hugging Face.

## Repo layout

| path | what |
|---|---|
| `app.py` | Hugging Face Space entrypoint (FastAPI host serving the SPA + `/api`) |
| `backend/` | control plane: rooms, token minting, show generation, TTS cascade, admin, moderation |
| `frontend/` | three.js single-page app (twins, themes, radio, green room, admin) |
| `companion/` | Go binary for a physical Reachy Mini |
| `radio/` | Reachy FM assets (songs, album art, synced lyrics, DJ mic breaks) |
| `scripts/` | asset fetchers, voice prerendering, deploy |

## Credits / license

3D assets (URDF + STL) are from
[pollen-robotics/reachy-mini-desktop-app](https://huggingface.co/pollen-robotics)
(Apache-2.0) and the prop library is CC-BY (attribution in the manifest); both
are fetched by scripts and kept out of git. LLM + TTS run on Modal endpoints.
