import * as THREE from 'three';

/**
 * Cinematic scroll clip, rebuilt from the recorded session.
 *
 * Kept from the original: start centered → arc out right while yawing
 * to reveal the side → travel back while continuing the turn (outsole /
 * heel) → hold near center for a long turntable → pitch to a new view →
 * unwind the yaw → settle.
 *
 * Changed: one continuous Euler curve (no pose-stops, no scale squash).
 *
 * Beats are relative to screen center. Euler is YXZ in degrees, yaw unwrapped.
 */
const BEATS = [
  { pct: 0,  x: 0.00, y:  0.00, z: 0.00, rx:  6, ry:  -24, rz:  -4, s: 0.95 },
  { pct: 6,  x: 0.62, y: -0.42, z: 0.02, rx:  4, ry:  -58, rz:  -6, s: 0.96 },
  { pct: 12, x: 1.22, y: -0.92, z: 0.04, rx:  2, ry: -108, rz: -12, s: 0.97 },
  { pct: 16, x: 1.48, y: -1.18, z: 0.04, rx:  1, ry: -138, rz: -16, s: 0.98 },
  { pct: 22, x: 0.78, y: -1.24, z: 0.04, rx:  0, ry: -220, rz: -18, s: 1.00 },
  { pct: 28, x: 0.22, y: -0.92, z: 0.03, rx:  1, ry: -330, rz: -18, s: 1.04 },
  { pct: 34, x: 0.08, y: -0.70, z: 0.03, rx:  4, ry: -372, rz: -20, s: 1.02 },
  { pct: 42, x: -0.02, y: -0.54, z: 0.03, rx:  8, ry: -410, rz: -24, s: 0.94 },
  { pct: 52, x: -0.04, y: -0.52, z: 0.03, rx: 10, ry: -490, rz: -28, s: 0.90 },
  { pct: 58, x: -0.08, y: -0.48, z: 0.03, rx: 10, ry: -528, rz: -26, s: 0.92 },
  { pct: 64, x: -0.18, y: -0.38, z: 0.03, rx:  4, ry: -538, rz: -18, s: 0.98 },
  { pct: 70, x: -0.22, y: -0.36, z: 0.03, rx: -14, ry: -548, rz:  -8, s: 0.92 },
  { pct: 76, x: -0.22, y: -0.36, z: 0.03, rx: -22, ry: -500, rz:  -6, s: 0.90 },
  { pct: 82, x: -0.22, y: -0.36, z: 0.03, rx: -20, ry: -428, rz:  -8, s: 0.88 },
  { pct: 90, x: -0.22, y: -0.40, z: 0.03, rx: -12, ry: -398, rz: -18, s: 0.90 },
  { pct: 100, x: -0.22, y: -0.46, z: 0.03, rx: -8, ry: -402, rz: -22, s: 0.92 },
];

const SAMPLE_N = 2400;
const PLAYHEAD_SMOOTH = 0.26;
const POSE_FOLLOW = 12;

const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _qCurr = new THREE.Quaternion();
const _qSegB = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

function lerpScalar(a, b, ta, tb, t) {
  const span = tb - ta;
  if (Math.abs(span) < 1e-9) return a;
  return a + (b - a) * ((t - ta) / span);
}

function catmullRom1D(p0, p1, p2, p3, t0, t1, t2, t3, t) {
  const a1 = lerpScalar(p0, p1, t0, t1, t);
  const a2 = lerpScalar(p1, p2, t1, t2, t);
  const a3 = lerpScalar(p2, p3, t2, t3, t);
  const b1 = lerpScalar(a1, a2, t0, t2, t);
  const b2 = lerpScalar(a2, a3, t1, t3, t);
  return lerpScalar(b1, b2, t1, t2, t);
}

function findBeat(pct) {
  let i = 0;
  while (i < BEATS.length - 1 && BEATS[i + 1].pct < pct) i++;
  return i;
}

function sampleChannel(key, pct) {
  const n = BEATS.length;
  if (pct <= BEATS[0].pct) return BEATS[0][key];
  if (pct >= BEATS[n - 1].pct) return BEATS[n - 1][key];
  const i = findBeat(pct);
  const i0 = Math.max(0, i - 1);
  const i3 = Math.min(n - 1, i + 2);
  return catmullRom1D(
    BEATS[i0][key],
    BEATS[i][key],
    BEATS[i + 1][key],
    BEATS[i3][key],
    BEATS[i0].pct,
    BEATS[i].pct,
    BEATS[i + 1].pct,
    BEATS[i3].pct,
    pct
  );
}

function sampleClip(pct, outPos, outQuat, outScale) {
  const p = THREE.MathUtils.clamp(pct, 0, 100);
  outPos.set(sampleChannel('x', p), sampleChannel('y', p), sampleChannel('z', p));
  const s = sampleChannel('s', p);
  outScale.set(s, s, s);
  _euler.set(
    THREE.MathUtils.degToRad(sampleChannel('rx', p)),
    THREE.MathUtils.degToRad(sampleChannel('ry', p)),
    THREE.MathUtils.degToRad(sampleChannel('rz', p)),
    'YXZ'
  );
  outQuat.setFromEuler(_euler);
}

function buildLut() {
  const count = SAMPLE_N + 1;
  const pos = new Float32Array(count * 3);
  const scale = new Float32Array(count * 3);
  const quat = new Float32Array(count * 4);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const q = new THREE.Quaternion();

  for (let i = 0; i <= SAMPLE_N; i++) {
    sampleClip((i / SAMPLE_N) * 100, p, q, s);
    const o3 = i * 3;
    const o4 = i * 4;
    pos[o3] = p.x;
    pos[o3 + 1] = p.y;
    pos[o3 + 2] = p.z;
    scale[o3] = s.x;
    scale[o3 + 1] = s.y;
    scale[o3 + 2] = s.z;
    quat[o4] = q.x;
    quat[o4 + 1] = q.y;
    quat[o4 + 2] = q.z;
    quat[o4 + 3] = q.w;
    if (i > 0) {
      const px = quat[o4 - 4];
      const py = quat[o4 - 3];
      const pz = quat[o4 - 2];
      const pw = quat[o4 - 1];
      if (px * q.x + py * q.y + pz * q.z + pw * q.w < 0) {
        quat[o4] *= -1;
        quat[o4 + 1] *= -1;
        quat[o4 + 2] *= -1;
        quat[o4 + 3] *= -1;
      }
    }
  }
  return { pos, scale, quat };
}

function sampleLut(lut, pct, outPos, outQuat, outScale) {
  const u = THREE.MathUtils.clamp(pct, 0, 100) * 0.01 * SAMPLE_N;
  const i = Math.min(SAMPLE_N - 1, Math.floor(u));
  const t = u - i;
  const a3 = i * 3;
  const b3 = a3 + 3;
  const a4 = i * 4;
  const b4 = a4 + 4;
  outPos.set(
    lut.pos[a3] + (lut.pos[b3] - lut.pos[a3]) * t,
    lut.pos[a3 + 1] + (lut.pos[b3 + 1] - lut.pos[a3 + 1]) * t,
    lut.pos[a3 + 2] + (lut.pos[b3 + 2] - lut.pos[a3 + 2]) * t
  );
  outScale.set(
    lut.scale[a3] + (lut.scale[b3] - lut.scale[a3]) * t,
    lut.scale[a3 + 1] + (lut.scale[b3 + 1] - lut.scale[a3 + 1]) * t,
    lut.scale[a3 + 2] + (lut.scale[b3 + 2] - lut.scale[a3 + 2]) * t
  );
  _qCurr.set(lut.quat[a4], lut.quat[a4 + 1], lut.quat[a4 + 2], lut.quat[a4 + 3]);
  _qSegB.set(lut.quat[b4], lut.quat[b4 + 1], lut.quat[b4 + 2], lut.quat[b4 + 3]);
  outQuat.copy(_qCurr).slerp(_qSegB, t);
}

function smoothDamp(current, target, vel, smoothTime, dt) {
  const st = Math.max(0.0001, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (vel.value + omega * change) * dt;
  vel.value = (vel.value - omega * temp) * exp;
  let output = target + (change + temp) * exp;
  if (target - current > 0 === output > target) {
    output = target;
    vel.value = 0;
  }
  return output;
}

const lut = buildLut();
sampleClip(0, _pos, _quat, _scale);
const restPos = _pos.clone();
const restQuat = _quat.clone();
const restScale = _scale.clone();

export function getScrollPct() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return 0;
  const y =
    window.lenis && typeof window.lenis.scroll === 'number'
      ? window.lenis.scroll
      : window.scrollY || document.documentElement.scrollTop || 0;
  return Math.max(0, Math.min(100, (y / max) * 100));
}

let snapped = false;
let playhead = 0;
const playheadVel = { value: 0 };

export function tickScrollAnimation(model, dt, { reducedMotion } = {}) {
  if (!model) return;

  if (reducedMotion) {
    model.position.copy(restPos);
    model.quaternion.copy(restQuat);
    model.scale.copy(restScale);
    return;
  }

  const targetPct = getScrollPct();
  const step = Math.max(dt, 0);

  if (!snapped) {
    playhead = targetPct;
    playheadVel.value = 0;
    sampleLut(lut, playhead, _pos, _quat, _scale);
    model.position.copy(_pos);
    model.quaternion.copy(_quat);
    model.scale.copy(_scale);
    snapped = true;
    return;
  }

  playhead = smoothDamp(playhead, targetPct, playheadVel, PLAYHEAD_SMOOTH, step);
  sampleLut(lut, playhead, _pos, _quat, _scale);

  const follow = 1 - Math.exp(-POSE_FOLLOW * step);
  model.position.lerp(_pos, follow);
  model.quaternion.slerp(_quat, follow);
  model.scale.lerp(_scale, follow);
}

export function resetScrollAnimation() {
  snapped = false;
  playhead = 0;
  playheadVel.value = 0;
}
