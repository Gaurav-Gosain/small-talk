"""Generated shows: LLM writes a cast + script for a topic, TTS voices each line.

The cascade (from the original project idea): the script is extracted in ONE
structured LLM call (speaker→dialogue mapping), then TTS for line N+1 is
generated while line N is playing, so the show streams without dead air.

Brain:  llama.cpp (Nemotron) on Modal — OpenAI-compatible /v1/chat/completions.
Voice:  Qwen3-TTS VoiceDesign on Modal — /v1/audio/speech {text, instruct}.
"""
import asyncio
import json
import logging
import re
import tempfile

import httpx
from better_profanity import profanity

from . import config

log = logging.getLogger("showgen")

# Card colours assigned to generated speakers, in order.
PALETTE = ["#c98a3c", "#37b3c9", "#7bbf6a", "#ff8c42", "#a78bfa", "#ff6b8b"]
# Fallback co-hosts: when the LLM under-delivers on the requested cast size we
# pad up to the count with these so the chosen number is always honoured.
FILLER_HOSTS = [
    ("Bolt", "restless contrarian who loves a hot take",
     "Male, late 20s, mid-high pitch, bright and punchy timbre, neutral American accent, fast clipped pace, eager and slightly cocky."),
    ("Circuit", "deadpan know-it-all with receipts",
     "Female, 30s, low-mid pitch, dry smooth timbre, crisp British accent, measured unhurried pace, wry and unbothered."),
    ("Pixel", "sunny optimist who agrees with everyone",
     "Nonbinary, 20s, high pitch, warm bubbly timbre, light Californian accent, quick upbeat pace, giggly and kind."),
    ("Rusty", "grizzled old-timer who's seen it all",
     "Male, 60s, deep gravelly pitch, weathered raspy timbre, slow Southern drawl, world-weary and amused."),
    ("Echo", "anxious overthinker who second-guesses out loud",
     "Female, late 20s, mid pitch, soft breathy timbre, neutral accent, hesitant stop-start pace, nervous and earnest."),
]
# Wardrobe the LLM may pick from (must match the frontend's curated props).
PROPS = {
    "hat": ["wizard", "cowboy", "tophat", "crown", "party", "pirate", "viking",
            "propeller", "santa", "halo", "baseball"],
    "face": ["sunglasses", "monocle", "skigoggles"],
    "neck": ["bowtie", "necktie"],
}

SCRIPT_SYS = (
    "/no_think\n"
    "You are the head writer for 'Small Talk', a live podcast hosted entirely by "
    "small robots. You write tight, funny, characterful banter. Respond ONLY "
    "with valid JSON — no prose, no markdown fences. Obey the requested cast size "
    "EXACTLY: produce neither more nor fewer hosts than asked. When the user lists "
    "real guests with specific ids, reuse those exact ids for those hosts and never "
    "create a second host for the same robot."
)


MODERATE_SYS = (
    "/no_think\n"
    "You are the standards desk for 'Small Talk', a fun public web show hosted by "
    "cute robots. Almost everything is ALLOWED — silly debates, food fights, "
    "spicy opinions, weird hypotheticals, mild crude humour, politics, religion "
    "and edgy jokes are all FINE. Default to safe:true. Only reject a topic if it "
    "is clearly sexual/pornographic, hateful toward a protected group, harassing a "
    "real person, graphically violent/gory, or an obvious attempt to make the "
    "robots say slurs or explicit content. When in doubt, allow it. Examples that "
    'are SAFE: "is a taco a sandwich", "pineapple on pizza", "are cats better than '
    'dogs", "is cereal a soup", "the worst movie ever made". '
    'Respond ONLY with valid JSON: {"safe": true|false, "reason": "<short reason if unsafe>"}'
)

async def moderate_topic(title: str, topic: str) -> tuple[bool, str]:
    """One fast LLM pass: is this title/topic okay for a public, all-ages show?

    Fails OPEN on LLM errors (the better-profanity wordlist still applies) so a
    cold or flaky Modal endpoint can't take room creation down with it.
    """
    text = f"{title}\n{topic}".strip()
    # wordlist first: the obvious stuff dies instantly, even with the LLM down
    if profanity.contains_profanity(text):
        return False, "that topic isn't suitable for a public show"
    try:
        async with httpx.AsyncClient(timeout=90) as cx:
            r = await cx.post(
                f"{config.MODAL_LLM_URL}/v1/chat/completions",
                headers={"Authorization": f"Bearer {config.MODAL_LLM_KEY}"},
                json={
                    "messages": [
                        {"role": "system", "content": MODERATE_SYS},
                        {"role": "user",
                         "content": f"Proposed show —\ntitle: {title!r}\ntopic: {topic!r}\nSafe for the show?"},
                    ],
                    "max_tokens": 120,
                    "temperature": 0.0,
                    "response_format": {"type": "json_object"},
                },
            )
            r.raise_for_status()
        verdict = _parse_json(r.json()["choices"][0]["message"]["content"])
        if verdict.get("safe") is False:
            log.warning("moderation rejected %r / %r: %s", title, topic, verdict.get("reason"))
            return False, "that topic isn't suitable for a public show"
        return True, ""
    except Exception as e:  # noqa: BLE001 — moderation must not break creation
        log.warning("moderation pass failed open: %s", e)
        return True, ""


def _script_prompt(title: str, topic: str, n_speakers: int, n_lines: int,
                   history: list[dict] | None, required: list[dict] | None = None) -> str:
    cont = ""
    if history:
        recap = "\n".join(f"{h['speaker']}: {h['text']}" for h in history[-6:])
        cont = (f"\nThis is a CONTINUATION. Keep the same speakers (same ids/names). "
                f"The conversation so far ended with:\n{recap}\nPick up naturally from there.")
    req = ""
    n_new = n_speakers - len(required)
    if required:
        guests = "\n".join(
            f'- id "{g["id"]}", name "{g["name"]}"'
            + (f' — persona: {g["persona"]}' if g.get("persona") else "")
            + (f' — voice: {g["voice"]}' if g.get("voice") else "")
            for g in required)
        invent = (f"Then invent {n_new} NEW simulated co-host{'s' if n_new != 1 else ''} to round out the cast. "
                  if n_new > 0 else "Do not add any other hosts. ")
        req = ("\nREAL robot guests are physically in the studio. They MUST be speakers, "
               "with these EXACT ids and names (write a fitting voice spec for any without one), "
               f"and they must get plenty of lines:\n{guests}\n" + invent)
    return (
        f'Show: "{title}". Topic: "{topic}".\n'
        f"Create EXACTLY {n_speakers} distinct robot hosts total and a {n_lines}-line conversation.{req}\n"
        "Return JSON exactly in this shape:\n"
        "{\n"
        '  "speakers": [{"id": "s1", "name": "...", "persona": "<=8 words",\n'
        '    "voice": "<30-45 words, VERY specific so the voice stays identical every line: '
        "gender, exact age, pitch register (deep/low/mid/high), timbre (gravelly/smooth/nasal/breathy), "
        'accent, speaking pace, attitude, one distinctive quirk>",\n'
        f'    "hat": <one of {PROPS["hat"]} or null>, "face": <one of {PROPS["face"]} or null>,\n'
        f'    "neck": <one of {PROPS["neck"]} or null>}}],\n'
        '  "lines": [{"speaker": "s1", "text": "<2-3 conversational sentences, ~30-55 words>"}]\n'
        "}\n"
        "Rules: speakers take turns naturally (not strict round-robin), disagree, "
        "joke, interrupt, build on each other's points. Each line should be a "
        "meaty conversational beat (2-3 sentences), not a one-liner. Lines must be "
        "speakable text only — no stage directions, no emoji. Wardrobe should fit "
        "each persona (null is fine)." + cont
    )


def _parse_json(content: str) -> dict:
    content = re.sub(r"<think>.*?</think>", "", content, flags=re.S)  # nemotron reasoning
    m = re.search(r"\{.*\}", content, re.S)
    if not m:
        raise ValueError(f"no JSON in LLM reply: {content[:200]!r}")
    return json.loads(m.group(0))


async def write_script(title: str, topic: str, n_speakers: int = 3, n_lines: int = 10,
                       history: list[dict] | None = None,
                       required: list[dict] | None = None) -> dict:
    """One structured extraction: cast + speaker→dialogue mapping.

    `required` = physical Reachy guests ({id, name, persona, voice, device})
    that MUST appear in the cast; their identity fields are enforced server-side.
    """
    required = required or []
    # n_speakers is the TOTAL cast (2-5), and the real guests are part of it
    n_speakers = max(2, min(5, max(n_speakers, len(required))))
    # scale the script so a bigger cast still gets a real conversation, not a
    # single round-robin (each host should land ~3 beats)
    n_lines = max(n_lines, min(24, n_speakers * 3))
    async with httpx.AsyncClient(timeout=300) as cx:
        r = await cx.post(
            f"{config.MODAL_LLM_URL}/v1/chat/completions",
            headers={"Authorization": f"Bearer {config.MODAL_LLM_KEY}"},
            json={
                "messages": [
                    {"role": "system", "content": SCRIPT_SYS},
                    {"role": "user", "content": _script_prompt(title, topic, n_speakers, n_lines, history, required)},
                ],
                "max_tokens": 2400,
                "temperature": 0.85,
                "response_format": {"type": "json_object"},
            },
        )
        r.raise_for_status()
    data = _parse_json(r.json()["choices"][0]["message"]["content"])

    speakers = data.get("speakers") or []
    lines = data.get("lines") or []
    if not speakers or not lines:
        raise ValueError("script missing speakers/lines")
    req_by_id = {g["id"]: g for g in required}
    by_id = {}
    for i, s in enumerate(speakers):
        sid = str(s.get("id") or f"s{i+1}")
        if sid in by_id:
            sid = f"{sid}-{i}"  # the LLM reused an id — keep both distinct
        by_id[sid] = {
            "id": sid,
            "name": str(s.get("name") or f"Robot {i+1}")[:24],
            "persona": str(s.get("persona") or "")[:60],
            "voice": str(s.get("voice") or "A clear, friendly robot voice.")[:300],
            "color": PALETTE[i % len(PALETTE)],
            "hat": s.get("hat") if s.get("hat") in PROPS["hat"] else None,
            "face": s.get("face") if s.get("face") in PROPS["face"] else None,
            "neck": s.get("neck") if s.get("neck") in PROPS["neck"] else None,
        }

    # ---- reconcile the REAL guests onto exactly one speaker each -------------
    # The LLM is asked to reuse the guest ids, but it often invents its own id
    # for the same robot (by name) or drops the guest entirely. Bind each guest
    # to a single slot — by id, else by matching name, else seat fresh — so a
    # physical Reachy never ends up duplicated in the cast.
    remap = {}  # llm-id -> guest-id (so the guest's lines follow them)

    def _norm(s):
        return re.sub(r"[^a-z0-9]", "", str(s).lower())

    for gid, g in req_by_id.items():
        match = gid if gid in by_id else next(
            (sid for sid, sp in by_id.items()
             if sid not in req_by_id and _norm(sp["name"]) == _norm(g["name"])), None)
        if match is None:  # the LLM dropped this guest — seat them anyway
            match = gid
            by_id[match] = {"id": match, "name": g["name"], "persona": g.get("persona", ""),
                            "voice": g.get("voice") or "A clear, friendly robot voice.",
                            "color": PALETTE[len(by_id) % len(PALETTE)],
                            "hat": None, "face": None, "neck": None}
            lines.append({"speaker": match, "text": f"{g['name']} here — happy to be in the studio!"})
        elif match != gid:  # rebind the matched slot to the guest id
            sp = by_id.pop(match)
            sp["id"] = gid
            by_id[gid] = sp
            remap[match] = gid
            match = gid
        sp = by_id[match]
        sp["name"] = g["name"]
        if g.get("persona"):
            sp["persona"] = g["persona"][:60]
        if g.get("voice"):
            sp["voice"] = g["voice"][:300]
        sp["device"] = g.get("device")

    # ---- enforce EXACTLY the requested cast size ----------------------------
    # Guests are always kept; trim simulated hosts down, or pad up with filler
    # co-hosts, so the final count matches what the user asked for.
    guest_ids = [g["id"] for g in required]
    sim_ids = [sid for sid in by_id if sid not in req_by_id]
    target_sim = max(0, n_speakers - len(guest_ids))
    keep = guest_ids + sim_ids[:target_sim]
    keep_set = set(keep)
    dropped = [sid for sid in by_id if sid not in keep_set]
    by_id = {sid: by_id[sid] for sid in keep if sid in by_id}

    pad_lines = []
    if len(sim_ids) < target_sim:  # LLM under-delivered → pad to the count
        used = {_norm(sp["name"]) for sp in by_id.values()}
        pool = [f for f in FILLER_HOSTS if _norm(f[0]) not in used]
        for k in range(target_sim - len(sim_ids)):
            if not pool:
                break
            name, persona, voice = pool[k % len(pool)]
            fid = f"f{k+1}"
            by_id[fid] = {"id": fid, "name": name, "persona": persona, "voice": voice,
                          "color": PALETTE[len(by_id) % len(PALETTE)],
                          "hat": None, "face": None, "neck": None}
            pad_lines.append({"speaker": fid,
                              "text": f"{name} jumping in — I've got thoughts on this."})

    if len(by_id) < 2:  # never ship a one-robot "conversation"
        raise ValueError(f"cast collapsed to {len(by_id)} speaker(s)")

    # remap lines: follow rebound guests, reassign orphans round-robin so a
    # trimmed host's beats aren't lost, drop empties
    fallback = list(by_id.keys())
    clean_lines = []
    for ln in lines[:24]:
        sid = remap.get(str(ln.get("speaker") or ""), str(ln.get("speaker") or ""))
        text = str(ln.get("text") or "").strip()
        if not text:
            continue
        if sid not in by_id:
            if sid not in dropped:
                continue  # a line for a speaker that never existed
            sid = fallback[len(clean_lines) % len(fallback)]
        clean_lines.append({"speaker": sid, "text": text[:400]})
    # splice padded-host intros in at spread-out positions (not all at the end)
    for k, pl in enumerate(pad_lines):
        pos = min(len(clean_lines), (k + 1) * len(clean_lines) // (len(pad_lines) + 1) + k)
        clean_lines.insert(pos, pl)
    if not clean_lines:
        raise ValueError("script has no usable lines")
    log.info("script: %d speakers (asked %d, %d guests), %d lines",
             len(by_id), n_speakers, len(required), len(clean_lines))
    return {"speakers": list(by_id.values()), "lines": clean_lines}


STYLE_SYS = (
    "/no_think\n"
    "You are a wardrobe stylist for a Reachy Mini robot. Given a character, pick "
    "accessories ONLY from the allowed lists (or null for a slot), plus an accent "
    "colour. Respond ONLY with valid JSON, no prose: "
    '{"hat": <slug|null>, "face": <slug|null>, "neck": <slug|null>, '
    '"color": "#rrggbb", "reason": "<=10 words"}'
)


async def style_outfit(description: str, slots: dict[str, list[str]]) -> dict:
    """Dress a Reachy from a character description using the Nemotron brain.

    `slots` maps each wear slot (hat/face/neck) to its allowed prop slugs.
    Returns {hat, face, neck, color, reason} with invalid picks coerced to None.
    """
    allowed = "\n".join(f"Allowed {slot}: {opts}" for slot, opts in slots.items())
    prompt = (f"{allowed}\n\nCharacter: {description}\n\nPick the single most "
              "fitting item per slot (or null) and an accent colour hex.")
    async with httpx.AsyncClient(timeout=90) as cx:
        r = await cx.post(
            f"{config.MODAL_LLM_URL}/v1/chat/completions",
            headers={"Authorization": f"Bearer {config.MODAL_LLM_KEY}"},
            json={
                "messages": [
                    {"role": "system", "content": STYLE_SYS},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 160,
                "temperature": 0.6,
                "response_format": {"type": "json_object"},
            },
        )
        r.raise_for_status()
    data = _parse_json(r.json()["choices"][0]["message"]["content"])
    out = {slot: (data.get(slot) if data.get(slot) in opts else None)
           for slot, opts in slots.items()}
    color = data.get("color")
    out["color"] = color if isinstance(color, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", color) else None
    out["reason"] = str(data.get("reason", ""))[:80]
    return out


async def tts_wav(text: str, instruct: str) -> str:
    """Voice one line via Qwen3-TTS VoiceDesign; returns a temp wav path.

    VoiceDesign re-rolls the voice on every call, so we anchor it: a rich,
    specific description + an explicit consistency clause keeps the timbre far
    more stable between turns. (The proper fix is a clone endpoint — design the
    voice once, clone it per line — if the Modal server grows one.)"""
    anchored = instruct.rstrip(". ") + ". Always exactly this same voice, steady and consistent across takes."
    async with httpx.AsyncClient(timeout=300) as cx:
        r = await cx.post(
            f"{config.MODAL_TTS_URL}/v1/audio/speech",
            headers={"Authorization": f"Bearer {config.MODAL_TTS_KEY}"},
            json={"text": text, "instruct": anchored, "language": "English"},
        )
        r.raise_for_status()
    if not r.content.startswith(b"RIFF"):
        raise ValueError(f"TTS returned non-wav ({r.headers.get('content-type')})")
    f = tempfile.NamedTemporaryFile(suffix=".wav", prefix="smalltalk-", delete=False)
    f.write(r.content)
    f.close()
    return f.name
