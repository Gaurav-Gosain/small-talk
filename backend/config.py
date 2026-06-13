"""Runtime configuration, sourced from the environment (.env supported)."""
import os

from dotenv import load_dotenv

load_dotenv()

# LiveKit dev server defaults (livekit-server --dev): key=devkey secret=secret.
LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "ws://localhost:7880")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "devkey")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "secret")

# The single room the podcast happens in (one per session is plenty for now).
ROOM_NAME = os.environ.get("REACHY_ROOM", "reachy-podcast")

# Where pre-rendered / sample audio clips live (the TTS stage will drop files here).
import pathlib

SAMPLES_DIR = pathlib.Path(
    os.environ.get("REACHY_SAMPLES_DIR", pathlib.Path(__file__).parent.parent / "samples")
).resolve()

# Token for the /admin control panel (stop shows on demand). Unset = admin off.
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")

# Modal-hosted brain + voice for generated shows (llama.cpp Nemotron + Qwen3-TTS).
MODAL_LLM_URL = os.environ.get("MODAL_LLM_URL", "").rstrip("/")
MODAL_LLM_KEY = os.environ.get("MODAL_LLM_KEY", "")
MODAL_TTS_URL = os.environ.get("MODAL_TTS_URL", "").rstrip("/")
MODAL_TTS_KEY = os.environ.get("MODAL_TTS_KEY", "")
