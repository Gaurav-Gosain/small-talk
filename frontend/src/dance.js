// Expressive motion for the Reachy twins, returned as pose offsets in twin units
// (radians / metres) that the renderer adds onto the base pose.
//
//  - danceStep:  a procedural, beat-locked CHOREOGRAPHY for the radio DJ. A small
//                library of distinct moves that switch on musical bar boundaries
//                (with crossfades) plus occasional fills, all locked to a beat
//                clock so the robot actually grooves instead of swaying forever.
//  - talkStep:   speech-driven "talking" motion. Syllable onsets in the audio
//                envelope become emphasis nods, pauses settle the head, and each
//                phrase picks a fresh gesture pose, so it reads as talking rather
//                than vibrating with the volume. Shared by the DJ mic breaks and
//                the live-show twins (and ported to the Go companion).

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (x) => x * x * (3 - 2 * x);

// beat-shape helpers (phase 0..1, 0 = on the beat)
const beatHit = (p) => Math.max(Math.exp(-p * 8), Math.exp(-(1 - p) * 8)); // sharp on-beat pulse

// ---- dance move library ---------------------------------------------------
// Each returns NORMALISED offsets (~ -1..1); amplitudes are applied in danceStep.
// keys: pitch(+down) yaw roll x(+side) y(+up) z(+fore) body ant(+perk) antA(L+/R-)
const mBob = (c) => { const h = beatHit(c % 1); return { pitch: h, y: -0.5 * h, ant: h, roll: 0.18 * Math.sin(Math.PI * c) }; };
const mSway = (c) => { const s = Math.sin(Math.PI * c); return { body: s, roll: -0.55 * s, x: 0.6 * s, yaw: 0.22 * s, pitch: 0.32 * beatHit(c % 1), antA: 0.45 * s }; };
const mCircle = (c) => { const a = TAU * (c / 2); return { roll: 0.9 * Math.sin(a), pitch: 0.45 * (1 - Math.cos(a)), yaw: 0.35 * Math.sin(a), ant: 0.25 }; };
const mBounce = (c) => { const h = beatHit(c % 1); return { y: 0.9 * h, pitch: 0.22 * h, ant: h, body: 0.3 * Math.sin(Math.PI * c) }; };
const mRobot = (c) => { const n = Math.floor(c) % 4; return { yaw: [1, -1, 0.5, -0.5][n], roll: [-1, 1, 1, -1][n], pitch: [0.6, 0.2, 0.85, 0.2][n], ant: (n % 2) ? 1 : 0.2 }; };
const mWeave = (c) => { const a = TAU * (c / 2); return { yaw: Math.sin(a), roll: 0.4 * Math.sin(2 * a), x: 0.5 * Math.sin(a), pitch: 0.3 * beatHit(c % 1) }; };
const mLean = (c) => { const l = Math.sin(Math.PI * c); return { z: 0.9 * l, pitch: 0.5 * l + 0.3 * beatHit(c % 1), y: -0.22 * Math.abs(l) }; };
const mAntenna = (c) => { const b = c % 1; return { antA: Math.sin(TAU * b), ant: 0.5 * beatHit(b), roll: 0.32 * Math.sin(Math.PI * c), pitch: 0.2 * beatHit(b) }; };

// fills (one bar), bar = the integer bar the fill started on
const fSpin = (c, bar) => { const x = (c - bar * 4) / 4; return { body: Math.sin(Math.PI * x) * 1.5, yaw: -0.4 * Math.sin(Math.PI * x), pitch: 0.4, ant: 0.6 }; };
const fDouble = (c) => { const h = beatHit((c * 2) % 1); return { pitch: h, y: -0.5 * h, ant: h }; };
const fDrop = (c, bar) => { const x = (c - bar * 4) / 4; const d = Math.sin(Math.PI * Math.min(1, x * 1.15)); return { pitch: 1.15 * d, y: -0.9 * d, z: 0.3 * d, ant: 0.5 * d }; };

const CHILL = [mSway, mCircle, mLean, mAntenna];
const HYPE = [mBob, mBounce, mRobot, mWeave, mSway];
const FILLS = [fSpin, fDouble, fDrop];

// amplitudes (twin units: rad / m)
const AMP = {
  pitch: 15 * D2R, yaw: 16 * D2R, roll: 14 * D2R,
  x: 0.007, y: 0.010, z: 0.008, body: 14 * D2R,
  ant: 16 * D2R, antA: 14 * D2R,
};
const KEYS = Object.keys(AMP);

export function makeDanceState() {
  return { move: mBob, next: null, blendT: 1, lastBar: -1, fill: null, fillBar: -1, amp: 0,
           cur: Object.fromEntries(KEYS.map((k) => [k, 0])) };
}

export function danceStep(s, dt, clock, intensity) {
  s.amp += (clamp(intensity, 0, 1) - s.amp) * (1 - Math.exp(-dt / (intensity > s.amp ? 0.12 : 0.4)));
  const bar = Math.floor(clock / 4);
  if (bar !== s.lastBar) {
    s.lastBar = bar;
    const switchBars = s.amp > 0.55 ? 2 : s.amp > 0.3 ? 3 : 4;
    if (bar > 0 && bar % switchBars === 0) {
      const pool = s.amp > 0.45 ? HYPE : CHILL;
      let nm = pool[(Math.random() * pool.length) | 0];
      if (nm === s.move) nm = pool[(pool.indexOf(nm) + 1) % pool.length];
      s.next = nm; s.blendT = 0;
    }
    if (bar > 0 && bar % 8 === 0 && s.amp > 0.4) { s.fill = FILLS[(Math.random() * FILLS.length) | 0]; s.fillBar = bar; }
  }
  if (s.next) {
    s.blendT = Math.min(1, s.blendT + dt / 0.35);
    if (s.blendT >= 1) { s.move = s.next; s.next = null; }
  }

  const a = s.move(clock);
  const out = {};
  for (const k of KEYS) out[k] = a[k] || 0;
  if (s.next) { const bn = s.next(clock); const t = smooth01(s.blendT); for (const k of KEYS) out[k] = lerp(out[k], bn[k] || 0, t); }
  if (s.fill && clock < (s.fillBar + 1) * 4) { const f = s.fill(clock, s.fillBar); for (const k of KEYS) out[k] = lerp(out[k], f[k] || 0, 0.7); }
  else s.fill = null;

  const amp = 0.32 + 0.68 * s.amp;            // floor so quiet music still grooves
  const sm = 1 - Math.exp(-dt / 0.045);       // light smoothing → robot snaps, no teleports
  for (const k of KEYS) s.cur[k] += ((out[k] * AMP[k] * amp) - s.cur[k]) * sm;

  return {
    pitch: s.cur.pitch, yaw: clamp(s.cur.yaw, -0.32, 0.32), roll: s.cur.roll,
    x: s.cur.x, y: s.cur.y, z: s.cur.z, body: clamp(s.cur.body, -0.36, 0.36),
    antL: -s.cur.ant + s.cur.antA, antR: -s.cur.ant - s.cur.antA,
  };
}

// ---- speech "talking" engine ----------------------------------------------
// Matches the official Reachy conversation app (speech_tapper.py): a sum of
// low-frequency, incommensurate sinusoids per axis with random phases gives a
// smooth organic head wander, scaled by loudness * a VAD gate (fast attack,
// slow release). No onset/syllable detection — that reads as jittery. The slow
// big yaw turn + faster small pitch nod is what looks like a talking head.
const TALK = {
  pitch: [4.5 * D2R, 2.2],   // small fast nods
  yaw: [7.5 * D2R, 0.6],     // big slow side-to-side turns (the dominant motion)
  roll: [2.25 * D2R, 1.3],   // subtle tilt
  x: [0.0045, 0.35], y: [0.00375, 0.45], z: [0.00225, 0.25], // tiny translational drift
};

export function makeTalkState() {
  const R = () => Math.random() * TAU;
  return { t: 0, env: 0, loud: 0, ph: { pitch: R(), yaw: R(), roll: R(), x: R(), y: R(), z: R() } };
}

// rawLevel: 0..1 speech level (broadband loudness / packet energy).
export function talkStep(s, dt, rawLevel) {
  s.t += dt;
  const lv = clamp(rawLevel || 0, 0, 1);
  // VAD gate: rises fast when the voice starts, releases slowly on a pause
  const target = lv > 0.05 ? 1 : 0;
  s.env += (target - s.env) * (1 - Math.exp(-dt / (target > s.env ? 0.05 : 0.28)));
  // responsive loudness so the motion swells on loud words, dips on quiet ones
  s.loud += (lv - s.loud) * (1 - Math.exp(-dt / 0.06));
  const g = clamp(Math.pow(s.loud, 0.7) * 2.3, 0, 1.25) * s.env;
  const o = (k) => TALK[k][0] * g * Math.sin(TAU * TALK[k][1] * s.t + s.ph[k]);
  return {
    pitch: o('pitch'), yaw: o('yaw'), roll: o('roll'),
    x: o('x'), y: o('y'), z: o('z'),
    antL: -5 * D2R * g, antR: -5 * D2R * g, // antennas gently perk while talking
  };
}
