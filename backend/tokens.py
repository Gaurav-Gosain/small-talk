"""LiveKit access-token minting (server-side)."""
import json

from livekit import api

from . import config


def make_token(
    identity: str,
    name: str | None = None,
    room: str | None = None,
    *,
    can_publish: bool = False,
    can_subscribe: bool = True,
    metadata: dict | None = None,
) -> str:
    """Mint a JWT for `identity` to join `room`.

    Viewers (browsers) get can_publish=False; Reachy publishers get True.
    `metadata` is attached to the participant and is readable by all clients —
    we use it to carry the Reachy's display colour / persona.
    """
    room = room or config.ROOM_NAME
    grants = api.VideoGrants(
        room_join=True,
        room=room,
        can_publish=can_publish,
        can_subscribe=can_subscribe,
        can_publish_data=True,
    )
    token = (
        api.AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET)
        .with_identity(identity)
        .with_name(name or identity)
        .with_grants(grants)
    )
    if metadata:
        token = token.with_metadata(json.dumps(metadata))
    return token.to_jwt()
