"""Generate expressive character wavs for the demos using Qwen3-TTS.

Run with the reachy-conv venv (has faster_qwen3_tts + the cached models):
    /home/gaurav/dev/reachy-conv/.venv/bin/python scripts/make-qwen-samples.py [duo|groupchat|all] [slug,slug]

Expressiveness in Qwen3-TTS is controlled entirely by the natural-language
`instruct` voice description — it has NO emotion/markup tags (verified in the
package + model config; inline [laughing]/(sighs) would be read literally). So we
write rich, structured descriptions (gender, age, pitch, timbre, attitude, pace,
accent, signature detail) and use expressive sampling params. Each voice is
designed once then cloned per line (Base model) for a consistent timbre, and
every clip is loudness-normalised so the cast sits at an even, polished level.
"""
import gc
import pathlib
import subprocess
import sys

import numpy as np
import soundfile as sf
import torch
from faster_qwen3_tts import FasterQwen3TTS

OUT = pathlib.Path(__file__).resolve().parent.parent / "samples"
OUT.mkdir(exist_ok=True)
DESIGN_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
CLONE_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"

# Expressive-but-stable sampling (defaults are 0.9 / 1.0 / 1.05).
GEN_KW = dict(temperature=0.95, top_p=0.92, repetition_penalty=1.1, chunk_size=12)
LUFS = -16.0  # target integrated loudness for every clip

# Each character: slug, rich voice-design instruct, pitch factor, lines.
CASTS = {
    "duo": [
        ("ada",
         "A bright, warm young woman in her late twenties with a light, clear, "
         "friendly mid-high voice. Curious, enthusiastic and expressive, quick to "
         "delight. Speaks at a lively, slightly fast pace with engaged, upward "
         "inflections and genuine warmth.",
         1.0,
         [
             "Welcome to the Reachy podcast! I'm Ada. Today's big question: can a "
             "tiny model, with just a few billion parameters, actually be charming?",
             "Oh come on, that's the magic! Small models run right here on the "
             "laptop. No cloud, no latency. That's not algebra, that's freedom!",
             "Unhinged is the whole point! Two robots, one brain, zero stage "
             "fright. We might just be the best hosts this hackathon has ever seen.",
         ]),
        ("bode",
         "A dry, witty man in his fifties with a deep, smooth, slightly weathered "
         "baritone. Sardonic, understated and unflappable, with a sarcastic edge. "
         "Speaks slowly and deliberately, with deadpan timing and the faint "
         "amusement of someone who has seen it all.",
         1.0,
         [
             "Bode here. Charming? It's a robot reading sine waves off a tensor. "
             "But sure, Ada... let's anthropomorphize the linear algebra.",
             "Freedom to hallucinate locally, instead of in a data center. "
             "Progress. Though two robots talking with no human in the loop is, I "
             "admit, delightfully unhinged.",
             "We're the only robot hosts this hackathon has ever seen. But I'll "
             "take the win. To small models... and smaller egos.",
         ]),
    ],
    "groupchat": [
        ("batman",
         "A grim middle-aged man with an extremely deep, gravelly bass voice "
         "roughened into a low growling whisper. Brooding, intense and menacing, "
         "dead serious. Speaks slowly and deliberately in short, clipped, "
         "threatening sentences, every word weighted, with a raw rasp at the edges.",
         0.92,
         [
             "A hot dog is not a sandwich. The night does not negotiate with bread.",
             "Vibes are not evidence. I work alone. And I eat my hot dog... in the shadows.",
         ]),
        ("jarvis",
         "A refined older British gentleman with a smooth, warm, polished baritone "
         "and crisp Received-Pronunciation enunciation. Unfailingly polite, composed "
         "and subtly witty, like a high-end AI butler. Speaks at a calm, even, "
         "measured pace, with elegant precision and a faint dry amusement.",
         1.0,
         [
             "Sir, by every culinary classification, a filling between bread is a sandwich. The data is unambiguous.",
             "Might I suggest we resolve this democratically. Although, statistically, you will simply brood.",
         ]),
        ("jack",
         "A theatrical middle-aged male pirate with a slightly nasal, sing-song "
         "British drawl that always sounds a touch drunk on rum. Sly, witty, "
         "eccentric and unpredictable, swaggering and roguish. Speaks in a "
         "meandering, lilting cadence with sudden emphatic flourishes, trailing off "
         "and doubling back mid-thought.",
         1.0,
         [
             "Why is the rum always gone? And more importantly... is this hot dog a sandwich, or a tiny edible boat? Savvy?",
             "Me? I don't pick sides, mate. I pick whichever side has the rum. And the hot dog. ...Now, where's the hot dog?",
         ]),
        ("yoda",
         "A very old, small, wise male sage with a frail, raspy, breathy "
         "higher-pitched voice and a gentle, patient warmth. Speaks slowly and "
         "softly in inverted, riddle-like phrasing, pausing thoughtfully between "
         "words, full of ancient calm and a flicker of mischief.",
         1.0,
         [
             "Hmmm. A sandwich, a hot dog may be. Or not. Cloudy, the bun's true nature is.",
             "Argue about lunch, we do, while the galaxy burns. Hungry... I am.",
         ]),
        ("surfer",
         "A laid-back young Californian surfer dude with a relaxed, warm, slightly "
         "nasal mid-range voice and a lazy, drawn-out drawl. Perpetually chill, "
         "cheerful and unbothered, like he's half-asleep on a sunny beach. Speaks "
         "slowly and casually, stretching out his vowels, easygoing and friendly.",
         1.0,
         [
             "Whoa whoa, chill guys. It's like a taco's cousin, you know? A bread boat. It's all vibes, brah.",
             "Okay so we all agree it's delicious. That's the real dub, dudes. Group hug!",
         ]),
    ],
}


def _collect(stream):
    chunks, sr = [], 24000
    for audio, s, _ in stream:
        sr = int(s)
        chunks.append(np.asarray(audio, dtype=np.float32).reshape(-1))
    return np.concatenate(chunks), sr


def _ffmpeg_filter(path: pathlib.Path, af: str):
    tmp = path.with_name(path.stem + ".tmp.wav")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(path), "-af", af, "-ar", "24000", str(tmp)],
        check=True,
    )
    tmp.replace(path)


def _post(path: pathlib.Path, pitch: float):
    """Optional pitch shift (duration-preserving) + loudness normalisation."""
    if abs(pitch - 1.0) > 1e-3:
        sr = 24000
        _ffmpeg_filter(path, f"asetrate={sr}*{pitch},aresample={sr},atempo={1 / pitch}")
    # Light de-rumble + normalise everyone to a consistent level.
    _ffmpeg_filter(path, f"highpass=f=70,loudnorm=I={LUFS}:TP=-1.5:LRA=11")


def generate(cast):
    print(f"loading {DESIGN_MODEL} …")
    design = FasterQwen3TTS.from_pretrained(DESIGN_MODEL)
    refs = {}
    for slug, voice, _pitch, lines in cast:
        audio, sr = _collect(
            design.generate_voice_design_streaming(
                text=lines[0], instruct=voice, language="English", **GEN_KW
            )
        )
        ref = OUT / f".ref-{slug}.wav"
        sf.write(ref, audio, sr)
        refs[slug] = (ref, lines[0], voice)
        print(f"  designed reference for {slug}")
    del design
    gc.collect()
    torch.cuda.empty_cache()

    print(f"loading {CLONE_MODEL} …")
    clone = FasterQwen3TTS.from_pretrained(CLONE_MODEL)
    for slug, _voice, pitch, lines in cast:
        ref, ref_text, voice = refs[slug]
        for j, text in enumerate(lines, start=1):
            audio, sr = _collect(
                clone.generate_voice_clone_streaming(
                    text=text, language="English",
                    ref_audio=str(ref), ref_text=ref_text, instruct=voice, **GEN_KW,
                )
            )
            out = OUT / f"{slug}-{j}.wav"
            sf.write(out, audio, sr)
            _post(out, pitch)
            print(f"  wrote {out.name}  ({len(audio) / sr:.1f}s)")
        ref.unlink(missing_ok=True)
    del clone
    gc.collect()
    torch.cuda.empty_cache()


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
    for name in (list(CASTS) if which == "all" else [which]):
        cast = CASTS[name]
        if only:
            cast = [c for c in cast if c[0] in only]
        print(f"=== generating cast: {name} ({[c[0] for c in cast]}) ===")
        generate(cast)
    print("done.")


if __name__ == "__main__":
    main()
