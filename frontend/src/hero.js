// Landing hero: a translucent holographic Reachy that peeks from the right and
// follows your cursor (springy), with podcast mics drifting in the background,
// and recorded emotes/dances once the cursor's been still a few seconds.
import * as THREE from 'three';
import { loadReachyClone, loadMoves } from './reachy3d.js';

// the hologram colour: themes may set --hero explicitly (a yellow robot on
// blueprint-blue reads wrong even when yellow is the right UI accent);
// otherwise it adopts the theme accent (--gold).
function accentColor() {
  const s = getComputedStyle(document.documentElement);
  const v = (s.getPropertyValue('--hero') || s.getPropertyValue('--gold')).trim();
  return new THREE.Color(v || '#5ce1e6');
}
// 'solid' renders the real white-plastic robot under studio light (for light
// paper/concrete themes — a glowing hologram can't sit on a light page).
function heroStyle() {
  return getComputedStyle(document.documentElement).getPropertyValue('--hero-style').trim() || 'holo';
}
const TAU = Math.PI * 2;
const IDLE_EMOTE_S = 5;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

// translucent "hologram": faint teal fill, glowing along the fresnel silhouette
function holoMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: accentColor() } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0);
        vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
        // near-opaque shell (occludes the internals via depthWrite) with a bright
        // glowing rim — reads as a clean energy hologram, not an x-ray blob.
        gl_FragColor = vec4(uColor*(0.42 + f*0.95), 0.82 + f*0.18); }`,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
}

// soft radial glow texture for the floor contact
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(73,230,200,0.55)');
  g.addColorStop(0.4, 'rgba(73,230,200,0.16)');
  g.addColorStop(1, 'rgba(73,230,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// a studio condenser mic suspended in a shock mount — an elongated capsule body
// (not a ball, so it reads as a mic, not a mushroom) with grille rings + boom.
function makeMic(mat) {
  const g = new THREE.Group();
  // elongated body — the mic capsule
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.52, 6, 16), mat);
  body.position.y = 0.08;
  g.add(body);
  // grille rings near the top suggest the mesh head
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.168, 0.012, 6, 18), mat);
    r.position.y = 0.22 + i * 0.09;
    r.rotation.x = Math.PI / 2;
    g.add(r);
  }
  // shock-mount ring (the "spider") around the body, slightly tilted
  const mount = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.028, 8, 24), mat);
  mount.position.y = 0.06;
  mount.rotation.x = Math.PI / 2 + 0.28;
  g.add(mount);
  // boom arm angling down-back
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.62, 8), mat);
  boom.position.set(0.27, -0.26, -0.05);
  boom.rotation.z = -0.7;
  g.add(boom);
  return g;
}

export class HeroReachy {
  constructor(container) {
    this.container = container;
    this._disposed = false;
    this._t = 0;
    this._clock = new THREE.Clock();
    this._mx = 0.12; // slight turn toward the content
    this._my = 0; // neutral head pitch so the antennas sit upright (not leaning)
    this._lx = 0;
    this._ly = 0;
    this._move = null;
    this._nextEmoteAt = 0;
    this._lastMoveAt = 0;
    this._mics = [];

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, w / h, 0.01, 100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this._addMics();

    this._onMove = (e) => {
      this._mx = (e.clientX / window.innerWidth) * 2 - 1;
      this._my = (e.clientY / window.innerHeight) * 2 - 1;
      this._lastMoveAt = this._t;
      this._move = null;
    };
    window.addEventListener('pointermove', this._onMove);
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);

    this._raf = requestAnimationFrame(this._tick);
    loadMoves().then((lib) => (this._lib = lib));
    this._load();
  }

  _addMics() {
    const mat = new THREE.MeshBasicMaterial({ color: accentColor(), wireframe: true, transparent: true,
      opacity: heroStyle() === 'solid' ? 0.3 : 0.22 });
    // [x, y, z, scale, rotSpeed, parallax] — a few clean mics in the empty space
    const specs = [
      [0.55, 1.15, -2.4, 0.14, 0.5, 0.45],
      [1.8, 0.7, -2.6, 0.12, 0.6, 0.5],
      [-0.45, 0.85, -2.8, 0.1, 0.45, 0.4],
      [1.35, -0.5, -2.5, 0.11, 0.55, 0.5],
    ];
    for (const [x, y, z, s, rot, par] of specs) {
      const mic = makeMic(mat);
      mic.scale.setScalar(s);
      mic.position.set(x, y, z);
      this.scene.add(mic);
      this._mics.push({ mic, base: new THREE.Vector3(x, y, z), phase: rand(0, TAU), rot, par });
    }
  }

  async _load() {
    let robot;
    try {
      robot = await loadReachyClone();
    } catch (e) {
      console.warn('hero: robot load failed', e);
      return;
    }
    if (this._disposed) return;

    this._solid = heroStyle() === 'solid';
    if (this._solid) {
      // keep the URDF's real materials; light them like a product shot
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a463c, 1.15));
      const key = new THREE.DirectionalLight(0xffffff, 1.0);
      key.position.set(2.2, 3.4, 2.6);
      this.scene.add(key);
      const rim = new THREE.DirectionalLight(0xfff2dc, 0.45);
      rim.position.set(-2.4, 1.6, -1.8);
      this.scene.add(rim);
    } else {
      const mat = holoMaterial();
      robot.traverse((o) => {
        if (o.isMesh) o.material = mat;
      });
    }
    robot.rotation.x = -Math.PI / 2;

    this.pivot = new THREE.Group();
    this.pivot.rotation.y = -Math.PI / 2;
    this.pivot.add(robot);
    this.scene.add(this.pivot);
    this.robot = robot;

    this.pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(robot);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    const dist = (radius / Math.tan((this.camera.fov * Math.PI) / 360)) * 2.25;
    this._look = center.clone().add(new THREE.Vector3(-radius * 1.15, radius * 0.02, 0));
    this.camera.position.set(center.x, this._look.y, center.z + dist);
    this.camera.lookAt(this._look);

    // hologram: additive glow pool. solid: a soft dark contact shadow.
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(size.x * 4.2, size.z * 4.2),
      this._solid
        ? new THREE.MeshBasicMaterial({ map: makeGlowTexture(), color: 0x000000, transparent: true,
            depthWrite: false, opacity: 0.28 })
        : new THREE.MeshBasicMaterial({ map: makeGlowTexture(), transparent: true, depthWrite: false,
            opacity: 0.55, blending: THREE.AdditiveBlending }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(center.x, box.min.y + 0.001, center.z);
    this.scene.add(shadow);

    this.head = robot.links?.['xl_330'] || null;
    if (this.head) {
      this._restAntL = this.robot.joints?.['left_antenna']?.angle ?? 0;
      this._restAntR = this.robot.joints?.['right_antenna']?.angle ?? 0;
      this._restYaw = this.robot.joints?.['yaw_body']?.angle ?? 0;
      this._headRestPos = this.head.position.clone();
      this._parentWorldQuatInv = this.head.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      this._headRestWorldQuat = this.head.getWorldQuaternion(new THREE.Quaternion());
    }
    this._euler = new THREE.Euler();
    this._q = new THREE.Quaternion();
    this._qLocal = new THREE.Quaternion();
    this._tmp = new THREE.Vector3();
    this._headQCur = this.head.quaternion.clone();
    this._headPosCur = this.head.position.clone();
    this._aLCur = this._restAntL;
    this._aRCur = this._restAntR;
    this._yawCur = this._restYaw;
  }

  _startEmote(t) {
    const lib = this._lib;
    const dance = lib.dances.length && Math.random() < 0.3;
    const pool = dance ? lib.dances : lib.reactions;
    if (!pool.length) return;
    const name = pool[(Math.random() * pool.length) | 0];
    const data = lib.moves[name];
    this._move = { data, start: t, dur: data.duration };
    this._nextEmoteAt = t + data.duration + rand(1.0, 2.5);
  }

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
    const L = (k) => a[idx[k]] + (b[idx[k]] - a[idx[k]]) * fr;
    return {
      x: L('x'), y: L('y'), z: L('z'),
      roll: L('roll'), pitch: L('pitch'), yaw: L('yaw'),
      antL: L('antL'), antR: L('antR'), bodyYaw: L('bodyYaw'),
    };
  }

  _tick = () => {
    if (this._disposed) return;
    this._raf = requestAnimationFrame(this._tick);
    const dt = Math.min(this._clock.getDelta(), 0.05);
    this._t += dt;
    const t = this._t;

    // springy cursor follow (eased toward target, gives momentum)
    this._lx = lerp(this._lx, this._mx, 1 - Math.exp(-dt / 0.22));
    this._ly = lerp(this._ly, this._my, 1 - Math.exp(-dt / 0.22));

    // drifting background mics: bob + slow spin + cursor parallax
    for (const m of this._mics) {
      m.mic.position.x = m.base.x + this._lx * m.par * 0.5;
      m.mic.position.y = m.base.y + Math.sin(t * 0.5 + m.phase) * 0.12 - this._ly * m.par * 0.4;
      m.mic.rotation.y += dt * m.rot * 0.35;
      m.mic.rotation.z = Math.sin(t * 0.4 + m.phase) * 0.18;
    }

    if (this.robot && this.head) {
      if (this._lib) {
        if (this._move && t - this._move.start >= this._move.dur) this._move = null;
        if (!this._move && t - this._lastMoveAt >= IDLE_EMOTE_S && t >= this._nextEmoteAt) this._startEmote(t);
      }

      const breatheY = 0.005 * Math.sin(TAU * 0.12 * t);
      let hx = 0, hy = breatheY, hz = 0;
      let hpitch = this._ly * 0.45;
      let hyaw = this._lx * 0.6;
      let hroll = -this._lx * 0.1;
      let aL = this._restAntL + 0.2 * Math.sin(TAU * 0.45 * t);
      let aR = this._restAntR - 0.2 * Math.sin(TAU * 0.45 * t);
      let yawV = this._restYaw + this._lx * 0.14;

      if (this._move) {
        const lt = t - this._move.start;
        const s = this._sampleMove(this._move.data, lt);
        let w = Math.min(1, lt / 0.35);
        const tail = this._move.dur - lt;
        if (tail < 0.45) w = Math.min(w, Math.max(0, tail / 0.45));
        hx = lerp(hx, -s.y, w);
        hy = lerp(hy, s.z, w);
        hz = lerp(hz, s.x, w);
        hpitch = lerp(hpitch, s.pitch, w);
        hyaw = lerp(hyaw, s.yaw, w);
        hroll = lerp(hroll, s.roll, w);
        aL = lerp(aL, this._restAntL + s.antL, w);
        aR = lerp(aR, this._restAntR + s.antR, w);
        yawV = lerp(yawV, this._restYaw + s.bodyYaw, w);
      }

      const k = 1 - Math.exp(-dt / 0.12);
      this._euler.set(hpitch, hyaw, hroll, 'XYZ');
      this._q.setFromEuler(this._euler);
      this._qLocal.copy(this._parentWorldQuatInv).multiply(this._q).multiply(this._headRestWorldQuat);
      this._headQCur.slerp(this._qLocal, k);
      this.head.quaternion.copy(this._headQCur);
      this._tmp.set(hx, hy, hz).applyQuaternion(this._parentWorldQuatInv).add(this._headRestPos);
      this._headPosCur.lerp(this._tmp, k);
      this.head.position.copy(this._headPosCur);
      this._aLCur = lerp(this._aLCur, aL, k);
      this._aRCur = lerp(this._aRCur, aR, k);
      this._yawCur = lerp(this._yawCur, Math.max(-0.5, Math.min(0.5, yawV)), k);
      this.robot.setJointValue?.('left_antenna', this._aLCur);
      this.robot.setJointValue?.('right_antenna', this._aRCur);
      this.robot.setJointValue?.('yaw_body', this._yawCur);
      this.pivot.rotation.y = -Math.PI / 2 + this._lx * 0.13;
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

  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    window.removeEventListener('pointermove', this._onMove);
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // actually release the WebGL context (see ReachyTwin.dispose)
    this.renderer.domElement.remove();
  }
}
