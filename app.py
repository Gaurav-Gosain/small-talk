"""Small Talk — Hugging Face Space entrypoint.

A Gradio app that wears no Gradio: we use `gradio.Server` (a FastAPI server with
Gradio's backend) purely as the host, then serve our own three.js meeting UI and
the /api control plane on it. Custom routes take priority over Gradio's, so the
visitor only ever sees the custom frontend — which also earns the hackathon's
"Off-Brand" badge.

LiveKit (the WebRTC SFU) is LiveKit Cloud; credentials come from Space secrets
(LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET). The browser connects to
LiveKit Cloud directly; this app just mints tokens and runs the Reachy
publishers that stream the pre-rendered voice clips into the room.
"""
import os
import pathlib

import gradio as gr
from fastapi.responses import FileResponse

from backend.server import attach

DIST = pathlib.Path(__file__).parent / "frontend" / "dist"

app = gr.Server()
attach(app)  # /api/* routes — registered before the static mounts below

# Serve the built single-page app. These subdirs don't collide with /api or
# Gradio's own routes, so a simple per-folder static mount is enough.
from fastapi.staticfiles import StaticFiles  # noqa: E402

class CachedStaticFiles(StaticFiles):
    """Hashed/immutable build artifacts: cache hard, forever."""

    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp


for sub in ("assets", "robot-3d", "moves", "props"):
    d = DIST / sub
    if d.is_dir():
        cls = CachedStaticFiles if sub == "assets" else StaticFiles
        app.mount(f"/{sub}", cls(directory=str(d)), name=sub)

class RadioStaticFiles(StaticFiles):
    """Songs/art are immutable (cache hard); playlist.json must always revalidate
    so updated lyrics/timings are never served stale."""

    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        full_path = str(args[0]) if args else ""
        resp.headers["Cache-Control"] = (
            "no-cache, must-revalidate" if full_path.endswith(".json")
            else "public, max-age=604800")
        return resp


# Reachy FM: songs + album art + DJ Servo's prerecorded mic breaks
RADIO = pathlib.Path(__file__).parent / "radio"
if RADIO.is_dir():
    app.mount("/radio", RadioStaticFiles(directory=str(RADIO)), name="radio")


# index.html must NEVER be cached: each deploy replaces the hashed bundle it
# points at, so a stale cached page 404s on its own JS and the app goes blank.
_NO_CACHE = {"Cache-Control": "no-cache, must-revalidate"}


@app.get("/")
async def index():
    return FileResponse(DIST / "index.html", headers=_NO_CACHE)


@app.get("/favicon.ico")
async def favicon():
    return FileResponse(DIST / "index.html", headers=_NO_CACHE)  # SPA injects an emoji favicon


if __name__ == "__main__":
    # HF Spaces (sdk: gradio) runs this file; bind to the port it provides.
    port = int(os.environ.get("GRADIO_SERVER_PORT", os.environ.get("PORT", 7860)))
    app.launch(server_name="0.0.0.0", server_port=port)
