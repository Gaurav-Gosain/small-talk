// ReachyTwin — a self-contained three.js view of one Reachy Mini, sized to fit
// a meeting-grid card. Loads the URDF + STL meshes pulled from the
// pollen-robotics desktop app, and animates the antennas / head bob from an
// audio level so the twin "talks" in sync with its voice track.
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import URDFLoader from 'urdf-loader';
import { makeDanceState, danceStep, makeTalkState, talkStep } from './dance.js';

const _gltf = new GLTFLoader();
const DEG = Math.PI / 180;
// Slot placement. We MEASURE the head (crown/centre/bottom + front depth) per
// twin, so anchors track the real geometry instead of guessed constants:
//   ref  = head landmark the prop attaches near ('top'=crown, 'mid', 'bot')
//   lift = metres above/below that landmark (world-up)
//   anchor = which face of the PROP meets that point ('bottom' rests on, 'center'
//            straddles, 'top' hangs below)
//   fwdFrac = fraction of the head's front depth to push toward the face (camera)
//   scale  = target size (fraction of head size)
const PROP_SLOTS = {
  hat:  { ref: 'top', lift: 0.006, anchor: 'bottom', region: 'bottom', side: 0, scale: 1.05 },
  face: { ref: 'mid', lift: 0.004,  anchor: 'center', zAnchor: 'front', gap: 0.012, side: 0, scale: 0.98 },
  neck: { ref: 'bot', lift: -0.022, anchor: 'center', zAnchor: 'back', fwdRef: 'body', gap: 0.002, side: 0, scale: 0.72 },
};
// Per-prop overrides (deltas on the slot default). `rot` ([x,y,z]° in the
// world-upright wear frame) fixes oddly-modelled props.
const PROP_OVERRIDES = {
  halo: { rot: [90, 0, 0], anchor: 'center', ref: 'top', lift: 0.05 }, // flat ring floating above
  monocle: { scale: 0.46, side: 0.036, lift: -0.012, gap: 0.02 }, // ON the right eye, not above it
  skigoggles: { gap: 0.024 },          // stand proud of the face mesh
  necktie: { lift: -0.016, rot: [-10, 0, 0], scale: 0.6 }, // knot below the chin, tie follows the chest slope
  party: { scale: 0.85, side: 0.014 }, // tall cone sits left of its base centre
  wizard: { rot: [-6, 0, 0], scale: 0.92 }, // the GLB leans; nudge it upright
  pirate: { lift: -0.016 },            // rides high otherwise
  baseball: { rot: [0, 45, 0], lift: -0.006 }, // brim modelled diagonally — turn it to the front
};

// Vertex-sampled bounds of `root` in its parent frame (root's own transform
// applied; call AFTER root.updateMatrixWorld(true) while detached). Returns the
// full bounds plus the x/z centre of a horizontal slab — 'bottom' = the lowest
// 35% (a hat's brim: the part that actually touches the head), 'top' = highest
// 35%. Aligning by the wear region instead of the whole bbox is what stops a
// leaning tip or hanging chain from dragging the prop off-centre.
function _wearBounds(root, region = 'all') {
  const full = new THREE.Box3();
  const pts = [];
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 5000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      full.expandByPoint(v);
      pts.push(v.x, v.y, v.z);
    }
  });
  if (full.isEmpty()) return null;
  // percentile heights: a pirate hat's ribbon or a mortarboard's tassel is a
  // thin dangling outlier — seating on the absolute min.y floats the hat by the
  // ribbon's length. The 6th/94th percentiles are where the BODY of the prop is.
  const ys = [];
  for (let i = 1; i < pts.length; i += 3) ys.push(pts[i]);
  ys.sort((a, b) => a - b);
  const loY = ys[Math.floor(ys.length * 0.06)];
  const hiY = ys[Math.floor(ys.length * 0.94)];
  const h = hiY - loY;
  const y0 = region === 'top' ? hiY - 0.35 * h : loY;
  const y1 = region === 'bottom' ? loY + 0.35 * h : hiY;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const y = pts[i + 1];
    if (y < y0 || y > y1) continue;
    if (pts[i] < minX) minX = pts[i];
    if (pts[i] > maxX) maxX = pts[i];
    if (pts[i + 2] < minZ) minZ = pts[i + 2];
    if (pts[i + 2] > maxZ) maxZ = pts[i + 2];
  }
  const ok = minX !== Infinity;
  return {
    full, loY, hiY,
    cx: ok ? (minX + maxX) / 2 : (full.min.x + full.max.x) / 2,
    cz: ok ? (minZ + maxZ) / 2 : (full.min.z + full.max.z) / 2,
  };
}

// World-space bbox of an object's meshes, skipping given subtree roots (so the
// thin/tall antennas don't inflate the measured head crown).
function _meshWorldBox(root, skip, out = new THREE.Box3()) {
  out.makeEmpty();
  const v = new THREE.Vector3();
  (function walk(o) {
    if (skip.has(o)) return;
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      o.updateWorldMatrix(true, false);
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z)
          .applyMatrix4(o.matrixWorld);
        out.expandByPoint(v);
      }
    }
    for (const c of o.children) walk(c);
  })(root);
  return out;
}

const URDF_URL = '/robot-3d/reachy-mini.urdf';
const MOVES_URL = '/moves/reachy-moves.json';
// Yaw applied (about vertical) to turn the robot's face toward the camera.
const FACE_YAW = -Math.PI / 2;

const lerp = (a, b, w) => a + (b - a) * w;
const rand = (a, b) => a + Math.random() * (b - a);

// Listener reactions: when a twin is NOT the active speaker it periodically
// plays a recorded emotion (and occasionally a dance) to emote at the speaker.
const REACT_SPEAK_LEVEL = 0.06; // above this audio level the twin is "speaking"
const REACT_GAP_MIN = 1.0; // seconds between reactions
const REACT_GAP_MAX = 3.5;
const MOVE_FADE = 0.35; // fade in/out so moves blend with breathing
const DANCE_CHANCE = 0.12; // chance a reaction is a full dance instead

// Recorded emotion/dance trajectories, fetched once and shared by all twins.
let _movesLib = null;
let _movesLoad = null;
export function loadMoves() {
  if (_movesLoad) return _movesLoad;
  _movesLoad = fetch(MOVES_URL)
    .then((r) => r.json())
    .then((d) => {
      d.idx = Object.fromEntries(d.cols.map((c, i) => [c, i]));
      d.reactions = Object.keys(d.moves).filter((n) => d.moves[n].kind === 'emotion');
      // Skip pure-spin dances — they turn the robot's face away from the camera.
      d.dances = Object.keys(d.moves).filter(
        (n) => d.moves[n].kind === 'dance' && n !== 'dizzy_spin',
      );
      _movesLib = d;
      return d;
    })
    .catch((e) => {
      console.warn('Reachy moves failed to load (reactions disabled)', e);
      return null;
    });
  return _movesLoad;
}

const D2R = Math.PI / 180;
const TAU = Math.PI * 2;

// Motion model, lifted from pollen's reachy_mini_conversation_app:
//  - idle "breathing": a slow vertical bob + counter-phase antenna sway
//  - speech wobble: per-DOF sinusoids on the head (roll/pitch/yaw + x/y/z),
//    amplitude scaled by the live audio level. We apply the 6-DOF offset to the
//    head-platform link (xl_330) directly — the same head-pose abstraction the
//    real robot uses, sidestepping Stewart-platform IK.
const BREATHE_Z_M = 0.005; // 5 mm vertical bob
const BREATHE_HZ = 0.1;
const ANT_SWAY_RAD = 15 * D2R; // idle antenna sway
const ANT_HZ = 0.5;
const BODY_YAW_RAD = 2.5 * D2R; // slow idle "look around" (gentle, so props don't swing off-centre)
const BODY_YAW_HZ = 0.06;
// Audio-level envelope time constants (seconds): quick to rise, slow to fall.
const LEVEL_ATTACK_S = 0.08;
const LEVEL_RELEASE_S = 0.32;
// antenna spring (VTuber-style secondary motion): the antennas trail + overshoot
// the target pose like ears/hair. ~2.7 Hz, slightly underdamped.
const ANT_STIFF = 280;
const ANT_DAMP = 13;
// expressive dance + talking motion lives in dance.js (danceStep / talkStep)

// Load + parse the URDF once, then clone the resulting object per card.
let _robotProto = null;
let _robotLoad = null;

function loadRobotPrototype() {
  if (_robotLoad) return _robotLoad;
  return (_robotLoad = _startRobotLoad());
}

function _startRobotLoad() {
  return new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    const loader = new URDFLoader(manager);
    loader.loadMeshCb = (path, mgr, done) => {
      new STLLoader(mgr).load(
        path,
        (geom) => {
          geom.computeVertexNormals();
          const mat = new THREE.MeshStandardMaterial({
            color: 0x9aa1ab,
            metalness: 0.35,
            roughness: 0.55,
          });
          done(new THREE.Mesh(geom, mat));
        },
        undefined,
        (err) => done(null, err),
      );
    };
    let robot = null;
    // URDF onComplete fires before the async STL meshes finish; wait for the
    // LoadingManager to report all meshes loaded so the prototype (and its
    // clones) actually have geometry before we measure / frame it.
    manager.onLoad = () => {
      if (robot) {
        _robotProto = robot;
        resolve(robot);
      }
    };
    loader.load(
      URDF_URL,
      (r) => {
        robot = r;
      },
      undefined,
      reject,
    );
  });
}

/** Load the URDF once and return an independent clone (for the hero / twins). */
export async function loadReachyClone() {
  const proto = await loadRobotPrototype();
  return proto.clone();
}

export class ReachyTwin {
  constructor(container, { accent = '#c98a3c', interactive = false, bodyColor = null } = {}) {
    this.container = container;
    this.accent = new THREE.Color(accent);
    this._pendingTint = bodyColor;
    this._interactive = interactive;
    this._orbitYaw = 0;
    this._orbitPitch = 0;
    this._zoom = 1;
    this.level = 0; // smoothed audio level, 0..1
    this._targetLevel = 0; // raw level from the grid, smoothed in _tick
    this._dance = null; // music dance params {clock, intensity} (radio DJ), or null
    this._t = 0; // accumulated wall-clock seconds (frame-rate independent)
    this._clock = new THREE.Clock();
    this._disposed = false;
    this._move = null; // active emotion/dance reaction
    this._nextReactAt = rand(0.5, 2.5);
    loadMoves().then((lib) => (this._lib = lib));

    const w = container.clientWidth || 320;
    const h = container.clientHeight || 240;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this._addLights();

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);

    this._raf = requestAnimationFrame(this._tick);
    this._loadRobot();
  }

  _addLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x33302b, 1.1));
    const key = new THREE.DirectionalLight(0xfff3e0, 1.4);
    key.position.set(1.5, 2, 1.2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(this.accent.clone(), 0.6);
    rim.position.set(-1.5, 0.5, -1.5);
    this.scene.add(rim);
  }

  async _loadRobot() {
    let proto;
    try {
      proto = await loadRobotPrototype();
    } catch (e) {
      console.error('Failed to load Reachy URDF', e);
      return;
    }
    if (this._disposed) return;

    // Clone so each card has independent joints. urdf-loader robots are
    // THREE.Object3D subclasses; clone() preserves the joint/link maps.
    this.robot = proto.clone();
    // URDF is Z-up; three.js is Y-up.
    this.robot.rotation.x = -Math.PI / 2;
    // Wrap in a pivot so we can yaw the (now upright) robot to face the camera
    // without fighting Euler order on the robot itself.
    this.pivot = new THREE.Group();
    this.pivot.rotation.y = FACE_YAW;
    this.pivot.add(this.robot);
    this.scene.add(this.pivot);

    this._frameCamera();

    // Capture rest pose for the joints + head link we animate.
    this._rest = {};
    for (const name of ['left_antenna', 'right_antenna', 'yaw_body']) {
      const j = this.robot.joints?.[name];
      this._rest[name] = j ? j.angle ?? 0 : 0;
    }
    // The head platform link carries the head meshes AND both antennas, so a
    // 6-DOF offset here moves the whole head about the neck pivot. We apply the
    // wobble in WORLD axes (nod=X, shake=Y, tilt=Z, vertical bob=Y) and convert
    // into the link's local frame, so the motion reads correctly regardless of
    // xl_330's arbitrary URDF orientation.
    this.head = this.robot.links?.['xl_330'] || null;
    if (this.head) {
      this.pivot.updateMatrixWorld(true);
      this._headRestPos = this.head.position.clone();
      this._headRestLocalQuat = this.head.quaternion.clone();
      this._parentWorldQuatInv = this.head.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      this._headRestWorldQuat = this.head.getWorldQuaternion(new THREE.Quaternion());
      // measure the head dome (minus antennas) so props anchor to real geometry
      const antennas = new Set(
        [this.robot.joints?.left_antenna, this.robot.joints?.right_antenna].filter(Boolean));
      const hb = _meshWorldBox(this.head, antennas);
      const ho = this.head.getWorldPosition(new THREE.Vector3());
      this._headTopUp = hb.max.y - ho.y; // crown above origin (world-up)
      this._headMidUp = (hb.min.y + hb.max.y) / 2 - ho.y;
      this._headBotUp = hb.min.y - ho.y;
      this._headFrontFwd = hb.max.z - ho.z; // how far the face sticks toward camera
      this._headCtrX = (hb.min.x + hb.max.x) / 2 - ho.x; // head's visual centre vs the link origin
      this._headCtrZ = (hb.min.z + hb.max.z) / 2 - ho.z; // dome centre front-to-back
      this._headSize = Math.max(hb.max.x - hb.min.x, hb.max.y - hb.min.y);
      this._headWidth = hb.max.x - hb.min.x; // left-right, for the headphone cups
      // the belly sticks out further than the head — neck props anchor to it
      const rb = new THREE.Box3().setFromObject(this.robot);
      this._bodyFrontFwd = rb.max.z - ho.z;
    }
    if (this._pendingTint) this.setBodyTint(this._pendingTint);
    if (this._pendingProps) { // props requested before the URDF finished loading
      const pend = this._pendingProps; this._pendingProps = null;
      for (const [slot, [url, ov]] of Object.entries(pend)) this.setProp(slot, url, ov);
    }
    if (this._interactive) this._bindOrbit();
    this._seed = Math.random() * TAU; // per-twin phase so the two robots differ
    this._euler = new THREE.Euler();
    this._q = new THREE.Quaternion();
    this._qLocal = new THREE.Quaternion();
    this._tmp = new THREE.Vector3();
  }

  _frameCamera() {
    this.pivot.updateMatrixWorld(true); // measure the rotated+yawed robot in world space
    const box = new THREE.Box3().setFromObject(this.robot);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    this._center = center;
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    const dist = radius / Math.tan((this.camera.fov * Math.PI) / 360);
    this._camDist = dist * 1.5;
    // Look slightly above center (towards the head).
    this._lookAt = center.clone().add(new THREE.Vector3(0, size.y * 0.12, 0));
    this.camera.position.set(center.x, this._lookAt.y, center.z + this._camDist);
    this.camera.lookAt(this._lookAt);
  }

  /** Feed a raw 0..1 audio level (called by the grid each frame). The smooth
   *  attack/release envelope is applied in _tick against wall-clock dt. */
  setLevel(level) {
    this._targetLevel = Math.max(0, Math.min(1, level));
  }

  /** Drive a music-synced dance. `p.clock` is a fractional beat count (the whole
   *  number is the beat, the fraction is the phase, 0 = on the beat); `p.intensity`
   *  (0..1) scales how big the moves are. Pass null to stop (mic breaks / paused).
   *  While dancing, the random recorded-move scheduler is suppressed. */
  setDance(p) { this._dance = p || null; }

  /** Drive the head to an explicit pose (radians) + antenna offsets (radians),
   *  bypassing the idle/dance/talk layers. Used by the in-app "how it works"
   *  explainer to pose the REAL robot from each algorithm. Fields (all optional):
   *  pitch/yaw/roll, x/y/z (metres), antL/antR, antStiff/antDamp (spring tuning),
   *  spring:false to snap the antennas. Pass null to restore the auto motion. */
  setPose(p) { this._manualPose = p || null; }

  _applyManualPose(dt) {
    const m = this._manualPose;
    if (this.head && this._euler) {
      this._euler.set(m.pitch || 0, m.yaw || 0, m.roll || 0, 'XYZ');
      this._q.setFromEuler(this._euler);
      this._qLocal.copy(this._parentWorldQuatInv).multiply(this._q).multiply(this._headRestWorldQuat);
      this.head.quaternion.copy(this._qLocal);
      this._tmp.set(m.x || 0, m.y || 0, m.z || 0).applyQuaternion(this._parentWorldQuatInv);
      this.head.position.copy(this._headRestPos).add(this._tmp);
    }
    const aL = (this._rest?.left_antenna || 0) + (m.antL || 0);
    const aR = (this._rest?.right_antenna || 0) + (m.antR || 0);
    if (this._antL == null) { this._antL = aL; this._antR = aR; this._antLV = 0; this._antRV = 0; }
    if (m.spring === false) { this._antL = aL; this._antR = aR; this._antLV = 0; this._antRV = 0; }
    else {
      const k = m.antStiff || ANT_STIFF, c = m.antDamp || ANT_DAMP;
      this._antLV += ((aL - this._antL) * k - this._antLV * c) * dt;
      this._antRV += ((aR - this._antR) * k - this._antRV * c) * dt;
      this._antL += this._antLV * dt; this._antR += this._antRV * dt;
    }
    this._setJoint('left_antenna', this._antL);
    this._setJoint('right_antenna', this._antR);
  }

  /** Stop/start the render loop without disturbing the pose — lets the explainer
   *  keep many twins alive but only render the ones currently on screen. */
  pause() { if (this._paused) return; this._paused = true; cancelAnimationFrame(this._raf); }
  resume() { if (!this._paused) return; this._paused = false; this._clock.getDelta(); this._raf = requestAnimationFrame(this._tick); }

  /** Backstage mode (the show is writing/voicing): react sooner and dance more,
   *  so the wait looks like a green-room hang instead of frozen robots. */
  setBackstage(on) {
    on = !!on;
    if (on && !this._backstage) {
      this._nextReactAt = Math.min(this._nextReactAt, this._t + rand(0.2, 1.4));
    }
    this._backstage = on;
  }

  _reactGap() {
    return this._backstage ? rand(0.6, 2.0) : rand(REACT_GAP_MIN, REACT_GAP_MAX);
  }

  _setJoint(name, value) {
    this.robot?.setJointValue?.(name, value);
  }

  /** Start a random listener reaction (mostly emotions, occasionally a dance). */
  _startReaction(t) {
    const lib = this._lib;
    const danceChance = this._backstage ? 0.35 : DANCE_CHANCE;
    const useDance = lib.dances.length && Math.random() < danceChance;
    const pool = useDance ? lib.dances : lib.reactions;
    if (!pool.length) return;
    const name = pool[(Math.random() * pool.length) | 0];
    const data = lib.moves[name];
    this._move = { data, start: t, dur: data.duration };
    this._nextReactAt = t + data.duration + this._reactGap();
  }

  /** Linearly sample a recorded move's flat frame array at local time `lt`. */
  _sampleMove(move, lt) {
    const f = move.frames;
    const idx = this._lib.idx;
    const x = lt * this._lib.fps;
    let i0 = Math.floor(x);
    if (i0 < 0) i0 = 0;
    if (i0 > f.length - 2) i0 = f.length - 2;
    const a = f[i0];
    const b = f[i0 + 1] || a;
    const fr = Math.min(1, Math.max(0, x - i0));
    const L = (k) => {
      const i = idx[k];
      return a[i] + (b[i] - a[i]) * fr;
    };
    return {
      x: L('x'), y: L('y'), z: L('z'),
      roll: L('roll'), pitch: L('pitch'), yaw: L('yaw'),
      antL: L('antL'), antR: L('antR'), bodyYaw: L('bodyYaw'),
    };
  }

  /** Drag = orbit, wheel = zoom, double-click = reset (config preview). */
  _bindOrbit() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.style.cursor = 'grab';
    let dragging = false, px = 0, py = 0;
    el.addEventListener('pointerdown', (e) => {
      dragging = true; px = e.clientX; py = e.clientY;
      el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing';
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this._orbitYaw += (e.clientX - px) * 0.012;
      this._orbitPitch = Math.max(-0.5, Math.min(0.6, this._orbitPitch + (e.clientY - py) * 0.008));
      px = e.clientX; py = e.clientY;
      this._applyView();
    });
    const end = (e) => { dragging = false; el.style.cursor = 'grab'; try { el.releasePointerCapture(e.pointerId); } catch {} };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._zoom = Math.max(0.6, Math.min(2.4, this._zoom * (e.deltaY < 0 ? 1.09 : 0.92)));
      this._applyView();
    }, { passive: false });
    el.addEventListener('dblclick', () => {
      this._orbitYaw = 0; this._orbitPitch = 0; this._zoom = 1;
      this._applyView();
    });
  }

  _applyView() {
    if (!this._lookAt) return;
    if (this.pivot) this.pivot.rotation.y = FACE_YAW + this._orbitYaw;
    const d = this._camDist / this._zoom;
    this.camera.position.set(
      this._center.x,
      this._lookAt.y + Math.sin(this._orbitPitch) * d,
      this._center.z + Math.cos(this._orbitPitch) * d,
    );
    this.camera.lookAt(this._lookAt);
  }

  /** Tint the robot's light shell materials (antennas/lenses stay dark).
   *  Pass null/'' to restore the stock white. */
  setBodyTint(color) {
    if (!this.robot) { this._pendingTint = color; return; }
    this.robot.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (!o.userData._stockMat) {
        o.userData._stockMat = o.material;
        o.material = o.material.clone();
      }
      const stock = o.userData._stockMat;
      const isShell = stock.color && (stock.color.r + stock.color.g + stock.color.b) / 3 > 0.5;
      if (!isShell) return;
      if (color) o.material.color.copy(stock.color).multiply(new THREE.Color(color));
      else o.material.color.copy(stock.color);
    });
  }

  /** Tuning aid: stop the idle wobble and snap to the rest pose so prop
   *  placement can be judged without animation. */
  freeze() {
    this._frozen = true;
    cancelAnimationFrame(this._raf);
    if (this.head) {
      this.head.position.copy(this._headRestPos);
      this.head.quaternion.copy(this._headRestLocalQuat);
    }
    for (const n of ['left_antenna', 'right_antenna', 'yaw_body']) this._setJoint(n, this._rest[n]);
    this.renderer.render(this.scene, this.camera);
  }

  _tick = () => {
    if (this._disposed || this._frozen) return;
    this._raf = requestAnimationFrame(this._tick);

    // Frame-rate independent time + asymmetric envelope (fast attack, slow
    // release) so motion looks the same at 60 or 144 Hz and never jitters.
    const dt = Math.min(this._clock.getDelta(), 0.1);
    this._t += dt;
    const t = this._t;
    const tau = this._targetLevel > this.level ? LEVEL_ATTACK_S : LEVEL_RELEASE_S;
    this.level += (this._targetLevel - this.level) * (1 - Math.exp(-dt / tau));
    const lvl = this.level;

    // explainer override: pose the head explicitly, skip the auto layers
    if (this._manualPose) {
      if (this.robot && this._rest) this._applyManualPose(dt);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.robot && this._rest) {
      const ph = this._seed;
      const speaking = this._targetLevel > REACT_SPEAK_LEVEL;

      // --- reaction scheduler: a listener (not currently speaking) periodically
      //     plays a recorded emotion/dance so it emotes while someone else talks.
      //     Suppressed entirely while music-dancing (that motion is procedural).
      if (this._dance) {
        this._move = null;
      } else if (this._lib) {
        if (speaking && !this._backstage) {
          this._move = null;
          this._nextReactAt = t + this._reactGap();
        } else {
          if (this._move && t - this._move.start >= this._move.dur) this._move = null;
          if (!this._move && t >= this._nextReactAt) this._startReaction(t);
        }
      }

      // --- base pose: idle breathing, overridden by an active move ---
      let hx = 0;
      let hy = BREATHE_Z_M * Math.sin(TAU * BREATHE_HZ * t); // vertical bob
      let hz = 0;
      let hroll = 0;
      let hpitch = 0;
      let hyaw = 0;
      const antBreathe = ANT_SWAY_RAD * Math.sin(TAU * ANT_HZ * t);
      let aL = this._rest.left_antenna + antBreathe;
      let aR = this._rest.right_antenna - antBreathe;
      let yawV =
        this._rest.yaw_body + BODY_YAW_RAD * Math.sin(TAU * BODY_YAW_HZ * t + ph) * (1 - 0.6 * lvl);

      if (this._move) {
        const lt = t - this._move.start;
        const s = this._sampleMove(this._move.data, lt);
        let w = Math.min(1, lt / MOVE_FADE); // fade in
        const tail = this._move.dur - lt;
        if (tail < MOVE_FADE) w = Math.min(w, Math.max(0, tail / MOVE_FADE)); // fade out
        // Robot frame (x fwd, y left, z up) → our world (X right, Y up, Z to camera).
        hx = lerp(hx, -s.y, w);
        hy = lerp(hy, s.z, w);
        hz = lerp(hz, s.x, w);
        hpitch = lerp(hpitch, s.pitch, w);
        hyaw = lerp(hyaw, s.yaw, w);
        hroll = lerp(hroll, s.roll, w);
        aL = lerp(aL, this._rest.left_antenna + s.antL, w);
        aR = lerp(aR, this._rest.right_antenna + s.antR, w);
        yawV = lerp(yawV, this._rest.yaw_body + s.bodyYaw, w);
      }

      // --- expressive layer: a beat-locked dance (radio DJ, music) or
      //     speech-driven talking motion (mic breaks + live-show twins) ---
      if (this._dance) {
        const o = (this._danceState ||= makeDanceState());
        const p = danceStep(o, dt, this._dance.clock || 0, this._dance.intensity || 0);
        hpitch += p.pitch; hyaw += p.yaw; hroll += p.roll;
        hx += p.x; hy += p.y; hz += p.z; yawV += p.body;
        aL += p.antL; aR += p.antR;
      } else {
        const o = (this._talkState ||= makeTalkState());
        const p = talkStep(o, dt, this._targetLevel);
        hpitch += p.pitch; hyaw += p.yaw; hroll += p.roll;
        hx += p.x; hy += p.y; hz += p.z;
        aL += p.antL; aR += p.antR;
      }

      // --- apply to the head link (world rotation → link-local) + joints ---
      if (this.head) {
        this._euler.set(hpitch, hyaw, hroll, 'XYZ');
        this._q.setFromEuler(this._euler);
        this._qLocal
          .copy(this._parentWorldQuatInv)
          .multiply(this._q)
          .multiply(this._headRestWorldQuat);
        this.head.quaternion.copy(this._qLocal);
        this._tmp.set(hx, hy, hz).applyQuaternion(this._parentWorldQuatInv);
        this.head.position.copy(this._headRestPos).add(this._tmp);
      }
      // antenna spring: trail + overshoot the target (aL/aR), VTuber-style
      if (this._antL == null) { this._antL = aL; this._antR = aR; this._antLV = 0; this._antRV = 0; }
      this._antLV += ((aL - this._antL) * ANT_STIFF - this._antLV * ANT_DAMP) * dt;
      this._antRV += ((aR - this._antR) * ANT_STIFF - this._antRV * ANT_DAMP) * dt;
      this._antL += this._antLV * dt;
      this._antR += this._antRV * dt;
      this._setJoint('left_antenna', this._antL);
      this._setJoint('right_antenna', this._antR);
      // keep the body roughly camera-facing even during expressive moves
      this._setJoint('yaw_body', Math.max(-0.5, Math.min(0.5, yawV)));
    }
    this.renderer.render(this.scene, this.camera);
  };

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** Attach (or clear, if url is null) a GLB prop in a named slot.
   *
   *  The prop is parented to the head link so it tracks head motion. We build it
   *  in a "wear frame" (world-upright: +Y up, +Z toward the camera/face) so we
   *  never reason about the URDF link's arbitrary orientation, then ANCHOR it by
   *  the appropriate face of its bounding box — a hat rests its *bottom* on the
   *  head, glasses *straddle* the eyes, a tie hangs from its *top*. Because we
   *  anchor by a bbox face (not its centre), short/flat hats sit correctly
   *  without per-prop tuning. `rot` fixes oddly-modelled props (e.g. a halo). */
  async setProp(slot, url, override = {}) {
    if (!this.head) { (this._pendingProps ??= {})[slot] = [url, override]; return; } // robot still loading
    this._props ??= {};
    const prev = this._props[slot];
    if (prev) { this.head.remove(prev); this._props[slot] = null; }
    if (!url) return;
    const slug = (String(url).match(/([^/]+)\.glb/) || [])[1] || '';
    const cfg = { ...(PROP_SLOTS[slot] || PROP_SLOTS.hat), ...(PROP_OVERRIDES[slug] || {}), ...override };
    let gltf;
    try { gltf = await _gltf.loadAsync(url); } catch (e) { console.warn('prop load failed', url, e); return; }
    if (this._disposed) return;

    // 1) recentre the raw geometry at its own origin
    const obj = gltf.scene;
    const box0 = new THREE.Box3().setFromObject(obj);
    const size0 = box0.getSize(new THREE.Vector3());
    obj.position.sub(box0.getCenter(new THREE.Vector3()));

    // 2) wear frame: per-prop rotation + scale relative to the measured head
    const fit = new THREE.Group();
    fit.add(obj);
    if (cfg.rot) fit.rotation.set(cfg.rot[0] * DEG, (cfg.rot[1] || 0) * DEG, (cfg.rot[2] || 0) * DEG);
    const targetSize = (cfg.scale || 1) * (this._headSize || 0.12);
    fit.scale.setScalar(targetSize / (Math.max(size0.x, size0.y, size0.z) || 1));

    // 3) resolve the vertical anchor from the MEASURED head geometry
    const refUp = cfg.ref === 'top' ? this._headTopUp
      : cfg.ref === 'bot' ? this._headBotUp : this._headMidUp;
    const headOffset = (refUp ?? 0.06) + (cfg.lift || 0);
    const surfaceFwd = cfg.fwdRef === 'body' ? (this._bodyFrontFwd || 0.05) : (this._headFrontFwd || 0.04);

    // measure ACTUAL vertices after rotation+scale (groups/empties don't skew it)
    fit.updateMatrixWorld(true);
    const wb = _wearBounds(fit, cfg.region || 'all');
    if (!wb) { console.warn('prop has no mesh', url); return; }
    const fb = wb.full;
    // seat on percentile heights, not absolute extremes (ribbons/tassels dangle)
    const ay = cfg.anchor === 'bottom' ? -wb.loY
      : cfg.anchor === 'top' ? -wb.hiY
      : -(wb.loY + wb.hiY) / 2;
    // forward: surface-anchor so the prop sits flush ON the head/body, not
    // floating in front (zAnchor 'front' = prop's front face touches the
    // surface, for glasses) or clipping inside it (zAnchor 'back' = prop's back
    // face rests on the surface, for ties). Default: wear-region centred on the
    // head dome's measured front-to-back centre (hats).
    const gap = cfg.gap ?? 0;
    const fz = cfg.zAnchor === 'front' ? surfaceFwd - fb.max.z + gap
      : cfg.zAnchor === 'back' ? surfaceFwd - fb.min.z + gap
      : (this._headCtrZ || 0) - wb.cz + (cfg.fwdFrac || 0) * surfaceFwd;
    // horizontal: centre the WEAR REGION on the head's measured visual centre —
    // bbox-centring lets a leaning tip / hanging chain drag the prop sideways.
    fit.position.set((cfg.side || 0) + (this._headCtrX || 0) - wb.cx, ay, fz);

    // 4) wrap: world-upright, sitting at the anchor point above the head origin
    const wrap = new THREE.Group();
    wrap.add(fit);
    const invHead = this._headRestWorldQuat.clone().invert();
    wrap.quaternion.copy(invHead);
    wrap.position.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(invHead)).multiplyScalar(headOffset);

    this.head.add(wrap);
    this._props[slot] = wrap;
  }

  /** Procedural DJ headphones (band + glowing cups + boom mic), built to the
   *  measured head so they always fit — no GLB in the library has these. */
  setHeadphones(accent = '#49e6c8') {
    if (!this.head || !this._headRestWorldQuat) return false;
    this._props ??= {};
    if (this._props.headphones) return true;
    const W = this._headWidth || this._headSize || 0.1;
    const midY = this._headMidUp ?? 0.03;
    const topY = this._headTopUp ?? 0.07;
    const cx = this._headCtrX || 0;
    const cz = this._headCtrZ || 0;

    const dark = new THREE.MeshStandardMaterial({ color: 0x16161c, metalness: 0.65, roughness: 0.4 });
    const glow = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accent), emissive: new THREE.Color(accent),
      emissiveIntensity: 0.9, metalness: 0.2, roughness: 0.45,
    });
    const g = new THREE.Group();

    const cupR = W * 0.30, cupH = W * 0.13, cupX = W / 2 + cupH / 2 + W * 0.015;
    for (const s of [-1, 1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(cupR, cupR * 0.92, cupH, 28), dark);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(cx + s * cupX, midY, cz);
      g.add(cup);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(cupR * 0.62, W * 0.022, 12, 36), glow);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(cx + s * (cupX + cupH / 2 + W * 0.004), midY, cz);
      g.add(ring);
    }
    // band: arc over the crown from cup to cup
    const bandR = Math.hypot(cupX, topY - midY) * 1.06;
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(bandR, W * 0.038, 12, 40, Math.PI), dark);
    band.position.set(cx, midY, cz);
    g.add(band);
    // boom mic: short arm angling down-forward from the right cup, glowing tip
    const armLen = W * 0.75;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.018, W * 0.018, armLen, 10), dark);
    arm.position.set(cx + cupX - W * 0.05, midY - armLen * 0.32, cz + (this._headFrontFwd || W * 0.4) * 0.55);
    arm.rotation.set(-0.9, 0, 0.35);
    g.add(arm);
    const mic = new THREE.Mesh(new THREE.SphereGeometry(W * 0.055, 14, 12), glow);
    mic.position.set(
      arm.position.x - Math.sin(0.35) * armLen * 0.5,
      arm.position.y - Math.cos(0.9) * armLen * 0.42,
      arm.position.z + Math.sin(0.9) * armLen * 0.5,
    );
    g.add(mic);

    // mount world-upright on the head, same trick as setProp
    const wrap = new THREE.Group();
    wrap.add(g);
    wrap.quaternion.copy(this._headRestWorldQuat.clone().invert());
    this.head.add(wrap);
    this._props.headphones = wrap;
    return true;
  }

  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.renderer.dispose();
    // dispose() frees GPU resources but NOT the WebGL context itself — browsers
    // cap live contexts (~16) and kill the oldest, so without this every
    // re-join leaks a context until the robots stop rendering.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
