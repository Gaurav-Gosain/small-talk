# Making a robot DJ actually groove: a deep dive into the beat-bopping algorithm

On Reachy FM, the radio station inside Small Talk, a small robot named DJ Servo spins records and bops to the music. This is a full account of how the bop works, from the raw audio samples up to the final joint angles, with the real formulas and the reasoning behind each choice.

The bop is two problems that are easy to run together. One is **beat tracking**: turning a stream of audio samples into a reliable, continuously-running sense of where the beat is. That is signal processing and a little control theory. The other is **choreography**: given that the robot knows where the beat is, deciding what its head, body, and antennas should do. That is procedural animation. The two halves talk to each other through a single number, and keeping them cleanly separated is most of what makes the result work.

Two constraints shape everything. It has to run live in a browser at frame rate, with no offline analysis of the song, because the point is to react to whatever is playing. And the robot has limited degrees of freedom: a six-axis head (three translation, three rotation, driven by a Stewart platform on the real Reachy Mini), one body-yaw joint, and two antennas. Everything below is written against those limits.

## A building block: the exponential smoother

One primitive appears throughout, so it is worth deriving once. To make a value `x` follow a moving `target` without jumps, the code repeatedly runs

```
x += (target - x) * (1 - exp(-dt / tau))
```

This is not an arbitrary lerp. It is the exact solution, over a timestep `dt`, of the continuous first-order relaxation

```
dx/dt = (target - x) / tau
```

Integrating that over one step with `target` held constant gives `x(t+dt) = target + (x(t) - target) * exp(-dt/tau)`, which rearranges into the line above. The constant `tau` is a time constant in seconds: the distance to the target decays by a factor of `1/e` (about 37 percent) every `tau` seconds, independent of frame rate. Because `dt` lives inside the exponential, a 30 Hz machine and a 144 Hz machine produce the same trajectory. This single expression, with different `tau`, is the tempo follower, the loudness follower, the move-blend curve, and the intensity envelope. A common variant uses an asymmetric `tau` (one value when rising, another when falling) to get fast attack and slow release.

## Part one: beat tracking

### Samples to spectrum

The audio coming out of the player is just amplitude sampled tens of thousands of times a second. A beat is not visible in that signal directly; you need its frequency content. The Web Audio API provides this through an `AnalyserNode`, which runs a windowed Fast Fourier Transform on a sliding buffer. We configure it with

```
analyser.fftSize = 256;
analyser.smoothingTimeConstant = 0.5;
```

`fftSize = 256` yields 128 magnitude bins spanning DC to the Nyquist frequency (around 22 to 24 kHz depending on the device sample rate), so each bin is roughly 180 Hz wide. That is coarse in frequency but fine in time, which is the right trade for rhythm: we care about *when* energy arrives, not its exact pitch. `smoothingTimeConstant` is an exponential average the analyser applies across FFT frames; 0.5 is a compromise that keeps the kick transients sharp enough for onset detection while leaving the visualizer readable. `getByteFrequencyData` returns each bin as a 0 to 255 byte already converted to a decibel scale and clipped, which conveniently compresses the large dynamic range of music into a bounded value.

### The bass band

The kick drum and bass notes carry the beat, and they sit in the lowest bins. We sum bins 1 through 4 (skipping bin 0, which holds DC offset and inaudible sub-rumble) and normalise:

```
bass = (bins[1] + bins[2] + bins[3] + bins[4]) / 4 / 255   // ~180 to 900 Hz, in [0,1]
```

Restricting to this band is what makes the detector robust. A snare, a vocal, or a hi-hat barely registers here, so the signal we threshold against is dominated by the part of the mix that actually marks the pulse. A separate broadband loudness, the mean of 56 bins sampled across the whole spectrum, is computed alongside and feeds the dance intensity later.

### Onset detection as an adaptive comparator

A beat is a sudden rise in bass relative to the recent norm, not an absolute loudness. So we maintain a fast-moving average of the bass and flag frames where the instantaneous value spikes above it:

```
kickAvg += (bass - kickAvg) * min(1, dt/200)     // dt in ms; ~200 ms of memory
onset =  bass > kickAvg * 1.3 + 0.04             // 30% over the local average, plus a small offset
      && bass > 0.16                             // absolute floor: stay dead during quiet parts
      && (now - lastBeat) > 215                  // refractory period (ms)
```

Three terms, each doing one job. The **relative threshold** `kickAvg * 1.3` makes the detector self-calibrating: in a loud chorus the average rises and so does the bar to clear, in a sparse verse it falls, so the same code finds beats at any mix level. The **absolute offset `+ 0.04` and floor `> 0.16`** stop noise around a near-zero average from tripping it during silence. The **refractory period** of 215 milliseconds is borrowed from how a neuron will not fire twice in quick succession: it caps detectable tempo near 280 beats per minute and prevents the leading and trailing edge of one kick from counting as two beats. This is the cheap cousin of spectral flux (which sums positive change across all bins); single-band energy flux is enough here because the music has a clear low-end pulse, and it costs four additions per frame.

### Why detected hits are not the output

It is tempting to nod the head on each detected onset. It looks bad, for two reasons. Detection is imperfect, so the head stutters on missed and doubled beats. And reacting is always late by a frame or two, whereas a real dancer feels the tempo and moves into the beat rather than after it. The hits are too noisy and too reactive to drive motion directly. So they drive a clock instead.

### The beat clock

The central state is one number, the **beat clock**, which counts beats as a continuous, fractional quantity. The integer part is the beat index; the fractional part is the phase within the current beat, where 0 is exactly on the beat and 0.5 is halfway to the next. Representing rhythm as a phase, rather than as a queue of timestamps, is what lets every downstream move be a clean periodic function.

Two forces act on the clock. First, it advances on its own every frame at the current tempo estimate:

```
beatClock += (dt/1000) / beatInterval            // beatInterval is seconds per beat
```

This free run is the important part: the clock keeps counting smoothly through a breakdown, a missed kick, or a beat the detector simply did not see, so the robot stays in time when the signal gets thin.

Second, each detected onset corrects it, in two ways.

### Tempo estimation

When an onset fires, the gap since the previous one is a candidate beat period. We blend it into the running estimate with a fixed-gain exponential average, guarded to a musical range:

```
iv = (now - lastBeat) / 1000                      // seconds since the last kick
if (0.3 < iv < 0.9)                               // 66 to 200 BPM only
    beatInterval = 0.7 * beatInterval + 0.3 * iv
```

The `[0.3, 0.9]` guard rejects the two classic failure modes: a doubled detection (a spurious onset half a beat early gives an implausibly short interval) and a skipped beat (an interval near two beats). Anything outside the window is ignored for tempo, while the clock keeps free-running at the last good estimate, so a few bad detections cost nothing. The 0.3 blend gain trades convergence speed against jitter: high enough to lock onto a new tempo within a couple of bars, low enough that one noisy interval does not visibly lurch the speed.

### The phase-locked loop

The second correction pulls the clock's phase onto the beat. A detected kick is, by assumption, a beat, so the clock should read a whole number at that instant. We nudge it toward the nearest integer:

```
beatClock += (round(beatClock) - beatClock) * 0.5
```

The quantity `round(beatClock) - beatClock` is the phase error: how far the clock's current phase is from a beat, in beats, in the range `[-0.5, 0.5]`. Multiplying by a gain and adding it back is a proportional correction. A free-running oscillator that is proportionally corrected by detected reference events is a **phase-locked loop**, the same structure a radio receiver uses to lock onto a carrier and a clock-recovery circuit uses to lock onto a data stream.

The loop gain of 0.5 is the design knob. With gain 1 the clock would hard-snap to each detected onset, inheriting all of the detector's timing jitter. With a small gain it would track sluggishly and lag tempo changes. At 0.5 each onset removes half the phase error, so a single mistimed detection moves the phase only halfway toward a wrong position and the next good beat pulls it back, while a run of consistent beats drives the error geometrically to zero and locks firmly. The combination of a free-running phase accumulator (which gives smoothness and gap-filling) with a low-gain phase corrector (which gives accuracy without jitter) is exactly why this beats either reacting to raw hits or hard-snapping to them. On a steady test track the loop converges to the exact beats per minute and keeps the head's dip on the kick to within a fraction of a frame.

The whole of part one produces just that clock. Everything the robot does is a function of it.

## Part two: choreography

The first working version simply bobbed the head, and the feedback was that it only swayed left and right forever. Variety has to be built in. The second half is a small choreographer over a library of moves, all driven by the clock.

### Phase shapes

Moves are assembled from two functions of the beat phase `p = clock mod 1` in `[0, 1)`.

```
beatHit(p) = max( exp(-8p), exp(-8(1-p)) )       // a sharp on-beat pulse
bobWave(p) = 0.5 * (1 + cos(2*pi*p))             // a smooth on-beat swell
```

`beatHit` is the percussive one. It equals 1 at `p = 0` and `p = 1` (the beat is at both ends, since phase wraps), decays to about `exp(-1) = 0.37` within one eighth of a beat, and bottoms out near `exp(-4) = 0.018` at the midpoint. The exponential gives a snap that a sine cannot; the decay constant 8 sets how sharp. `bobWave` is the gentle alternative, a raised cosine that is high on the beat and smoothly low between, used where a flowing bob is wanted rather than a hit.

### The move library

Each move is a pure function of the clock returning normalised pose offsets in roughly `[-1, 1]`. Positive pitch is a downward nod; the keys are pitch, yaw, roll (head rotation), x, y, z (head translation, with positive y up), body (body yaw), and antenna terms. The eight moves:

```
bob(c):      pitch = beatHit(c)                  // head snaps down on the beat
             y     = -0.5 * beatHit(c)           // and dips down with it
             roll  = 0.18 * sin(pi*c)            // slow lean over two beats

sway(c):     s = sin(pi*c)                        // one full left-right cycle per 2 beats
             body  = s,  roll = -0.55*s,  x = 0.6*s,  yaw = 0.22*s,
             pitch = 0.32 * beatHit(c)

circle(c):   a = pi*c                             // one head circle per 2 beats
             roll  = 0.9 * sin(a)
             pitch = 0.45 * (1 - cos(a))          // 90 deg out of phase with roll -> ellipse
             yaw   = 0.35 * sin(a)

bounce(c):   pitch = 0.25 * beatHit(c)
             y     = 0.9 * beatHit(c)             // whole head pops UP on the beat
             body  = 0.3 * sin(pi*c)

robot(c):    n = floor(c) mod 4                   // hold a pose per beat, 4-pose cycle
             yaw   = [1,-1,0.5,-0.5][n]
             roll  = [-1,1,1,-1][n]
             pitch = [0.6,0.2,0.85,0.2][n]

weave(c):    a = pi*c
             yaw   = sin(a)
             roll  = 0.4 * sin(2a)                // figure-eight: roll at twice the yaw rate
             x     = 0.5 * sin(a)

lean(c):     l = sin(pi*c)
             z     = 0.9 * l                      // rock forward and back over 2 beats
             pitch = 0.5*l + 0.3*beatHit(c)

antenna(c):  antA  = sin(2*pi*(c mod 1))          // antennas flick left/right on the beat
             roll  = 0.32 * sin(pi*c)
             pitch = 0.2 * beatHit(c)
```

Because every channel is a function of `c`, every move is automatically locked to the tempo and phase the tracker found. `bob` dips when the phase is zero; `circle` closes its loop every two beats; `robot` changes pose only on integer beats; `weave` traces a figure eight because its roll oscillates at twice the yaw frequency, the standard Lissajous construction. None of them carry an internal clock, which is the whole difference from the recorded animations that failed. The eight are split into a calm pool (sway, circle, lean, antenna) and an energetic pool (bob, bounce, robot, weave).

### Quantised switching and crossfades

Music groups beats into bars of four, and a natural dance changes on those boundaries, not mid-phrase. The choreographer watches `floor(clock/4)` and only considers a switch when it changes. How often it switches depends on energy:

```
switchBars = amp > 0.55 ? 2 : amp > 0.3 ? 3 : 4
```

so a loud section reshuffles every two bars and a calm one every four. The incoming move is drawn from the pool matching the current loudness, with an immediate repeat rejected.

A switch is a crossfade, never a cut. A blend parameter advances `blendT += dt / 0.35` over the transition (about a third of a second), and the outgoing and incoming moves are interpolated through a smoothstep, the cubic Hermite ease:

```
smoothstep(t) = t*t*(3 - 2t)
out = lerp( moveOld(c), moveNew(c), smoothstep(blendT) )
```

The point of smoothstep over a linear blend is its derivative: `6t(1-t)` is zero at both `t = 0` and `t = 1`, so velocity is continuous across the handoff and there is no kink where one move ends and the next begins. The robot flows from one move into the next.

### Fills

Every eight bars, during energetic sections, a one-bar fill is layered on as phrase-ending punctuation: a quick body spin (a half-sine yaw sweep across the bar), a double-time burst where the head bobs at `beatHit((2c) mod 1)`, or a deep dramatic dip. The fill is blended in at 0.7 weight for its one bar, then released back to the running move.

### Intensity and the output chain

A single intensity scalar drives both motion size and move choice. It is the broadband loudness mapped up and clamped,

```
intensity = clamp((level - 0.05) * 2.6, 0, 1)
```

then smoothed with an asymmetric envelope so the robot leaps into a drop and eases out of it:

```
amp += (intensity - amp) * (1 - exp(-dt / (intensity > amp ? 0.12 : 0.4)))   // 120 ms up, 400 ms down
```

The sampled, blended, fill-augmented move offsets are then scaled by `0.32 + 0.68 * amp` (a floor of 0.32 keeps a playing song from ever freezing) and by per-channel amplitudes: head rotations up to 14 to 16 degrees, translations up to 7 to 10 millimetres, body yaw up to 14 degrees. Two safety steps finish it. Each channel passes through a final light smoother at `tau = 0.045 s`, which turns the `robot` move's stepped poses into clean snaps instead of single-frame teleports and removes any residual seam from a blend. And the head yaw and body yaw are clamped (to about plus or minus 18 and 20 degrees) so the face never turns away from the camera, even mid-spin.

These offsets are added onto the head's base idle pose and applied to the head link in world axes (pitch about the side axis is a nod, yaw about the vertical is a turn, roll about the forward axis is a tilt), with the translations applied in the head frame.

## The finishing touch: antennas on a spring

One detail, taken from how VTuber rigs animate hair and ears, gives the whole thing weight. Rather than driving each antenna straight to its commanded angle, the antenna is treated as the mass in a damped spring being pulled toward that angle. The continuous model is a unit-mass damped harmonic oscillator,

```
x'' = -k (x - target) - c x'
```

with stiffness `k` and damping `c`. It is integrated with semi-implicit (symplectic) Euler, updating velocity from the current position and then position from the new velocity:

```
vel += ( (target - pos) * k - vel * c ) * dt     // k = 280, c = 13
pos += vel * dt
```

The constants set the feel through two derived quantities. The undamped natural frequency is

```
omega = sqrt(k) = sqrt(280) ~= 16.7 rad/s ~= 2.66 Hz
```

and the damping ratio, from the characteristic equation `s^2 + c s + k = 0` whose roots are `s = -c/2 +/- sqrt((c/2)^2 - k)`, is

```
zeta = c / (2 sqrt(k)) = 13 / (2 sqrt(280)) ~= 0.39
```

Since `zeta < 1` the system is underdamped: the roots are complex, the antenna overshoots its target and rings down. The standard second-order results then predict a peak overshoot of `exp(-zeta*pi / sqrt(1 - zeta^2)) ~= 0.27` and a 2 percent settling time of about `4 / (zeta*omega) ~= 0.6 s`. A direct step-response simulation agrees: about 25 percent overshoot, settled in roughly 0.57 seconds. So when the head snaps down on a beat, the antennas whip a moment later and bounce, the way real ears or hair would; a spring is three lines of code and adds a disproportionate amount of life.

Two stability notes. Semi-implicit Euler is used rather than explicit Euler because the explicit scheme is unconditionally unstable for an undamped oscillator and only marginally stable with light damping, whereas the symplectic form preserves a discrete energy and stays bounded. It is stable here as long as the step is well under `2/omega ~= 0.12 s`, which holds even at 30 frames per second; the render loop also clamps `dt` to a ceiling so a stalled tab cannot feed the integrator a huge step and launch the antennas.

## One frame, end to end

Per frame the pipeline runs: the FFT updates the bass-band energy and the broadband loudness; the onset detector and phase-locked loop advance the beat clock and refine the tempo estimate; the choreographer reads the clock, selects the active move (only switching on bar lines, crossfading through a smoothstep when it does), evaluates that move as a function of the clock, layers in a fill if the phrase calls for one, and scales the whole pose by the asymmetric intensity envelope; the head and body offsets are clamped and applied, and the antenna commands pass through their springs before reaching the joints. The same beat clock is also exposed to the page as a single CSS variable that pulses the spotlight behind the DJ, the equalizer next to his name, and the visualizer ring around the turntable, so the entire screen breathes on the beat the head nods to.

Nothing in here is choreographed by hand and nothing is recorded. It is all derived live from the sound coming out of the speaker, which is the only way it could ever truly be in time with the music. That single rule, that synced motion must be generated from the audio rather than retrieved from a library, is the design decision the rest follows from.
