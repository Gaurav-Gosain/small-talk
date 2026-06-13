"""Export Reachy Mini emotions + dances as time-sampled trajectories for the
three.js twin to replay (so listeners can emote while someone else talks).

Run with the reachy-conv venv (has reachy_mini, the dances lib, the cached
emotions dataset, and scipy):
    /home/gaurav/dev/reachy-conv/.venv/bin/python scripts/export-moves.py

Writes frontend/public/moves/reachy-moves.json. Each frame is a flat array in
`cols` order; pose is robot-frame (x fwd, y left, z up; metres / radians) — the
frontend remaps to three.js axes.
"""
import json
import pathlib

import numpy as np
from reachy_mini.motion.recorded_move import RecordedMoves
from reachy_mini_dances_library.dance_move import DanceMove
from scipy.spatial.transform import Rotation as R

OUT = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "public" / "moves"
OUT.mkdir(parents=True, exist_ok=True)

HZ = 33
CAP_S = 6.0  # trim long emotions so reactions stay snappy

# Curated listener reactions + a few fun dances.
REACTIONS = [
    "yes1", "understanding1", "attentive1", "attentive2", "surprised1",
    "thoughtful1", "laughing2", "curious1", "cheerful1", "amazed1",
    "welcoming1", "confused1", "enthusiastic1", "proud1", "no1", "inquiring1",
]
DANCES = ["dizzy_spin", "headbanger_combo", "groovy_sway_and_roll", "yeah_nod", "uh_huh_tilt"]

COLS = ["t", "x", "y", "z", "roll", "pitch", "yaw", "antL", "antR", "bodyYaw"]


def r4(v):
    return round(float(v), 4)


def sample(move):
    frames = []
    dt = 1.0 / HZ
    end = min(float(move.duration), CAP_S) - 1e-6
    t = 0.0
    while t < end:
        head, antennas, body_yaw = move.evaluate(t)
        x, y, z = head[:3, 3]
        roll, pitch, yaw = R.from_matrix(head[:3, :3]).as_euler("xyz")
        frames.append([
            round(t, 3), r4(x), r4(y), r4(z),
            r4(roll), r4(pitch), r4(yaw),
            r4(antennas[0]), r4(antennas[1]), r4(body_yaw),
        ])
        t += dt
    return frames


def main():
    out = {"fps": HZ, "cols": COLS, "moves": {}}

    emo = RecordedMoves("pollen-robotics/reachy-mini-emotions-library")
    available = set(emo.list_moves())
    for name in REACTIONS:
        if name not in available:
            print(f"  skip emotion (not found): {name}")
            continue
        m = emo.get(name)
        out["moves"][name] = {
            "kind": "emotion",
            "duration": round(min(float(m.duration), CAP_S), 3),
            "frames": sample(m),
        }
        print(f"  emotion {name}: {len(out['moves'][name]['frames'])} frames")

    for name in DANCES:
        try:
            d = DanceMove(name)
        except Exception as e:
            print(f"  skip dance {name}: {e}")
            continue
        out["moves"][name] = {
            "kind": "dance",
            "duration": round(float(d.duration), 3),
            "frames": sample(d),
        }
        print(f"  dance {name}: {len(out['moves'][name]['frames'])} frames")

    path = OUT / "reachy-moves.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    kb = path.stat().st_size / 1024
    print(f"wrote {path} ({len(out['moves'])} moves, {kb:.0f} KB)")


if __name__ == "__main__":
    main()
