# Small Talk demo — Clipchamp edit timeline (~2:05)

Source clips live in `~/Downloads/reachy_hackathon/`:

| short name      | file                              | duration | what it shows |
|---|---|---|---|
| **dance**       | `reachy_dance.mp4`               | 1:08     | Reachy dancing to music — cold open |
| **dance audio** | `(Audio) reachy_…` (in Clipchamp media) | 1:08 | dance soundtrack (same source as `dance` if separated) |
| **main**        | `2026-06-13 20-08-27.mov`        | 8:37     | comprehensive app walkthrough: theme switching → group chat → podcast → radio → design Reachy |
| **screen call** | `screen_recorder.mov`            | 7:47     | the joint call with Gaurav + Nikhil joining via physical Reachys |
| **call B-roll** | `VID20260613191534.mp4`          | 7:20     | phone B-roll of physical robots on the call |
| **reachy A**    | `IMG_3315.MOV`                   | 3:56     | physical Reachy talking, close up |
| **reachy B**    | `IMG_3314.MOV`                   | 2:10     | physical Reachy talking, close up |
| **reachy C**    | `IMG_3313.MOV`                   | 0:27     | physical Reachy talking, short clip |
| **reachy D**    | `IMG_3316.MOV`                   | 0:07     | physical Reachy talking, very short clip |
| **mid 1**       | `2026-06-13 19-16-32.mov`        | 5:54     | earlier screen rec (alternate take, use if you want a second angle) |
| **mid 2**       | `2026-06-13 19-06-57.mov`        | 4:45     | earlier screen rec |
| **dj mascot**   | `demo/video/dj-greenscreen.mp4`  | 0:12     | DJ Reachy on a chroma-key green BG, talking-envelope head motion |

Voiceover (per beat) lives in `demo/audio/clone-NN-*.wav`. The 0.5 s gaps in `clone-full.wav` are only there as a scratch listen — use the **per-beat** wavs on the timeline so you can shift them around per visual cut.

---

## Beat 1 — Cold open (0:00 – 0:08)

| layer | source | in / out | timeline | notes |
|---|---|---|---|---|
| V1 | **dance** | pick the best 8 s — usually somewhere mid-clip (~0:30) when Reachy has settled into a strong move | 0:00 – 0:08 | full-frame, no overlay |
| A1 | **dance audio** | 0:30 – 0:38 (matches V1) | 0:00 – 0:08 | 0 dB |
| A2 | `clone-01-hook.wav` (6.8 s) | — | **0:02 – 0:08.8** | overlay voice 2 s after music drops |

Duck A1 to roughly **–10 dB** under A2 from 0:02 onwards.

---

## Beat 2 — Premise & theme cycle (0:08 – 0:23)

| layer | source | in / out | timeline | notes |
|---|---|---|---|---|
| V1 | **main** | hunt for the theme-switching montage early in the clip (probably ~0:30 – 1:30). Pick **4 themes max** of ~3 s each — total 12 s | 0:08 – 0:23 | crossfade ~6 frames between cuts; let each theme breathe for 2 s before the next |
| A1 | dance audio (looped) | continue | 0:08 – 0:23 | keep ducked |
| A2 | `clone-02-premise.wav` (~15 s) | — | 0:08 – 0:23 | sits exactly under the visual |

---

## Beat 3 — Designing a Reachy (0:23 – 0:38)

| layer | source | in / out | timeline | notes |
|---|---|---|---|---|
| V1 | **main** | hunt for the **green-room / Design Reachy panel** — almost certainly near the *end* of the 8:37 clip. Show: shell colour pick → hat swap → voice description being typed. Trim to ~15 s, drop the property panels | 0:23 – 0:38 | one quick zoom-in (Clipchamp "Pan & Zoom") on the typed voice description sells the personality angle |
| A2 | `clone-03-cast.wav` (~12 s) | — | 0:23 – 0:35 | leave 3 s of music-only at the end |

---

## Beat 4 — Engine / cascade (0:38 – 0:55)

| layer | source | in / out | timeline | notes |
|---|---|---|---|---|
| V1a | **main** group-chat section | pick the **funniest 5 s exchange** from group chat (look for one where 2 robots crack up or react to each other). Aim for ~0:38 – 0:43 | 0:38 – 0:43 | bring up subtitles |
| V1b | **main** continue group chat | wide shot of the grid for 2 s, then push in on one twin | 0:43 – 0:55 | gives the "every voice is generating in parallel" feel |
| A2 | `clone-04-engine.wav` (~15 s) | — | 0:38 – 0:53 | the "Qwen three TTS" line — the visual pushes into the live twin right as the VO says "the voices are Qwen three TTS" |
| A3 | leak in 2–3 s of robot voice from V1a as a duck under VO | — | 0:40 – 0:43 | gives texture; –18 dB under VO |

---

## Beat 5 — Two formats (0:55 – 1:05)

| layer | source | in / out | timeline | notes |
|---|---|---|---|---|
| V1 | **main** podcast section | one tight 4 s exchange from the podcast layout, different theme than beat 4 | 0:55 – 1:00 | hard cut, no transition |
| V1 | **main** wide of podcast layout | 5 s, hold steady | 1:00 – 1:05 |  |
| A2 | `clone-05-formats.wav` (~7 s) | — | 0:55 – 1:02 | leave 3 s of music-only tail |

---

## Beat 6 — Reachy FM (1:05 – 1:23)

| layer | source | in / out | timeline | notes |
|---|---|---|---|---|
| V1 | **main** radio section | rapid cuts: (a) spinning vinyl deck 4 s → (b) karaoke lyrics syncing 4 s → (c) audio-reactive visualizer 4 s → (d) DJ robot in headphones 6 s | 1:05 – 1:23 | tight cuts, 3 frames each |
| A1 | bring up a tiny bit of the radio track audio under the VO | — | 1:05 – 1:23 | –15 dB; lets the audience know there's music in the show without competing with VO |
| A2 | `clone-06-radio.wav` (~13 s) | — | 1:05 – 1:18 | leave 5 s of radio audio tail before next beat |

---

## Beat 7 — Physical Reachys join (1:23 – 1:43)

| layer | source | in / out | timeline | notes |
|---|---|---|---|---|
| V1 | **screen call** + **reachy A** | **split-screen** — `screen_recorder.mov` on the left half (the web UI showing the device's twin card), **reachy A** (`IMG_3315.MOV`) on the right half (real Reachy moving in sync). Find a ~12 s segment where both are clearly active | 1:23 – 1:35 |  |
| V1 | **reachy A** full-frame, mouth/head moving | pick the moment the **physical Reachy speaks a single line** (4 s) | 1:35 – 1:39 | **pause the VO here so the audience hears the real Reachy's voice** — this is the wow moment |
| V1 | back to **screen call** showing both device cards lit up | 4 s | 1:39 – 1:43 |  |
| A2 | `clone-07-real-robots.wav` (~15 s) | — | 1:23 – 1:35 then 1:39 – ... | split: first 12 s of VO under the split screen, then **silence on the VO track during 1:35 – 1:39** so the real Reachy audio plays clean, then back to VO |
| A3 | **reachy A** native audio | the line you picked | 1:35 – 1:39 | this is the diegetic moment; ride the actual robot voice at 0 dB |

If you don't have clean robot audio in the IMG clips, use the screen recorder's audio for that 4 s window instead.

---

## Beat 8 — Team reveal (1:43 – 1:55)

| layer | source | in / out | timeline | notes |
|---|---|---|---|---|
| V1 | **call B-roll** (`VID20260613191534.mp4`) | a wide phone shot of **you + Nikhil + both physical Reachys + the web UI on a monitor**. Find a 7-second window. | 1:43 – 1:50 | the team-reveal anchor |
| V1 | **reachy B** + **reachy C** | tight cut on each physical Reachy speaking once, ~2.5 s each | 1:50 – 1:55 |  |
| A2 | `clone-08-team.wav` (~6.6 s) | — | 1:43 – 1:50 | nails the "me and Nikhil" line under the wide |

---

## Beat 9 — End card (1:55 – 2:05)

| layer | source | in / out | timeline | notes |
|---|---|---|---|---|
| V1 | **dj mascot** (`demo/video/dj-greenscreen.mp4`) — chroma-key the green out | use the full 12 s, will be cropped to 10 s | 1:55 – 2:05 | layer it bottom-right corner over a typography end card with the GitHub URL: `github.com/Gaurav-Gosain/small-talk` |
| V1 background | solid-colour title slate or a still from theme cycle | — | 1:55 – 2:05 | dark BG, bold "Small Talk" lockup |
| A1 | swell dance audio back to **0 dB** | — | 1:55 – 2:05 | hold for 1.5 s after VO ends, then fade |
| A2 | `clone-09-closing.wav` (~6.6 s) | — | 1:55 – 2:01.6 | tail 3.5 s of music + DJ mascot before fade-out |

---

## Audio mix cheatsheet

| element | level under VO | level when VO silent |
|---|---|---|
| dance / bed music | –10 to –12 dB | 0 dB |
| robot voice diegetic | mostly hidden, occasional duck-under | 0 dB at the wow moment (1:35 – 1:39) |
| voiceover (clone-*.wav) | 0 dB | — |

Hard-knee compressor on the voiceover bus (ratio 3:1, threshold –18 dB) keeps it sitting on top of the music without pumping.

---

## Transitions — pick one and stick to it

- **Cuts** (default): hard cuts everywhere except inside the theme cycle (Beat 2) which uses 6-frame crossfades
- **Whip** between Beat 7 and Beat 8: a small horizontal blur whip sells the "now bring the real robots" pivot from app → physical
- **Fade to black** only at the very end after the end card holds 1.5 s

---

## What to do first

1. Throw `clone-full.wav` (or sequential per-beat wavs) on the audio track. That **locks the total length** and gives you the rhythm to cut against.
2. Drop placeholder visuals against each beat — even just a colour card — so you can see the pacing.
3. Replace each placeholder with the real shot, hunting through the main 8:37 for the right moment.
4. Last pass: music ducking + chroma-key the DJ mascot.

You'll likely come in around 2:00 even — if so, ship it.
