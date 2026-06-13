"""Audio decoding helpers.

We shell out to ffmpeg so we can ingest *anything* (wav, mp3, flac, ogg, m4a)
and always get back mono 16-bit PCM at LiveKit's preferred 48 kHz — no
per-format branching, no resampling surprises.
"""
import asyncio

import numpy as np

SAMPLE_RATE = 48000
NUM_CHANNELS = 1


async def decode_to_pcm(path: str, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Decode `path` to a 1-D int16 numpy array (mono, `sample_rate` Hz)."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-v", "error",
        "-i", str(path),
        "-f", "s16le",
        "-acodec", "pcm_s16le",
        "-ac", str(NUM_CHANNELS),
        "-ar", str(sample_rate),
        "-",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed decoding {path}: {err.decode(errors='ignore')}")
    return np.frombuffer(out, dtype=np.int16).copy()
