"""Create/update the 'Small Talk' Hugging Face Space and push the build.

Needs a WRITE token (hf auth login). Reads LiveKit creds from the local .env and
sets them as Space secrets (they are never committed). Run after `pnpm build`:

    uv run python scripts/deploy-space.py
"""
import os
import pathlib

from dotenv import load_dotenv
from huggingface_hub import HfApi, get_token

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO_ID = "build-small-hackathon/small-talk"

load_dotenv(ROOT / ".env")
api = HfApi()
token = get_token()
if not token:
    raise SystemExit("no HF token found. Run: hf auth login (with a WRITE token)")
perm = None
try:
    perm = api.get_token_permission(token)
except Exception:
    try:
        perm = api.whoami(token=token).get("auth", {}).get("accessToken", {}).get("role")
    except Exception:
        pass
if perm == "read":
    raise SystemExit("token is read-only; need a write/fine-grained token. Run: hf auth login")

# 1) create the Space (idempotent)
api.create_repo(REPO_ID, repo_type="space", space_sdk="gradio", exist_ok=True)
print(f"space ready: https://huggingface.co/spaces/{REPO_ID}")

# 2) LiveKit creds as secrets (kept out of git)
for key in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "REACHY_ROOM",
            "MODAL_LLM_URL", "MODAL_LLM_KEY", "MODAL_TTS_URL", "MODAL_TTS_KEY",
            "ADMIN_TOKEN"):
    val = os.environ.get(key)
    if val:
        api.add_space_secret(REPO_ID, key, val)
        print(f"  secret set: {key}")

# HF token so the /api/style-reachy endpoint can call the LLM ZeroGPU space with
# our (team-org) quota instead of the exhausted anonymous pool.
if token:
    api.add_space_secret(REPO_ID, "HF_TOKEN", token)
    print("  secret set: HF_TOKEN")

# 3) the Space card (README with HF frontmatter)
api.upload_file(
    path_or_fileobj=str(ROOT / "SPACE_README.md"),
    path_in_repo="README.md",
    repo_id=REPO_ID,
    repo_type="space",
)

# 4) the app itself: entrypoint, backend, built SPA, voice clips, deps
api.upload_folder(
    folder_path=str(ROOT),
    repo_id=REPO_ID,
    repo_type="space",
    allow_patterns=[
        "app.py",
        "backend/**",
        "frontend/dist/**",
        "radio/**",
        "samples/*.wav",
        "requirements.txt",
        "packages.txt",
    ],
    commit_message="Deploy Small Talk: Reachy Mini AI podcast (gradio.Server + three.js + LiveKit)",
)
print("pushed. the Space will build automatically.")
