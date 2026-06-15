# Making a robot DJ actually groove: the beat-bopping algorithm

On Reachy FM, the radio station inside Small Talk, a small robot named DJ Servo spins records and bops along to the music. Getting that bop to look right turned out to be two separate problems that are easy to confuse: knowing where the beat is, and deciding what to do on it. The first is a signal-processing problem. The second is a choreography problem. This is how both are solved, and why the obvious approaches do not work.

## The version that did not work

The first attempt had Servo pick random dance moves from a library of recorded animations and play them on a loop. It looked exactly as bad as it sounds. The moves had their own internal rhythm baked in when they were recorded, and that rhythm had nothing to do with the song playing. The robot would do a little shimmy, pause, do a head roll, all on its own schedule, while the music did something completely different underneath. It was a robot dancing near music, not to it.

The lesson: anything that looks synced has to be generated from the audio in real time, not pulled from a library. So everything below is computed live from the sound as it plays.

## Part one: where is the beat?

To bop on the beat, the robot first has to find the beat. The raw material is the audio itself, but raw audio is just a stream of numbers (the speaker position thousands of times a second), and you cannot see a beat in that directly. You need to know how much energy is in the low frequencies, because that is where the kick drum lives, and the kick drum is usually the beat.

The tool for that is a Fast Fourier Transform, which takes a slice of sound and tells you how much of it is bass, how much is midrange, how much is treble. The browser provides this through the Web Audio API. We take the lowest few frequency bands (roughly the bottom 700 Hz, where kicks and bass notes sit) and add them up into a single number: how much low-end energy is happening right now.

### Detecting a hit

A beat is not just "loud bass." It is a sudden spike of bass against the recent average. So we keep a running average of the low-end energy and watch for the moment the instantaneous energy jumps well above it. Concretely: the current bass has to exceed the running average by about thirty percent, clear a minimum floor (so quiet passages do not produce phantom beats), and it has to have been at least 215 milliseconds since the last detected beat (which caps the tempo at a sane ceiling and prevents a single kick from registering twice).

That gives us beat hits. But beat hits alone are not enough, and this is the part most naive implementations get wrong.

### Why reacting to each hit looks bad

If you simply nod the head every time you detect a kick, two things go wrong. The detection is never perfect, so it misses some beats and double-counts others, and the head stutters. And the head only ever reacts, always a moment late, never anticipating. A real dancer is not surprised by each beat. They feel the tempo and move into the beat.

So instead of reacting to individual hits, we use the hits to drive a clock.

### A clock that learns the tempo

The core of the system is a single number called the beat clock. It counts beats, but as a continuous, fractional value: 4.0 is the downbeat of a bar, 4.5 is halfway to the next beat, 5.0 is the next beat. The whole-number part is which beat we are on, and the fractional part is the phase, how far through the current beat we are.

Two things move this clock:

1. **It advances on its own, every frame.** We keep an estimate of how long one beat lasts (the tempo), and each frame we add a small slice to the clock based on how much time passed. This means the clock keeps counting beats smoothly even through a section where the kick drops out or the detector misses a few. The robot stays in time during a breakdown instead of freezing.

2. **Detected hits correct it.** When we detect a kick, we do two things. We measure the time since the previous kick and, if it is in a plausible range (between about 66 and 200 beats per minute), we blend it into our tempo estimate, so the clock gradually learns the actual speed of the song. And we gently nudge the clock toward the nearest whole beat, on the assumption that a detected kick is a beat and should sit at a whole number. The nudge is soft (it moves halfway, not all the way) so a slightly mistimed detection does not yank the clock and cause a visible jump.

This arrangement, a free-running oscillator that gets gently pulled into line by detected events, is a phase-locked loop. It is the same idea radios use to lock onto a station. Here it locks the robot's internal sense of rhythm onto the song's. On a steady test track it learns the tempo to the exact beat per minute and keeps the head's dip landing on the kick to within a fraction of a frame.

So the output of part one is just that clock: a number that smoothly counts the beats of whatever is playing, staying locked even when the audio gets messy. Everything the robot does is a function of it.

## Part two: what to do on the beat

Now the robot knows where the beat is. The temptation is to bob the head and call it done. That is what the very first working version did, and the feedback was immediate and fair: it was just swaying left and right, the same motion forever. A real dance has variety. It changes. So the second half of the system is a small choreographer.

### A library of moves

There is a set of distinct dance moves, each written as a short mathematical function of the beat clock:

- **Bob**: the head snaps down on the beat and springs back, the classic head nod.
- **Sway**: a two-step weight shift, the body turning side to side over two beats with the head leaning into it.
- **Head circle**: the head traces a slow circle, one loop every two beats, like vibing with eyes half closed.
- **Bounce**: the whole head pops upward on every beat.
- **Robot**: staccato. The head snaps to a held angular pose on each beat and freezes there until the next, the classic robot dance.
- **Weave**: the head draws a horizontal figure-eight.
- **Lean**: the head rocks forward and back, leaning into the rhythm.
- **Antenna feature**: the head holds a gentle groove while the antennas do the talking, flicking left and right.

Each move is a pure function of the clock, so each one is automatically locked to the beat. The bob dips exactly when the phase hits zero. The sway completes its left-right cycle every two beats. None of them have a built-in rhythm of their own, the way the recorded animations did. Their rhythm is the song's rhythm, always.

### Switching moves without it looking like a glitch

A dance is a sequence of moves, and the natural place to change is at a musical boundary. Music is organized in bars (groups of four beats), and phrases (groups of bars). So the choreographer only ever switches moves on a bar line. It changes more often when the music is energetic (every two bars) and less often when it is calm (every four), which on its own makes loud sections feel busier than quiet ones.

When it switches, it does not cut. It crossfades, blending smoothly from the outgoing move to the incoming one over about a third of a second, so the transition reads as the dancer flowing into a new move rather than teleporting.

Move selection is split into two pools. A calm pool (sway, head circle, lean, antenna) and an energetic pool (bob, bounce, robot, weave). The choreographer picks from the pool that matches the current loudness, so the robot naturally does mellow moves during a quiet intro and hits the bob and the robot during a loud chorus. It also avoids repeating the move it just did.

### Fills

Every eight bars, during energetic sections, the choreographer drops in a one-bar fill: a quick body spin, a double-time burst where the head bobs twice as fast, or a dramatic deep dip. These are the punctuation, the moment a dancer does something extra to mark the end of a phrase. They are layered on top of whatever move is running and then it returns to normal.

### Intensity ties it together

A single value, derived from the overall loudness of the music, scales the size of every move and feeds the move selection. Quiet passages get small, mellow motion. Loud passages get big, energetic motion. There is a floor so the robot never goes completely still while a song is playing, but the difference between a soft verse and a dropping chorus is clearly visible in how hard it is dancing.

## The finishing touch: springy antennas

One detail makes the whole thing feel alive, and it comes from how VTuber rigs animate hair and ears. Instead of driving the antennas straight to their target position, each antenna is run through a spring. It chases the target with a little weight and bounce, trailing slightly behind a fast move and overshooting before it settles. The spring is tuned to be slightly underdamped, which means about a twenty-five percent overshoot that settles in roughly half a second. When the head snaps down on a beat, the antennas whip a beat later and bounce, exactly the way real ears or hair would. It is a small amount of code (a spring is just three lines) and it adds a disproportionate amount of life.

## How the pieces connect

Put together, one frame of the dance looks like this. The audio analysis updates the beat clock and the loudness. The choreographer reads the clock, decides which move is active (switching on bar lines, crossfading when it does), samples that move as a function of the clock, layers in a fill if one is due, and scales everything by loudness. The result is a target pose for the head, body, and antennas. The antennas pass through their springs. The robot renders. The same beat clock also pulses the spotlight, the equalizer, and the visualizer ring around the turntable, so the whole screen breathes on the beat the head is nodding to.

None of it is choreographed by hand and none of it is recorded. It is all computed, live, from the sound coming out of the speaker, which is the only way it could ever actually be in time with the music.
