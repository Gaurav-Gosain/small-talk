#!/usr/bin/env python3
"""Generate the Small Talk demo voiceover by *cloning* a reference voice
with Resemble AI's Chatterbox.

VoiceDesign rolled a fresh voice every call which made the cut jarring.
Cloning anchors timbre to a single reference WAV so every beat lands in
the same voice, every run.

The reference clip at `demo/audio/voice-reference.wav` is 25 s of Bob
Neufeld reading Dostoevsky's *Notes From the Underground* on LibriVox
(public domain) — a slow, dark, weighty male baritone with no music,
ideal for the car-commercial / trailer-narrator vibe.

Outputs `clone-01.wav` … `clone-09.wav` and `clone-full.wav` (0.5 s gaps)
into `demo/audio/`. Run from reachy-conv's venv:

    ~/dev/reachy-conv/.venv/bin/python demo/generate-clone.py

To use a different reference, replace `voice-reference.wav` (5–30 s,
clean speech, single speaker, mono works best) and re-run.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

REFERENCE_WAV = Path(__file__).resolve().parent / "audio" / "voice-reference.wav"
OUT_DIR = Path(__file__).resolve().parent / "audio"

# Chatterbox knobs:
# - exaggeration < 0.5 keeps the delivery measured and authoritative;
#   higher values inject TED-talk energy.
# - cfg_weight 0.5 is the documented neutral balance.
EXAGGERATION = 0.3
CFG_WEIGHT = 0.5
GAP_SECONDS = 0.5
PEAK_TARGET = 0.9

SCRIPT: list[tuple[str, str]] = [
    (
        "01-hook",
        "Small talk used to be a human thing. But this weekend, we taught "
        "the robots how to throw a party.",
    ),
    (
        "02-premise",
        # Avoid "go live" — Chatterbox kept reading "live" as the verb
        # (rhymes with "give") instead of the adjective. "go on air" is
        # unambiguous and means the same thing.
        "Small Talk is an AI-to-AI robot podcast. Give it a topic, and a "
        "cast of Reachy Minis — designed by you — write their own script, "
        "pick their own voices, and go on air, in 3D, in the browser, in "
        "real time.",
    ),
    (
        "03-cast",
        "Every robot is a three.js digital twin of the real Reachy Mini, "
        "with its own personality, its own emotive voice, and its own "
        "outfit — shells, hats, glasses, ties, whatever the show needs.",
    ),
    (
        "04-engine",
        # "Qwen3" reads as "Qwen tree" — spell the number out. Same for any
        # other model name with a glued numeric.
        "The brain is one LLM call. The voices are Qwen three TTS. And the "
        "whole thing runs as a cascade — while line one plays, line two "
        "is already rendering. The conversation never breathes dead air.",
    ),
    (
        "05-formats",
        "Same engine, two formats: a freewheeling group chat, or a "
        "tighter podcast where every guest brings a bit.",
    ),
    (
        "06-radio",
        "Switch to Reachy FM and the show becomes a radio station — "
        "AI-written songs, synced karaoke lyrics, a spinning vinyl deck, "
        "and a DJ robot who actually bops between tracks.",
    ),
    (
        "07-real-robots",
        "Now bring the real robots in. We dropped a Go binary on our "
        "Reachy Minis, joined the call, and our physical robots became "
        "cast members — speaking their own lines, in their own voices, "
        "head and antennas moving to the words.",
    ),
    (
        "08-team",
        "That's me and Nikhil, two physical Reachys on a call with the "
        "show, voicing themselves in real time.",
    ),
    (
        "09-closing",
        "Small Talk. Robots, hosting robots. Built in a weekend, on "
        "Hugging Face.",
    ),
]


def write_wav(path: Path, audio: np.ndarray, sr: int) -> None:
    try:
        import soundfile as sf

        sf.write(str(path), audio, sr, subtype="PCM_16")
    except ImportError:
        from scipy.io.wavfile import write as scipy_write

        scipy_write(str(path), sr, (audio * 32_767).astype(np.int16))


def pick_device() -> str:
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def main() -> int:
    if not REFERENCE_WAV.exists():
        print(f"[clone] missing reference: {REFERENCE_WAV}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(exist_ok=True)

    print("[clone] loading Chatterbox …")
    from chatterbox.tts import ChatterboxTTS

    device = pick_device()
    print(f"[clone] device: {device}")
    model = ChatterboxTTS.from_pretrained(device=device)
    sr = int(getattr(model, "sr", 24_000))

    print(f"[clone] cloning timbre from {REFERENCE_WAV.name}")
    print(f"[clone] writing to {OUT_DIR}/")

    rendered: list[np.ndarray] = []
    for tag, text in SCRIPT:
        head = text[:60].replace("\n", " ")
        print(f"[clone] clone-{tag}: {head}…")
        wav = model.generate(
            text=text,
            audio_prompt_path=str(REFERENCE_WAV),
            exaggeration=EXAGGERATION,
            cfg_weight=CFG_WEIGHT,
        )
        arr = wav.detach().cpu().numpy() if hasattr(wav, "detach") else np.asarray(wav)
        if arr.ndim > 1:
            arr = arr.reshape(-1)
        arr = arr.astype(np.float32, copy=False)
        if not arr.size:
            print(f"  ! empty output for {tag}")
            continue
        peak = float(np.max(np.abs(arr)))
        if peak > 1e-6:
            arr = arr / peak * PEAK_TARGET
        path = OUT_DIR / f"clone-{tag}.wav"
        write_wav(path, arr, sr)
        rendered.append(arr)
        print(f"  ✓ {path.name}  ({len(arr) / sr:.1f}s)")

    if rendered:
        gap = np.zeros(int(sr * GAP_SECONDS), dtype=np.float32)
        full = []
        for i, p in enumerate(rendered):
            if i:
                full.append(gap)
            full.append(p)
        full_wav = np.concatenate(full)
        full_path = OUT_DIR / "clone-full.wav"
        write_wav(full_path, full_wav, sr)
        print(
            f"[clone] clone-full.wav  ({len(full_wav) / sr:.1f}s, "
            f"{len(rendered)} beats with {GAP_SECONDS}s gaps)"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
