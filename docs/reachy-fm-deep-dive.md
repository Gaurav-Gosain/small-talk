# Reachy FM: building a robot radio station that grooves to the beat

Small Talk started as a project where small robots host their own podcast. You give a few Reachy Mini robots a topic, they write a script, design their own voices, and talk it out while you watch their 3D digital twins on screen. Somewhere in the middle of building that, the project grew a radio station.

Reachy FM is a self contained corner of the app. You tune in, a robot DJ in headphones spins a vinyl record, sung lyrics scroll past in time with the music, and between tracks the DJ leans into the mic and talks. The whole thing runs in your browser with no servers in the loop once the page loads.

This is a walk through how it works, from the songs to the DJ who nods on the kick drum, and the one problem that turned out to be much harder than expected: making karaoke lyrics actually line up with the audio.

## What you hear

The station plays sixteen tracks. They are AI written songs, and the joke is that they are all about the hackathon the project was built for. There is a love ballad to a model hosting platform ("Hugging Face (Hold Me Close)"), a blues number about coding in the desert heat ("My GPU Is Hotter Than Dubai"), a gospel song about running out of cloud credits ("HuggingFace Credits (Twenty Dollars of Hope)"), and a noir detective piece about a quiet enterprise AI company nobody can quite describe ("Cohere (Nobody Knows What You Do)"). The opener is a theme song called "Welcome to Reachy Radio", and the closer is a track called "About Us" that is, fittingly, about the robots themselves.

Each song arrived as three files: the audio, a square of album art, and a subtitle file with the lyrics and rough timings. Hold that last one in mind. It becomes the center of the story later.

## DJ Servo, the host

The voice of the station is DJ Servo, a late night FM baritone with the unhurried delivery of someone narrating to drivers at two in the morning. Before each song, Servo introduces it. The introductions are written to match the track. Before the Modal credits ballad, he says:

> Two hundred and fifty dollars of Modal credits. Felt like a million. Lasted a weekend. A moment of silence for the burn rate, and now, the ballad.

These are not generated live. They are recorded ahead of time with a text to speech model called Qwen3-TTS, running on a serverless GPU. Text to speech models that design a voice from a description tend to drift between calls, so the same robot can sound like three different people across a session. To keep Servo consistent, every clip is generated with a detailed voice description plus an explicit instruction that the voice should stay identical across takes. A small script reads a list of introductions, sends each one to the model, and saves the result. The voice clips ship with the app like any other audio file.

On screen, Servo is a real 3D model. It is the actual Reachy Mini robot, the same one used everywhere else in the project, loaded from its engineering files and rendered with three.js. The one thing it needed for the radio was a pair of DJ headphones, and no headphones existed in the prop library. So they are built in code, fitted to the robot's head.

When the model loads, the code measures the head: its width, the top of the dome, the center point front to back. Then it constructs the headphones from primitive shapes positioned against those measurements. Two cylinders for the ear cups, a half torus arcing over the crown for the band, glowing rings on the cups, and a short boom arm with a microphone ball at the end. Because the parts are placed relative to the measured head rather than fixed numbers, the headphones fit correctly no matter how the model is scaled.

## Why there are no servers

The rest of Small Talk uses a real time audio system. Robots join a call, their voices are streamed in over the network, and everyone subscribes to the live feed. That makes sense for a live podcast where the script is being generated as you watch.

Reachy FM does not need any of that. The songs are fixed. The introductions are fixed. There is nothing to generate in real time. So the radio throws out the entire streaming layer and runs on a single HTML audio element.

The logic is a small state machine. There is a playlist, a current track index, and a phase that is either "mic break" or "song". To play a track, the code points the audio element at the introduction clip and lets it play. When that clip ends, a single event fires, the phase flips to "song", and the audio element is pointed at the music. When the song ends, the index advances and the cycle repeats. Skipping forward, skipping back, and clicking a record in the crate all funnel into the same two steps: dress the screen for the new track, then start its introduction.

This is worth pausing on because it is a deliberate choice, not a shortcut. The streaming version would have worked. But it would have meant running network infrastructure for content that never changes, and it would have added latency and failure modes for no benefit. A radio station is a sequence of files played one after another. The simplest thing that does that is the right thing.

## The look

The visual centerpiece is DJ Servo, large and lit on a small stage with a soft glow behind him. To his left sits a turntable: a vinyl platter with grooves drawn as concentric rings, the album art spinning at the center as the label, and a tonearm that physically lifts off the record during mic breaks and drops back down when a song starts. To his right, the lyrics.

Around the turntable is a ring of bars that react to the music. This is a frequency visualizer. The audio is run through an analyser that reports how much energy sits in each band of the sound, from the low rumble to the high cymbals, many times a second. Each bar in the ring maps to one of those bands and grows with its energy. It is the same idea as the bouncing bars on an old stereo, drawn in a circle.

Along the bottom is the record crate: every album cover in a row. The cover of the track currently playing glows, and the strip scrolls to keep it in view as the show moves through the playlist. Click any cover to jump to that track.

The first thing you actually see is a "Tune In" button over a blurred backdrop. That button is not decoration. Browsers refuse to let a page play sound until you interact with it, which is a sensible rule that stops websites from blasting audio at you. The button is that first interaction. It also doubles as the moment the audio analysis is switched on, which has to happen after a user gesture for the same reason.

## Making a robot nod to the beat

A robot DJ that stands perfectly still is not a DJ. Servo needs to move with the music, and not in a generic way. He needs to nod on the beat.

The naive version of this is to take the overall loudness of the music and bob the head in proportion. It looks wrong. The head drifts up and down with the volume, which is not what nodding to a beat looks like. Nodding is sharp. The head drops on the kick drum and springs back, over and over.

So the real version detects beats. The audio analyser is asked specifically about the low frequency bands, where the kick drum lives. The code keeps a running average of that low end energy. When the instantaneous energy jumps well above that average, and enough time has passed since the last one, that is a beat. In plain terms: the code is listening for the thump and reacting to each thump rather than to the general volume.

Every detected beat triggers a quick impulse. A value snaps to its maximum and then decays back to zero over about a tenth of a second. That impulse is fed into the robot's motion as a downward head dip and a small antenna flick, layered on top of a gentle constant sway so he is never completely frozen between beats. The result reads as a headbang locked to the kick, not a float locked to the volume.

A nice side effect: the beat value is also handed to the visuals through a single shared variable, so the spotlight behind Servo, the floor under him, and a small equalizer next to his name all pulse on the same beat the head nods to. One detection, several reactions.

There is a small piece of decorum in here too. During a mic break, Servo is talking, not listening, so the beat detection is switched off and his motion is driven by the energy of his own voice instead. He lip syncs his introduction, then drops back into grooving when the song starts. Pause the music and he stops dancing. It would be strange if he kept going in silence.

## The lyrics problem

This is the part that looked easy and was not.

The goal is karaoke. As the song plays, the current line of lyrics should light up exactly when it is sung. To do that, the app needs a list of lines, each tagged with the second it begins. The playlist stores them as pairs of a timestamp and a line of text, and the player highlights the latest line whose timestamp has passed.

The songs came with subtitle files, so this should have been a matter of reading them in. The subtitle files, it turned out, were a mess.

They had been produced by running automatic transcription over the audio, and the results showed it. Single lines were split across several entries, sometimes splitting a word down the middle so that "button" became "but" on one line and "ton" on the next. Lines were duplicated. Timestamps were out of order, with some entries lasting twenty milliseconds and others overlapping. The structure was unusable.

The first instinct was to throw the subtitle files away and transcribe the songs again from scratch with a better model. That fixed the structure. It broke the words. Transcription models are trained on speech, and they struggle with singing over instruments. The opening line of the theme song is "Turn it up and let it glow". The fresh transcription heard "Turn it up and let it go". It heard the brand name "Reachy" as "richie", and "CUDA chip" as "Q to chip". The timing and segmentation were now clean, but the lyrics were wrong, and wrong in ways that mattered because half the words were product names being mangled.

Here is the key realization, and it took an embarrassingly long time to arrive at: the old subtitle files had the correct words. They were the real generated lyrics. Their only problem was structure and timing. The fresh transcription had the opposite profile: clean structure and timing, wrong words.

The right answer was to combine them. Take the correct words from the old files, and get accurate timing some other way.

That "other way" has a name: forced alignment. It answers a specific question. Given an audio recording and the exact words being sung, when is each word sung? It is the opposite of transcription. Transcription asks what the words are. Forced alignment already knows the words and only solves for the timing. Because it is not guessing at the words, it does not matter that the singing is hard to make out. It just has to find where each known word lands in the audio.

The pipeline ended up like this. First, clean the correct text out of each old subtitle file: drop the section markers like "[Verse 1]", remove the duplicated and fragmented entries, and keep the real lines in order. Then force align that clean text against the song audio using a Whisper based aligner, asking it to preserve the original line breaks. The output is each line of the real lyrics, tagged with the second it actually begins.

The results were what the subtitle files should have been all along. "Turn it up and let it glow", correctly spelled, lighting up at the moment it is sung. "Handed us the CUDA chip", not "Q to chip". The line breaks the songwriter intended, with the timing of the actual performance.

Two cleanup passes handle the rough edges. Some of the songs fade out before their final repeated choruses, but the lyrics for those choruses are still in the text. Forced alignment cannot find them in audio that has already ended, so it crams them into the last second, sometimes past the end of the file, splitting words to make them fit. So the pipeline trims any trailing lines that pile up past the end of the audio. The second pass merges short leftover fragments, like a lone "enough?" sitting under "We made robots do the Macarena, is that", back into the line they belong to.

## The bug that hid behind all of that

After all of that work, the lyrics were correct and the timing was accurate, and the report came back that they were still out of sync. For everything.

The first job was to find out whether the timing was actually wrong or whether something else was going on. So rather than trust the alignment, it got tested directly. The code took a lyric line, looked up the second it claimed to start, cut that slice out of the real audio, and transcribed just that slice. The words matched. The line that the playlist said was sung at twenty seconds was, in fact, being sung at twenty seconds. The data was correct.

The problem was caching. The lyrics file was being served without any instruction about how long browsers should hold on to it. Left to their own judgment, browsers cache a file like that and keep serving the old copy. So every time the lyrics were corrected and redeployed, the browser kept handing back the stale version it already had. The fix was on the file itself rather than the data inside it: tell the browser to always check for a fresh copy of the lyrics, while still letting it cache the large audio files that never change, and add a unique marker to each request so there is no copy old enough to reuse.

It is a good reminder that "the output is wrong" and "the pipeline that produced the output is wrong" are different claims, and it is worth confirming which one you are dealing with before rebuilding the pipeline a fourth time.

## The small things

A few details that did not fit anywhere else but make the thing feel finished.

The lyric panel fades at the top and bottom and scrolls so the active line sits in the upper middle, the way most karaoke screens place it. Long lines wrap instead of running off the edge, and the highlighted line has a little room around it so its glow is not clipped.

On a phone, the whole layout stacks with the DJ on top, and the page scrolls, because a fixed full height layout cuts off the bottom on small screens.

The station has an "On Air" lamp that turns red during mic breaks and the tonearm lifts at the same time, so even with the sound off you can tell whether the DJ is talking or a record is playing.

## What it adds up to

Reachy FM is a small thing inside a larger project, and most of it is the kind of work that does not show: a state machine that is deliberately boring, a headphone model fitted to a measured head, a beat detector that listens for the thump instead of the volume, and a lyrics pipeline that took the correct words from one bad source and the correct timing from the audio itself. None of those are flashy on their own. Together they make a robot in headphones spin records, nod on the kick drum, and sing along in time, which turns out to be a fun way to listen to sixteen songs about running out of GPU credits.
