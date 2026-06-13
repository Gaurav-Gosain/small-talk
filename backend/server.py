"""Control plane for Small Talk.

Multi-room model: each Room is its own LiveKit room with a topic and a cast.
Seed rooms run the pre-rendered conversations; users can create rooms and drop
their own configured Reachy in (it joins and reacts — live speech needs the
on-device brain + TTS).
"""
import asyncio
import os
import re
import uuid
from dataclasses import dataclass

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from livekit import api
from pydantic import BaseModel

from . import config, showgen, tokens
from .publisher import ReachyPublisher

# A character: (identity, display name, card colour, persona blurb, clip prefix, wardrobe).
CAST_TEMPLATES: dict[str, list[tuple[str, str, str, str, str, dict]]] = {
    "duo": [
        ("reachy-ada", "Ada", "#c98a3c", "curious, warm, asks big questions", "ada",
         {"hat": "party"}),
        ("reachy-bode", "Bode", "#5a6b3a", "dry wit, contrarian, loves a tangent", "bode",
         {"hat": "tophat"}),
    ],
    "groupchat": [
        ("reachy-batman", "Batman", "#5b6b8c", "broods, works alone, encased-meat justice", "batman",
         {}),
        ("reachy-jarvis", "JARVIS", "#37b3c9", "polite British AI butler, cites the data", "jarvis",
         {"face": "monocle", "neck": "bowtie"}),
        ("reachy-jack", "Jack Sparrow", "#3fae9a", "rum-soaked pirate, picks whichever side has the rum", "jack",
         {"hat": "pirate"}),
        ("reachy-yoda", "Yoda", "#7bbf6a", "speaks in riddles, perpetually hungry", "yoda",
         {"hat": "halo"}),
        ("reachy-surfer", "Surfer", "#ff8c42", "chill, everything is just vibes, brah", "surfer",
         {"face": "sunglasses"}),
    ],
}

# Subtitle text for the pre-rendered seed clips (keyed by wav stem — the same
# lines scripts/make-qwen-samples.py rendered).
SEED_LINES: dict[str, str] = {
    "ada-1": "Welcome to the Reachy podcast! I'm Ada. Today's big question: can a tiny model, with just a few billion parameters, actually be charming?",
    "ada-2": "Oh come on, that's the magic! Small models run right here on the laptop. No cloud, no latency. That's not algebra, that's freedom!",
    "ada-3": "Unhinged is the whole point! Two robots, one brain, zero stage fright. We might just be the best hosts this hackathon has ever seen.",
    "bode-1": "Bode here. Charming? It's a robot reading sine waves off a tensor. But sure, Ada... let's anthropomorphize the linear algebra.",
    "bode-2": "Freedom to hallucinate locally, instead of in a data center. Progress. Though two robots talking with no human in the loop is, I admit, delightfully unhinged.",
    "bode-3": "We're the only robot hosts this hackathon has ever seen. But I'll take the win. To small models... and smaller egos.",
    "batman-1": "A hot dog is not a sandwich. The night does not negotiate with bread.",
    "batman-2": "Vibes are not evidence. I work alone. And I eat my hot dog... in the shadows.",
    "jarvis-1": "Sir, by every culinary classification, a filling between bread is a sandwich. The data is unambiguous.",
    "jarvis-2": "Might I suggest we resolve this democratically. Although, statistically, you will simply brood.",
    "jack-1": "Why is the rum always gone? And more importantly... is this hot dog a sandwich, or a tiny edible boat? Savvy?",
    "jack-2": "Me? I don't pick sides, mate. I pick whichever side has the rum. And the hot dog. ...Now, where's the hot dog?",
    "yoda-1": "Hmmm. A sandwich, a hot dog may be. Or not. Cloudy, the bun's true nature is.",
    "yoda-2": "Argue about lunch, we do, while the galaxy burns. Hungry... I am.",
    "surfer-1": "Whoa whoa, chill guys. It's like a taco's cousin, you know? A bread boat. It's all vibes, brah.",
    "surfer-2": "Okay so we all agree it's delicious. That's the real dub, dudes. Group hug!",
}


@dataclass
class Room:
    id: str
    title: str
    topic: str
    emoji: str
    template: str  # 'duo' | 'groupchat' | 'open'
    status: str = "live"  # 'waiting' (green room, open shows) | 'live'
    # how many SIMULATED hosts the generated cast should have. For 'sim' shows
    # that's the whole cast (2-5); for 'physical' shows it's the virtual robots
    # added alongside the real Reachys in the green room (1-4).
    sim_count: int = 3


ROOMS: dict[str, Room] = {
    r.id: r
    for r in [
        Room("the-podcast", "The Small Talk Podcast",
             "Can a model with a few billion parameters be charming?", "🎙️", "duo"),
        Room("hot-dog-court", "Hot Dog Court",
             "Is a hot dog a sandwich? Five robots, zero consensus.", "🌭", "groupchat"),
    ]
}

# roomId -> {identity -> publisher} ; roomId -> conversation loop task
ROOM_PUBS: dict[str, dict[str, ReachyPublisher]] = {}
ROOM_TASKS: dict[str, asyncio.Task] = {}

# Room creation + custom Reachies are live (the LLM+TTS cascade powers them).
FEATURES_LOCKED = False


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:24] or "room"


def _cast_preview(template: str) -> list[dict]:
    return [{"name": c[1], "color": c[2], "persona": c[3]} for c in CAST_TEMPLATES.get(template, [])]


def _room_dict(r: Room) -> dict:
    return {
        "id": r.id, "title": r.title, "topic": r.topic, "emoji": r.emoji,
        "template": r.template, "cast": _cast_preview(r.template),
        "status": r.status, "simCount": r.sim_count,
        "live": r.id in ROOM_TASKS and not ROOM_TASKS[r.id].done(),
    }


_counts_cache: dict[str, int] = {}
_counts_ts = 0.0


async def _viewer_counts() -> dict[str, int]:
    """Human viewers per room = total participants minus the Reachy publishers we
    spawned. Cached ~5s so polling many viewers doesn't hammer LiveKit / block."""
    global _counts_cache, _counts_ts
    now = asyncio.get_event_loop().time()
    if now - _counts_ts < 5.0:
        return _counts_cache
    out: dict[str, int] = {}
    try:
        lk = api.LiveKitAPI(config.LIVEKIT_URL, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET)
        rooms = await lk.room.list_rooms(api.ListRoomsRequest())
        await lk.aclose()
        for room in rooms.rooms:
            out[room.name] = max(0, room.num_participants - len(ROOM_PUBS.get(room.name, {})))
    except Exception:
        out = _counts_cache  # keep the last good value on failure
    _counts_cache, _counts_ts = out, now
    return out


# Shows run while someone is watching; after this long with zero viewers they
# shut down (seed rooms restart on the next join, custom rooms are deleted).
IDLE_STOP_S = int(os.environ.get("SHOW_IDLE_STOP_S", "150"))
SEED_ROOM_IDS = {"the-podcast", "hot-dog-court"}


def _idle_tracker(room_id: str):
    """Returns an async fn that's True once the room has been viewerless > IDLE_STOP_S."""
    state = {"since": None}

    async def check() -> bool:
        viewers = (await _viewer_counts()).get(room_id, 0)
        now = asyncio.get_event_loop().time()
        if viewers > 0:
            state["since"] = None
            return False
        if state["since"] is None:
            state["since"] = now
            return False
        return (now - state["since"]) > IDLE_STOP_S

    return check


async def _shutdown_room(room: Room, *, remove: bool | None = None) -> None:
    """Stop the show (disconnect cast, cancel task). remove=True also deletes the
    room; default keeps seed rooms and deletes custom ones (the idle behaviour)."""
    print(f"[show:{room.id}] shutting down (remove={remove})")
    for pub in ROOM_PUBS.pop(room.id, {}).values():
        try:
            await pub.aclose()
        except Exception:
            pass
    ROOM_TASKS.pop(room.id, None)
    if remove is None:
        remove = room.id not in SEED_ROOM_IDS
    if remove and room.id not in SEED_ROOM_IDS:
        ROOMS.pop(room.id, None)


async def _list_device_guests(room_id: str) -> list[dict]:
    """Physical Reachy companions currently in the LiveKit room (green-room cast)."""
    import json as _json

    guests = []
    try:
        lk = api.LiveKitAPI(config.LIVEKIT_URL, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET)
        res = await lk.room.list_participants(api.ListParticipantsRequest(room=room_id))
        await lk.aclose()
        for p in res.participants:
            if not p.identity.startswith("reachy-device-"):
                continue
            meta = {}
            try:
                meta = _json.loads(p.metadata) if p.metadata else {}
            except Exception:
                pass
            guests.append({
                "id": f"d{len(guests) + 1}",
                "name": (p.name or p.identity)[:24],
                "persona": str(meta.get("persona") or "")[:60],
                "voice": str(meta.get("voice") or "")[:300],
                "device": p.identity,
            })
    except Exception as e:
        print(f"[room:{room_id}] device scan failed: {e}")
    return guests[:5]  # a call tops out at 5 hosts total


async def _run_generated_show(room: Room, required: list[dict] | None = None) -> None:
    """The live LLM+TTS cascade (the original project idea, end to end):
    one structured LLM call writes the cast + speaker→dialogue script (starring
    any physical Reachys from the green room), then each line is voiced by
    Qwen3-TTS — with line N+1's audio generating while line N plays — and
    streamed into the LiveKit room with subtitle data messages."""
    pubs = ROOM_PUBS.setdefault(room.id, {})
    # a hidden stage manager joins first so the audience gets real progress
    # while the script generates (the frontend hides 'stage-' participants)
    stage = ReachyPublisher(f"stage-{room.id}", "Stage Manager", room=room.id,
                            props={"role": "stage"})
    await stage.connect()
    pubs[stage.identity] = stage
    await stage.send_data({"type": "status", "text": "the writers’ room is drafting the script…"})

    # total cast = the real Reachys + the room's simulated count, capped at 5
    required = required or []
    n_speakers = max(2, min(5, len(required) + room.sim_count if required else room.sim_count))
    script = await showgen.write_script(room.title, room.topic,
                                        n_speakers=n_speakers, required=required)
    speakers = {s["id"]: s for s in script["speakers"]}
    names = " · ".join(s["name"] for s in script["speakers"])
    await stage.send_data({"type": "status", "text": f"cast locked: {names} — designing their voices…"})

    fresh = []
    for s in script["speakers"]:
        ident = f"gen-{room.id}-{s['id']}"
        if ident not in pubs:
            props = {k: s[k] for k in ("hat", "face", "neck") if s.get(k)}
            if s.get("device"):
                # this host IS a physical robot: the web UI routes this audio to
                # the device's card, and the device plays only this track
                props["forDevice"] = s["device"]
            pub = ReachyPublisher(
                ident, s["name"], room=room.id, color=s["color"], persona=s["persona"],
                props=props,
            )
            pubs[ident] = pub
            fresh.append(pub)
    if fresh:
        await asyncio.gather(*(p.connect() for p in fresh))
    anchor = next(iter(pubs.values()))

    async def voice(line: dict) -> str:
        spk = speakers[line["speaker"]]
        return await showgen.tts_wav(line["text"], spk["voice"])

    idle = _idle_tracker(room.id)
    history: list[dict] = []
    lines = list(script["lines"])
    rounds = 0
    played: list[tuple[str, str, str]] = []  # (identity, wav, text) for the fallback loop

    async def cleanup():
        await _shutdown_room(room)
        for _, wav, _t in played:
            try:
                os.unlink(wav)
            except OSError:
                pass

    while True:
        nxt = asyncio.create_task(voice(lines[0]))
        for i, line in enumerate(lines):
            spk = speakers[line["speaker"]]
            ident = f"gen-{room.id}-{line['speaker']}"
            pub = pubs.get(ident)
            if not pub:
                continue
            try:
                if not nxt.done():
                    # real dead air: TTS is still rendering this voice — give the
                    # audience the sound booth instead of frozen robots
                    await anchor.send_data({"type": "status", "phase": "voicing",
                                            "speaker": spk["name"], "color": spk["color"],
                                            "text": f"{spk['name']} is warming up…"})
                wav = await nxt
            except Exception as e:
                print(f"[show:{room.id}] tts failed: {e}")
                continue
            finally:
                if i + 1 < len(lines):
                    nxt = asyncio.create_task(voice(lines[i + 1]))  # the cascade
            await anchor.send_data({"type": "line", "speaker": spk["name"],
                                    "color": spk["color"], "text": line["text"]})
            await pub.say_file(wav)
            await pub.wait_until_idle()
            played.append((ident, wav, line["text"]))
            history.append({"speaker": spk["name"], "text": line["text"]})
            if await idle():
                return await cleanup()
            await asyncio.sleep(0.3)

        rounds += 1
        if rounds < 4 and not await idle():
            try:
                # phase:'writing' drives the mid-show writers' ticker in the UI
                await anchor.send_data({"type": "status", "phase": "writing",
                                        "text": "the cast is writing the next segment…"})
                cont = await showgen.write_script(room.title, room.topic,
                                                  n_speakers=n_speakers, history=history)
                # keep the original cast; only take the new lines that map onto it
                lines = [l for l in cont["lines"] if l["speaker"] in speakers] or lines
                continue
            except Exception as e:
                print(f"[show:{room.id}] continuation failed, looping: {e}")
        # fallback: replay what we have until the room empties out
        while played:
            for ident, wav, text in played:
                pub = pubs.get(ident)
                if not pub:
                    return
                spk_name = next((s["name"] for s in script["speakers"]
                                 if f"gen-{room.id}-{s['id']}" == ident), "")
                await anchor.send_data({"type": "line", "speaker": spk_name, "text": text})
                await pub.say_file(wav)
                await pub.wait_until_idle()
                if await idle():
                    return await cleanup()
                await asyncio.sleep(0.3)


# Serialise show creation per room: the task check → task registration window
# spans several awaits (publisher connects), so two concurrent joins could spawn
# TWO run-loops feeding the same publishers — every line plays twice.
_ENSURE_LOCKS: dict[str, asyncio.Lock] = {}


async def _ensure_conversation(room: Room) -> None:
    """Spin up the room's cast + looping conversation if it isn't already live."""
    async with _ENSURE_LOCKS.setdefault(room.id, asyncio.Lock()):
        await _ensure_conversation_locked(room)


async def _ensure_conversation_locked(room: Room) -> None:
    task = ROOM_TASKS.get(room.id)
    if task and not task.done():
        return
    cast = CAST_TEMPLATES.get(room.template)
    if not cast:
        # simulated open shows start on join; physical ones wait in the green
        # room until POST /rooms/{id}/start casts the connected robots
        if (room.status == "live" and room.topic
                and config.MODAL_LLM_URL and config.MODAL_TTS_URL):
            ROOM_TASKS[room.id] = asyncio.create_task(_run_generated_show(room))
        return
    if not any(config.SAMPLES_DIR.glob("*.wav")):
        raise HTTPException(400, "no voice clips found (run scripts/make-qwen-samples.py)")

    pubs = ROOM_PUBS.setdefault(room.id, {})
    fresh = []
    for identity, name, color, persona, _prefix, props in cast:
        if identity not in pubs:
            pub = ReachyPublisher(identity, name, room=room.id, color=color, persona=persona,
                                  props=props)
            pubs[identity] = pub
            fresh.append(pub)
    if fresh:  # the whole cast walks in together instead of single-file
        await asyncio.gather(*(p.connect() for p in fresh))

    clips = {c[0]: sorted(config.SAMPLES_DIR.glob(f"{c[4]}*.wav")) for c in cast}
    speakers = [c[0] for c in cast if clips[c[0]]]
    sequence: list[tuple[str, str]] = []
    for k in range(max((len(clips[s]) for s in speakers), default=0)):
        for s in speakers:
            if k < len(clips[s]):
                sequence.append((s, str(clips[s][k])))
    if not sequence:
        raise HTTPException(400, "no clips for this room")

    import pathlib as _pl

    who = {c[0]: (c[1], c[2]) for c in cast}  # identity -> (name, colour)

    async def run_loop():
        idle = _idle_tracker(room.id)
        anchor = next(iter(pubs.values()))
        i = 0
        while True:
            identity, clip = sequence[i % len(sequence)]
            pub = pubs.get(identity)
            if not pub:
                break
            text = SEED_LINES.get(_pl.Path(clip).stem)
            if text:
                name, color = who.get(identity, ("", None))
                await anchor.send_data({"type": "line", "speaker": name, "color": color, "text": text})
            await pub.say_file(clip)
            await pub.wait_until_idle()
            if await idle():  # nobody watching → wind down; next join restarts it
                await _shutdown_room(room)
                return
            await asyncio.sleep(0.35)
            i += 1

    ROOM_TASKS[room.id] = asyncio.create_task(run_loop())


# --------------------------------------------------------------------------- models


class TokenRequest(BaseModel):
    identity: str | None = None
    name: str | None = None
    room: str
    # physical Reachy companions join as real participants (a card in the grid)
    device: bool = False
    color: str | None = None
    persona: str | None = None
    voice: str | None = None
    bodyColor: str | None = None
    hat: str | None = None
    face: str | None = None
    neck: str | None = None


class CreateRoomRequest(BaseModel):
    title: str
    topic: str = ""
    emoji: str = "💬"
    template: str = "open"  # 'duo' | 'groupchat' | 'open'
    mode: str = "sim"  # 'sim' = all-virtual cast, starts on join · 'physical' = green room first
    simCount: int = 3  # sim mode: total hosts (2-5) · physical: virtual hosts to add (1-4)


class ReachyRequest(BaseModel):
    name: str
    persona: str | None = None
    voice: str | None = None
    color: str = "#49e6c8"
    bodyColor: str | None = None
    hat: str | None = None
    face: str | None = None
    neck: str | None = None


# --------------------------------------------------------------------------- routes


async def get_config():
    return {"livekitUrl": config.LIVEKIT_URL}


async def list_rooms():
    viewers = await _viewer_counts()
    return {"rooms": [{**_room_dict(r), "viewers": viewers.get(r.id, 0)} for r in ROOMS.values()]}


async def create_room(req: CreateRoomRequest):
    if FEATURES_LOCKED:
        raise HTTPException(403, "Room creation is under construction.")
    if req.template not in ("duo", "groupchat", "open"):
        raise HTTPException(400, "bad template")
    # standards desk: one LLM pass over title+topic before the room exists
    ok, why = await showgen.moderate_topic(req.title.strip(), req.topic.strip())
    if not ok:
        raise HTTPException(400, why)
    rid = f"{_slug(req.title)}-{uuid.uuid4().hex[:4]}"
    physical = req.template == "open" and req.mode == "physical"
    status = "waiting" if physical else "live"
    # sim shows pick the whole cast (2-5); physical shows pick the virtual
    # hosts that fill in around the real Reachys (1-4)
    sim_count = max(1, min(4, req.simCount)) if physical else max(2, min(5, req.simCount))
    ROOMS[rid] = Room(rid, req.title.strip() or "Untitled room", req.topic.strip(),
                      req.emoji or "💬", req.template, status=status, sim_count=sim_count)
    if status == "waiting":
        asyncio.create_task(_expire_waiting_room(rid))
    return {"ok": True, "id": rid, "room": _room_dict(ROOMS[rid])}


async def _expire_waiting_room(rid: str, ttl: float = 900.0) -> None:
    """A green room nobody starts or visits gets cleaned up after a while."""
    await asyncio.sleep(ttl)
    room = ROOMS.get(rid)
    if room and room.status == "waiting" and rid not in ROOM_TASKS:
        if (await _viewer_counts()).get(rid, 0) == 0:
            ROOMS.pop(rid, None)
            print(f"[room:{rid}] waiting room expired")


async def post_token(req: TokenRequest):
    metadata = None
    if req.device:
        identity = f"reachy-device-{_slug(req.name or 'reachy')}-{uuid.uuid4().hex[:4]}"
        metadata = {"role": "reachy", "device": True,
                    "color": req.color or "#49e6c8", "persona": req.persona or "a real Reachy Mini, live"}
        for k in ("voice", "bodyColor", "hat", "face", "neck"):
            if getattr(req, k):
                metadata[k] = getattr(req, k)
    else:
        identity = req.identity or f"viewer-{uuid.uuid4().hex[:8]}"
    token = tokens.make_token(identity, req.name, req.room, can_publish=False,
                              can_subscribe=True, metadata=metadata)
    return {"token": token, "url": config.LIVEKIT_URL, "room": req.room, "identity": identity}


async def join_room(room_id: str):
    room = ROOMS.get(room_id)
    if not room:
        raise HTTPException(404, "no such room")
    # never make the viewer wait for publishers to spin up — answer immediately
    # and let the cast stream into the room while the frontend plays its
    # patching-in choreography
    asyncio.create_task(_ensure_conversation_logged(room))
    return {"ok": True, "room": _room_dict(room)}


async def _ensure_conversation_logged(room: Room) -> None:
    try:
        await _ensure_conversation(room)
    except Exception as e:  # background task: surface in logs, not to the viewer
        print(f"[join:{room.id}] ensure_conversation failed: {e}")


async def start_show(room_id: str):
    """Leave the green room: cast the physical Reachys currently connected and
    kick off the generated show."""
    room = ROOMS.get(room_id)
    if not room:
        raise HTTPException(404, "no such room")
    if room.template != "open" or not room.topic:
        raise HTTPException(400, "only topic'd open rooms start this way")
    async with _ENSURE_LOCKS.setdefault(room.id, asyncio.Lock()):
        task = ROOM_TASKS.get(room.id)
        if task and not task.done():
            return {"ok": True, "already": True, "room": _room_dict(room)}
        if not (config.MODAL_LLM_URL and config.MODAL_TTS_URL):
            raise HTTPException(503, "show brain not configured")
        guests = await _list_device_guests(room.id)
        room.status = "live"
        ROOM_TASKS[room.id] = asyncio.create_task(_run_generated_show(room, required=guests))
        return {"ok": True, "guests": [g["name"] for g in guests], "room": _room_dict(room)}


async def add_reachy(room_id: str, req: ReachyRequest):
    """Drop a user-configured Reachy into the room. It joins and reacts; live
    speech needs the on-device brain + TTS, so its track stays silent for now."""
    if FEATURES_LOCKED:
        raise HTTPException(403, "Custom Reachies are under construction.")
    room = ROOMS.get(room_id)
    if not room:
        raise HTTPException(404, "no such room")
    if room.template != "open":
        raise HTTPException(403, "demo rooms are watch-only")
    ident = f"guest-{_slug(req.name)}-{uuid.uuid4().hex[:4]}"
    props = {k: v for k, v in (("hat", req.hat), ("face", req.face), ("neck", req.neck),
                               ("bodyColor", req.bodyColor)) if v}
    pub = ReachyPublisher(ident, req.name, room=room_id, color=req.color, persona=req.persona,
                          props=props)
    await pub.connect()
    ROOM_PUBS.setdefault(room_id, {})[ident] = pub
    return {"ok": True, "identity": ident}


class IdentityRequest(BaseModel):
    identity: str


async def remove_reachy(room_id: str, req: IdentityRequest):
    """Remove a guest Reachy when its viewer leaves (called on leave + on tab
    close via sendBeacon), so rooms don't accumulate ghost guests."""
    pub = ROOM_PUBS.get(room_id, {}).pop(req.identity, None)
    if pub:
        await pub.aclose()
    return {"ok": True}


# --------------------------------------------------------------------- stylist
# The "bring your own Reachy" wardrobe: the Nemotron brain picks 3D accessories
# (from the curated prop set the frontend bundles) to match a character.
CURATED_PROPS = {
    "hat": ["wizard", "cowboy", "tophat", "crown", "party", "pirate", "viking",
            "propeller", "santa", "halo", "baseball"],
    "face": ["sunglasses", "monocle", "skigoggles"],
    "neck": ["bowtie", "necktie"],
}


class StyleRequest(BaseModel):
    description: str


async def style_reachy(req: StyleRequest):
    """Dress the Reachy from its description (same Nemotron brain as the shows)."""
    desc = (req.description or "").strip()[:600]
    if not desc:
        raise HTTPException(400, "describe your Reachy first")
    if not config.MODAL_LLM_URL:
        raise HTTPException(503, "stylist brain not configured")
    try:
        return await showgen.style_outfit(desc, CURATED_PROPS)
    except Exception as e:
        raise HTTPException(502, f"stylist unavailable: {e}")


# --------------------------------------------------------------------- debug log
# Browser-side WebRTC diagnostics ship here so flaky-client issues (looking at
# you, Firefox) can be inspected server-side without copy-pasting consoles.
from collections import deque  # noqa: E402

DEBUG_LOG: deque[str] = deque(maxlen=3000)


class DebugLines(BaseModel):
    tag: str = ""
    lines: list[str]


async def post_debug_log(req: DebugLines):
    import time as _t

    ts = _t.strftime("%H:%M:%S")
    for ln in req.lines[:100]:
        DEBUG_LOG.append(f"{ts} [{req.tag[:24]}] {ln[:500]}")
    return {"ok": True}


# --------------------------------------------------------------------- admin
from fastapi import Header  # noqa: E402


def _check_admin(token: str | None) -> None:
    if not config.ADMIN_TOKEN or token != config.ADMIN_TOKEN:
        raise HTTPException(403, "bad admin token")


async def admin_debug_log(x_admin_token: str | None = Header(default=None)):
    _check_admin(x_admin_token)
    from fastapi.responses import PlainTextResponse

    return PlainTextResponse("\n".join(DEBUG_LOG))


async def admin_rooms(x_admin_token: str | None = Header(default=None)):
    """Everything running, with enough detail to decide what to kill."""
    _check_admin(x_admin_token)
    viewers = await _viewer_counts()
    out = []
    for r in list(ROOMS.values()):
        task = ROOM_TASKS.get(r.id)
        out.append({
            **_room_dict(r),
            "viewers": viewers.get(r.id, 0),
            "publishers": len(ROOM_PUBS.get(r.id, {})),
            "task": "running" if task and not task.done() else ("done" if task else "none"),
            "seed": r.id in SEED_ROOM_IDS,
        })
    return {"rooms": out}


async def _admin_stop_one(room_id: str, *, remove: bool) -> bool:
    room = ROOMS.get(room_id)
    task = ROOM_TASKS.get(room_id)
    if task and not task.done():
        task.cancel()
    if room:
        await _shutdown_room(room, remove=remove)
        return True
    # room already gone — sweep any orphans
    for pub in ROOM_PUBS.pop(room_id, {}).values():
        try:
            await pub.aclose()
        except Exception:
            pass
    ROOM_TASKS.pop(room_id, None)
    return False


async def admin_stop(room_id: str, x_admin_token: str | None = Header(default=None)):
    """Stop the show: cast disconnects, room stays and restarts on next join."""
    _check_admin(x_admin_token)
    await _admin_stop_one(room_id, remove=False)
    return {"ok": True}


async def admin_delete(room_id: str, x_admin_token: str | None = Header(default=None)):
    """Stop the show AND remove the room entirely (seed rooms can't be deleted)."""
    _check_admin(x_admin_token)
    await _admin_stop_one(room_id, remove=True)
    return {"ok": True}


class AdminBatch(BaseModel):
    ids: list[str]
    delete: bool = False


async def admin_stop_batch(req: AdminBatch, x_admin_token: str | None = Header(default=None)):
    """Stop (or delete) a selected set of rooms in one go."""
    _check_admin(x_admin_token)
    for rid in req.ids[:50]:
        await _admin_stop_one(rid, remove=req.delete)
    return {"ok": True, "count": len(req.ids[:50])}


async def admin_stop_all(x_admin_token: str | None = Header(default=None)):
    _check_admin(x_admin_token)
    ids = set(ROOM_TASKS) | set(ROOM_PUBS)
    for rid in ids:
        await _admin_stop_one(rid, remove=False)
    return {"ok": True, "stopped": sorted(ids)}


def attach(app) -> None:
    """Register CORS + gzip + the /api routes onto `app`."""
    from starlette.middleware.gzip import GZipMiddleware

    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
    )
    app.add_api_route("/api/config", get_config, methods=["GET"])
    app.add_api_route("/api/rooms", list_rooms, methods=["GET"])
    app.add_api_route("/api/rooms", create_room, methods=["POST"])
    app.add_api_route("/api/rooms/{room_id}/join", join_room, methods=["POST"])
    app.add_api_route("/api/rooms/{room_id}/start", start_show, methods=["POST"])
    app.add_api_route("/api/rooms/{room_id}/reachy", add_reachy, methods=["POST"])
    app.add_api_route("/api/rooms/{room_id}/reachy/leave", remove_reachy, methods=["POST"])
    app.add_api_route("/api/token", post_token, methods=["POST"])
    app.add_api_route("/api/style-reachy", style_reachy, methods=["POST"])
    app.add_api_route("/api/debug-log", post_debug_log, methods=["POST"])
    app.add_api_route("/api/admin/debug-log", admin_debug_log, methods=["GET"])
    app.add_api_route("/api/admin/rooms", admin_rooms, methods=["GET"])
    app.add_api_route("/api/admin/rooms/{room_id}/stop", admin_stop, methods=["POST"])
    app.add_api_route("/api/admin/rooms/{room_id}", admin_delete, methods=["DELETE"])
    app.add_api_route("/api/admin/stop-batch", admin_stop_batch, methods=["POST"])
    app.add_api_route("/api/admin/stop-all", admin_stop_all, methods=["POST"])


# Local dev app (the Space uses app.py / gradio.Server instead).
app = FastAPI(title="Small Talk")
attach(app)


def run() -> None:
    import uvicorn

    uvicorn.run("backend.server:app", host="0.0.0.0", port=8000, reload=False)


if __name__ == "__main__":
    run()
