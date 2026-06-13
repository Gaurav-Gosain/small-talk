ok so here is the context. this is the hackathon. @hackathon.html

Here is the idea. Me and my friend are taking part in this as a team, we both have Reachy Minis.

So we are ideating what would an AI to AI podcast/group call look like.

Both reachy minis join the call over webrtc using livekit.
We will have an NVIDIA Nemotron (Nano 4B, via llama.cpp on Modal) running as the
combined brain of all reachies and qwen 3 tts (voice design) for emotive and
unique voices for each reachy. The reachies joining the podcast/debate bring their own personalities +
voice description (personality comes from a md file perhaps similar story for
voice). The voice description gets fed into qwen 3 tts voicedesign to make
their reachy feel personal. I envision the ui to look like the following:

- User visits our hugging face space and see a demo video/description and a
  button that says, "Own a reachy? Join the reachy podcast" or something along
  those lines
- Once a user clicks this button, he gets sent into the
  connection/configuration option where they can connect/configure their reachy
  with the personality voice design etc.
- Once ready, the user joins the call and the interface shifts to something
  familiar like google meet/zoom/livekit style user rectagular cards in a grid.
- Each reachy gets a 3d digital twin of itself shown in the card, you can grab
  the 3d assets and visualization logic from here:
  - <https://github.com/pollen-robotics/reachy-mini-desktop-app>
- The organizer of the podcast can then set the topic/references for the talk
  (can also perhaps be documents etc. that get added as context, similar to
  notebooklm's podcast feature.)
- For the speech itself I was thinking something of an LLM+tts cascade, the
  following is my idea:
  - Since we control both the speakers, we can completely get rid of the stt aspect
  - Reachy#1 starts the conversation
  - LLM shared brain generates text, this gets piped into qwen for tts and the
    speech starts getting created
  - at this point, even before the tts is done creation/speaking, Reachy#2's
    role can start, the LLM brain can already start generating the response since
    we already have access to the text Reachy#1 had generated. So Reachy#2 can
    start generating its tts audio in parallel. At this point Reachy#1 can also
    start preparing its next line and so on, this way we cascade the whole
    llm+tts pipeline!

- <https://huggingface.co/build-small-hackathon>
- <https://github.com/pollen-robotics/reachy_mini>
- <https://github.com/pollen-robotics/reachy-mini-desktop-app>

Task 1:

Get the meeting infrastructure setup, setup the livekit backend + reachy 3D
rendering in three.js + figure out how to pipe generated wav/mp3 files live
into livekit
