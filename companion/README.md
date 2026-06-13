# Small Talk companion — put a *physical* Reachy Mini on air

A single static binary that runs **on the robot**. It joins a Small Talk show as
a real cast member: the show's voices play through the Reachy's speaker, and the
head, antennas and body move with the speech using the exact same motion model
as the digital twins on the web UI.

## Install (from your machine)

```sh
cd companion
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o smalltalk-reachy .
scp smalltalk-reachy reachy@reachy.local:~
```

(A prebuilt `smalltalk-reachy-arm64` is committed here too.)

## Run locally (no robot — for testing)

You don't need a Reachy to try the companion. Build it for your own machine and
run with `-no-motors` (skips the robot daemon); the show's voices play through
your computer's speakers:

```sh
cd companion
go build -o smalltalk-reachy .          # native build for your machine
./smalltalk-reachy -room hot-dog-court -no-motors
```

Useful local flags:

```sh
# Silence the audio (just watch the subtitles + cast logs scroll by)
./smalltalk-reachy -room hot-dog-court -no-motors -player "cat > /dev/null"

# Point at a locally-running backend instead of the hosted Space
./smalltalk-reachy -room hot-dog-court -no-motors -space http://localhost:7860
```

Needs `go` (1.21+) and, for audio, any of `ffplay` / `ffmpeg` / `mpv` on PATH.

## Run (on the robot)

```sh
# Listen in on any show — every host plays through the Reachy's speaker
./smalltalk-reachy -room hot-dog-court

# Star in your own show: on the web, "New show → Physical Reachys" opens a green
# room and shows you the exact command (with the room id). Run it here:
./smalltalk-reachy -room my-show-1a2b -name "Gaurav's Reachy" -voice "warm, deep, unhurried"
```

When you hit **Start the show** in the green room, the writers cast this Reachy
**by name** as one of the hosts (alongside however many simulated robots you
picked on the slider). From that moment the binary flips into **cast mode** and
the robot speaks **only its own lines** — the other hosts keep playing in the
web view, so the physical robot isn't echoing the whole room. Until it's cast
(or if you just tune into a show as a spectator) it plays everyone, like a
little radio.

Requirements on the robot: the `reachy_mini` daemon running (it is, by default —
we speak its `ws://localhost:8000/ws/sdk` JSON protocol), and any of
`ffplay` / `ffmpeg` / `mpv` for Opus decoding (Reachy OS ships ffmpeg).

### Keep it on air across a whole show

A terminal room drop exits the binary non-zero, so wrap it in a supervisor and
it rejoins automatically:

```sh
while true; do ./smalltalk-reachy -room my-show-1a2b -name "Gaurav's Reachy"; sleep 2; done
```

(or a `systemd` unit with `Restart=always`).

## Flags

| flag | default | meaning |
|---|---|---|
| `-room` | — | room id to join (required) |
| `-name` | `Reachy` | display name — the writers cast the robot under this name |
| `-voice` | — | voice description for this robot's TTS lines when it's cast |
| `-persona` | a real Reachy… | one-line personality blurb for the card |
| `-color` | `#49e6c8` | card accent colour |
| `-shell` / `-hat` / `-face` / `-neck` | — | shell tint + prop slugs |
| `-space` | the HF Space URL | Small Talk control plane (mints the LiveKit token) |
| `-only` | all | manually embody just the participants whose identity contains this |
| `-robot` | `localhost:8000` | reachy_mini daemon address |
| `-no-motors` | off | audio + subtitles only (for testing off-robot) |
| `-wake` | off | send `wake_up` to the daemon on start |
| `-player` | auto | override the audio player command (gets Ogg/Opus on stdin) |

## How it works

- `POST <space>/api/token` with `device:true` → a LiveKit token whose identity is
  `reachy-device-…` and whose metadata carries the name/voice/persona/props. The
  robot joins as a **real participant** (its own card in the grid), not a
  spectator.
- When a physical show starts, the backend scans the room for `reachy-device-*`
  participants and tells the writers they MUST cast them by name. Each cast
  robot's TTS is published by a `gen-…` host whose metadata has
  `forDevice = <this robot's identity>`.
- The binary watches subscribed audio tracks: a track whose `forDevice` matches
  its own identity is **its line** → it plays that and (once cast) mutes every
  other host. A track with no `forDevice`, before being cast, plays as a room
  speaker. This is the "speak only my own lines, if it makes sense" rule.
- Speech intensity is derived from Opus packet sizes (VBR tracks energy), so the
  binary needs no audio decoding of its own — that envelope drives the same
  breathe/sway/antenna model as `frontend/src/reachy3d.js`, sent to the daemon
  at 50 Hz as `set_full_target` (4×4 head pose + antennas + body yaw).
- Subtitles/status data messages are printed to the console; `goto_sleep` is sent
  on exit so the robot settles.
