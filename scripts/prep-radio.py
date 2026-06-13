#!/usr/bin/env python3
"""Prep the Reachy FM radio station assets.

Takes the songs dump (mp3 + jpeg album art + srt synced lyrics), slugifies it
into radio/, parses the SRTs into a compact lyrics JSON, and prerecords DJ
Servo's mic breaks with the Qwen3-TTS Modal endpoint (one consistent late-night
FM voice). Idempotent: existing RJ clips are kept unless --re-voice.

Usage:  uv run scripts/prep-radio.py [--src /tmp/songs/songs] [--re-voice]
Needs:  MODAL_TTS_URL / MODAL_TTS_KEY in the environment (or .env), ffmpeg.
"""
import argparse
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

import httpx

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "radio"

try:  # .env convenience when run outside uv
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

TTS_URL = os.environ.get("MODAL_TTS_URL", "")
TTS_KEY = os.environ.get("MODAL_TTS_KEY", "")

# DJ Servo — the station's one and only voice. Rich spec + consistency clause,
# same trick as the live shows (VoiceDesign re-rolls unless anchored hard).
RJ_VOICE = (
    "A smooth, deep late-night FM radio DJ voice: warm male baritone, velvety and "
    "unhurried, with classic announcer resonance and a constant hint of a smile. "
    "Relaxed flowing delivery, like narrating to night drivers at 2 AM. "
    "Always exactly this same voice, steady and consistent across takes."
)

# The running order of the station, with DJ Servo's mic break BEFORE each track.
# Slug must match slugify(title) of the source files.
SHOW: list[tuple[str, str]] = [
    ("welcome-to-reachy-radio",
     "You're locked in to Reachy FM, eighty-eight point eight on your imaginary dial. "
     "I'm DJ Servo — four billion parameters of pure velvet, broadcasting from a robot "
     "the size of a coffee mug. We open, as all great stations open, with a theme song. "
     "Turn it up... and let it glow."),
    ("my-gpu-is-hotter-than-dubai",
     "It is forty-five degrees outside the studio right now... and somehow the GPU is winning. "
     "This one goes out to every thermal-throttled soul in the desert. My GPU Is Hotter Than Dubai."),
    ("modal-my-credits-are-gone",
     "Two hundred and fifty dollars of Modal credits. Felt like a million. Lasted a weekend. "
     "A moment of silence for the burn rate... and now, the ballad."),
    ("huggingface-credits-twenty-dollars-of-hope",
     "Brothers and sisters, gather round the warm glow of the inference endpoint. "
     "Twenty dollars of credit. Not twenty thousand. Twenty. Can I get an amen? Take us to church."),
    ("hugging-face-hold-me-close",
     "And after the sermon... the love song. For the yellow emoji that hosts our models for free "
     "and never calls back. Hugging Face, Hold Me Close."),
    ("gradio-three-lines-of-python",
     "Fifty files. Twelve configs. A Docker Compose... for a text box. Or — hear me out — "
     "three lines of Python. This one's for the demo builders. Gradio."),
    ("nvidia-gave-us-gpus-and-we-used-them-for-vibes",
     "Jensen, in the leather jacket, handed humanity the future of computing. "
     "We taught a small robot the Macarena. No regrets, no refunds. NVIDIA Gave Us GPUs."),
    ("openai-at-a-small-model-hackathon",
     "Picture it: a trillion-dollar company walks into a party about being small. "
     "Everyone's too polite to ask why. OpenAI, at a Small Model Hackathon."),
    ("openai-sponsored-a-small-model-hackathon-and-i-have-questions",
     "In the artificial intelligence system, there are two kinds of models. "
     "The small ones, who do the work... and the big ones, who sponsor the party. "
     "Dun dun. The case continues."),
    ("cohere-nobody-knows-what-you-do",
     "It was a dark night at the hackathon. In the corner stood... Cohere. "
     "Enterprise. Mysterious. Allegedly Canadian. This noir goes out to them."),
    ("openbmb-the-song-nobody-can-pronounce",
     "Open Bamboo? Open Bimby? It's Open Big Model Base, and they brought more models "
     "than you can download. Say it with me. Or don't. Nobody can."),
    ("readme-driven-development",
     "Fourteen badges. Build passing. Coverage unknown. I too have written the README "
     "before the code, and I too have called it production-ready. Snaps on, please."),
    ("dubai-developer-blues",
     "Slide guitar. Sunset over the marina. Air conditioning set to survival. "
     "These, friends, are the Dubai Developer Blues."),
    ("modal-credits-gone-too-fast",
     "Still grieving the Modal credits? So are we. Same wound... different tempo."),
    ("i-asked-claude-to-write-these-songs",
     "Full disclosure from the booth: every track tonight was written by an AI, "
     "about the people who asked an AI to write it. Is that a problem? "
     "The next song investigates itself."),
    ("about-us-no-robot-required",
     "And finally... the story of us. Five robots, one hot dog question, zero consensus. "
     "This is About Us — recorded, ironically, with robots very much required."),
]

STATION_OPEN = (
    "Reachy FM. Small models... big feelings. Stay tuned.")

MARKER = re.compile(
    r"^\[?\(?\s*(verse|chorus|bridge|outro|intro|pre-chorus|hook|refrain|final chorus|interlude)"
    r"[\s\d:\)\]]*$", re.IGNORECASE)


def slugify(s: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")


def parse_srt(path: pathlib.Path) -> list[list]:
    """SRT -> [[startSeconds, text], ...] with bare section markers dropped."""
    out = []
    blocks = re.split(r"\n\s*\n", path.read_text(errors="replace"))
    for b in blocks:
        lines = [l.strip() for l in b.strip().splitlines() if l.strip()]
        if len(lines) < 3:
            continue
        m = re.match(r"(\d+):(\d+):(\d+)[,.](\d+)", lines[1])
        if not m:
            continue
        t = int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3]) + int(m[4]) / 1000
        text = " ".join(lines[2:]).strip()
        if not text or MARKER.match(text):
            continue
        out.append([round(t, 2), text])
    return out


def tts_mp3(text: str, dest: pathlib.Path) -> None:
    r = httpx.post(
        f"{TTS_URL}/v1/audio/speech",
        headers={"Authorization": f"Bearer {TTS_KEY}"},
        json={"text": text, "instruct": RJ_VOICE, "language": "English"},
        timeout=300,
    )
    r.raise_for_status()
    if not r.content.startswith(b"RIFF"):
        raise ValueError(f"TTS returned non-wav for {dest.name}")
    wav = dest.with_suffix(".wav")
    wav.write_bytes(r.content)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(wav),
                    "-codec:a", "libmp3lame", "-b:a", "112k", str(dest)], check=True)
    wav.unlink()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="/tmp/songs/songs")
    ap.add_argument("--re-voice", action="store_true", help="regenerate RJ clips")
    args = ap.parse_args()
    src = pathlib.Path(args.src)

    (OUT / "rj").mkdir(parents=True, exist_ok=True)
    by_slug = {slugify(p.stem): p for p in src.glob("*.mp3")}
    missing = [s for s, _ in SHOW if s not in by_slug]
    if missing:
        sys.exit(f"songs not found for slugs: {missing}\nhave: {sorted(by_slug)}")

    tracks = []
    for slug, rj_text in SHOW:
        mp3 = by_slug[slug]
        title = mp3.stem
        art = mp3.with_suffix(".jpeg")
        srt = mp3.with_suffix(".srt")
        shutil.copyfile(mp3, OUT / f"{slug}.mp3")
        if art.exists():
            shutil.copyfile(art, OUT / f"{slug}.jpeg")
        rj_clip = OUT / "rj" / f"{slug}.mp3"
        if args.re_voice or not rj_clip.exists():
            print(f"  voicing DJ Servo for {slug}…")
            tts_mp3(rj_text, rj_clip)
        tracks.append({
            "id": slug,
            "title": title,
            "mp3": f"/radio/{slug}.mp3",
            "art": f"/radio/{slug}.jpeg" if art.exists() else None,
            "lyrics": parse_srt(srt) if srt.exists() else [],
            "rj": {"src": f"/radio/rj/{slug}.mp3", "text": rj_text},
        })

    sweep = OUT / "rj" / "station-id.mp3"
    if args.re_voice or not sweep.exists():
        print("  voicing the station id…")
        tts_mp3(STATION_OPEN, sweep)

    (OUT / "playlist.json").write_text(json.dumps({
        "station": "REACHY FM",
        "dial": "88.8",
        "host": "DJ Servo",
        "stationId": {"src": "/radio/rj/station-id.mp3", "text": STATION_OPEN},
        "tracks": tracks,
    }, indent=1))
    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"radio/ ready: {len(tracks)} tracks, {total/1e6:.0f} MB")


if __name__ == "__main__":
    main()
