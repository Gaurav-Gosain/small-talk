// "How it works" explainer: a modal with prose, real code, and live canvas
// visualizations of the actual algorithms (beat-tracking PLL, antenna spring,
// talking sway, dance moves, beat-shape curves). Open via openExplainer().

import { ReachyTwin } from './reachy3d.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const D2R = Math.PI / 180;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function highlight(code) {
  return esc(code)
    .replace(/(\/\/[^\n]*)/g, '<span class="c-com">$1</span>')
    .replace(/\b(const|let|if|else|return|function|for|while|new|Math|max|min|exp|sin|cos|sqrt|round|floor|clamp)\b/g, '<span class="c-kw">$1</span>')
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="c-num">$1</span>');
}

// ---- the REAL Reachy, embedded as a live three.js twin --------------------
// Lazily spins up a ReachyTwin when its slot scrolls into view and pauses it
// when it leaves, so many widgets can each show the actual robot without
// keeping a dozen WebGL contexts rendering at once. Returns a small handle the
// widget drives via pose()/dance()/level()/prop()/tint().
function makeTwin(host, opts = {}) {
  const stage = el('div', 'xp-twin');
  host.appendChild(stage);
  let twin = null;
  const state = { props: {}, tint: undefined }; // replayed if the twin is born later
  const io = new IntersectionObserver((es) => {
    const vis = es[0].isIntersecting;
    if (vis && !twin) {
      twin = new ReachyTwin(stage, { interactive: false, ...opts });
      if (state.tint !== undefined) twin.setBodyTint(state.tint);
      for (const [slot, [url, ov]] of Object.entries(state.props)) twin.setProp(slot, url, ov);
    } else if (twin) (vis ? twin.resume() : twin.pause());
  }, { threshold: 0.01 });
  io.observe(stage);
  return {
    el: stage,
    pose: (p) => twin && twin.setPose(p),
    dance: (p) => twin && twin.setDance(p),
    level: (l) => twin && twin.setLevel(l),
    prop: (slot, url, ov) => { state.props[slot] = [url, ov]; if (twin) twin.setProp(slot, url, ov); },
    tint: (c) => { state.tint = c; if (twin) twin.setBodyTint(c); },
    stop: () => { io.disconnect(); if (twin) twin.dispose(); },
  };
}
// a side-by-side stage: a 2D diagram canvas on the left, the live robot on the
// right. Returns { left, right } containers.
function splitStage(host) {
  const row = el('div', 'xp-split');
  const left = el('div', 'xp-split-2d');
  const right = el('div', 'xp-split-3d');
  row.append(left, right); host.appendChild(row);
  return { left, right };
}
// a clean, friendly little robot avatar for list/chip use (no rendered eyes —
// just a calm visor) so the cast cards read as roster tiles, not faces
function drawChip(ctx, cx, cy, r, kind) {
  const col = kind === 'guest' ? '#ffd34d' : kind === 'pad' ? '#7bbf6a' : '#c7ccd6';
  ctx.save();
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, r * 0.12); ctx.lineCap = 'round';
  for (const d of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(cx + d * r * 0.5, cy - r * 0.6); ctx.lineTo(cx + d * r * 0.8, cy - r * 1.15); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx + d * r * 0.8, cy - r * 1.15, r * 0.14, 0, TAU); ctx.fill();
  }
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = kind === 'guest' ? col : g; ctx.globalAlpha = kind === 'host' ? 0.92 : 1;
  rrect(ctx, cx - r, cy - r * 0.85, r * 2, r * 1.85, r * 0.55); ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(18,18,24,0.9)'; rrect(ctx, cx - r * 0.6, cy - r * 0.25, r * 1.2, r * 0.55, r * 0.27); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (const d of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + d * r * 0.26, cy + r * 0.02, r * 0.09, 0, TAU); ctx.fill(); }
  ctx.restore();
}
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// canvas with devicePixelRatio handling; returns {ctx, w, h, stop}
function makeCanvas(host, draw) {
  const cv = el('canvas', 'xp-canvas');
  host.appendChild(cv);
  let raf = 0, alive = true, last = performance.now();
  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    const r = cv.getBoundingClientRect(); // pause when scrolled out of view
    if (r.bottom < -40 || r.top > (window.innerHeight || 800) + 40) { last = now; return; }
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // subtle studio backdrop: a soft gold glow + faint dot grid for depth
    const bg = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.72);
    bg.addColorStop(0, 'rgba(255,211,77,0.05)'); bg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let x = 24; x < w; x += 24) for (let y = 18; y < h; y += 24) ctx.fillRect(x, y, 1, 1);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    draw(ctx, w, h, dt);
  }
  raf = requestAnimationFrame(frame);
  return () => { alive = false; cancelAnimationFrame(raf); };
}
const beatHit = (p) => Math.max(Math.exp(-p * 8), Math.exp(-(1 - p) * 8));

// ---- widgets --------------------------------------------------------------
function wBeat(host) {
  const ctl = el('div', 'xp-controls');
  let mode = 'steady';
  ['steady', 'jitter', 'drop beats'].forEach((m) => {
    const b = el('button', 'xp-btn' + (m === 'steady' ? ' on' : ''), m);
    b.onclick = () => { mode = m; [...ctl.children].forEach((c) => c.classList.remove('on')); b.classList.add('on'); };
    ctl.appendChild(b);
  });
  host.appendChild(ctl);
  const { left, right } = splitStage(host);
  const twin = makeTwin(right, { accent: '#ffd34d' });
  // PLL state (the real algorithm) + a simulated kick source
  let clock = 0, beatInterval = 0.52, lastBeat = -1, simT = 0, nextBeat = 0.6, bpm = 120;
  const trueIv = 0.5;        // ground-truth tempo (120 BPM)
  const kicks = [];          // each kick, logged at the clock phase when it landed
  const stopCanvas = makeCanvas(left, (ctx, w, h, dt) => {
    simT += dt;
    // emit a simulated kick at each true beat, with jitter / drops per mode
    if (simT >= nextBeat) {
      nextBeat += trueIv;
      const drop = mode === 'drop beats' && Math.random() < 0.45;
      if (!drop) {
        const jit = mode === 'jitter' ? (Math.random() * 2 - 1) * 0.06 : 0; // seconds early/late
        const onsetClock = clock + jit / beatInterval;  // clock phase at the (jittered) kick
        const off = ((onsetClock % 1) + 1) % 1;          // 0 = on the beat
        kicks.push({ off: off > 0.5 ? off - 1 : off, life: 1 });
        // ---- the real PLL correction ----
        const onsetT = simT + jit;
        const iv = lastBeat < 0 ? trueIv : (onsetT - lastBeat);
        if (iv > 0.3 && iv < 0.9) beatInterval = beatInterval * 0.7 + iv * 0.3;
        lastBeat = onsetT;
        clock += (Math.round(onsetClock) - clock) * 0.5;
        bpm = 60 / beatInterval;
      }
    }
    clock += dt / beatInterval;
    for (let i = kicks.length - 1; i >= 0; i--) { kicks[i].life -= dt * 0.9; if (kicks[i].life <= 0) kicks.splice(i, 1); }
    const phase = ((clock % 1) + 1) % 1;
    // drive the REAL robot: a beat-locked dance on our PLL clock. The kicks may
    // scatter or drop, but the clock — and so the groove — stays smooth.
    twin.dance({ clock, intensity: 0.95 });

    // phase dial: the clock hand sweeps smoothly; each kick leaves a fading dot
    // at the angle the clock pointed when it arrived (on the beat = straight up)
    const cx = w * 0.5, cy = h * 0.47, r = Math.min(w * 0.34, h * 0.36);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(cx, cy - r, 3, 0, TAU); ctx.fill();
    for (const k of kicks) {
      const ang = k.off * TAU - Math.PI / 2;
      ctx.fillStyle = `rgba(255,95,107,${k.life})`;
      ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, 5 + 4 * k.life, 0, TAU); ctx.fill();
    }
    const a = phase * TAU - Math.PI / 2;
    ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r * 0.84, cy + Math.sin(a) * r * 0.84); ctx.stroke();
    ctx.font = '11px ui-monospace,monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(245,241,232,0.55)';
    ctx.fillText(`${bpm.toFixed(0)} BPM`, cx, cy + r + 24);
    ctx.fillStyle = 'rgba(255,95,107,0.85)'; ctx.fillText('kick', cx - r - 4, cy - r + 2);
    ctx.fillStyle = '#ffd34d'; ctx.fillText('clock', cx + r + 8, cy - r + 2);
  });
  return () => { stopCanvas(); twin.stop(); };
}

function wSpring(host) {
  const ctl = el('div', 'xp-controls');
  let stiff = 280, damp = 13;
  const mk = (label, min, max, val, fn) => {
    const wrap = el('label', 'xp-slider', `<span>${label}</span>`);
    const inp = el('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.value = val; inp.step = (max - min) / 100;
    const out = el('span', 'xp-sval', '');
    inp.oninput = () => { fn(+inp.value); out.textContent = read(); };
    wrap.append(inp, out); ctl.appendChild(wrap); return () => (out.textContent = read());
  };
  const read = () => {
    const w0 = Math.sqrt(stiff), z = damp / (2 * w0);
    const os = z < 1 ? Math.exp(-z * Math.PI / Math.sqrt(1 - z * z)) * 100 : 0;
    return `${(w0 / TAU).toFixed(1)}Hz  ζ=${z.toFixed(2)}  overshoot ${os.toFixed(0)}%`;
  };
  const u1 = mk('stiffness', 60, 600, stiff, (v) => stiff = v);
  const u2 = mk('damping', 2, 50, damp, (v) => damp = v);
  host.appendChild(ctl); u1(); u2();
  const tap = el('button', 'xp-btn', 'tap a beat'); host.appendChild(tap);
  const { left, right } = splitStage(host);
  const twin = makeTwin(right, { accent: '#ffd34d' });
  // a JS copy of the spring drives the trace; the real robot runs the same
  // constants on its own antennas so the graph and the bot stay in step
  let posR = 0, velR = 0, target = 0, autoT = 0;
  tap.onclick = () => { target = 1; };
  const trace = [];
  const stopCanvas = makeCanvas(left, (ctx, w, h, dt) => {
    autoT += dt;
    if (autoT > 0.9) { autoT = 0; target = 1; }
    target = Math.max(0, target - dt * 2.2); // the head dips then recovers; antennas chase
    const t = target;
    velR += ((-t - posR) * stiff - velR * damp) * dt; posR += velR * dt;
    // drive the REAL robot: head dips, antennas spring with the slider constants
    twin.pose({ y: -t * 0.012, pitch: t * 0.14, antL: -t * 0.8, antR: -t * 0.8, antStiff: stiff, antDamp: damp });
    // trace: the instant target vs the springy antenna
    const gx = 36, gw = w - 52, gy = h * 0.52, gh = h * 0.72;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + gw, gy); ctx.stroke();
    trace.push({ t: -t, p: posR });
    if (trace.length > 200) trace.shift();
    const plot = (key, color, wid) => {
      ctx.strokeStyle = color; ctx.lineWidth = wid; ctx.beginPath();
      trace.forEach((s, i) => { const x = gx + (i / 200) * gw, y = gy - s[key] * gh * 0.42; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    };
    plot('t', 'rgba(245,241,232,0.32)', 1.5);
    plot('p', '#ffd34d', 2.5);
    ctx.fillStyle = 'rgba(245,241,232,0.5)'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'left';
    ctx.fillText('target', gx + 4, gy - gh * 0.42 + 2);
    ctx.fillStyle = '#ffd34d'; ctx.fillText('antenna (spring)', gx + 4, gy - gh * 0.42 + 16);
  });
  return () => { stopCanvas(); twin.stop(); };
}

function wTalk(host) {
  const ctl = el('div', 'xp-controls');
  let loud = 0.5, speaking = true;
  const wrap = el('label', 'xp-slider', '<span>loudness</span>');
  const inp = el('input'); inp.type = 'range'; inp.min = 0; inp.max = 1; inp.step = 0.01; inp.value = loud;
  inp.oninput = () => loud = +inp.value; wrap.appendChild(inp); ctl.appendChild(wrap);
  const tg = el('button', 'xp-btn on', 'speaking');
  tg.onclick = () => { speaking = !speaking; tg.classList.toggle('on', speaking); tg.textContent = speaking ? 'speaking' : 'paused'; };
  ctl.appendChild(tg); host.appendChild(ctl);
  const { left, right } = splitStage(host);
  const twin = makeTwin(right, { accent: '#ffd34d' });
  let t = 0, env = 0, lo = 0;
  const stopCanvas = makeCanvas(left, (ctx, w, h, dt) => {
    t += dt;
    // drive the REAL robot's talking motion (the same talkStep sum of sinusoids)
    twin.level(speaking ? loud : 0);
    // illustrate the component sinusoids that add up to that motion
    const target = speaking ? 1 : 0;
    env += (target - env) * (1 - Math.exp(-dt / (target > env ? 0.05 : 0.28)));
    lo += ((speaking ? loud : 0) - lo) * (1 - Math.exp(-dt / 0.06));
    const g = clamp(Math.pow(lo, 0.7) * 2.3, 0, 1.25) * env;
    const gx = 30, gw = w - 46, gy = h * 0.5, gh = h * 0.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + gw, gy); ctx.stroke();
    const drawWave = (freq, amp, color, wid) => {
      ctx.strokeStyle = color; ctx.lineWidth = wid; ctx.beginPath();
      for (let i = 0; i <= 110; i++) {
        const tt = t - (1 - i / 110) * 3.2;
        const y = gy - amp * g * Math.sin(TAU * freq * tt) * gh * 0.5;
        const x = gx + (i / 110) * gw; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    drawWave(2.2, 0.3, 'rgba(124,211,255,0.5)', 1.3); // pitch nod
    drawWave(0.6, 0.5, 'rgba(123,191,106,0.5)', 1.3); // yaw turn
    drawWave(1.3, 0.2, 'rgba(255,107,139,0.5)', 1.3); // roll tilt
    ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2.5; ctx.beginPath();
    for (let i = 0; i <= 110; i++) {
      const tt = t - (1 - i / 110) * 3.2;
      const sum = 0.3 * Math.sin(TAU * 2.2 * tt) + 0.5 * Math.sin(TAU * 0.6 * tt) + 0.2 * Math.sin(TAU * 1.3 * tt);
      const y = gy - sum * g * gh * 0.4; const x = gx + (i / 110) * gw; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(245,241,232,0.5)'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'left';
    ctx.fillText('sum → head motion', gx + 2, gy - gh * 0.5 + 4);
  });
  return () => { stopCanvas(); twin.stop(); };
}

function wMoves(host) {
  const moves = {
    bob: (c) => ({ dy: beatHit(c % 1) * 0.5, roll: 0.18 * Math.sin(Math.PI * c), antL: -beatHit(c % 1), antR: -beatHit(c % 1) }),
    sway: (c) => { const s = Math.sin(Math.PI * c); return { roll: -0.55 * s, dx: 0.6 * s, antL: 0.45 * s, antR: -0.45 * s }; },
    circle: (c) => { const a = Math.PI * c; return { roll: 0.9 * Math.sin(a), dy: -0.45 * (1 - Math.cos(a)), dx: 0.35 * Math.sin(a) }; },
    bounce: (c) => ({ dy: -0.9 * beatHit(c % 1), antL: -beatHit(c % 1), antR: -beatHit(c % 1) }),
    robot: (c) => { const n = Math.floor(c) % 4; return { dx: [1, -1, 0.5, -0.5][n], roll: [-1, 1, 1, -1][n] * 0.5, antL: (n % 2), antR: (n % 2) }; },
    weave: (c) => { const a = Math.PI * c; return { dx: Math.sin(a), roll: 0.4 * Math.sin(2 * a) }; },
  };
  const ctl = el('div', 'xp-controls');
  let cur = 'bob', sm = { dy: 0, dx: 0, roll: 0, antL: 0, antR: 0 };
  Object.keys(moves).forEach((m) => {
    const b = el('button', 'xp-btn' + (m === 'bob' ? ' on' : ''), m);
    b.onclick = () => { cur = m; [...ctl.children].forEach((c) => c.classList.remove('on')); b.classList.add('on'); };
    ctl.appendChild(b);
  });
  host.appendChild(ctl);
  const { left, right } = splitStage(host);
  const twin = makeTwin(right, { accent: '#ffd34d' });
  let clock = 0, flash = 0;
  const stopCanvas = makeCanvas(left, (ctx, w, h, dt) => {
    const prev = clock; clock += dt / 0.5; // 120 BPM
    if (Math.floor(clock) !== Math.floor(prev)) flash = 1;
    flash = Math.max(0, flash - dt * 4);
    const o = moves[cur](clock);
    const k = 1 - Math.exp(-dt / 0.045);
    for (const key of ['dy', 'dx', 'roll', 'antL', 'antR']) sm[key] += ((o[key] || 0) - sm[key]) * k;
    // drive the REAL robot from the selected move formula
    twin.pose({
      pitch: sm.dy * 0.32, yaw: sm.dx * 0.5, roll: sm.roll * 0.6,
      y: -sm.dy * 0.012, x: sm.dx * 0.006, antL: sm.antL * 0.5, antR: sm.antR * 0.5,
    });
    // beat dots + the formula name
    for (let i = 0; i < 4; i++) {
      const on = (Math.floor(clock) % 4) === i;
      ctx.fillStyle = on ? `rgba(255,211,77,${0.4 + 0.6 * flash})` : 'rgba(255,255,255,0.15)';
      ctx.beginPath(); ctx.arc(w * 0.5 + (i - 1.5) * 24, h * 0.26, on ? 7 : 4.5, 0, TAU); ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd34d'; ctx.font = '600 22px ui-monospace,monospace';
    ctx.fillText(cur + '(c)', w * 0.5, h * 0.56);
    ctx.fillStyle = 'rgba(245,241,232,0.45)'; ctx.font = '11px ui-monospace,monospace';
    ctx.fillText('a formula of the beat clock', w * 0.5, h * 0.56 + 22);
  });
  return () => { stopCanvas(); twin.stop(); };
}

function wShape(host) {
  let t = 0;
  const fnHit = (p) => Math.max(Math.exp(-p * 8), Math.exp(-(1 - p) * 8));
  const fnBob = (p) => 0.5 * (1 + Math.cos(TAU * p));
  const stop = makeCanvas(host, (ctx, w, h, dt) => {
    t = (t + dt * 0.45) % 1;
    const pad = 34, gw = w - pad * 2, gh = h - pad * 2.1, x0 = pad, y0 = h - pad;
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gx = x0 + gw * i / 4, gy = y0 - gh * i / 4;
      ctx.beginPath(); ctx.moveTo(gx, y0); ctx.lineTo(gx, y0 - gh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x0 + gw, gy); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + gw, y0); ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 - gh); ctx.stroke();
    const area = (fn, c0) => {
      const g = ctx.createLinearGradient(0, y0 - gh, 0, y0);
      g.addColorStop(0, c0); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0, y0);
      for (let i = 0; i <= 120; i++) { const p = i / 120; ctx.lineTo(x0 + p * gw, y0 - fn(p) * gh); }
      ctx.lineTo(x0 + gw, y0); ctx.closePath(); ctx.fill();
    };
    const line = (fn, color, wid) => {
      ctx.strokeStyle = color; ctx.lineWidth = wid; ctx.beginPath();
      for (let i = 0; i <= 120; i++) { const p = i / 120, x = x0 + p * gw, y = y0 - fn(p) * gh; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    };
    area(fnBob, 'rgba(124,211,255,0.15)'); area(fnHit, 'rgba(255,211,77,0.18)');
    line(fnBob, 'rgba(124,211,255,0.85)', 2); line(fnHit, '#ffd34d', 2.5);
    // playhead + glowing dots riding each curve
    const px = x0 + t * gw;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, y0); ctx.lineTo(px, y0 - gh); ctx.stroke();
    const dot = (fn, color) => {
      const y = y0 - fn(t) * gh; ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 10;
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, y, 5, 0, TAU); ctx.fill(); ctx.restore();
    };
    dot(fnBob, 'rgba(124,211,255,0.95)'); dot(fnHit, '#ffd34d');
    ctx.font = '11px ui-monospace,monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = '#ffd34d'; ctx.fillText(`beatHit  ${fnHit(t).toFixed(2)}`, x0 + 8, y0 - gh + 14);
    ctx.fillStyle = 'rgba(124,211,255,0.9)'; ctx.fillText(`bobWave  ${fnBob(t).toFixed(2)}`, x0 + 8, y0 - gh + 30);
    ctx.fillStyle = 'rgba(245,241,232,0.4)'; ctx.textAlign = 'right'; ctx.fillText('phase  p →', x0 + gw, y0 + 17);
  });
  return stop;
}

// ---- pipeline / backend widgets -------------------------------------------
function wPipeline(host) {
  const nodes = [
    ['Topic', 'you ask'],
    ['Nemotron', 'one JSON call'],
    ['Script', 'cast + lines'],
    ['Qwen3-TTS', 'a voice each'],
    ['LiveKit', 'WebRTC'],
    ['Twins', 'three.js + robot'],
  ];
  const dots = [];
  let spawn = 1;
  const stop = makeCanvas(host, (ctx, w, h, dt) => {
    const n = nodes.length, m = 14;
    const slot = (w - 2 * m) / n;
    const bw = Math.min(slot * 0.86, 150), bh = h * 0.32, y = h * 0.46;
    const xs = nodes.map((_, i) => m + slot * (i + 0.5));
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 2;
    for (let i = 0; i < n - 1; i++) { ctx.beginPath(); ctx.moveTo(xs[i] + bw / 2, y); ctx.lineTo(xs[i + 1] - bw / 2, y); ctx.stroke(); }
    spawn += dt; if (spawn > 1.1) { spawn = 0; dots.push({ p: 0 }); }
    const glow = nodes.map(() => 0);
    for (let i = dots.length - 1; i >= 0; i--) {
      dots[i].p += dt * 0.32; if (dots[i].p >= 1) { dots.splice(i, 1); continue; }
      const seg = dots[i].p * (n - 1), idx = Math.floor(seg);
      glow[idx] = Math.max(glow[idx], 1 - (seg - idx));
      if (idx + 1 < n) glow[idx + 1] = Math.max(glow[idx + 1], seg - idx);
    }
    nodes.forEach(([label, sub], i) => {
      const x = xs[i];
      ctx.fillStyle = `rgba(255,211,77,${0.05 + 0.16 * glow[i]})`;
      ctx.strokeStyle = `rgba(255,211,77,${0.28 + 0.6 * glow[i]})`; ctx.lineWidth = 1.5;
      rrect(ctx, x - bw / 2, y - bh / 2, bw, bh, 9); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f5f1e8'; ctx.font = '600 12px ui-monospace,monospace'; ctx.textAlign = 'center';
      ctx.fillText(label, x, y - 1);
      ctx.fillStyle = 'rgba(245,241,232,0.5)'; ctx.font = '9px ui-monospace,monospace';
      ctx.fillText(sub, x, y + 14);
    });
    ctx.save(); ctx.shadowColor = '#ffd34d'; ctx.shadowBlur = 12; ctx.fillStyle = '#ffe9a8';
    for (const d of dots) { const px = xs[0] + d.p * (xs[n - 1] - xs[0]); ctx.beginPath(); ctx.arc(px, y, 4, 0, TAU); ctx.fill(); }
    ctx.restore();
  });
  return stop;
}

function wCast(host) {
  let asked = 3, guests = 1, llmGave = 4, reroll = 0;
  const ctl = el('div', 'xp-controls');
  const mk = (label, min, max, val, fn) => {
    const wrap = el('label', 'xp-slider', `<span>${label}</span>`);
    const inp = el('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = 1; inp.value = val;
    inp.oninput = () => fn(+inp.value); wrap.appendChild(inp); ctl.appendChild(wrap);
  };
  mk('cast size', 2, 5, asked, (v) => asked = v);
  mk('physical guests', 0, 3, guests, (v) => guests = v);
  const rb = el('button', 'xp-btn', 're-roll the LLM');
  rb.onclick = () => { llmGave = 1 + Math.floor(Math.random() * 6); reroll = 1; };
  ctl.appendChild(rb); host.appendChild(ctl);
  const stop = makeCanvas(host, (ctx, w, h, dt) => {
    reroll = Math.max(0, reroll - dt * 2.5);
    const cast = clamp(Math.max(asked, guests), 2, 5);
    const targetSim = Math.max(0, cast - guests);
    const fromLLM = Math.min(llmGave, targetSim);
    const padded = targetSim - fromLLM;
    const trimmed = Math.max(0, llmGave - fromLLM);
    const cards = [];
    for (let i = 0; i < guests; i++) cards.push('guest');
    for (let i = 0; i < fromLLM; i++) cards.push('host');
    for (let i = 0; i < padded; i++) cards.push('pad');
    const n = cards.length || 1;
    const cw = Math.min(96, (w - 40) / n - 12), ch = h * 0.46, y = h * 0.46;
    const totW = n * (cw + 12) - 12, x0 = (w - totW) / 2;
    cards.forEach((t, i) => {
      const x = x0 + i * (cw + 12), pop = i === cards.length - 1 ? 1 + reroll * 0.06 : 1;
      ctx.save(); ctx.translate(x + cw / 2, y); ctx.scale(pop, pop); ctx.translate(-(x + cw / 2), -y);
      ctx.lineWidth = 1.5;
      if (t === 'guest') { ctx.fillStyle = 'rgba(255,211,77,0.16)'; ctx.strokeStyle = '#ffd34d'; }
      else if (t === 'host') { ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.strokeStyle = 'rgba(255,255,255,0.4)'; }
      else { ctx.fillStyle = 'rgba(123,191,106,0.1)'; ctx.strokeStyle = 'rgba(123,191,106,0.7)'; ctx.setLineDash([5, 4]); }
      rrect(ctx, x, y - ch / 2, cw, ch, 10); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      drawChip(ctx, x + cw / 2, y - ch * 0.04, cw * 0.2, t);
      ctx.fillStyle = 'rgba(245,241,232,0.75)'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'center';
      ctx.fillText(t === 'guest' ? 'guest' : t === 'host' ? 'AI host' : '+ filler', x + cw / 2, y + ch / 2 - 9);
      ctx.restore();
    });
    ctx.fillStyle = 'rgba(245,241,232,0.55)'; ctx.font = '11px ui-monospace,monospace'; ctx.textAlign = 'center';
    const verdict = padded > 0 ? `padded +${padded} to fill the cast` : trimmed > 0 ? `trimmed ${trimmed} extra host${trimmed > 1 ? 's' : ''}` : 'exact';
    ctx.fillText(`asked ${cast} · kept ${guests} guest${guests === 1 ? '' : 's'} · LLM returned ${llmGave} host${llmGave === 1 ? '' : 's'} → ${verdict}`, w / 2, h * 0.92);
  });
  return stop;
}

function wCascade(host) {
  let cascade = true;
  const ctl = el('div', 'xp-controls');
  const tg = el('button', 'xp-btn on', 'cascade: ON');
  tg.onclick = () => { cascade = !cascade; tg.classList.toggle('on', cascade); tg.textContent = cascade ? 'cascade: ON' : 'cascade: OFF'; };
  ctl.appendChild(tg); host.appendChild(ctl);
  const N = 4, SYN = 0.8, PLAY = 1.7;
  const colors = ['#ffd34d', '#7cd3ff', '#7bbf6a', '#ff8a93'];
  let t = 0;
  const stop = makeCanvas(host, (ctx, w, h, dt) => {
    t += dt * 0.5;
    // schedule. cascade: synthesis races AHEAD (back-to-back), buffering each
    // line so playback never waits. naive: synth one, play it, synth the next.
    const gen = [], play = [];
    if (cascade) {
      for (let i = 0; i < N; i++) gen[i] = { s: i * SYN, e: i * SYN + SYN };
      for (let i = 0; i < N; i++) { const s = Math.max(gen[i].e, i ? play[i - 1].e : 0); play[i] = { s, e: s + PLAY }; }
    } else {
      let cur = 0;
      for (let i = 0; i < N; i++) { gen[i] = { s: cur, e: cur + SYN }; play[i] = { s: cur + SYN, e: cur + SYN + PLAY }; cur = cur + SYN + PLAY; }
    }
    const total = play[N - 1].e + 0.4, now = t % total;
    const x0 = 64, m = 14, gw = w - x0 - m, X = (s) => x0 + (s / total) * gw;
    const top = h * 0.14, rowH = (h * 0.46) / N, playY = h * 0.84, playH = h * 0.17;
    ctx.font = '10px ui-monospace,monospace';
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(245,241,232,0.5)';
    ctx.fillText(cascade ? 'synthesize  (runs ahead, buffers)' : 'synthesize  (one at a time)', x0, top - 8);
    ctx.fillText('play', 8, playY - playH * 0.5 - 8);
    // generation rows — one per line, stacked, each racing ahead of its slot
    for (let i = 0; i < N; i++) {
      const ry = top + i * rowH + rowH / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, ry); ctx.lineTo(x0 + gw, ry); ctx.stroke();
      ctx.fillStyle = 'rgba(245,241,232,0.5)'; ctx.textAlign = 'right'; ctx.fillText('L' + (i + 1), x0 - 8, ry + 3);
      // buffered: dashed link from "rendered" to "starts playing"
      if (play[i].s > gen[i].e + 0.02) {
        ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X(gen[i].e), ry); ctx.lineTo(X(play[i].s), playY - playH / 2); ctx.stroke(); ctx.setLineDash([]);
      }
      const st = now < gen[i].s ? 'wait' : now < gen[i].e ? 'gen' : 'ready';
      ctx.globalAlpha = st === 'wait' ? 0.28 : st === 'gen' ? 1 : 0.62;
      ctx.fillStyle = colors[i];
      rrect(ctx, X(gen[i].s), ry - rowH * 0.3, Math.max(3, X(gen[i].e) - X(gen[i].s)), rowH * 0.6, 4); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // dead-air shading in the playback lane (naive mode only)
    if (!cascade) for (let i = 0; i < N - 1; i++) {
      const g0 = play[i].e, g1 = play[i + 1].s;
      if (g1 > g0) {
        ctx.fillStyle = 'rgba(255,95,107,0.2)'; ctx.fillRect(X(g0), playY - playH / 2, X(g1) - X(g0), playH);
        ctx.fillStyle = 'rgba(255,95,107,0.9)'; ctx.textAlign = 'center'; ctx.font = '8px ui-monospace,monospace';
        ctx.fillText('dead air', (X(g0) + X(g1)) / 2, playY + 3); ctx.font = '10px ui-monospace,monospace';
      }
    }
    // playback lane — one sequential track draining the buffer
    for (let i = 0; i < N; i++) {
      const playing = now >= play[i].s && now < play[i].e;
      ctx.fillStyle = colors[i]; ctx.globalAlpha = playing ? 1 : now >= play[i].e ? 0.45 : 0.32;
      rrect(ctx, X(play[i].s), playY - playH / 2, Math.max(3, X(play[i].e) - X(play[i].s)), playH, 5); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#15161c'; ctx.textAlign = 'center'; ctx.font = '700 10px ui-monospace,monospace';
      ctx.fillText('L' + (i + 1), (X(play[i].s) + X(play[i].e)) / 2, playY + 3); ctx.font = '10px ui-monospace,monospace';
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(now), top - 6); ctx.lineTo(X(now), playY + playH / 2 + 8); ctx.stroke();
  });
  return stop;
}

const LOOKS = {
  'grizzled cowboy': { hat: 'cowboy', face: null, neck: 'bowtie', color: '#ecdcc2', reason: 'frontier sheriff energy' },
  'arcane wizard': { hat: 'wizard', face: null, neck: null, color: '#ddd6f3', reason: 'mystical and ancient' },
  'British butler': { hat: null, face: 'monocle', neck: 'bowtie', color: '#f0e6c8', reason: 'impeccably refined' },
  'party starter': { hat: 'party', face: 'sunglasses', neck: null, color: '#f6d8ea', reason: 'here to celebrate' },
  'noir detective': { hat: 'tophat', face: null, neck: 'necktie', color: '#dbdfe8', reason: 'shadowy and sharp' },
};
function wStylist(host) {
  let cur = 'grizzled cowboy';
  const ctl = el('div', 'xp-controls');
  Object.keys(LOOKS).forEach((k) => {
    const b = el('button', 'xp-btn' + (k === cur ? ' on' : ''), k);
    b.onclick = () => { cur = k; [...ctl.children].forEach((c) => c.classList.remove('on')); b.classList.add('on'); apply(); };
    ctl.appendChild(b);
  });
  host.appendChild(ctl);
  const row = el('div', 'xp-split xp-stylist');
  const stageEl = el('div', 'xp-split-3d');
  const info = el('div', 'xp-stylist-info');
  row.append(stageEl, info); host.appendChild(row);
  const twin = makeTwin(stageEl, { accent: '#ffd34d' }); // idles + breathes on its own
  const propUrl = (s) => (s ? `/props/${s}.glb` : null);
  function apply() {
    const L = LOOKS[cur];
    twin.prop('hat', propUrl(L.hat));
    twin.prop('face', propUrl(L.face));
    twin.prop('neck', propUrl(L.neck));
    twin.tint(L.color);
    const slot = (k, v) => `<div class="xp-slot"><span>${k}</span><b class="${v ? '' : 'nul'}">${v || 'null'}</b></div>`;
    info.innerHTML =
      `<div class="xp-look">"${esc(cur)}"</div>` +
      slot('hat', L.hat) + slot('face', L.face) + slot('neck', L.neck) +
      `<div class="xp-slot"><span>color</span><b><i style="background:${L.color}"></i>${L.color}</b></div>` +
      `<div class="xp-reason">the model only picks from props the renderer actually has — anything off the allow-list becomes <code>null</code></div>`;
  }
  apply();
  return () => twin.stop();
}

function wLyrics(host) {
  // a sung phrase: each word has a true onset time; raw SRT cues are coarse and
  // drift, forced alignment snaps each word onto its real onset
  const words = ['Tune', 'in', 'to', 'Reachy', 'Radio', 'turn', 'it', 'up', 'and', 'glow'];
  const onset = []; let acc = 0.25;
  for (const wd of words) { onset.push(acc); acc += 0.34 + wd.length * 0.035; }
  const total = acc + 0.4;
  // raw SRT: 3 coarse cues, each starting late and covering several words
  const srt = [{ s: 0.55, e: 1.7, i: [0, 1, 2, 3] }, { s: 1.9, e: 3.0, i: [4, 5, 6] }, { s: 3.2, e: total, i: [7, 8, 9] }];
  let t = 0;
  const stop = makeCanvas(host, (ctx, w, h, dt) => {
    t = (t + dt * 0.5) % total;
    const m = 18, x0 = m, gw = w - 2 * m, X = (s) => x0 + (s / total) * gw;
    // audio onsets (ground truth)
    const ay = h * 0.22;
    ctx.fillStyle = 'rgba(245,241,232,0.4)'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'left';
    ctx.fillText('audio · word onsets', x0, ay - 14);
    onset.forEach((o) => { ctx.fillStyle = 'rgba(124,211,255,0.6)'; ctx.fillRect(X(o), ay - 8, 2, 16); });
    const rows = [
      ['raw SRT cue', h * 0.52, false],
      ['forced-aligned', h * 0.82, true],
    ];
    rows.forEach(([lab, ry, aligned]) => {
      ctx.fillStyle = 'rgba(245,241,232,0.4)'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'left';
      ctx.fillText(lab, x0, ry - 20);
      if (aligned) {
        words.forEach((wd, i) => {
          const s = onset[i], e = i + 1 < words.length ? onset[i + 1] : total - 0.3;
          const on = t >= s && t < e;
          ctx.fillStyle = on ? '#ffd34d' : 'rgba(255,211,77,0.4)';
          ctx.font = (on ? '700 ' : '') + '12px ui-monospace,monospace'; ctx.textAlign = 'center';
          ctx.fillText(wd, (X(s) + X(e)) / 2, ry);
        });
      } else {
        srt.forEach((c) => {
          const on = t >= c.s && t < c.e;
          ctx.strokeStyle = on ? 'rgba(255,95,107,0.9)' : 'rgba(255,95,107,0.3)'; ctx.lineWidth = 1.5;
          rrect(ctx, X(c.s), ry - 13, X(c.e) - X(c.s), 20, 4); ctx.stroke();
          ctx.fillStyle = on ? '#ff8a93' : 'rgba(255,138,147,0.45)';
          ctx.font = '11px ui-monospace,monospace'; ctx.textAlign = 'center';
          ctx.fillText(c.i.map((k) => words[k]).join(' '), (X(c.s) + X(c.e)) / 2, ry + 1);
        });
      }
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(t), ay - 12); ctx.lineTo(X(t), h * 0.86); ctx.stroke();
  });
  return stop;
}

// ---- content --------------------------------------------------------------
const WIDGETS = { wBeat, wSpring, wTalk, wMoves, wShape, wPipeline, wCast, wCascade, wStylist, wLyrics };
const SECTIONS = [
  {
    group: 'The show pipeline', id: 'overview', nav: 'The whole pipeline',
    html: `<p>A show is built from one line of input — a topic — and ends as robots talking on a live
      WebRTC stream. In between, a language model writes the script in a single call, a text-to-speech
      model gives every character its own voice, and the audio is published into a LiveKit room that the
      browser twins (and any physical Reachy) lip-sync and move to. The dots below trace one show through
      the stages.</p>
      <p>Two ideas keep it feeling live rather than pre-rendered: the script is <b>one constrained
      generation</b> (no slow back-and-forth chains), and synthesis <b>cascades</b> — the next voice is
      already rendering while the current one speaks. The sections below open up each stage.</p>`,
    widget: 'wPipeline',
  },
  {
    group: 'The show pipeline', id: 'script', nav: 'Writing the script',
    html: `<p>The entire cast and every line come back from <b>one</b> call to the Nemotron brain, forced into
      JSON with <code>response_format: json_object</code>. Asking for structured output in a single shot is far
      faster and steadier than chaining "now invent a host, now write their line" prompts that drift.</p>
      <p>The catch: an LLM won't reliably honour "make exactly N hosts," and a live show may already have
      <b>physical guests</b> who must appear. So the model's output is <b>reconciled</b> to the requested size:
      real guests are always kept, surplus invented hosts are trimmed (their lines reassigned so nothing is
      lost), and if the model under-delivers, filler co-hosts are padded in and spliced across the script. Drag
      the sliders and re-roll the LLM to watch it always land on the asked-for cast.</p>`,
    code: `// one constrained call returns the whole show as JSON
{ "response_format": { "type": "json_object" } }     // /no_think, one shot

// then reconcile the model's cast to exactly what was asked
target_sim = max(0, cast_size - len(guests))   // guests are non-negotiable
keep       = guests + sim_hosts[:target_sim]   // trim any surplus hosts
while len(keep) < cast_size:                   // model under-delivered?
    keep.append(filler_host())                 // pad, then splice lines in`,
    widget: 'wCast',
  },
  {
    group: 'The show pipeline', id: 'cascade', nav: 'The TTS cascade',
    html: `<p>Each line is synthesized by a TTS model in the cloud, which takes about as long as a short
      sentence. Doing it the obvious way — render a line, play it, render the next — leaves the robots
      frozen and silent for a second between every line. <b>Dead air.</b></p>
      <p>Instead, synthesis runs <b>ahead</b> of the speaker. The next line is kicked off as a background
      task while the current one is still playing, and since rendering a line is quicker than speaking it, the
      voices stack up into a ready buffer that playback drains back-to-back — no gaps. Playback paces itself
      to wall-clock: capturing audio frames into the LiveKit track applies backpressure, so awaiting it is the
      timing. Toggle the cascade off to watch synthesis and playback fall back into lockstep, with dead air
      between every line.</p>`,
    code: `nxt = create_task(voice(lines[0]))        // start rendering line 1
for i, line in enumerate(lines):
    wav = await nxt                          // already done — no wait
    if i + 1 < len(lines):
        nxt = create_task(voice(lines[i+1])) // render the NEXT while this plays
    await pub.say_file(wav)                   // frame backpressure paces it`,
    widget: 'wCascade',
  },
  {
    group: 'The show pipeline', id: 'stylist', nav: 'The wardrobe stylist',
    html: `<p>When you design a Reachy, a character description ("a grizzled cowboy") is turned into a 3D
      outfit by the same language brain acting as a <b>wardrobe stylist</b>. The trick is to never let it
      free-associate: the prompt hands it the exact list of allowed props per slot (hat, face, neck) and
      demands JSON back. Any pick that isn't on the allow-list is coerced to <code>null</code>, and the accent
      colour must match a strict hex pattern — so a hallucinated "sombrero" can never reach the renderer.</p>
      <p>It's constrained generation again: the model brings the taste (matching vibe to props), the code
      guarantees the output is always a valid, renderable outfit. Pick an archetype to see what it dresses.</p>`,
    code: `// the model may ONLY choose from the props we actually have
slots = { "hat": [...], "face": [...], "neck": [...] }
pick  = llm_json(STYLIST_SYS, character, slots)   // JSON-mode, temp 0.6

// validate every slot: off-list -> null, bad colour -> null
outfit = { slot: (pick[slot] if pick[slot] in opts else None)
           for slot, opts in slots.items() }
outfit["color"] = pick["color"] if re.match("#[0-9a-f]{6}", ...) else None`,
    widget: 'wStylist',
  },
  {
    group: 'The show pipeline', id: 'lyrics', nav: 'Karaoke alignment',
    html: `<p>Reachy FM shows synced karaoke lyrics on the vinyl. The words are known (from the track's
      caption file), but their <b>timing</b> is coarse — a subtitle cue covers a whole phrase, so highlighting
      it word-by-word would just guess. Re-transcribing the audio fixes the timing but rewrites the words
      ("glow" became "go", "CUDA chip" became "Q to chip").</p>
      <p>The fix is <b>forced alignment</b>: feed Whisper the <i>correct</i> text and the audio together, and
      it reports where each known word is actually sung, using its own attention — never changing a word, only
      timestamping it. Coarse cues become precise per-word onsets. The playhead below shows the raw cues
      lagging while the aligned words land exactly on the audio onsets.</p>`,
    code: `// don't re-transcribe (it rewrites words) — ALIGN the known text
result = stable_whisper.align(audio, known_lyrics, language="en")
for word in result.all_words():
    word.start, word.end   // real onset, straight from the model's attention`,
    widget: 'wLyrics',
  },
  {
    group: "DJ Servo's groove", id: 'beat', nav: 'Finding the beat',
    html: `<p>To bop on the beat, the robot first has to <b>find</b> it. A Fast Fourier Transform splits the
      audio into frequency bands; the kick drum lives in the lowest few, so we watch the bass energy and flag a
      <b>beat</b> when it spikes above its own running average.</p>
      <p>But reacting to each detected kick looks jittery (the detector misses and double-counts). So the kicks
      instead drive a <b>beat clock</b>: a free-running counter at the learned tempo, gently nudged onto each
      detected beat. This is a <b>phase-locked loop</b>, the same trick a radio uses to lock onto a station. Try
      throwing jitter or dropped beats at it below: the head stays locked.</p>`,
    code: `// detect a kick, then correct the clock (a phase-locked loop)
onset = bass > kickAvg * 1.3 + 0.04 && bass > 0.16 && (now - lastBeat) > 215;
if (onset) {
  beatInterval = beatInterval * 0.7 + iv * 0.3;     // learn the tempo
  clock += (round(clock) - clock) * 0.5;            // pull phase onto the beat
}
clock += dt / beatInterval;                          // free-run between beats`,
    widget: 'wBeat',
  },
  {
    group: "DJ Servo's groove", id: 'shape', nav: 'The beat shape',
    html: `<p>Every move is a function of the clock's <b>phase</b> (0 on the beat, 0.5 halfway to the next). Two
      shapes do the work: a sharp exponential pulse for a percussive snap, and a smooth cosine swell for a
      flowing bob.</p>`,
    code: `beatHit(p) = max( exp(-8p), exp(-8(1-p)) );   // sharp: 1 on the beat, ~0 between
bobWave(p) = 0.5 * (1 + cos(2*pi*p));        // smooth swell, high on the beat`,
    widget: 'wShape',
  },
  {
    group: "DJ Servo's groove", id: 'dance', nav: 'The dance moves',
    html: `<p>A single bob gets boring, so there's a <b>library</b> of moves, each a short formula of the clock:
      the head snaps down (bob), shifts its weight (sway), traces a circle, snaps to held poses (robot), or weaves a
      figure-eight. The choreographer switches between them on musical bar lines with a crossfade, picking livelier
      moves when the music is loud. Pick one to watch it run, locked to the beat.</p>`,
    code: `sway(c)  = { roll: -0.55*sin(pi*c), x: 0.6*sin(pi*c) }    // weight shift, 2 beats
circle(c)= { roll: 0.9*sin(pi*c), pitch: 0.45*(1-cos(pi*c)) } // 90° apart -> a circle
robot(c) = poses[ floor(c) mod 4 ]                       // hold a pose per beat`,
    widget: 'wMoves',
  },
  {
    group: "DJ Servo's groove", id: 'spring', nav: 'Springy antennas',
    html: `<p>The finishing touch comes from how VTuber rigs animate hair and ears. Instead of snapping the
      antennas to their target, each one is the mass in a <b>damped spring</b> being pulled toward it, so it trails
      and overshoots like a real ear. Drag the sliders: stiffness sets the bounce frequency, damping sets how much
      it rings before settling.</p>`,
    code: `// a damped harmonic oscillator, integrated with semi-implicit Euler
vel += ((target - pos) * stiff - vel * damp) * dt;
pos += vel * dt;
// omega = sqrt(stiff);  zeta = damp / (2*sqrt(stiff));  overshoot = exp(-zeta*pi/sqrt(1-zeta^2))`,
    widget: 'wSpring',
  },
  {
    group: "DJ Servo's groove", id: 'talk', nav: 'Talking, not dancing',
    html: `<p>When the robot <b>speaks</b> (the DJ's mic breaks, the podcast hosts) it shouldn't dance. It should
      look like it's talking. The trick, taken from the official Reachy app, is a sum of <b>low, unrelated
      sinusoids</b> (a slow big head-turn, a faster small nod, a subtle tilt), scaled by loudness and a voice gate.
      Because the frequencies don't line up, the motion never repeats and reads as natural. No onset detection: that
      looked like a jerky twitch at the start of each sentence.</p>`,
    code: `// per axis: amplitude * loudness * voiceGate * sin(2*pi*freq*t + randomPhase)
pitch:  4.5° @ 2.2 Hz    // small fast nods
yaw:    7.5° @ 0.6 Hz    // the dominant slow side-to-side turn
roll:   2.25° @ 1.3 Hz   // subtle tilt`,
    widget: 'wTalk',
  },
];

// ---- modal ----------------------------------------------------------------
let _stops = [];
export function openExplainer(target) {
  closeExplainer();
  const back = el('div', 'xp-back');
  const modal = el('div', 'xp-modal');
  const head = el('div', 'xp-head', `<div class="xp-title">How it works <em>· the architecture behind Small Talk</em></div>`);
  const close = el('button', 'xp-close', '✕'); close.onclick = closeExplainer; head.appendChild(close);
  const nav = el('nav', 'xp-nav');
  const body = el('div', 'xp-body');
  let lastGroup = null;
  SECTIONS.forEach((s) => {
    if (s.group && s.group !== lastGroup) { nav.appendChild(el('div', 'xp-navgroup', s.group)); lastGroup = s.group; }
    const link = el('button', 'xp-navlink', s.nav);
    link.onclick = () => body.querySelector(`#xp-${s.id}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
    nav.appendChild(link);
    const sec = el('section', 'xp-section'); sec.id = `xp-${s.id}`;
    sec.appendChild(el('h3', 'xp-sec-h', s.nav));
    sec.appendChild(el('div', 'xp-prose', s.html));
    if (s.code) sec.appendChild(el('pre', 'xp-code', highlight(s.code)));
    if (s.widget) { const wrap = el('div', 'xp-widget'); sec.appendChild(wrap); _stops.push(WIDGETS[s.widget](wrap)); }
    body.appendChild(sec);
  });
  const main = el('div', 'xp-main'); main.append(nav, body);
  modal.append(head, main); back.appendChild(modal); document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('show'));
  back.onclick = (e) => { if (e.target === back) closeExplainer(); };
  document.addEventListener('keydown', _onKey);
  if (target) body.querySelector(`#xp-${target}`)?.scrollIntoView();
}
function _onKey(e) { if (e.key === 'Escape') closeExplainer(); }
export function closeExplainer() {
  _stops.forEach((s) => s && s()); _stops = [];
  document.removeEventListener('keydown', _onKey);
  document.querySelector('.xp-back')?.remove();
}
