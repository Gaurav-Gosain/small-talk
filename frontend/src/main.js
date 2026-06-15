// Small Talk — app shell: Home (rooms) → Connect (design your Reachy) → Call.
import { Room, RoomEvent, Track } from 'livekit-client';
import { ReachyTwin } from './reachy3d.js';
import { HeroReachy } from './hero.js';
import { openRadio, closeRadio } from './radio.js';
import { openExplainer } from './explainer.js';
import './styles.css';
import './themes.css';

const $ = (id) => document.getElementById(id);
const views = { home: $('view-home'), connect: $('view-connect'), call: $('view-call'), admin: $('view-admin'), radio: $('view-radio') };
const nav = $('nav');
const statusEl = $('status');
const grid = $('grid');
const spotlight = $('spotlight');
const spotMain = $('spotMain');
const spotStrip = $('spotStrip');

let hero = null;
let lkRoom = null; // LiveKit room
let audioCtx = null;
let layout = 'grid';
let activeId = null;
const cards = new Map();
let currentRoom = null;
let currentGuestId = null; // this viewer's guest Reachy in the current room
let userReachy = loadUserReachy();
let allRooms = [];
const UGC_ENABLED = true; // design-your-Reachy (AI stylist + 3D preview) is live; live room publish still gated server-side
const STYLE_SLOTS = ['hat', 'face', 'neck'];
const CURATED = {
  hat: ['wizard', 'cowboy', 'tophat', 'crown', 'party', 'pirate', 'viking',
        'propeller', 'santa', 'halo', 'baseball'],
  face: ['sunglasses', 'monocle', 'skigoggles'],
  neck: ['bowtie', 'necktie'],
};

// Apply AI/manual wardrobe + shell tint to a twin; polls until the URDF is ready.
function applyStyleWhenReady(twin, style) {
  const go = () => {
    for (const slot of STYLE_SLOTS)
      twin.setProp(slot, style[slot] ? `/props/${style[slot]}.glb` : null);
    if ('bodyColor' in style) twin.setBodyTint(style.bodyColor || null);
  };
  if (twin?.head && twin._headRestWorldQuat) return go();
  let n = 0;
  const iv = setInterval(() => {
    if (twin?._disposed || ++n > 80) return clearInterval(iv);
    if (twin?.head && twin._headRestWorldQuat) { clearInterval(iv); go(); }
  }, 80);
}

// ------------------------------------------------------------------ helpers
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}
function loadUserReachy() {
  try { return JSON.parse(localStorage.getItem('userReachy') || 'null'); } catch { return null; }
}
function saveUserReachy(r) { userReachy = r; localStorage.setItem('userReachy', JSON.stringify(r)); }
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function initials(name) { return (name || '?').trim().slice(0, 1).toUpperCase(); }

// If WebGL is unavailable (privacy settings, old drivers, VMs) three.js THROWS.
// The show must go on without the 3D twin: audio, subtitles and nameplates all
// still work — the twin pane just stays empty.
function safeTwin(host, opts) {
  try {
    return new ReachyTwin(host, opts);
  } catch (e) {
    console.warn('[small-talk] WebGL unavailable, card runs without a 3D twin:', e?.message);
    return { level: 0, setLevel(l) { this.level = l; }, setBackstage() {}, setProp() {}, setBodyTint() {}, dispose() {} };
  }
}

// ------------------------------------------------------------------ routing
function showView(name) {
  for (const [k, v] of Object.entries(views)) v.classList.toggle('hidden', k !== name);
  renderNav(name);
  if (name === 'radio') openRadio();
  else closeRadio();
  if (name === 'home') {
    if (!hero) { try { hero = new HeroReachy($('hero3d')); } catch { hero = null; } }
  } else if (hero) {
    hero.dispose();
    hero = null;
  }
}
function renderNav(name) {
  nav.innerHTML = '';
  if (name === 'call') {
    const b = el('button', 'btn btn-ghost btn-sm', '← Leave room');
    b.onclick = leaveCall;
    nav.appendChild(b);
  } else if (name === 'radio') {
    const b = el('button', 'btn btn-ghost btn-sm', '← Leave the station');
    b.onclick = () => { history.replaceState(null, '', location.pathname); showView('home'); };
    nav.appendChild(b);
  } else if (name === 'connect' || name === 'admin') {
    const b = el('button', 'btn btn-ghost btn-sm', '← Back');
    b.onclick = () => showView('home');
    nav.appendChild(b);
  } else if (UGC_ENABLED && userReachy) {
    const chip = el('div', 'eyebrow', `✦ ${userReachy.name}`);
    chip.style.cursor = 'pointer';
    chip.title = 'Edit your Reachy';
    chip.onclick = startConnect;
    nav.appendChild(chip);
  }
}
$('brand').onclick = () => (lkRoom ? leaveCall() : showView('home'));

// ------------------------------------------------------------------ rooms list
async function loadRooms() {
  try {
    const { rooms } = await api('/api/rooms');
    allRooms = rooms;
  } catch {}
  updateShowButtons();
  renderLiveRooms();
}
function renderLiveRooms() {
  const host = $('liveRooms');
  const rail = $('liveRail');
  if (!host || !rail) return;
  const extras = allRooms.filter((r) => r.id !== 'hot-dog-court' && r.id !== 'the-podcast');
  rail.classList.toggle('hidden', extras.length === 0);
  const q = ($('lrSearch')?.value || '').trim().toLowerCase();
  const shown = extras
    .filter((r) => !q || `${r.title} ${r.topic}`.toLowerCase().includes(q))
    .sort((a, b) => (b.live - a.live) || (b.viewers || 0) - (a.viewers || 0) || a.title.localeCompare(b.title));
  $('lrCount').textContent = extras.length > 1 ? String(extras.length) : '';
  host.innerHTML = '';
  if (!shown.length && q) {
    host.appendChild(el('span', 'lr-empty', 'no shows match — start one ↑'));
    return;
  }
  shown.slice(0, 20).forEach((r, i) => {
    const c = el('button', 'lr-card');
    c.style.animationDelay = `${Math.min(i, 8) * 45}ms`;
    const emoji = el('span', 'lc-emoji'); emoji.textContent = r.emoji || '✨';
    const body = el('span', 'lc-body');
    const title = el('span', 'lc-title'); title.textContent = r.title;
    const topic = el('span', 'lc-topic'); topic.textContent = r.topic || 'live generated show';
    body.append(title, topic);
    const meta = el('span', 'lc-meta');
    meta.append(el('span', 'd' + (r.live ? ' on' : '')), document.createTextNode(` ${r.viewers || 0}`));
    c.append(emoji, body, meta);
    c.onclick = () => joinRoom(r);
    host.appendChild(c);
  });
}
$('lrSearch')?.addEventListener('input', renderLiveRooms);

// ------------------------------------------------------------------ new show
const TOPIC_IDEAS = [
  'Is a hot dog a sandwich?',
  'Should robots get weekends off?',
  'The best era of video game music, defended to the death',
  'Pineapple on pizza: culinary crime or misunderstood genius?',
  'If you could delete one app from existence, which and why?',
  'Are we living in a simulation, and is it well-optimised?',
  'Cats vs dogs, but the robots have strong opinions',
  'What would robots put in a time capsule for the year 3000?',
  'The most overrated invention of all time',
  'Could a toaster ever achieve true happiness?',
  'Tabs or spaces — settle it forever',
  'Is cereal a soup? A rigorous investigation',
];

$('newShowBtn').onclick = () => {
  const back = el('div', 'modal-back');
  const card = el('div', 'connect-card modal-card');
  card.innerHTML = `
    <h2>Start a new show</h2>
    <p class="sub">Give the robots a topic — they'll write the script, design their own
    voices and go live.</p>
    <div class="field"><label>Show title</label><input class="input" id="nsTitle" placeholder="e.g. Midnight Philosophy" /></div>
    <div class="field">
      <label>Topic <button type="button" class="ns-surprise" id="nsSurprise">🎲 surprise me</button></label>
      <textarea class="textarea" id="nsTopic" placeholder="What should they argue about?"></textarea>
    </div>
    <div class="field"><label>Cast</label>
      <div class="chips" id="nsMode">
        <button class="chip on" data-m="sim">🤖 Simulated Reachys — starts right away</button>
        <button class="chip" data-m="physical">📡 Physical Reachys — green room first</button>
      </div>
    </div>
    <div class="field" id="nsCountField">
      <label><span id="nsCountLabel">How many robots?</span> <span class="ns-cval" id="nsCval"></span></label>
      <div class="ns-bots" id="nsBots"></div>
      <input type="range" id="nsCount" min="2" max="5" step="1" value="3" />
      <div class="ns-hint" id="nsCountHint"></div>
    </div>
    <div class="connect-nav">
      <button class="btn btn-ghost" id="nsCancel">Cancel</button>
      <button class="btn btn-primary" id="nsGo">Go live →</button>
    </div>`;
  back.appendChild(card);
  document.body.appendChild(back);
  card.querySelector('#nsTitle').focus();

  let mode = 'sim';
  const slider = card.querySelector('#nsCount');

  // the count slider re-ranges per mode: sim picks the whole cast (2-5),
  // physical picks the virtual robots added around the real ones (1-4)
  const renderCount = () => {
    const n = +slider.value;
    const bots = card.querySelector('#nsBots');
    const max = +slider.max;
    bots.innerHTML = '';
    for (let i = 1; i <= max; i++) {
      const b = el('span', 'ns-bot' + (i <= n ? ' on' : ''));
      b.textContent = '🤖';
      bots.appendChild(b);
    }
    card.querySelector('#nsCval').textContent = mode === 'physical'
      ? `${n} simulated`
      : `${n} robots`;
    card.querySelector('#nsCountHint').textContent = mode === 'physical'
      ? 'Your physical Reachys join on top of these in the green room.'
      : 'A show needs 2–5 robots.';
  };
  const setMode = (m) => {
    mode = m;
    card.querySelectorAll('#nsMode .chip').forEach((x) => x.classList.toggle('on', x.dataset.m === m));
    card.querySelector('#nsGo').textContent = m === 'physical' ? 'Open the green room →' : 'Go live →';
    card.querySelector('#nsCountLabel').textContent = m === 'physical' ? 'Add simulated robots' : 'How many robots?';
    if (m === 'physical') { slider.min = 1; slider.max = 4; if (+slider.value > 4) slider.value = 4; }
    else { slider.min = 2; slider.max = 5; if (+slider.value < 2) slider.value = 2; }
    renderCount();
  };
  card.querySelectorAll('#nsMode .chip').forEach((c) => { c.onclick = () => setMode(c.dataset.m); });
  slider.oninput = renderCount;
  card.querySelector('#nsSurprise').onclick = () => {
    const t = card.querySelector('#nsTopic');
    t.value = TOPIC_IDEAS[(Math.random() * TOPIC_IDEAS.length) | 0];
    t.focus();
  };
  setMode('sim');

  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const submit = async () => {
    const title = card.querySelector('#nsTitle').value.trim() || 'Untitled show';
    const topic = card.querySelector('#nsTopic').value.trim();
    if (!topic) { card.querySelector('#nsTopic').focus(); return; }
    const go = card.querySelector('#nsGo');
    go.disabled = true;
    go.textContent = 'Clearing it with standards…';
    try {
      const { room } = await api('/api/rooms', {
        method: 'POST',
        body: { title, topic, emoji: mode === 'physical' ? '📡' : '✨', template: 'open', mode, simCount: +slider.value },
      });
      close();
      joinRoom(room);
    } catch (e) {
      go.disabled = false;
      go.textContent = mode === 'physical' ? 'Open the green room →' : 'Go live →';
      card.querySelector('.sub').textContent = `Could not create the show: ${e.message}`;
    }
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  };
  document.addEventListener('keydown', onKey);
  card.querySelector('#nsCancel').onclick = close;
  back.onclick = (e) => { if (e.target === back) close(); };
  card.querySelector('#nsGo').onclick = submit;
};
const showRoom = (id) => allRooms.find((r) => r.id === id);
function updateShowButtons() {
  const label = (base, r) => (r && r.live && r.viewers ? `${base} · ${r.viewers} watching` : base);
  if ($('showGroup')) $('showGroup').textContent = label('The group chat', showRoom('hot-dog-court'));
  if ($('showPodcast')) $('showPodcast').textContent = label('The podcast', showRoom('the-podcast'));
}
async function joinById(id) {
  if (!allRooms.length) await loadRooms();
  const r = showRoom(id);
  if (r) joinRoom(r);
}
$('showGroup').onclick = () => joinById('hot-dog-court');
$('showPodcast').onclick = () => joinById('the-podcast');
if ($('showRadio')) $('showRadio').onclick = () => { location.hash = '#radio'; };

// ------------------------------------------------------------------ connect flow
$('connectBtn').onclick = startConnect;
const PERSONA_PRESETS = ['Stoic philosopher', 'Hyperactive hype-bot', 'Noir detective', 'Cosmic stoner', 'Victorian butler', 'Conspiracy raccoon'];
const VOICE_PRESETS = ['Deep & gravelly', 'Bright & fast', 'Calm British butler', 'Slurring rum-soaked pirate', 'Old raspy sage', 'Laid-back surfer drawl'];
const COLORS = ['#49e6c8', '#6c7bff', '#ff8c42', '#f2c14e', '#7bbf6a', '#ff6b8b', '#a78bfa', '#37b3c9'];
// shell tints multiply the white plastic — keep them light so shading survives
const BODY_COLORS = ['', '#ffd9c4', '#cfe6ff', '#d9f4d4', '#f6d9e8', '#efe6c8', '#d9d4f4', '#c9ced6'];
let cfg = null;
let cfgStep = 0;
let configTwin = null;

function startConnect() {
  cfg = userReachy
    ? { ...userReachy }
    : { name: '', color: COLORS[0], persona: '', voice: '' };
  cfgStep = 0;
  showView('connect');
  renderStep();
}
function setSteps() {
  $('steps').querySelectorAll('.step').forEach((s, i) => s.classList.toggle('on', i <= cfgStep));
}
function disposeConfigTwin() {
  if (configTwin) { configTwin.dispose(); configTwin = null; }
}
function renderStep() {
  setSteps();
  disposeConfigTwin();
  const m = $('connect-mount');
  if (cfgStep === 0) {
    m.innerHTML = `
      <h2>Name your Reachy</h2>
      <p class="sub">This is the robot you'll bring on air.</p>
      <div class="field"><label>Name</label><input class="input" id="cfgName" placeholder="e.g. Nova" value="${cfg.name || ''}" /></div>
      <div class="field"><label>Accent colour</label><div class="swatches" id="cfgColors"></div></div>
      <div class="field"><label>Shell colour</label><div class="swatches" id="cfgBody"></div></div>`;
    const sw = m.querySelector('#cfgColors');
    COLORS.forEach((c) => {
      const s = el('div', 'swatch' + (c === cfg.color ? ' on' : ''));
      s.style.background = c;
      s.onclick = () => { cfg.color = c; sw.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on')); s.classList.add('on'); };
      sw.appendChild(s);
    });
    const bw = m.querySelector('#cfgBody');
    BODY_COLORS.forEach((c) => {
      const s = el('div', 'swatch' + ((cfg.bodyColor || '') === c ? ' on' : ''));
      s.style.background = c || '#f2efe9';
      s.title = c ? '' : 'stock white';
      s.onclick = () => { cfg.bodyColor = c; bw.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on')); s.classList.add('on'); };
      bw.appendChild(s);
    });
    m.querySelector('#cfgName').oninput = (e) => (cfg.name = e.target.value);
  } else if (cfgStep === 1) {
    m.innerHTML = `
      <h2>Give it a personality</h2>
      <p class="sub">A line or two — like the system prompt for its brain.</p>
      <div class="field">
        <label>Personality</label>
        <textarea class="textarea" id="cfgPersona" placeholder="A weary detective who's seen too much and trusts no one.">${cfg.persona || ''}</textarea>
        <div class="chips" id="cfgPChips"></div>
      </div>`;
    chipFill(m.querySelector('#cfgPChips'), PERSONA_PRESETS, (v) => { cfg.persona = v; m.querySelector('#cfgPersona').value = v; });
    m.querySelector('#cfgPersona').oninput = (e) => (cfg.persona = e.target.value);
  } else if (cfgStep === 2) {
    m.innerHTML = `
      <h2>Design its voice</h2>
      <p class="sub">Describe how it should sound — fed to Qwen3-TTS voice design.</p>
      <div class="field">
        <label>Voice</label>
        <textarea class="textarea" id="cfgVoice" placeholder="Deep, gravelly, slow and menacing, with a faint rasp.">${cfg.voice || ''}</textarea>
        <div class="chips" id="cfgVChips"></div>
      </div>`;
    chipFill(m.querySelector('#cfgVChips'), VOICE_PRESETS, (v) => { cfg.voice = v; m.querySelector('#cfgVoice').value = v; });
    m.querySelector('#cfgVoice').oninput = (e) => (cfg.voice = e.target.value);
  } else {
    m.innerHTML = `
      <h2>Meet ${cfg.name || 'your Reachy'}</h2>
      <p class="sub">Let the AI stylist dress it from your description — or pick a hat yourself.</p>
      <div id="config-twin"></div>
      <div class="style-row">
        <button class="btn btn-primary btn-sm" id="styleBtn">✨ Auto-style with AI</button>
        <span class="style-reason" id="styleReason"></span>
      </div>
      <div class="field"><label>Hat</label><div class="chips" data-slot="hat"></div></div>
      <div class="field"><label>Face</label><div class="chips" data-slot="face"></div></div>
      <div class="field"><label>Neck</label><div class="chips" data-slot="neck"></div></div>
      <div class="review-row"><div class="k">Name</div><div class="v">${cfg.name || '—'}</div></div>
      <div class="review-row"><div class="k">Personality</div><div class="v">${cfg.persona || '—'}</div></div>
      <div class="review-row"><div class="k">Voice</div><div class="v">${cfg.voice || '—'}</div></div>`;
    configTwin = safeTwin(m.querySelector('#config-twin'), {
      accent: cfg.color, interactive: true, bodyColor: cfg.bodyColor || null,
    });
    applyStyleWhenReady(configTwin, cfg);
    m.querySelector('#config-twin').insertAdjacentHTML('beforeend',
      '<span class="twin-hint">drag to rotate · scroll to zoom · double-click to reset</span>');

    const repaint = () => STYLE_SLOTS.forEach((slot) =>
      m.querySelectorAll(`.chips[data-slot="${slot}"] .chip`).forEach((x) => x.classList.toggle('on', x.dataset.v === cfg[slot])));
    STYLE_SLOTS.forEach((slot) => {
      const host = m.querySelector(`.chips[data-slot="${slot}"]`);
      CURATED[slot].forEach((name) => {
        const c = el('button', 'chip' + (cfg[slot] === name ? ' on' : ''), name);
        c.dataset.v = name;
        c.onclick = () => {
          cfg[slot] = cfg[slot] === name ? null : name;
          repaint();
          configTwin.setProp(slot, cfg[slot] ? `/props/${cfg[slot]}.glb` : null);
        };
        host.appendChild(c);
      });
    });

    m.querySelector('#styleBtn').onclick = async () => {
      const btn = m.querySelector('#styleBtn'), reason = m.querySelector('#styleReason');
      btn.disabled = true;
      reason.textContent = 'the stylist is thinking…';
      try {
        const desc = `${cfg.name}. Personality: ${cfg.persona}. Voice: ${cfg.voice}`;
        const r = await api('/api/style-reachy', { method: 'POST', body: { description: desc } });
        STYLE_SLOTS.forEach((slot) => (cfg[slot] = r[slot] || null));
        if (r.color) { cfg.color = r.color; }
        applyStyleWhenReady(configTwin, cfg);
        repaint();
        reason.textContent = r.reason || 'styled ✓';
      } catch {
        reason.textContent = 'stylist unavailable — pick accessories below';
      }
      btn.disabled = false;
    };
  }

  const navRow = el('div', 'connect-nav');
  const back = el('button', 'btn btn-ghost', cfgStep === 0 ? 'Cancel' : '← Back');
  back.onclick = () => {
    if (cfgStep === 0) { disposeConfigTwin(); showView('home'); }
    else { cfgStep--; renderStep(); }
  };
  const next = el('button', 'btn btn-primary', cfgStep === 3 ? '✦ Save Reachy' : 'Next →');
  next.onclick = () => {
    if (cfgStep === 0 && !cfg.name.trim()) { m.querySelector('#cfgName').focus(); return; }
    if (cfgStep < 3) { cfgStep++; renderStep(); }
    else {
      saveUserReachy({
        name: cfg.name.trim(), color: cfg.color, persona: cfg.persona.trim(),
        voice: cfg.voice.trim(), hat: cfg.hat || null, face: cfg.face || null, neck: cfg.neck || null,
        bodyColor: cfg.bodyColor || null,
      });
      disposeConfigTwin();
      showView('home');
      loadRooms();
      statusEl.textContent = `✦ ${userReachy.name} is styled and saved.`;
    }
  };
  navRow.append(back, next);
  m.appendChild(navRow);
}
function chipFill(host, presets, onPick) {
  presets.forEach((p) => {
    const c = el('button', 'chip', p);
    c.onclick = () => onPick(p);
    host.appendChild(c);
  });
}

// ------------------------------------------------------------------ call: cards + layout
function parseMeta(p) { try { return p.metadata ? JSON.parse(p.metadata) : {}; } catch { return {}; } }

function ensureCard(participant) {
  if (cards.has(participant.identity)) return cards.get(participant.identity);
  const meta = parseMeta(participant);
  const accent = meta.color || '#49e6c8';
  const card = el('div', 'card');
  card.style.setProperty('--accent', accent);
  card.innerHTML = `
    <div class="twin"></div>
    <div class="speaking-ring"></div>
    <div class="nameplate"><span class="dot"></span><span class="name"></span><span class="persona"></span></div>`;
  card.querySelector('.name').textContent = participant.name || participant.identity;
  card.querySelector('.persona').textContent = meta.persona || '';
  (layout === 'spotlight' ? spotStrip : grid).appendChild(card);
  const twin = safeTwin(card.querySelector('.twin'), { accent, bodyColor: meta.bodyColor || null });
  if (meta.hat || meta.face || meta.neck) applyStyleWhenReady(twin, meta); // generated casts dress themselves
  const entry = { el: card, twin, analyser: null, data: null };
  cards.set(participant.identity, entry);
  applyLayout(true);
  stopConnecting(); // first robot on stage → the patching-in overlay bows out
  return entry;
}

// ------------------------------------------------------------------ green room (waiting for robots)
function deviceCount() {
  if (!lkRoom) return 0;
  return [...lkRoom.remoteParticipants.values()].filter((p) => p.identity.startsWith('reachy-device-')).length;
}
let greenSimCount = 3;
function updateGreenRoom() {
  const n = deviceCount();
  const count = $('grCount'), start = $('grStart');
  if (!count) return;
  const total = Math.min(5, n + greenSimCount);
  count.innerHTML = n === 0
    ? `no robots connected yet — <b>${greenSimCount} simulated</b> will host`
    : `<b>${n} physical</b> + <b>${greenSimCount} simulated</b> = cast of ${total}`;
  count.classList.toggle('on', n > 0);
  start.textContent = n === 0 ? `Start with ${greenSimCount} simulated robots` : `Start the show (${total} robots)`;
}
function openGreenRoom(r) {
  const room = $('greenRoom');
  if (!room) return;
  greenSimCount = r.simCount || 3;
  room.classList.remove('hidden');
  $('grRoomId').textContent = r.id;
  $('grCmd').textContent = `./smalltalk-reachy -room ${r.id} -name "My Reachy"`;
  const copyBtn = (btnId, getText) => {
    $(btnId).onclick = () => {
      navigator.clipboard?.writeText(getText());
      $(btnId).textContent = 'copied ✓';
      setTimeout(() => ($(btnId).textContent = 'copy'), 1400);
    };
  };
  copyBtn('grCopyId', () => r.id);
  copyBtn('grCopy', () => $('grCmd').textContent);
  $('grStart').onclick = async () => {
    const b = $('grStart');
    b.disabled = true;
    b.textContent = 'Starting…';
    try {
      await api(`/api/rooms/${r.id}/start`, { method: 'POST' });
      stopGreenRoom();
      startWritingRoom();
    } catch (e) {
      b.disabled = false;
      $('grCount').textContent = `could not start: ${e.message}`;
    }
  };
  updateGreenRoom();
}
function stopGreenRoom() {
  const b = $('grStart');
  if (b) b.disabled = false;
  $('greenRoom')?.classList.add('hidden');
}

// ------------------------------------------------------------------ writers' room (pre-show)
const WR_LINES = [
  'INT. SMALL TALK STUDIO — NIGHT',
  'The robots shuffle their index cards.',
  'WRITERS: arguing about the cold open…',
  'CASTING: auditioning tiny robots…',
  'WARDROBE: a heated debate about hats.',
  'SOUND DEPT: designing voices from scratch…',
  'DIRECTOR: places, everyone. places!',
  'Someone unplugged the coffee machine.',
  'FINAL TOUCHES: polishing the punchlines…',
];
let wrTimer = null;
let wrThoughts = null;
function startWritingRoom() {
  const room = $('writingRoom');
  if (!room) return;
  room.classList.remove('hidden');
  $('wrStatus').textContent = 'the writers’ room is drafting the script…';
  // doodles drift out of the writers' card while the script cooks
  clearInterval(wrThoughts);
  const WR_EMOJI = ['💭', '✍️', '📝', '☕', '💡', '🎬', '🎩'];
  wrThoughts = setInterval(() => {
    const host = room.querySelector('.wr-card');
    if (host) spawnThought(host, WR_EMOJI[(Math.random() * WR_EMOJI.length) | 0]);
  }, 1500);
  let li = 0;
  const typeLine = () => {
    const target = WR_LINES[li % WR_LINES.length];
    li++;
    let i = 0;
    const tick = () => {
      $('wrTyping').textContent = target.slice(0, ++i);
      if (i < target.length) wrTimer = setTimeout(tick, 34 + Math.random() * 40);
      else wrTimer = setTimeout(typeLine, 1700); // hold, then next line
    };
    tick();
  };
  typeLine();
}
function stopWritingRoom() {
  clearTimeout(wrTimer);
  wrTimer = null;
  clearInterval(wrThoughts);
  wrThoughts = null;
  $('writingRoom')?.classList.add('hidden');
}

// ------------------------------------------------------------------ patching-in (join choreography)
// The view flips to the call INSTANTLY on click; this overlay narrates the real
// steps (join → token → SFU → cast walking in) while skeleton robots bob.
let connecting = false;
let cnSlowTimer = null;
function setConnStatus(text) {
  const el = $('cnStatus');
  if (!el || el.textContent === text) return;
  el.textContent = text;
  el.animate([{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }],
    { duration: 260, easing: 'cubic-bezier(.4,0,.2,1)' });
}
function setLivePill(state) { // 'standby' | 'live'
  const pill = $('livePill');
  if (!pill) return;
  pill.classList.toggle('standby', state === 'standby');
  const t = $('livePillText');
  if (t) t.textContent = state === 'standby' ? 'STANDBY' : 'LIVE';
}
let cnFading = false;
function startConnecting() {
  connecting = true;
  cnFading = false;
  const ov = $('connecting');
  ov?.getAnimations({ subtree: true }).forEach((a) => a.cancel()); // clear a leftover fade
  $('cnActions')?.classList.add('hidden');
  ov?.classList.remove('hidden');
  setLivePill('standby');
  setConnStatus('finding the studio…');
  clearTimeout(cnSlowTimer);
  cnSlowTimer = setTimeout(() => {
    if (connecting) setConnStatus('the studio is taking a moment — robots are waking…');
  }, 12000);
}
function stopConnecting() {
  connecting = false;
  clearTimeout(cnSlowTimer);
  setLivePill('live');
  const ov = $('connecting');
  // every arriving robot card calls this — only the FIRST starts the fade,
  // the rest must not restart it or the exit stutters
  if (!ov || ov.classList.contains('hidden') || cnFading) return;
  cnFading = true;
  const ease = 'cubic-bezier(.4,0,.2,1)';
  const fade = ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: ease, fill: 'forwards' });
  ov.querySelector('.cn-card')?.animate(
    [{ transform: 'none' }, { transform: 'translateY(-10px) scale(0.98)' }],
    { duration: 450, easing: ease, fill: 'forwards' },
  );
  fade.onfinish = () => {
    ov.classList.add('hidden');
    ov.getAnimations({ subtree: true }).forEach((a) => a.cancel()); // drop fill so re-show starts fresh
    cnFading = false;
  };
}
function failConnecting(message) {
  connecting = false;
  clearTimeout(cnSlowTimer);
  setConnStatus(`could not join: ${message}`);
  $('cnActions')?.classList.remove('hidden');
}
$('cnRetry') && ($('cnRetry').onclick = () => currentRoom && joinRoom(currentRoom));
$('cnBack') && ($('cnBack').onclick = () => leaveCall());

// ------------------------------------------------------------------ show ticker (mid-show dead air)
// Two kinds of real dead air get owned by one pill: the LLM writing the next
// segment (WRITERS' ROOM) and TTS rendering a voice (SOUND BOOTH, with an
// equalizer instead of dots + an "on deck" pulse on the robot about to speak).
const TICKER_MODES = {
  writing: {
    label: 'WRITERS’ ROOM',
    lines: ['drafting the next segment', 'reading the room', 'punching up the jokes',
      'arguing about the segue', 'checking the robots’ notes', 'one more pass on the banter'],
    emoji: ['💭', '✍️', '📝', '☕', '💡'],
  },
  voicing: {
    label: 'SOUND BOOTH',
    lines: ['warming up the voice box', 'mic check, one two', 'adjusting the pop filter',
      'a quick sip of oil', 'finding the right octave'],
    emoji: ['🎙️', '🎵', '💭'],
  },
};
// a little emoji drifts up from a host element and evaporates
function spawnThought(host, emoji) {
  if (!host || document.hidden) return;
  const s = document.createElement('span');
  s.className = 'thought';
  s.textContent = emoji;
  s.style.left = `${12 + Math.random() * 72}%`;
  host.appendChild(s);
  s.animate([
    { opacity: 0, transform: 'translateY(8px) scale(0.7)' },
    { opacity: 0.9, transform: 'translateY(-16px) scale(1)', offset: 0.25 },
    { opacity: 0, transform: 'translateY(-52px) scale(1.05)' },
  ], { duration: 2600, easing: 'ease-out' }).onfinish = () => s.remove();
}
function setBackstage(on) {
  for (const [, entry] of cards) entry.twin.setBackstage?.(on);
}
let swTimer = null;
let swDelay = null;
let swThoughts = null;
function showSegWriting(mode, text) {
  const conf = TICKER_MODES[mode] || TICKER_MODES.writing;
  clearTimeout(swDelay);
  // grace period: a sub-second TTS wait shouldn't flash the pill
  swDelay = setTimeout(() => {
    const el = $('segWriting');
    if (!el) return;
    el.classList.toggle('voicing', mode === 'voicing');
    $('swLabel').textContent = conf.label;
    $('swText').textContent = text || conf.lines[0];
    el.classList.remove('hidden');
    document.getElementById('view-call')?.classList.add('pondering');
    setBackstage(true); // robots hang out: more emotes, the odd dance
    clearInterval(swTimer);
    let i = 0;
    swTimer = setInterval(() => {
      const t = $('swText');
      if (!t) return;
      t.textContent = conf.lines[i++ % conf.lines.length];
      t.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    }, 3600);
    clearInterval(swThoughts);
    swThoughts = setInterval(() => {
      const list = [...cards.values()];
      if (!list.length) return;
      const entry = list[(Math.random() * list.length) | 0];
      spawnThought(entry.el, conf.emoji[(Math.random() * conf.emoji.length) | 0]);
    }, 1900);
  }, mode === 'voicing' ? 700 : 0);
}
function setOnDeck(speaker) {
  for (const [, entry] of cards) {
    const isNext = entry.el.querySelector('.name')?.textContent === speaker;
    entry.el.classList.toggle('ondeck', !!speaker && isNext);
  }
}
function hideSegWriting() {
  clearTimeout(swDelay);
  swDelay = null;
  clearInterval(swTimer);
  swTimer = null;
  clearInterval(swThoughts);
  swThoughts = null;
  $('segWriting')?.classList.add('hidden');
  document.getElementById('view-call')?.classList.remove('pondering');
  setBackstage(false);
  setOnDeck(null);
}

// ------------------------------------------------------------------ audio diagnostics shipper
// Every [st-audio] line is also POSTed to the backend so WebRTC failures on
// flaky clients can be read server-side (GET /api/admin/debug-log).
const DBG_TAG = `${/firefox|gecko\/\d/i.test(navigator.userAgent) && !/chrome/i.test(navigator.userAgent) ? 'ffx' : 'chr'}-${Math.random().toString(36).slice(2, 6)}`;
let dbgBuf = [];
function dbg(line) {
  console.log(`[st-audio] ${line}`);
  dbgBuf.push(line);
}
setInterval(() => {
  if (!dbgBuf.length) return;
  const lines = dbgBuf.splice(0, 50);
  fetch('/api/debug-log', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tag: DBG_TAG, lines }),
  }).catch(() => {});
}, 4000);
dbg(`ua=${navigator.userAgent.slice(0, 110)}`);

// per-track WebRTC stats: bytes/packets/loss/jitter + selected ICE pair
function startStatsSampler(track, identity, audioEl) {
  let last = { bytes: 0, packets: 0 };
  const iv = setInterval(async () => {
    if (!document.body.contains(audioEl)) return clearInterval(iv);
    try {
      const recv = track.receiver;
      if (!recv) { dbg(`${identity}: no receiver`); return; }
      const report = await recv.getStats();
      let inb = null, pair = null, transport = null;
      report.forEach((s) => {
        if (s.type === 'inbound-rtp') inb = s;
        if (s.type === 'transport') transport = s;
        if (s.type === 'candidate-pair' && (s.selected || s.nominated || s.state === 'succeeded')) pair = s;
      });
      const dBytes = inb ? inb.bytesReceived - last.bytes : -1;
      const dPkts = inb ? inb.packetsReceived - last.packets : -1;
      if (inb) last = { bytes: inb.bytesReceived, packets: inb.packetsReceived };
      dbg(`${identity}: Δbytes=${dBytes} Δpkts=${dPkts} lost=${inb?.packetsLost ?? '?'} ` +
        `jitter=${inb?.jitter?.toFixed?.(3) ?? '?'} lvl=${inb?.audioLevel?.toFixed?.(3) ?? 'n/a'} | ` +
        `el t=${audioEl.currentTime.toFixed(1)} paused=${audioEl.paused} vol=${audioEl.volume} muted=${audioEl.muted} | ` +
        `msTrack=${track.mediaStreamTrack.readyState}/${track.mediaStreamTrack.muted ? 'MUTED' : 'live'} | ` +
        `pair=${pair ? `${pair.state}${pair.nominated ? '/nom' : ''}` : 'none'} dtls=${transport?.dtlsState ?? '?'} ice=${transport?.iceState ?? transport?.iceConnectionState ?? '?'}`);
    } catch (e) {
      dbg(`${identity}: stats err ${String(e).slice(0, 60)}`);
    }
  }, 3000);
}

// ------------------------------------------------------------------ audio gate
// Firefox doesn't support the iframe `allow="autoplay"` policy HF wraps Spaces
// in, so it blocks our late-created <audio> elements (tracks arrive after the
// click gesture expires). When playback is blocked we surface a tap-for-sound
// button — clicking is a fresh gesture, and startAudio() retries every element.
function updateAudioGate() {
  const gate = $('audioGate');
  if (!gate) return;
  const blocked = lkRoom && lkRoom.canPlaybackAudio === false;
  console.log(`[st-audio] canPlaybackAudio=${lkRoom?.canPlaybackAudio} → gate ${blocked ? 'SHOWN' : 'hidden'}`);
  gate.classList.toggle('hidden', !blocked);
}
if ($('audioGate')) {
  $('audioGate').onclick = async () => {
    try { await lkRoom?.startAudio(); } catch {}
    if (audioCtx?.state === 'suspended') audioCtx.resume();
    updateAudioGate();
  };
}

// ------------------------------------------------------------------ subtitles
let subTimer = null;
function showSubtitle(speaker, text, color) {
  const bar = $('subtitles');
  if (!bar) return;
  bar.innerHTML = speaker
    ? `<b style="color:${color || 'var(--gold)'}">${speaker}</b><span>${text}</span>`
    : `<i>${text}</i>`;
  bar.classList.remove('hidden');
  clearTimeout(subTimer);
  subTimer = setTimeout(() => bar.classList.add('hidden'), 30000);
}
function handleData(payload) {
  try {
    const msg = JSON.parse(new TextDecoder().decode(payload));
    // if someone else started the show while we sat in the green room, move on
    if (!$('greenRoom')?.classList.contains('hidden')) { stopGreenRoom(); startWritingRoom(); }
    if (msg.type === 'line') {
      stopWritingRoom();
      hideSegWriting();
      showSubtitle(msg.speaker, msg.text, msg.color);
    } else if (msg.type === 'status') {
      // pre-show: real progress lands in the writers' room; between segments
      // and during TTS waits: the show ticker; anything else: subtitle bar
      if (wrTimer) $('wrStatus').textContent = msg.text;
      else if (msg.phase === 'writing') showSegWriting('writing', msg.text);
      else if (msg.phase === 'voicing') { showSegWriting('voicing', msg.text); setOnDeck(msg.speaker); }
      else showSubtitle(null, msg.text);
    }
  } catch {}
}
function removeCard(identity) {
  const entry = cards.get(identity);
  if (!entry) return;
  // tear down audio so <audio> elements + WebAudio nodes don't leak across joins
  try { entry.track?.detach(); } catch {}
  try { entry.audioEl?.remove(); } catch {}
  entry.twin.dispose();
  entry.el.remove();
  cards.delete(identity);
  if (identity === activeId) activeId = null;
  applyLayout(true);
}
function flip(els, mutate) {
  if (document.hidden) return mutate();
  const first = new Map(els.map((e) => [e, e.getBoundingClientRect()]));
  mutate();
  for (const e of els) {
    const f = first.get(e);
    const l = e.getBoundingClientRect();
    if (!f.width || !l.width) continue;
    const dx = f.left - l.left, dy = f.top - l.top, sx = f.width / l.width, sy = f.height / l.height;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01) continue;
    e.animate([{ transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, { transform: 'none' }],
      { duration: 420, easing: 'cubic-bezier(.4,0,.2,1)' });
  }
}
function applyLayout(animate = true) {
  const els = [...cards.values()].map((e) => e.el);
  const run = () => {
    if (layout === 'spotlight') {
      grid.classList.add('hidden');
      spotlight.classList.remove('hidden');
      const active = cards.has(activeId) ? activeId : cards.keys().next().value;
      for (const [id, entry] of cards) {
        entry.el.classList.toggle('active', id === active);
        (id === active ? spotMain : spotStrip).appendChild(entry.el);
      }
    } else {
      spotlight.classList.add('hidden');
      grid.classList.remove('hidden');
      const n = Math.max(cards.size, 1);
      grid.style.gridTemplateColumns = `repeat(${Math.ceil(Math.sqrt(n))}, minmax(0,1fr))`;
      for (const entry of cards.values()) { entry.el.classList.remove('active'); grid.appendChild(entry.el); }
    }
  };
  animate ? flip(els, run) : run();
}
function setActive(id) {
  if (id === activeId) return;
  activeId = id;
  if (layout === 'spotlight') applyLayout(true);
}

function attachAudio(track, participant) {
  // a publisher voicing a physical robot lights up the DEVICE's card — one card
  // per robot, and the web twin mirrors what the real robot is saying
  const meta = parseMeta(participant);
  const entry = (meta.forDevice && cards.get(meta.forDevice)) || ensureCard(participant);
  if (entry.audioEl) return;
  const audioEl = track.attach();
  // audio diagnostics — shipped to /api/debug-log (filter console for [st-audio])
  const id = participant.identity;
  ['playing', 'pause', 'stalled', 'suspend', 'waiting', 'ended', 'error'].forEach((ev) =>
    audioEl.addEventListener(ev, () => dbg(`${id}: element ${ev} (t=${audioEl.currentTime.toFixed(1)})`)));
  track.mediaStreamTrack.onmute = () => dbg(`${id}: TRACK MUTED (media stopped or sink conflict)`);
  track.mediaStreamTrack.onunmute = () => dbg(`${id}: track unmuted`);
  audioEl.play().then(() => dbg(`${id}: play() ok`)).catch((e) => dbg(`${id}: play() BLOCKED ${e.name}`));
  setTimeout(() => {
    const s = (track.receiver?.getSynchronizationSources?.() || [])[0];
    dbg(`${id}: syncSource ${s ? `lvl=${s.audioLevel} ts=${Math.round(s.timestamp)}` : 'NONE'}`);
  }, 6000);
  startStatsSampler(track, id, audioEl);
  audioEl.classList.add('hidden-audio');
  document.body.appendChild(audioEl);
  // NO WebAudio here: Firefox routes a remote track's audio to either the
  // speakers or a WebAudio tap — not both (cloning doesn't help; the limit is
  // the underlying source). Speech levels come from the RTP receiver instead
  // (getSynchronizationSources), so the <audio> element stays the only consumer.
  entry.receiver = track.receiver || null;
  entry.track = track; // kept so we can detach (remove the <audio>) on leave
  entry.audioEl = audioEl;
}
// Speech levels WITHOUT WebAudio (Firefox routes a remote track to either the
// speakers or a WebAudio tap — never both). Primary: RTP sync-source audioLevel.
// Fallback: inbound byte rate — a talking opus track runs ~6KB/s vs ~0.1KB/s
// keepalive, which makes a perfectly good speech envelope.
async function sampleLevels() {
  for (const [, entry] of cards) {
    const r = entry.receiver;
    if (!r) continue;
    let level = null;
    const s = (r.getSynchronizationSources?.() || [])[0];
    if (s && typeof s.audioLevel === 'number') {
      const fresh = Math.min(
        Math.abs(performance.timeOrigin + performance.now() - s.timestamp),
        Math.abs(performance.now() - s.timestamp),
      ) < 400;
      level = fresh ? Math.min(1, s.audioLevel * 5) : 0;
    }
    if (level === null) {
      try {
        let bytes = 0;
        (await r.getStats()).forEach((st) => { if (st.type === 'inbound-rtp') bytes = st.bytesReceived; });
        const now = performance.now();
        if (entry._lvlBytes != null) {
          const rate = ((bytes - entry._lvlBytes) / Math.max(1, now - entry._lvlAt)) * 1000;
          level = Math.max(0, Math.min(1, (rate - 1200) / 4000));
        } else level = 0;
        entry._lvlBytes = bytes;
        entry._lvlAt = now;
      } catch { level = 0; }
    }
    entry.level = level;
  }
}
setInterval(sampleLevels, 250);

function pollLevels() {
  requestAnimationFrame(pollLevels);
  let loudest = null, max = 0;
  for (const [id, entry] of cards) {
    if (!entry.receiver) continue;
    entry.twin.setLevel(entry.level || 0);
    entry.el.classList.toggle('talking', entry.twin.level > 0.04);
    if (entry.twin.level > max) { max = entry.twin.level; loudest = id; }
  }
  if (loudest && max > 0.06) setActive(loudest);
}
pollLevels();

// ------------------------------------------------------------------ join / leave
function updateViewers() {
  if (!lkRoom) return;
  const others = [...lkRoom.remoteParticipants.values()].filter((p) => p.identity.startsWith('viewer-')).length;
  const n = others + 1; // include yourself
  const e = document.getElementById('chViewers');
  if (e) e.textContent = `${n} watching`;
}
async function joinRoom(r) {
  if (lkRoom || cards.size) await leaveCall(false); // never stack two sessions
  currentRoom = r;
  layout = r.template === 'duo' ? 'grid' : 'spotlight';
  activeId = null;
  // flip to the call view IMMEDIATELY — the patching-in overlay owns the wait
  $('callEmoji').textContent = r.emoji || '🎙️';
  $('callTitle').textContent = r.title;
  $('callTopic').textContent = r.topic || '';
  showView('call');
  startConnecting();
  try {
    // join (kicks the show off server-side) and the token are independent — race them
    setConnStatus('minting your backstage pass…');
    const [, { token, url }] = await Promise.all([
      api(`/api/rooms/${r.id}/join`, { method: 'POST' }),
      api('/api/token', { method: 'POST', body: { name: 'Audience', room: r.id } }),
    ]);
    setConnStatus('patching you into the feed…');
    // dual peer connection mode: in single-PC mode (the v2 default) the BROWSER
    // is the SDP offerer and self-hosted livekit-server answers with its own
    // opus payload type (111) instead of mirroring the offered one — Gecko
    // can't do asymmetric payload types (Chromium can), so Firefox/Zen decode
    // pure silence while packets flow. With dual PCs the server offers and the
    // browser mirrors, so the mismatch can't happen. (livekit/livekit #4535)
    lkRoom = new Room({ singlePeerConnection: false });
    // any robot (publisher, guest, or a PHYSICAL Reachy companion) gets a card —
    // except publishers that VOICE a device (their audio rides the device's card)
    const maybeCard = (p) => {
      if (p.identity.startsWith('stage-')) return;
      const meta = parseMeta(p);
      if (meta.role !== 'reachy' || meta.forDevice) return;
      stopWritingRoom();
      ensureCard(p);
    };
    lkRoom
      .on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
        if (p.identity.startsWith('stage-')) return; // hidden stage manager
        if (track.kind === Track.Kind.Audio) { stopWritingRoom(); attachAudio(track, p); }
      })
      .on(RoomEvent.ParticipantConnected, (p) => { maybeCard(p); updateViewers(); updateGreenRoom(); })
      .on(RoomEvent.ParticipantDisconnected, (p) => { removeCard(p.identity); updateViewers(); updateGreenRoom(); })
      .on(RoomEvent.DataReceived, (payload) => handleData(payload))
      .on(RoomEvent.AudioPlaybackStatusChanged, updateAudioGate)
      .on(RoomEvent.ConnectionStateChanged, (s) => dbg(`room connection: ${s}`))
      .on(RoomEvent.Reconnecting, () => dbg('room RECONNECTING'))
      .on(RoomEvent.Reconnected, () => dbg('room reconnected'))
      .on(RoomEvent.TrackStreamStateChanged, (pub, state, p) => dbg(`${p.identity}: stream state → ${state}`))
      .on(RoomEvent.TrackUnsubscribed, (_t, _pub, p) => dbg(`${p.identity}: track UNSUBSCRIBED`))
      .on(RoomEvent.Disconnected, (reason) => dbg(`room disconnected: ${reason}`));
    await lkRoom.connect(url, token);
    try { await lkRoom.startAudio(); } catch {} // FF in the HF iframe may reject — the gate handles it
    updateAudioGate();
    updateViewers();
    setConnStatus('waking the cast…');
    for (const p of lkRoom.remoteParticipants.values()) {
      if (p.identity.startsWith('stage-')) continue;
      maybeCard(p);
      for (const pub of p.trackPublications.values())
        if (pub.track && pub.kind === Track.Kind.Audio) attachAudio(pub.track, p);
    }

    currentGuestId = null;
    // demos are watch-only — your designer Reachy only takes the stage in live rooms
    if (UGC_ENABLED && userReachy && r.template === 'open') {
      try {
        const g = await api(`/api/rooms/${r.id}/reachy`, { method: 'POST', body: userReachy });
        currentGuestId = g.identity;
      } catch {}
    }

    applyLayout(false);
    // open shows: green room while waiting for robots; writers' room once started.
    // Otherwise the overlay stays until the first robot card lands (ensureCard).
    if (r.template === 'open' && r.status === 'waiting') { stopConnecting(); openGreenRoom(r); }
    else if (r.template === 'open' && cards.size === 0) { stopConnecting(); startWritingRoom(); }
    else {
      $('subtitles')?.classList.add('hidden');
      if (cards.size) stopConnecting();
    }
  } catch (e) {
    failConnecting(e.message);
  }
}
function dropGuest() {
  if (currentGuestId && currentRoom) {
    api(`/api/rooms/${currentRoom.id}/reachy/leave`, { method: 'POST', body: { identity: currentGuestId } }).catch(() => {});
  }
  currentGuestId = null;
}
async function leaveCall(goHome = true) {
  dropGuest();
  if (lkRoom) { try { await lkRoom.disconnect(); } catch {} lkRoom = null; }
  for (const id of [...cards.keys()]) removeCard(id);
  // sweep any stray audio elements so re-joining never stacks/echoes
  document.querySelectorAll('.hidden-audio').forEach((e) => e.remove());
  currentRoom = null;
  activeId = null;
  clearTimeout(subTimer);
  stopWritingRoom();
  stopGreenRoom();
  hideSegWriting();
  connecting = false;
  clearTimeout(cnSlowTimer);
  $('connecting')?.classList.add('hidden');
  $('cnActions')?.classList.add('hidden');
  $('audioGate')?.classList.add('hidden');
  $('subtitles')?.classList.add('hidden');
  if (goHome) {
    showView('home');
    loadRooms();
  }
}
// best-effort cleanup if the tab is closed mid-call (sendBeacon survives unload)
window.addEventListener('pagehide', () => {
  if (currentGuestId && currentRoom) {
    navigator.sendBeacon(
      `/api/rooms/${currentRoom.id}/reachy/leave`,
      new Blob([JSON.stringify({ identity: currentGuestId })], { type: 'application/json' }),
    );
  }
});

// ------------------------------------------------------------------ themes (switchable skins)
const THEMES = [
  { id: 'ghost', label: 'Ghost' },
  { id: 'tron', label: 'Tron' },
  { id: 'kinetic', label: 'Kinetic' },
  { id: 'oracle', label: 'Oracle' },
  { id: 'lithos', label: 'Lithos' },
  { id: 'observatory', label: 'Observatory' },
  { id: 'foundry', label: 'Foundry' },
  { id: 'blueprint', label: 'Blueprint' },
  { id: 'dossier', label: 'Dossier' },
  { id: 'concrete', label: 'Concrete' },
  { id: 'editorial', label: 'Gold' },
];

// Lithos cursor spotlight: a soft-masked circle trails the cursor (eased). Its
// strata pattern uses background-attachment: fixed, so the pattern stays
// page-anchored while the circle moves — a true "reveal" with zero canvas work.
const SPOTLIGHT_R = 300;
const _spot = { mx: -2000, my: -2000, sx: -2000, sy: -2000 };
window.addEventListener('mousemove', (e) => { _spot.mx = e.clientX; _spot.my = e.clientY; });
function spotlightLoop() {
  requestAnimationFrame(spotlightLoop);
  const reveal = $('lithosReveal');
  if (theme !== 'lithos' || !reveal || views.home.classList.contains('hidden')) return;
  _spot.sx += (_spot.mx - _spot.sx) * 0.1;
  _spot.sy += (_spot.my - _spot.sy) * 0.1;
  // left/top (not transform) so background-attachment: fixed keeps working
  reveal.style.left = _spot.sx - SPOTLIGHT_R + 'px';
  reveal.style.top = _spot.sy - SPOTLIGHT_R + 'px';
}
let theme = localStorage.getItem('theme') || 'ghost';
if (!THEMES.some((t) => t.id === theme)) theme = 'ghost'; // saved theme may have been retired
function refreshHero() {
  if (hero) { hero.dispose(); hero = null; }
  if (!views.home.classList.contains('hidden')) {
    try { hero = new HeroReachy($('hero3d')); } catch { hero = null; }
  }
}
function setTheme(id, { rebuild = true } = {}) {
  theme = id;
  document.documentElement.setAttribute('data-theme', id);
  localStorage.setItem('theme', id);
  const sel = $('themePicker')?.querySelector('select');
  if (sel && sel.value !== id) sel.value = id;
  if (rebuild) refreshHero(); // so the holographic Reachy adopts the theme accent
}
function buildThemePicker() {
  const host = $('themePicker');
  if (!host) return;
  host.innerHTML = '<span class="tp-label">THEME</span>';
  const sel = el('select', 'theme-select');
  THEMES.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.label;
    if (t.id === theme) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => setTheme(sel.value);
  host.appendChild(sel);
}

// ------------------------------------------------------------------ home FX (anar-labs flavour)
const GLYPHS = '▚▖�364ABDEFKR#%@░▒█/<>*┐└┤';
function scramble(elm, finalText, ms = 1000) {
  const chars = [...finalText];
  const start = performance.now();
  (function frame(now) {
    const p = Math.min(1, (now - start) / ms);
    const shown = Math.floor(p * chars.length);
    elm.textContent = chars
      .map((c, i) => (c === ' ' ? ' ' : i < shown ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0]))
      .join('');
    if (p < 1) requestAnimationFrame(frame);
    else elm.textContent = finalText;
  })(performance.now());
}
const BOOT_LINES = [
  '> establishing uplink…',
  '> tuning receiver · 98.6 robot fm',
  '> decoding live chatter',
  '> <span class="ok">signal locked ✓</span>',
];
function runBoot() {
  const boot = $('boot');
  if (!boot) return;
  let i = 0;
  (function tick() {
    if (i < BOOT_LINES.length) {
      boot.innerHTML = BOOT_LINES.slice(0, ++i).join('<br>') + '<span class="cur">&nbsp;</span>';
      setTimeout(tick, 360);
    } else {
      setTimeout(() => (boot.style.opacity = '0'), 1100);
    }
  })();
}
const TICKER = [
  { t: '● NOW BROADCASTING', hot: true },
  { t: 'THE GROUP CHAT — IS A HOT DOG A SANDWICH?' },
  { t: 'FIVE ROBOTS · ZERO CONSENSUS' },
  { t: '● START YOUR OWN SHOW', hot: true },
  { t: 'CAN A 4B MODEL BE CHARMING?' },
  { t: 'BRAINS · NEMOTRON 4B VIA LLAMA.CPP' },
  { t: 'VOICES · QWEN3-TTS VOICEDESIGN' },
  { t: 'HOSTS · REACHY MINI — REAL ONES WELCOME' },
];
function initHomeFX() {
  const track = $('tickerTrack');
  if (track) {
    const seg = TICKER.map((s) => `<span class="${s.hot ? 'b' : ''}">${s.t}</span><span class="sep">/</span>`).join('');
    track.innerHTML = seg + seg; // duplicated for a seamless -50% loop
  }
  runBoot();
  const sweep = document.querySelector('.home-content .text-sweep');
  if (sweep) {
    const final = sweep.textContent;
    setTimeout(() => {
      // lock the box to its final width so the random-width scramble glyphs
      // animate in place instead of shoving the layout around…
      sweep.style.display = 'inline-block';
      sweep.style.width = sweep.offsetWidth + 2 + 'px';
      sweep.style.whiteSpace = 'nowrap';
      sweep.style.overflow = 'hidden';
      sweep.style.verticalAlign = 'top';
      scramble(sweep, final, 1150);
      // …then release it so switching to a wider-headline theme doesn't clip
      setTimeout(() => {
        sweep.style.cssText = '';
      }, 1350);
    }, 480);
  }
}

// ------------------------------------------------------------------ admin (#admin)
const admToken = () => $('admToken')?.value || localStorage.getItem('admToken') || '';
const admSelected = new Set();
let admRooms = [];
async function admApi(path, method = 'GET', body = null) {
  const res = await fetch(path, {
    method,
    headers: { 'x-admin-token': admToken(), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(res.status === 403 ? 'bad token' : `HTTP ${res.status}`);
  return res.json();
}
async function loadAdmin() {
  const list = $('admList');
  if (!list) return;
  localStorage.setItem('admToken', $('admToken').value || localStorage.getItem('admToken') || '');
  try {
    admRooms = (await admApi('/api/admin/rooms')).rooms;
  } catch (e) {
    list.innerHTML = `<div class="adm-meta">⚠ ${e.message}</div>`;
    return;
  }
  renderAdmin();
}
function renderAdmin() {
  const list = $('admList');
  const q = ($('admSearch')?.value || '').trim().toLowerCase();
  for (const id of [...admSelected]) if (!admRooms.some((r) => r.id === id)) admSelected.delete(id);
  list.innerHTML = '';
  const shown = admRooms
    .filter((r) => !q || `${r.title} ${r.topic} ${r.id}`.toLowerCase().includes(q))
    .sort((a, b) => (b.task === 'running') - (a.task === 'running') || (b.viewers || 0) - (a.viewers || 0));
  shown.forEach((r) => {
    const row = el('div', 'adm-row' + (admSelected.has(r.id) ? ' sel' : ''));
    const cb = el('input');
    cb.type = 'checkbox';
    cb.className = 'adm-cb';
    cb.checked = admSelected.has(r.id);
    cb.onchange = () => { cb.checked ? admSelected.add(r.id) : admSelected.delete(r.id); renderAdmin(); };
    const body = el('div', 'adm-body');
    const head = el('div', 'adm-head');
    head.textContent = `${r.emoji} ${r.title}`;
    if (r.task === 'running') head.appendChild(el('span', 'adm-live', 'LIVE'));
    if (r.seed) head.appendChild(el('span', 'adm-tag', 'seed'));
    const topic = el('div', 'adm-topic');
    topic.textContent = r.topic || '—';
    const meta = el('div', 'adm-meta');
    meta.textContent = `${r.task} · ${r.publishers} cast · ${r.viewers} watching · ${r.template}`;
    body.append(head, topic, meta);
    const acts = el('div', 'adm-acts');
    if (r.task === 'running') {
      const stop = el('button', 'btn btn-ghost btn-sm', '⏹ Stop');
      stop.title = 'Stop the show — the room stays and restarts on the next join';
      stop.onclick = async () => { stop.disabled = true; try { await admApi(`/api/admin/rooms/${r.id}/stop`, 'POST'); } catch {} loadAdmin(); };
      acts.appendChild(stop);
    }
    if (!r.seed) {
      const del = el('button', 'btn btn-ghost btn-sm adm-danger', '🗑 Delete');
      del.title = 'Stop and remove this room entirely';
      del.onclick = async () => { del.disabled = true; try { await admApi(`/api/admin/rooms/${r.id}`, 'DELETE'); } catch {} loadAdmin(); };
      acts.appendChild(del);
    }
    row.append(cb, body, acts);
    list.appendChild(row);
  });
  if (!shown.length) list.innerHTML = '<div class="adm-meta">nothing matches</div>';
  const n = admSelected.size;
  $('admStopSel').textContent = n ? `⏹ Stop selected (${n})` : '⏹ Stop selected';
  $('admDelSel').textContent = n ? `🗑 Delete selected (${n})` : '🗑 Delete selected';
  $('admStopSel').disabled = $('admDelSel').disabled = !n;
}
if ($('admRefresh')) {
  $('admRefresh').onclick = loadAdmin;
  $('admSearch').addEventListener('input', renderAdmin);
  $('admStopSel').onclick = async () => {
    try { await admApi('/api/admin/stop-batch', 'POST', { ids: [...admSelected], delete: false }); } catch {}
    admSelected.clear(); loadAdmin();
  };
  $('admDelSel').onclick = async () => {
    if (!confirm(`Delete ${admSelected.size} room(s) entirely?`)) return;
    try { await admApi('/api/admin/stop-batch', 'POST', { ids: [...admSelected], delete: true }); } catch {}
    admSelected.clear(); loadAdmin();
  };
  $('admStopAll').onclick = async () => {
    if (!confirm('Stop every running show? (rooms stay; they restart on the next join)')) return;
    try { await admApi('/api/admin/stop-all', 'POST'); } catch {}
    loadAdmin();
  };
  $('admToken').value = localStorage.getItem('admToken') || '';
  setInterval(() => { if (!views.admin.classList.contains('hidden')) loadAdmin(); }, 10000);
}

// ------------------------------------------------------------------ boot
if ($('topHelp')) $('topHelp').onclick = () => openExplainer();
setTheme(theme, { rebuild: false }); // apply saved/default theme before first paint
buildThemePicker();
spotlightLoop(); // Lithos cursor reveal (no-op until that theme is active)
showView(location.hash === '#admin' ? 'admin' : location.hash === '#radio' ? 'radio' : 'home');
if (location.hash === '#admin') loadAdmin();
window.addEventListener('hashchange', () => {
  if (location.hash === '#admin') { showView('admin'); loadAdmin(); }
  else if (location.hash === '#radio') showView('radio');
});
initHomeFX();
loadRooms();
setInterval(() => { if (views.home && !views.home.classList.contains('hidden')) loadRooms(); }, 12000);
