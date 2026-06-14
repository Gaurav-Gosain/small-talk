# Small Talk — demo video edit plan + voiceover

Target cut: **~2:00**. Two source videos, one final.

---

## Editorial principles

- **Hook in the first 5 seconds.** Open on the Reachy dance with the music already moving. Don't show your face, your name, or "this is our hackathon project" — let the robot be the cold open.
- **Cut hard, not slow.** Every section gets one strong moment and one demo of "the thing works", then you're out. No long camera lingers, no dwelling on a UI you've already shown.
- **Music + voiceover share the floor.** Duck the music ~ –12 dB under the voiceover; let it ride at full volume in transitions and during the dance.
- **Conversations are samples, not transcripts.** The two long convos (group chat + podcast) only need 1 punchy exchange each. Trim down to the funniest 4–6 second snippet, then cut. Trust the audience to extrapolate.
- **Save the physical robots for the reveal.** Don't intercut Video 2 into the middle of the app demo — let "real robots join" be its own beat. That's the kicker.

---

## Beat sheet (timed to the voiceover lines)

The voiceover lives in `demo/audio/01-hook.wav` … `09-closing.wav` after you run `demo/generate.py`. `full.wav` is everything stitched with 0.5 s gaps for quick scratch placement; for the real edit, drop the **per-segment** wavs onto the timeline so you can shift them per visual beat.

| # | Time | What you see (footage) | What you hear (voiceover) |
|---|---|---|---|
| 1 | 0:00 – 0:08 | **Reachy dance** — full frame, music at full volume, voiceover *over* the music drop ~2 s in | `01-hook.wav` — "Small talk used to be a human thing. But this weekend, we taught the robots how to throw a party." |
| 2 | 0:08 – 0:23 | **Theme cycle montage** — fast cut through every theme (~1 s each), end on the theme you like best | `02-premise.wav` — "Small Talk is an AI-to-AI robot podcast. Give it a topic, and a cast of Reachy Minis — designed by you — write their own script, pick their own voices, and go on air, in 3D, in the browser, in real time." |
| 3 | 0:23 – 0:38 | **Designing a Reachy** — the green room / design flow you recorded at the *end* of video 1. Bring it forward to here. Show shell colour pick, hat swap, voice typed in | `03-cast.wav` — "Every robot is a three.js digital twin of the real Reachy Mini, with its own personality, its own emotive voice, and its own outfit — shells, hats, glasses, ties, whatever the show needs." |
| 4 | 0:38 – 0:55 | **Group chat** — wide shot of the grid first, then push in on one twin animating to speech. Pick the **funniest 5-second exchange** from your recording. Subtitles on. | `04-engine.wav` — "The brain is one LLM call. The voices are Qwen three TTS. And the whole thing runs as a cascade — while line one plays, line two is already rendering. The conversation never breathes dead air." |
| 5 | 0:55 – 1:05 | **Podcast format** — same trick: wide shot, then one tight exchange (~4 s). Use a different theme than #4 so the visual feels distinct | `05-formats.wav` — "Same engine, two formats: a freewheeling group chat, or a tighter podcast where every guest brings a bit." |
| 6 | 1:05 – 1:23 | **Reachy FM** — bombard the eye. Quick cuts: spinning vinyl → karaoke lyrics syncing → audio-reactive viz → DJ robot in headphones bopping. ~3 s per beat. Pick the catchier of your two recorded tracks | `06-radio.wav` — "Switch to Reachy FM and the show becomes a radio station — AI-written songs, synced karaoke lyrics, a spinning vinyl deck, and a DJ robot who actually bops between tracks." |
| 7 | 1:23 – 1:43 | **Physical Reachys join** — split-screen if you can: web UI on one side showing the robot's twin card, your real Reachy on the other side moving in sync. Otherwise quick cut between the two. Mid-pause your voiceover here so the **physical robot says one line on its own** — that's the wow moment | `07-real-robots.wav` — "Now bring the real robots in. We dropped a Go binary on our Reachy Minis, joined the call, and our physical robots became cast members — speaking their own lines, in their own voices, head and antennas moving to the words." |
| 8 | 1:43 – 1:55 | **Two-robot reveal** — wide shot of you + Nikhil + both physical Reachys + the web UI on a monitor in the background. Hold ~3 s, then a tight on each robot speaking once | `08-team.wav` — "That's me and Nikhil, two physical Reachys on a call with the show, voicing themselves in real time." |
| 9 | 1:55 – 2:05 | **End card** — Small Talk logo / typography on the project page, GitHub URL underneath. Music swells | `09-closing.wav` — "Small Talk. Robots, hosting robots. Built in a weekend, on Hugging Face." |

---

## Trim list (be ruthless)

**Cut entirely:**
- Anything that's just "watching the page load"
- Any second take of a convo if the first one already lands a joke
- The full radio track plays — 8 s of any song is enough
- Any moment where the camera is searching for what to focus on

**Trim hard:**
- Theme cycling: keep ~5 themes max, ~1 s each. You don't need to show every one.
- Group chat / podcast convo: from the whole recording, pick **one** funny back-and-forth (~5 s). The voiceover sells the rest.
- Reachy design flow: show 3 picks (shell colour, hat, voice description being typed), then cut. Skip the property panels.

---

## Voice choice

Going with **Qwen3-TTS VoiceDesign** (free-form instruct prompt) over a preset speaker, because we want a *specific* vibe and VoiceDesign lets us steer it precisely.

The instruct prompt the generator uses:

> A warm, slightly playful male narrator in his mid-30s. Mid-deep timbre with a subtle smile in the voice. Confident but conversational; unhurried but with energy. Leans into key words. Clear American English, natural breath pauses, the occasional knowing chuckle. Think indie product-film documentary meets a tech editor reading their own essay aloud.

If that doesn't land on the first generation, swap to one of these (edit `VOICE` in `generate.py`):

- **Bright female tech editorial:** "Late-20s American female narrator. Bright, clear, with a smile in her voice. Conversational pacing with deliberate emphasis on punchlines. Energetic but never bubbly. Think indie tech documentary, the kind that ends with 'and that's why we built it.'"
- **Late-night warm:** "Early-40s male narrator. Lower register, slightly raspy, very unhurried. Confident, the kind of voice that sounds like it's letting you in on something. Think audiobook of a tech essay, late at night."
- **British dry:** "Mid-30s British male, dry wit, just-under-deadpan. Crisp diction, lifts on the ironic words. Think Top Gear narration applied to robots."

Or if you'd rather use a preset speaker than design one, change `MODEL` in `generate.py` to `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit` and set `VOICE = "eric"` (or `dylan` / `ryan` / `serena` — full list in `reachy-conv/.../tts.py`).

---

## How to generate the voiceover

You need mlx-audio installed (reachy-conv already pins it). From this repo's root:

```sh
~/dev/reachy-conv/.venv/bin/python demo/generate.py
```

That drops `01-hook.wav` … `09-closing.wav` and `full.wav` into `demo/audio/`. First run downloads the model (~1 GB) and warms up; subsequent runs are fast.

Listen to each one. If a line is off, edit the text in `generate.py` (it's just a list), rerun, and only that segment gets regenerated — the others are still on disk.

---

## Final stitch

In your editor:

1. Drop the dance footage on the timeline + music track. Voiceover `01-hook.wav` overlaid starting at ~0:02 (let the music breathe first).
2. For each subsequent beat: cut the visual in at the start of that voiceover wav. Music stays underneath but ducked to ~ –12 dB.
3. **Pause the voiceover** during the brief "physical robot says one line" moment in beat 7 — let the robot's actual voice come through. It's the only diegetic audio moment outside the dance.
4. Hold the end card 1.5 s past the last voiceover word so the audience can read the URL.

If you end up under 2:00, great — hackathon judges respect brevity.
