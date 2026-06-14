#!/usr/bin/env python3
"""Rebuild the Reachy FM karaoke lyrics with correct words and accurate timing.

The songs shipped with auto-generated SRTs whose WORDS were correct (they're the
real generated lyrics) but whose structure was a mess: split lines, duplicated
cues, garbage 20ms timestamps, markers. So we take the cleaned correct text from
each SRT (scripts/lyrics-src/<id>.srt) and FORCE-ALIGN it to the audio with
Whisper (stable-ts) to get accurate per-line timing. Forced alignment keeps the
exact words ("glow" stays "glow") while fixing the timing, which plain Whisper
transcription got wrong.

Then we trim the un-aligned tail (these audios fade before the SRT's final
repeated choruses, so the tail would otherwise cram past the end) and merge short
continuation fragments. Output overwrites the `lyrics` arrays in radio/playlist.json.

Run (GPU):
    uv venv /tmp/wv --python 3.12
    uv pip install --python /tmp/wv stable-ts faster-whisper nvidia-cudnn-cu12 nvidia-cublas-cu12
    LIBS=/tmp/wv/lib/python3.12/site-packages/nvidia
    LD_LIBRARY_PATH="$LIBS/cublas/lib:$LIBS/cudnn/lib" \
        /tmp/wv/bin/python scripts/transcribe-lyrics.py
"""
import json
import pathlib
import re
import subprocess

import stable_whisper

ROOT = pathlib.Path(__file__).resolve().parent.parent
RADIO = ROOT / "radio"
SRT_DIR = ROOT / "scripts" / "lyrics-src"
PLAYLIST = RADIO / "playlist.json"

MARKER = re.compile(r"^[\[\(]?\s*(verse|chorus|bridge|outro|intro|pre[\s-]?chorus|"
                    r"hook|refrain|interlude|spoken|instrumental|final\s+chorus)[\s\d:\)\]]*$", re.I)
BRACKET = re.compile(r"^\[.*\]$")
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())


def srt_text(track_id):
    """Cleaned correct lyric lines from the source SRT (markers + near-adjacent
    duplicate fragments removed)."""
    p = SRT_DIR / f"{track_id}.srt"
    if not p.exists():
        return ""
    cues = []
    for b in re.split(r"\n\s*\n", p.read_text(errors="replace")):
        ls = [l.strip() for l in b.strip().splitlines() if l.strip()]
        if len(ls) < 3 or not re.match(r"\d+:\d+:\d+[,.]\d+", ls[1]):
            continue
        txt = re.sub(r"^\[[^\]]*\]\s*", "", " ".join(ls[2:]).strip())
        if not txt or MARKER.match(txt) or BRACKET.match(txt):
            continue
        cues.append(txt)
    kept = []
    for txt in cues:
        n = norm(txt)
        if not n:
            continue
        if any(n == r or (n in r and len(n) < len(r)) for r in (norm(k) for k in kept[-2:])):
            continue
        kept.append(txt)
    return "\n".join(kept)


def duration(mp3):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", str(mp3)], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


def merge_orphans(lines):
    out = []
    for t, tx in lines:
        if out:
            pt, px = out[-1]
            short = len(tx.split()) <= 3 and len(tx) <= 16
            cont = px[-1:] not in ".?!)" and not px.endswith("—")
            if short and cont and (tx[:1].islower() or len(tx.split()) <= 2):
                out[-1] = [pt, (px + " " + tx).strip()]
                continue
        out.append([t, tx])
    return out


def main():
    model = stable_whisper.load_faster_whisper("large-v3", device="cuda", compute_type="float16")
    data = json.loads(PLAYLIST.read_text())
    for tr in data["tracks"]:
        text = srt_text(tr["id"])
        if not text:
            print(f"  no SRT for {tr['id']}")
            continue
        mp3 = RADIO / pathlib.Path(tr["mp3"]).name
        res = model.align(str(mp3), text, language="en", original_split=True)
        lines = [[round(s.start, 2), s.text.strip()] for s in res.segments if s.text.strip()]
        lines = merge_orphans(lines)
        # trim the un-aligned tail (audio fades before the SRT's final repeats)
        dur = duration(mp3)
        while len(lines) >= 2 and (lines[-1][0] > dur - 1.2 or lines[-1][0] - lines[-2][0] < 0.5):
            lines.pop()
        last = -1.0
        for ln in lines:
            ln[0] = max(ln[0], last + 0.2)
            last = ln[0]
        tr["lyrics"] = lines
        print(f"  {len(lines):3d} lines  {tr['id']}", flush=True)
    PLAYLIST.write_text(json.dumps(data, indent=1))
    print("updated", PLAYLIST)


if __name__ == "__main__":
    main()
