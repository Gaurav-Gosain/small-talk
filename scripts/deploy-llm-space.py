"""Create/update the Small Talk LLM brain Space (Gemma 4 12B on ZeroGPU).

    uv run --with huggingface_hub python scripts/deploy-llm-space.py
"""
import pathlib

from huggingface_hub import HfApi, get_token

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO_ID = "build-small-hackathon/small-talk-llm"
SRC = ROOT / "llm-space"

api = HfApi()
if not get_token():
    raise SystemExit("no HF token. Run: hf auth login (write token)")

zero = "zero-a10g"  # ZeroGPU flavor string accepted by request_space_hardware
print("zerogpu flavor:", zero)

api.create_repo(REPO_ID, repo_type="space", space_sdk="gradio", exist_ok=True)
print(f"space ready: https://huggingface.co/spaces/{REPO_ID}")

api.upload_folder(
    folder_path=str(SRC),
    repo_id=REPO_ID,
    repo_type="space",
    commit_message="Gemma 4 12B brain on ZeroGPU (transformers)",
)
print("uploaded app.py / requirements.txt / README.md")

try:
    api.request_space_hardware(REPO_ID, zero)
    print(f"hardware -> {zero}")
except Exception as e:
    print(f"!! could not set hardware automatically ({e}). "
          f"Set it to ZeroGPU in the Space settings UI.")

print("done. the Space will build automatically.")
