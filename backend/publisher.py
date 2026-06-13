"""ReachyPublisher — connects one Reachy Mini into the LiveKit room as a
participant and streams pre-rendered audio clips into the call as a live
audio track.

Design notes
------------
* One `rtc.Room` connection per Reachy (each has its own identity/token/track).
* Audio is pushed as 10 ms int16 frames at 48 kHz. `AudioSource.capture_frame`
  applies backpressure (its internal queue drains at real-time playback speed),
  so simply awaiting it frame-by-frame paces the stream to wall-clock — no
  manual sleeps needed.
* `say_file()` enqueues a clip; an async worker plays the queue in order. This
  is the seam the LLM+TTS cascade plugs into later: generate a line -> drop the
  wav -> `say_file()`, while the next line is already being generated.
"""
import argparse
import asyncio

import numpy as np
from livekit import rtc

from . import config, tokens
from .audio import NUM_CHANNELS, SAMPLE_RATE, decode_to_pcm

SAMPLES_PER_FRAME = SAMPLE_RATE // 100  # 10 ms


class ReachyPublisher:
    def __init__(
        self,
        identity: str,
        name: str | None = None,
        room: str | None = None,
        *,
        color: str = "#c98a3c",
        persona: str | None = None,
        props: dict | None = None,
    ):
        self.identity = identity
        self.name = name or identity
        self.room_name = room or config.ROOM_NAME
        self.metadata = {"role": "reachy", "color": color, "persona": persona, **(props or {})}

        self.room = rtc.Room()
        self.source = rtc.AudioSource(SAMPLE_RATE, NUM_CHANNELS)
        self.track = rtc.LocalAudioTrack.create_audio_track(
            f"{self.identity}-voice", self.source
        )
        self._queue: asyncio.Queue = asyncio.Queue()
        self._worker: asyncio.Task | None = None

    async def connect(self) -> "ReachyPublisher":
        token = tokens.make_token(
            self.identity,
            self.name,
            self.room_name,
            can_publish=True,
            can_subscribe=True,
            metadata=self.metadata,
        )
        await self.room.connect(
            config.LIVEKIT_URL, token, options=rtc.RoomOptions(auto_subscribe=True)
        )
        opts = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await self.room.local_participant.publish_track(self.track, opts)
        self._worker = asyncio.create_task(self._run())
        print(f"[{self.identity}] connected to '{self.room_name}' and publishing")
        return self

    async def say_file(self, path: str) -> None:
        """Queue an audio clip to be spoken. Returns immediately."""
        await self._queue.put(str(path))

    async def send_data(self, payload: dict) -> None:
        """Broadcast a JSON message to the room (subtitles, status)."""
        import json

        try:
            await self.room.local_participant.publish_data(
                json.dumps(payload).encode(), reliable=True
            )
        except Exception as e:
            print(f"[{self.identity}] data send failed: {e}")

    async def wait_until_idle(self) -> None:
        """Block until every queued clip has finished playing."""
        await self._queue.join()

    async def _run(self) -> None:
        while True:
            path = await self._queue.get()
            try:
                pcm = await decode_to_pcm(path, SAMPLE_RATE)
                await self._stream_pcm(pcm)
            except Exception as e:  # keep the worker alive across bad clips
                print(f"[{self.identity}] failed to play {path}: {e}")
            finally:
                self._queue.task_done()

    async def _stream_pcm(self, pcm: np.ndarray) -> None:
        frame = rtc.AudioFrame.create(SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_FRAME)
        buf = np.frombuffer(frame.data, dtype=np.int16)
        for start in range(0, len(pcm), SAMPLES_PER_FRAME):
            chunk = pcm[start : start + SAMPLES_PER_FRAME]
            if len(chunk) < SAMPLES_PER_FRAME:  # zero-pad the final frame
                padded = np.zeros(SAMPLES_PER_FRAME, dtype=np.int16)
                padded[: len(chunk)] = chunk
                chunk = padded
            np.copyto(buf, chunk)
            await self.source.capture_frame(frame)  # backpressure paces playback
        await self.source.wait_for_playout()  # don't clip the tail

    async def aclose(self) -> None:
        if self._worker:
            self._worker.cancel()
        await self.room.disconnect()
        print(f"[{self.identity}] disconnected")


# --------------------------------------------------------------------------- CLI


async def _cli_main(args: argparse.Namespace) -> None:
    pub = ReachyPublisher(
        args.identity, args.name, args.room, color=args.color, persona=args.persona
    )
    await pub.connect()
    try:
        while True:
            await pub.say_file(args.file)
            await pub.wait_until_idle()
            if not args.loop:
                break
    finally:
        await pub.aclose()


def cli() -> None:
    p = argparse.ArgumentParser(description="Publish an audio file into the Reachy podcast room")
    p.add_argument("--identity", required=True, help="unique participant id, e.g. reachy-1")
    p.add_argument("--name", help="display name, e.g. Ada")
    p.add_argument("--room", help=f"room name (default: {config.ROOM_NAME})")
    p.add_argument("--file", required=True, help="path to wav/mp3/etc to play")
    p.add_argument("--color", default="#c98a3c", help="card accent colour (hex)")
    p.add_argument("--persona", help="short persona blurb")
    p.add_argument("--loop", action="store_true", help="replay the file on a loop")
    asyncio.run(_cli_main(p.parse_args()))


if __name__ == "__main__":
    cli()
