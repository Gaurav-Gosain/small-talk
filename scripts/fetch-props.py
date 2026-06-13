"""Build a CC0/CC-BY 3D prop library for Small Talk's Reachy accessories.

Source: Icosa Gallery (https://icosa.gallery) — the open-source successor to
Google Poly. No API key needed. We pull self-contained GLBs, keep only
permissively-licensed low/medium-poly props, dedupe, and write a manifest with
full attribution (CC-BY requires crediting the author).

    uv run python scripts/fetch-props.py
"""
import json
import pathlib
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "props-lib"  # kept out of public/ so the 170MB+ library
# doesn't bloat the built SPA / Space; wired into the build when the feature ships.
OUT.mkdir(parents=True, exist_ok=True)
API = "https://api.icosa.gallery/v1/assets"

# Licenses we'll ship. CC-BY needs attribution (we record it); CC0 needs nothing.
# We skip ND/SA to stay safe for tinting/attaching to the Reachy (derivative use).
ALLOWED_LIC = {"CREATIVE_COMMONS_BY", "CREATIVE_COMMONS_0", "CREATIVE_COMMONS_BY_3_0"}

# Prop wishlist grouped by where it lives on / around a Reachy.
WISHLIST = {
    "hat": ["wizard hat", "cowboy hat", "top hat", "party hat", "crown", "beanie",
            "baseball cap", "chef hat", "pirate hat", "santa hat", "viking helmet",
            "sombrero", "graduation cap", "fedora", "witch hat", "halo", "tiara",
            "propeller hat", "fez", "bowler hat", "straw hat", "police hat"],
    "face": ["sunglasses", "eyeglasses", "monocle", "eyepatch", "mustache",
             "3d glasses", "nerd glasses", "ski goggles", "groucho glasses"],
    "neck": ["bowtie", "necktie", "scarf", "bandana", "necklace", "medal", "cape"],
    "held": ["microphone", "guitar", "saxophone", "trumpet", "ukulele", "drum",
             "electric guitar", "violin", "maracas", "vinyl record", "boombox",
             "newspaper", "book", "coffee mug", "magic wand", "umbrella", "trophy"],
    "food": ["hot dog", "hamburger", "pizza slice", "donut", "taco", "ice cream cone",
             "sushi", "banana", "cookie", "cupcake", "pretzel", "popcorn", "burrito"],
    "topper": ["star", "flower", "heart", "gem", "diamond", "lightbulb",
               "lightning bolt", "cloud", "rocket", "planet saturn", "moon",
               "rubber duck", "cactus", "mushroom", "gift box", "balloon",
               "speech bubble", "fire flame", "snowflake", "leaf", "crystal"],
    "pet": ["cat", "dog", "bird", "fish", "frog", "penguin", "owl"],
}

session = requests.Session()
session.headers["User-Agent"] = "Mozilla/5.0 (smalltalk-props-fetch)"


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48] or "prop"


def search(kw: str, limit: int = 10):
    try:
        r = session.get(API, params={"format": "GLTF2", "keywords": kw,
                                      "limit": limit, "orderBy": "BEST"}, timeout=30)
        r.raise_for_status()
        return r.json().get("assets", [])
    except Exception as e:
        print(f"  ! search '{kw}' failed: {e}")
        return []


def glb_url(asset):
    for f in asset.get("formats", []):
        if f.get("formatType") == "GLB":
            return (f.get("root") or {}).get("url")
    return None


def viable(asset) -> bool:
    if asset.get("license") not in ALLOWED_LIC:
        return False
    tris = asset.get("triangleCount") or 0
    if tris <= 0 or tris > 60000:          # skip Tilt sketches (0) + heavy meshes
        return False
    return glb_url(asset) is not None


def download(entry) -> bool:
    url, dest = entry["_url"], OUT / entry["file"]
    if dest.exists() and dest.stat().st_size > 1000:
        return True
    for attempt in range(3):
        try:
            r = session.get(url, timeout=90)
            if r.status_code == 200 and r.content[:4] == b"glTF" and len(r.content) < 8_000_000:
                dest.write_bytes(r.content)
                entry["bytes"] = len(r.content)
                return True
            return False
        except Exception:
            if attempt == 2:
                return False
    return False


def main():
    # 1) gather candidates, dedupe by assetId, cap per keyword
    seen, candidates = set(), []
    for category, kws in WISHLIST.items():
        for kw in kws:
            picked = 0
            for a in search(kw, limit=12):
                if picked >= 4:
                    break
                aid = a["assetId"]
                if aid in seen or not viable(a):
                    continue
                seen.add(aid)
                picked += 1
                candidates.append({
                    "id": aid,
                    "name": a["displayName"],
                    "category": category,
                    "query": kw,
                    "author": a.get("authorName", "Unknown"),
                    "license": a["license"],
                    "tris": a.get("triangleCount", 0),
                    "source": f"https://icosa.gallery/view/{aid}",
                    "file": f"{category}__{slug(a['displayName'])}__{aid}.glb",
                    "_url": glb_url(a),
                })
            print(f"  {category}/{kw}: +{picked}  (total {len(candidates)})")

    print(f"\n{len(candidates)} candidates. Downloading...\n")

    # 2) download with modest concurrency (web.archive is rate-sensitive)
    ok = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(download, c): c for c in candidates}
        for i, fut in enumerate(as_completed(futs), 1):
            c = futs[fut]
            if fut.result():
                ok.append(c)
                if i % 10 == 0 or len(ok) % 25 == 0:
                    print(f"  [{i}/{len(candidates)}] ok={len(ok)}  last: {c['name']}")

    # 3) manifest (attribution + categories) — drop the private _url field
    manifest = []
    for c in sorted(ok, key=lambda x: (x["category"], x["name"])):
        manifest.append({k: v for k, v in c.items() if not k.startswith("_")})
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))

    by_cat = {}
    for c in manifest:
        by_cat[c["category"]] = by_cat.get(c["category"], 0) + 1
    print(f"\nDownloaded {len(manifest)} props -> {OUT}")
    for cat, n in sorted(by_cat.items()):
        print(f"  {cat:8} {n}")
    print("manifest.json written.")


if __name__ == "__main__":
    sys.exit(main())
