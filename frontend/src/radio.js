// Reachy FM — the prerecorded radio station. Pure client-side: one <audio>
// element plays DJ Servo's mic breaks and the songs in sequence; WebAudio is
// safe here (local files, not WebRTC tracks) and drives the visualizer ring,
// the karaoke lyrics sync off the SRT-derived timestamps, and a 3D Reachy in
// the booth wears procedural headphones and vibes to the music.
import { ReachyTwin } from './reachy3d.js';

const ACCENT = '#ffd34d';
const $id = (s) => document.getElementById(s);

let st = null; // station state (null = closed)

export async function openRadio() {
  const host = $id('view-radio');
  if (!host || st) return;
  host.innerHTML = `
  <div class="radio">
    <div class="rd-bg" id="rdBg"></div>
    <div class="rd-head">
      <span class="rd-logo">REACHY <b>FM</b><em>88.8 · the small model station</em></span>
      <span class="rd-onair" id="rdOnAir"><i></i><span id="rdOnAirText">OFF AIR</span></span>
    </div>
    <div class="rd-main">
      <div class="rd-deck">
        <div class="rd-platterwrap">
          <canvas class="rd-viz" id="rdViz"></canvas>
          <div class="rd-platter">
            <div class="rd-vinyl" id="rdVinyl">
              <img class="rd-labelart" id="rdLabel" alt="">
              <div class="rd-spindle"></div>
            </div>
            <div class="rd-arm" id="rdArm"><div class="rd-armhead"></div></div>
          </div>
        </div>
        <div class="rd-trackinfo">
          <div class="rd-title" id="rdTitle">…</div>
          <div class="rd-artist">Reachy &amp; the Small Models</div>
          <div class="rd-progress" id="rdSeek"><div class="rd-bar" id="rdBar"></div></div>
          <div class="rd-clock"><span id="rdT0">0:00</span><span id="rdT1">0:00</span></div>
          <div class="rd-controls">
            <button class="rd-btn" id="rdPrev" title="previous">⏮</button>
            <button class="rd-btn rd-play" id="rdPlay" title="play/pause">▶</button>
            <button class="rd-btn" id="rdNextB" title="next">⏭</button>
            <input type="range" id="rdVol" min="0" max="1" step="0.01" value="0.9" title="volume">
          </div>
        </div>
      </div>
      <div class="rd-stage" id="rdStage">
        <div class="rd-spot"></div>
        <div class="rd-floor"></div>
        <div class="rd-twin" id="rdTwin"></div>
        <div class="rd-boothmeta">
          <b>DJ SERVO <span class="rd-eq" id="rdEq"><i></i><i></i><i></i><i></i></span></b>
          <span class="rd-say" id="rdSay">spinning the small-model classics</span>
          <span class="rd-next" id="rdNext"></span>
        </div>
      </div>
      <div class="rd-lyrics" id="rdLyrics"><div class="rd-lyrollers" id="rdLyRoll"></div></div>
    </div>
    <div class="rd-bottom">
      <div class="rd-tracks" id="rdTracks"></div>
    </div>
    <div class="rd-gate" id="rdGate">
      <button class="btn btn-primary rd-tunein" id="rdTune">📻 TUNE IN</button>
      <span class="rd-gatesub">Reachy FM · 16 tracks · one velvet robot voice</span>
    </div>
  </div>`;

  st = { idx: 0, phase: 'idle', raf: 0, lyrics: [], lyAt: -1, sayTimer: null, disposed: false };
  st.audio = new Audio();
  st.audio.preload = 'auto';

  try {
    // cache-bust: playlist.json ships no Cache-Control, so browsers heuristically
    // cache it and would otherwise serve stale lyrics/timings after an update
    st.playlist = await (await fetch(`/radio/playlist.json?t=${Date.now()}`, { cache: 'no-store' })).json();
  } catch {
    $id('rdTitle').textContent = 'station offline';
    return;
  }
  if (st.disposed) return;

  // the DJ in the booth — headphones go on as soon as the URDF head exists
  try {
    st.twin = new ReachyTwin($id('rdTwin'), { accent: ACCENT });
    const iv = setInterval(() => {
      if (!st || st.disposed) return clearInterval(iv);
      if (st.twin.setHeadphones?.(ACCENT)) clearInterval(iv);
    }, 120);
  } catch {
    st.twin = { setLevel() {}, setDance() {}, dispose() {} };
  }

  st.audio.onended = () => advance();
  st.audio.ontimeupdate = () => onTime();
  st.audio.onplay = () => updatePlayBtn(true);
  st.audio.onpause = () => { updatePlayBtn(false); st.twin?.setDance?.(null); }; // freeze the groove when paused

  $id('rdTune').onclick = () => {
    $id('rdGate').classList.add('hidden');
    ensureGraph();
    startTrack(0, true);
  };
  $id('rdPlay').onclick = () => {
    if (st.phase === 'idle') { $id('rdGate').classList.add('hidden'); ensureGraph(); startTrack(0, true); return; }
    st.audio.paused ? st.audio.play().catch(() => {}) : st.audio.pause();
  };
  $id('rdPrev').onclick = () => startTrack((st.idx - 1 + st.playlist.tracks.length) % st.playlist.tracks.length, true);
  $id('rdNextB').onclick = () => startTrack((st.idx + 1) % st.playlist.tracks.length, true);
  $id('rdVol').oninput = (e) => { st.audio.volume = +e.target.value; };
  $id('rdSeek').onclick = (e) => {
    if (st.phase !== 'song' || !st.audio.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    st.audio.currentTime = ((e.clientX - r.left) / r.width) * st.audio.duration;
  };

  // bottom strip: every record in the crate, click to cue it up
  const strip = $id('rdTracks');
  st.playlist.tracks.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = 'rd-tile';
    b.title = t.title;
    const short = t.title.replace(/\s*\(.*$/, '');
    b.innerHTML = `<img src="${t.art || ''}" alt="" loading="lazy"><span>${short}</span>`;
    b.onclick = () => {
      $id('rdGate')?.classList.add('hidden');
      ensureGraph();
      startTrack(i, true);
    };
    strip.appendChild(b);
  });

  dress(0); // the deck looks ready behind the tune-in gate
  vizLoop();
}

export function closeRadio() {
  if (!st) return;
  st.disposed = true;
  cancelAnimationFrame(st.raf);
  clearTimeout(st.sayTimer);
  try { st.audio.pause(); st.audio.src = ''; } catch {}
  try { st.twin?.dispose?.(); } catch {}
  try { st.ctx?.close(); } catch {}
  const host = $id('view-radio');
  if (host) host.innerHTML = '';
  st = null;
}

// WebAudio tap for the viz + the DJ's lip sync — fine for local files
function ensureGraph() {
  if (st.ctx) { st.ctx.resume?.(); return; }
  try {
    st.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = st.ctx.createMediaElementSource(st.audio);
    st.analyser = st.ctx.createAnalyser();
    st.analyser.fftSize = 256;        // finer bins → cleaner kick/bass for beat sync
    st.analyser.smoothingTimeConstant = 0.6;
    st.bins = new Uint8Array(st.analyser.frequencyBinCount);
    src.connect(st.analyser);
    st.analyser.connect(st.ctx.destination);
  } catch { st.ctx = null; }
}

function track() { return st.playlist.tracks[st.idx]; }

function dress(i) {
  st.idx = i;
  const t = track();
  $id('rdTitle').textContent = t.title;
  $id('rdLabel').src = t.art || '';
  $id('rdBg').style.backgroundImage = t.art ? `url("${t.art}")` : 'none';
  const nxt = st.playlist.tracks[(i + 1) % st.playlist.tracks.length];
  $id('rdNext').textContent = `up next — ${nxt.title}`;
  const strip = $id('rdTracks');
  if (strip) {
    [...strip.children].forEach((c, j) => c.classList.toggle('active', j === i));
    const tile = strip.children[i];
    if (tile) strip.scrollTo({ left: tile.offsetLeft - strip.clientWidth / 2 + tile.clientWidth / 2, behavior: 'smooth' });
  }
  buildLyrics(t.lyrics);
}

function startTrack(i, withRj) {
  dress(i);
  const t = track();
  if (withRj && t.rj?.src) micBreak(t);
  else playSong();
}

function micBreak(t) {
  st.phase = 'rj';
  setOnAir(true);
  setSpin(false);
  st.twin?.setDance?.(null); // talking to the listeners, not dancing
  st.audio.src = t.rj.src;
  st.audio.play().catch(() => {});
  typeSay(t.rj.text);
}

function playSong() {
  const t = track();
  st.phase = 'song';
  setOnAir(false);
  setSpin(true);
  // the dance is driven each frame in vizLoop from the beat clock once playing
  st.lyAt = -1;
  st.audio.src = t.mp3;
  st.audio.play().catch(() => {});
  saySoon('spinning: ' + t.title, 600);
}

function advance() {
  if (!st || st.disposed) return;
  if (st.phase === 'rj') playSong();
  else startTrack((st.idx + 1) % st.playlist.tracks.length, true);
}

function setOnAir(on) {
  $id('rdOnAir')?.classList.toggle('lit', on);
  const t = $id('rdOnAirText');
  if (t) t.textContent = on ? 'ON AIR' : 'NOW PLAYING';
  $id('rdArm')?.classList.toggle('lifted', on);
  $id('rdStage')?.classList.toggle('talking', on);
}
function setSpin(on) { $id('rdVinyl')?.classList.toggle('spinning', on); }
function updatePlayBtn(playing) { const b = $id('rdPlay'); if (b) b.textContent = playing ? '⏸' : '▶'; }

// DJ caption: typewriter for mic breaks, plain swap otherwise
function typeSay(text) {
  clearTimeout(st.sayTimer);
  const el = $id('rdSay');
  if (!el) return;
  let i = 0;
  const tick = () => {
    el.textContent = text.slice(0, ++i);
    if (i < text.length && st && !st.disposed) st.sayTimer = setTimeout(tick, 26);
  };
  tick();
}
function saySoon(text, delay) {
  clearTimeout(st.sayTimer);
  st.sayTimer = setTimeout(() => { const el = $id('rdSay'); if (el) el.textContent = text; }, delay);
}

// ---- karaoke lyrics --------------------------------------------------------
function buildLyrics(lines) {
  st.lyrics = lines || [];
  st.lyAt = -1;
  const roll = $id('rdLyRoll');
  if (!roll) return;
  roll.innerHTML = '';
  for (const [, text] of st.lyrics) {
    const d = document.createElement('div');
    d.className = 'rd-line';
    if (/^[\[(].*[\])]$/.test(text)) d.classList.add('stage');
    d.textContent = text;
    roll.appendChild(d);
  }
  roll.style.transform = 'translateY(0)';
}

function onTime() {
  if (!st || st.phase !== 'song') return;
  const t = st.audio.currentTime;
  const d = st.audio.duration || 0;
  const bar = $id('rdBar');
  if (bar && d) bar.style.width = `${(t / d) * 100}%`;
  const f = (s) => `${(s / 60) | 0}:${String((s | 0) % 60).padStart(2, '0')}`;
  const t0 = $id('rdT0'), t1 = $id('rdT1');
  if (t0) t0.textContent = f(t);
  if (t1 && d) t1.textContent = f(d);

  let at = -1;
  for (let i = 0; i < st.lyrics.length && st.lyrics[i][0] <= t + 0.25; i++) at = i;
  if (at === st.lyAt) return;
  st.lyAt = at;
  const roll = $id('rdLyRoll');
  if (!roll) return;
  [...roll.children].forEach((c, i) => {
    c.classList.toggle('active', i === at);
    c.classList.toggle('past', i < at);
  });
  const line = roll.children[at];
  if (line) roll.style.transform = `translateY(${-(line.offsetTop - roll.parentElement.clientHeight * 0.38)}px)`;
}

// ---- visualizer ring + DJ levels ------------------------------------------
function vizLoop() {
  if (!st || st.disposed) return;
  st.raf = requestAnimationFrame(vizLoop);
  const cv = $id('rdViz');
  if (!cv) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = cv.clientWidth, hgt = cv.clientHeight;
  if (!w) return;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = hgt * dpr; }
  const ctx2 = cv.getContext('2d');
  ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2.clearRect(0, 0, w, hgt);
  const now = performance.now();
  const dt = Math.min(60, now - (st.lastFrame || now));
  st.lastFrame = now;

  let level = 0, bass = 0;
  if (st.analyser && !st.audio.paused) {
    st.analyser.getByteFrequencyData(st.bins);
    const bins = st.bins;
    const N = 56;
    const cx = w / 2, cy = hgt / 2;
    const r0 = Math.min(w, hgt) * 0.43;
    const beatPulse = st.beatFlash || 0;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const v = bins[(i * bins.length / N) | 0] / 255;
      sum += v;
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      const len = 3 + v * Math.min(w, hgt) * 0.085 + beatPulse * Math.min(w, hgt) * 0.03;
      ctx2.strokeStyle = `rgba(255, 211, 77, ${0.22 + v * 0.55 + beatPulse * 0.2})`;
      ctx2.lineWidth = 2.4;
      ctx2.beginPath();
      ctx2.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx2.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
      ctx2.stroke();
    }
    level = sum / N;
    // kick/bass band only (first few bins ~0-700Hz at fftSize 256) for the beat
    for (let i = 1; i < 5; i++) bass += bins[i] / 255;
    bass /= 4;
  }

  // ---- beat tracking + procedural dance ----
  // Detect kick onsets, lock a fractional "beat clock" to them with a soft phase
  // correction, and learn the tempo. The clock keeps advancing between detected
  // beats so the groove stays in time, and every dance move is derived from it.
  // No random library dances: the motion is 100% music-synced.
  const playing = st.phase === 'song' && !st.audio.paused;
  if (playing) {
    st.kickAvg = st.kickAvg == null ? bass : st.kickAvg + (bass - st.kickAvg) * Math.min(1, dt / 200);
    const onset = bass > st.kickAvg * 1.3 + 0.04 && bass > 0.16 && now - (st.lastBeat || 0) > 215;
    if (st.beatInterval == null) st.beatInterval = 0.5; // 120 BPM until the tempo is learned
    if (st.beatClock == null) st.beatClock = 0;
    if (onset) {
      const iv = (now - (st.lastBeat || now)) / 1000;
      if (iv > 0.3 && iv < 0.9) st.beatInterval = st.beatInterval * 0.7 + iv * 0.3; // smooth tempo
      st.lastBeat = now;
      st.beatClock += (Math.round(st.beatClock) - st.beatClock) * 0.5; // nudge phase onto the beat
      st.beatFlash = 1;
    }
    st.beatClock += dt / 1000 / st.beatInterval;
    const intensity = Math.min(1, Math.max(0, (level - 0.05) * 2.6));
    st.twin?.setDance?.({ clock: st.beatClock, intensity });
    st.twin?.setLevel?.(0);
  } else {
    st.twin?.setDance?.(null);
    st.twin?.setLevel?.(st.phase === 'rj' ? Math.min(1, level * 2.2) : 0); // mic-break lip sync
  }
  st.beatFlash = (st.beatFlash || 0) * Math.pow(0.0008, dt / 1000); // decays ~85ms

  // expose a beat pulse to CSS for the spotlight + eq (the on-beat snap)
  const bp = (((st.beatClock || 0) % 1) + 1) % 1;
  const bobNow = playing ? Math.max(Math.exp(-bp * 8), Math.exp(-(1 - bp) * 8)) * Math.min(1, level * 2.6) : 0;
  const root = document.querySelector('.radio');
  if (root) root.style.setProperty('--beat', (st.phase === 'rj' ? level * 1.4 : Math.max(bobNow, st.beatFlash || 0)).toFixed(3));
}
