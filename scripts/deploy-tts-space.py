"""Create/update the Small Talk Voice Design Space (Qwen3-TTS on ZeroGPU).

    uv run --with huggingface_hub python scripts/deploy-tts-space.py
"""
import pathlib

from huggingface_hub import HfApi, get_token

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO_ID = "build-small-hackathon/small-talk-tts"
SRC = ROOT / "tts-space"

api = HfApi()
if not get_token():
    raise SystemExit("no HF token. Run: hf auth login (write token)")

api.create_repo(REPO_ID, repo_type="space", space_sdk="gradio", exist_ok=True)
print(f"space ready: https://huggingface.co/spaces/{REPO_ID}")

api.upload_folder(
    folder_path=str(SRC),
    repo_id=REPO_ID,
    repo_type="space",
    commit_message="Qwen3-TTS VoiceDesign on ZeroGPU (base qwen-tts, no CUDA graphs)",
)
print("uploaded app.py / requirements.txt / README.md")

try:
    api.request_space_hardware(REPO_ID, "zero-a10g")
    print("hardware -> zero-a10g")
except Exception as e:
    print(f"!! could not set hardware automatically ({e}). Set ZeroGPU in Space settings.")

print("done. the Space will build automatically.")
