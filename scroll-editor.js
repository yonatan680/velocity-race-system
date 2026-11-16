/**
 * scroll-editor.js
 * Grab the model → move/rotate/scale with the gizmo → save scroll keyframes.
 *
 * Expects (set these before or after this module loads):
 *   window.threeScene / threeCamera / threeRenderer / threeModel
 *
 * three r169 — TransformControls + OrbitControls from three/examples/jsm/controls/
 */
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const REVISION = THREE.REVISION || '?';
const PCT_DECIMALS = 0; // keyframe identity: rounded percent (0, 1, … 100)

// ── shared interpolation (editor preview === exported snippet) ──────────────
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function interpPose(keyframes, pct, outPos, outQuat, outScale) {
  const n = keyframes.length;
  if (!n) return;
  const p = Math.max(0, Math.min(100, pct));
  const first = keyframes[0];
  const last = keyframes[n - 1];
  if (p <= first.pct) {
    outPos.set(first.position[0], first.position[1], first.position[2]);
    outQuat.set(first.quaternion[0], first.quaternion[1], first.quaternion[2], first.quaternion[3]);
    outScale.set(first.scale[0], first.scale[1], first.scale[2]);
    return;
  }
  if (p >= last.pct) {
    outPos.set(last.position[0], last.position[1], last.position[2]);
    outQuat.set(last.quaternion[0], last.quaternion[1], last.quaternion[2], last.quaternion[3]);
    outScale.set(last.scale[0], last.scale[1], last.scale[2]);
    return;
  }
  let i = 0;
  while (i < n - 1 && keyframes[i + 1].pct < p) i++;
  const a = keyframes[i];
  const b = keyframes[i + 1];
  const span = b.pct - a.pct;
  const u = span <= 0 ? 1 : clamp01((p - a.pct) / span);
  const t = easeInOut(u);
  outPos.set(a.position[0], a.position[1], a.position[2]).lerp(
    _ib.set(b.position[0], b.position[1], b.position[2]),
    t
  );
  outQuat.set(a.quaternion[0], a.quaternion[1], a.quaternion[2], a.quaternion[3]).slerp(
    _qb.set(b.quaternion[0], b.quaternion[1], b.quaternion[2], b.quaternion[3]),
    t
  );
  outScale.set(a.scale[0], a.scale[1], a.scale[2]).lerp(
    _sb.set(b.scale[0], b.scale[1], b.scale[2]),
    t
  );
}

const _ib = new THREE.Vector3();
const _qb = new THREE.Quaternion();
const _sb = new THREE.Vector3();

// ── wait for the host to expose the scene ───────────────────────────────────
waitForRefs(start);

function waitForRefs(cb) {
  const t0 = performance.now();
  (function poll() {
    const scene = window.threeScene;
    const camera = window.threeCamera;
    const renderer = window.threeRenderer;
    const model = window.threeModel;
    if (scene && camera && renderer && model && model.parent) {
      cb({ scene, camera, renderer, model });
      return;
    }
    if (performance.now() - t0 > 20000) {
      console.error(
        '[scroll-editor] timed out waiting for window.threeScene / threeCamera / threeRenderer / threeModel (model must be in the scene graph).'
      );
      return;
    }
    requestAnimationFrame(poll);
  })();
}

function start({ scene, camera, renderer, model }) {
  const canvas = renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  const worldPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const box = new THREE.Box3();
  const bboxCenter = new THREE.Vector3();
  const originWorld = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _e = new THREE.Euler();

  // ── snapshot the pose the gizmo owns (safety net vs host animation) ──────
  const snap = {
    pos: model.position.clone(),
    quat: model.quaternion.clone(),
    scale: model.scale.clone(),
  };

  function captureSnap() {
    snap.pos.copy(model.position);
    snap.quat.copy(model.quaternion);
    snap.scale.copy(model.scale);
  }

  function applySnap() {
    model.position.copy(snap.pos);
    model.quaternion.copy(snap.quat);
    model.scale.copy(snap.scale);
  }

  function readKf() {
    return {
      pct: 0,
      position: [model.position.x, model.position.y, model.position.z],
      quaternion: [model.quaternion.x, model.quaternion.y, model.quaternion.z, model.quaternion.w],
      scale: [model.scale.x, model.scale.y, model.scale.z],
    };
  }

  function applyKf(kf) {
    model.position.set(kf.position[0], kf.position[1], kf.position[2]);
    model.quaternion.set(kf.quaternion[0], kf.quaternion[1], kf.quaternion[2], kf.quaternion[3]);
    model.scale.set(kf.scale[0], kf.scale[1], kf.scale[2]);
    captureSnap();
  }

  // ── keyframes (0% is created now, never deleted) ──────────────────────────
  const keyframes = [readKf()]; // pct filled below
  keyframes[0].pct = 0;

  let previewing = false;
  let selected = false;
  let bodyDrag = false;
  let gizmoDrag = false;
  let dragOffset = new THREE.Vector3();
  window.__editorActive = true;

  // ── TransformControls (r169+: add getHelper(); legacy: add controls) ──────
  const tcontrols = new TransformControls(camera, canvas);
  tcontrols.setSize(0.9);
  tcontrols.setSpace('world');
  tcontrols.setMode('translate');

  let helper;
  let gizmoMethod;
  if (typeof tcontrols.getHelper === 'function') {
    helper = tcontrols.getHelper();
    scene.add(helper);
    gizmoMethod = 'getHelper() (r169+)';
  } else {
    helper = tcontrols;
    scene.add(tcontrols);
    gizmoMethod = 'direct add (legacy Object3D)';
  }

  helper.traverse((node) => {
    node.renderOrder = 1e6;
    node.frustumCulled = false;
    const mats = node.material
      ? Array.isArray(node.material)
        ? node.material
        : [node.material]
      : [];
    mats.forEach((m) => {
      m.depthTest = false;
      m.depthWrite = false;
      m.transparent = true;
    });
  });

  box.setFromObject(model);
  box.getCenter(bboxCenter);
  model.getWorldPosition(originWorld);
  const centerOffset = bboxCenter.distanceTo(originWorld);
  if (centerOffset > 0.05) {
    console.warn(
      `[scroll-editor] model origin is ${centerOffset.toFixed(3)} units from bbox center — gizmo sits on the origin. Prefer a parent group already centered on the mesh.`
    );
  }

  tcontrols.addEventListener('dragging-changed', (e) => {
    gizmoDrag = !!e.value;
    orbit.enabled = !gizmoDrag && !bodyDrag && !previewing;
    if (!gizmoDrag) captureSnap();
  });
  tcontrols.addEventListener('objectChange', () => {
    captureSnap();
    updateReadout();
  });

  // ── OrbitControls (disabled while a handle / body-drag is active) ─────────
  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.enableZoom = false; // wheel scrolls the PAGE (keyframes); alt/ctrl+wheel zooms
  orbit.screenSpacePanning = true;
  orbit.enablePan = true;
  orbit.target.copy(bboxCenter);
  orbit.update();

  // ── host render hook: apply editor pose AFTER the site's own loop ─────────
  const _render = renderer.render.bind(renderer);
  renderer.render = function patchedRender(scn, cam) {
    if (previewing) {
      interpPose(keyframes, getScrollPct(), _v, _q, _s);
      model.position.copy(_v);
      model.quaternion.copy(_q);
      model.scale.copy(_s);
    } else if (window.__editorActive) {
      applySnap();
    }
    if (!previewing) orbit.update();
    return _render(scn, cam);
  };

  function pointerNDC(event) {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    ndc.x = ((event.clientX - rect.left) / w) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / h) * 2 + 1;
    return ndc;
  }

  function hitsModel(event) {
    raycaster.setFromCamera(pointerNDC(event), camera);
    return raycaster.intersectObject(model, true).length > 0;
  }

  function hitsGizmo(event) {
    if (!selected || !helper || !helper.visible) return false;
    raycaster.setFromCamera(pointerNDC(event), camera);
    return raycaster.intersectObject(helper, true).length > 0;
  }

  function select() {
    selected = true;
    tcontrols.attach(model);
    helper.visible = true;
    tcontrols.enabled = true;
    updatePanel();
  }

  function deselect() {
    selected = false;
    bodyDrag = false;
    tcontrols.detach();
    helper.visible = false;
    tcontrols.enabled = false;
    orbit.enabled = !previewing;
    updatePanel();
  }

  function startBodyDrag(event) {
    bodyDrag = true;
    orbit.enabled = false;
    model.getWorldPosition(worldPos);
    camera.getWorldDirection(camDir);
    plane.setFromNormalAndCoplanarPoint(camDir, worldPos);
    raycaster.setFromCamera(pointerNDC(event), camera);
    if (raycaster.ray.intersectPlane(plane, hit)) {
      dragOffset.copy(worldPos).sub(hit);
    } else {
      dragOffset.set(0, 0, 0);
    }
  }

  function moveBodyDrag(event) {
    camera.getWorldDirection(camDir);
    model.getWorldPosition(worldPos);
    plane.setFromNormalAndCoplanarPoint(camDir, worldPos);
    raycaster.setFromCamera(pointerNDC(event), camera);
    if (!raycaster.ray.intersectPlane(plane, hit)) return;
    const target = hit.add(dragOffset);
    if (model.parent) {
      model.parent.updateWorldMatrix(true, false);
      model.parent.worldToLocal(target);
    }
    model.position.copy(target);
    captureSnap();
    updateReadout();
  }

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (previewing || e.button !== 0) return;
      if (hitsGizmo(e)) {
        orbit.enabled = false;
        return;
      }
      if (hitsModel(e)) {
        e.stopPropagation();
        select();
        startBodyDrag(e);
      }
    },
    true
  );

  window.addEventListener('pointermove', (e) => {
    if (!bodyDrag) return;
    moveBodyDrag(e);
  });

  window.addEventListener('pointerup', () => {
    if (!bodyDrag) return;
    bodyDrag = false;
    orbit.enabled = !previewing;
    captureSnap();
  });

  // Page scroll always (this is how you pick keyframe %); alt/ctrl+wheel zooms.
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (previewing) return;
      if (e.ctrlKey || e.altKey) {
        e.preventDefault();
        const factor = Math.exp(e.deltaY * 0.0015);
        const offset = camera.position.clone().sub(orbit.target);
        offset.multiplyScalar(factor);
        camera.position.copy(orbit.target).add(offset);
        orbit.update();
        return;
      }
      e.preventDefault();
      const dy = e.deltaY;
      if (window.lenis && typeof window.lenis.scrollTo === 'function') {
        const y =
          (typeof window.lenis.scroll === 'number' ? window.lenis.scroll : window.scrollY) + dy;
        window.lenis.scrollTo(y, { immediate: true });
      } else {
        window.scrollBy(0, dy);
      }
    },
    { passive: false }
  );

  window.addEventListener('keydown', (e) => {
    if (previewing) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') deselect();
    else if (e.key === 'w' || e.key === 'W') setMode('translate');
    else if (e.key === 'e' || e.key === 'E') setMode('rotate');
    else if (e.key === 'r' || e.key === 'R') setMode('scale');
  });

  function setMode(mode) {
    tcontrols.setMode(mode);
    updatePanel();
  }

  // ── scroll helpers ────────────────────────────────────────────────────────
  function getScrollY() {
    if (window.lenis && typeof window.lenis.scroll === 'number') return window.lenis.scroll;
    return window.scrollY || document.documentElement.scrollTop || 0;
  }

  function getScrollMax() {
    return Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  }

  function getScrollPct() {
    return (getScrollY() / getScrollMax()) * 100;
  }

  function roundPct(pct) {
    const f = Math.pow(10, PCT_DECIMALS);
    return Math.max(0, Math.min(100, Math.round(pct * f) / f));
  }

  function findKfIndex(pct) {
    const p = roundPct(pct);
    return keyframes.findIndex((k) => roundPct(k.pct) === p);
  }

  function jumpTo(pct) {
    const y = (roundPct(pct) / 100) * getScrollMax();
    if (window.lenis && typeof window.lenis.scrollTo === 'function') {
      window.lenis.scrollTo(y, { immediate: true });
    } else {
      window.scrollTo(0, y);
    }
  }

  function saveKeyframe() {
    const pct = roundPct(getScrollPct());
    const kf = readKf();
    kf.pct = pct;
    const i = findKfIndex(pct);
    if (i >= 0) keyframes[i] = kf;
    else keyframes.push(kf);
    keyframes.sort((a, b) => a.pct - b.pct);
    captureSnap();
    updatePanel();
  }

  function deleteKeyframe(index) {
    if (index <= 0) return; // 0% start cannot be deleted
    keyframes.splice(index, 1);
    updatePanel();
  }

  // ── canvas must receive clicks in edit mode (site often has overlays) ─────
  const wrap = canvas.parentElement;
  const prev = {
    canvasPE: canvas.style.pointerEvents,
    wrapPE: wrap ? wrap.style.pointerEvents : '',
    wrapZ: wrap ? wrap.style.zIndex : '',
  };

  function enableCanvasHits(on) {
    canvas.style.pointerEvents = on ? 'auto' : prev.canvasPE || '';
    if (wrap) {
      wrap.style.pointerEvents = on ? 'auto' : prev.wrapPE || '';
      wrap.style.zIndex = on ? '2147483000' : prev.wrapZ || '';
    }
  }

  // ── panel (small, fixed, never a full-screen overlay) ─────────────────────
  const root = document.createElement('div');
  root.id = 'se-root';
  root.innerHTML = `
    <style>
      #se-root{pointer-events:none;position:fixed;inset:0;z-index:2147483646;font-family:ui-sans-serif,system-ui,sans-serif}
      #se-panel{pointer-events:auto;position:fixed;top:12px;right:12px;width:268px;background:#141414;color:#eee;border:1px solid #333;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.4);font-size:12px;line-height:1.35;user-select:none}
      #se-panel *{box-sizing:border-box}
      #se-hd{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;cursor:pointer;border-bottom:1px solid #2a2a2a;font-weight:600;letter-spacing:.02em}
      #se-hd span{opacity:.55;font-weight:400;font-size:11px}
      #se-body{padding:8px 10px 10px}
      #se-body.hidden{display:none}
      #se-modes{display:flex;gap:4px;margin-bottom:8px}
      #se-modes button,#se-body button{appearance:none;border:1px solid #3a3a3a;background:#1e1e1e;color:#eee;border-radius:5px;padding:5px 8px;cursor:pointer;font-size:11px}
      #se-modes button.on,#se-save.on{background:#2a5a3a;border-color:#3d8a55}
      #se-modes button:hover,#se-body button:hover{border-color:#777}
      #se-read{font-variant-numeric:tabular-nums;opacity:.85;font-size:10.5px;margin:0 0 8px;white-space:pre-line}
      #se-pct{font-variant-numeric:tabular-nums;margin:0 0 8px;opacity:.9}
      #se-save{width:100%;margin-bottom:8px;font-weight:600}
      #se-list{max-height:180px;overflow:auto;border:1px solid #2a2a2a;border-radius:5px;margin-bottom:8px}
      .se-row{display:flex;align-items:center;gap:6px;padding:5px 6px;border-bottom:1px solid #222;cursor:pointer}
      .se-row:last-child{border-bottom:0}
      .se-row:hover{background:#1c1c1c}
      .se-row b{flex:1;font-weight:500;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .se-row .se-del{border:0;background:transparent;color:#c66;padding:0 4px;cursor:pointer;font-size:13px}
      .se-row .se-del[disabled]{opacity:.25;cursor:not-allowed}
      #se-actions{display:flex;gap:4px}
      #se-actions button{flex:1}
      #se-exit{display:none;pointer-events:auto;position:fixed;top:12px;right:12px;background:#141414;color:#eee;border:1px solid #333;border-radius:8px;padding:8px 12px;cursor:pointer;font-size:12px}
    </style>
    <div id="se-panel">
      <div id="se-hd">Scroll editor <span>collapse</span></div>
      <div id="se-body">
        <div id="se-modes">
          <button data-mode="translate" class="on">Move W</button>
          <button data-mode="rotate">Rotate E</button>
          <button data-mode="scale">Scale R</button>
        </div>
        <div id="se-read"></div>
        <div id="se-pct"></div>
        <button id="se-save">+ Add keyframe</button>
        <div id="se-list"></div>
        <div id="se-actions">
          <button id="se-preview">▶ Preview</button>
          <button id="se-export">📤 Export</button>
        </div>
      </div>
    </div>
    <button id="se-exit">■ Exit preview</button>
  `;
  document.body.appendChild(root);

  const panel = root.querySelector('#se-panel');
  const body = root.querySelector('#se-body');
  const hd = root.querySelector('#se-hd');
  const readEl = root.querySelector('#se-read');
  const pctEl = root.querySelector('#se-pct');
  const saveBtn = root.querySelector('#se-save');
  const listEl = root.querySelector('#se-list');
  const previewBtn = root.querySelector('#se-preview');
  const exportBtn = root.querySelector('#se-export');
  const exitBtn = root.querySelector('#se-exit');

  hd.addEventListener('click', () => {
    body.classList.toggle('hidden');
    hd.querySelector('span').textContent = body.classList.contains('hidden') ? 'expand' : 'collapse';
  });

  root.querySelectorAll('#se-modes button').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  saveBtn.addEventListener('click', saveKeyframe);
  previewBtn.addEventListener('click', () => setPreview(true));
  exitBtn.addEventListener('click', () => setPreview(false));
  exportBtn.addEventListener('click', doExport);

  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.se-row');
    if (!row) return;
    const index = Number(row.dataset.i);
    if (e.target.classList.contains('se-del')) {
      deleteKeyframe(index);
      return;
    }
    const kf = keyframes[index];
    jumpTo(kf.pct);
    applyKf(kf);
    select();
    updatePanel();
  });

  function fmt(n, d = 2) {
    return Number(n).toFixed(d);
  }

  function updateReadout() {
    _e.setFromQuaternion(model.quaternion, 'XYZ');
    const rx = THREE.MathUtils.radToDeg(_e.x);
    const ry = THREE.MathUtils.radToDeg(_e.y);
    const rz = THREE.MathUtils.radToDeg(_e.z);
    const uni = (model.scale.x + model.scale.y + model.scale.z) / 3;
    readEl.textContent =
      `pos  ${fmt(model.position.x)}  ${fmt(model.position.y)}  ${fmt(model.position.z)}\n` +
      `rot  ${fmt(rx, 1)}°  ${fmt(ry, 1)}°  ${fmt(rz, 1)}°\n` +
      `scale  ${fmt(model.scale.x)}  ${fmt(model.scale.y)}  ${fmt(model.scale.z)}  (${fmt(uni)})`;
  }

  function updatePanel() {
    const pct = roundPct(getScrollPct());
    pctEl.textContent = `scroll  ${fmt(pct, PCT_DECIMALS)}%`;
    const exists = findKfIndex(pct) >= 0;
    saveBtn.textContent = exists ? '✓ Update keyframe' : '+ Add keyframe';
    saveBtn.classList.toggle('on', exists);

    root.querySelectorAll('#se-modes button').forEach((btn) => {
      btn.classList.toggle('on', btn.dataset.mode === tcontrols.mode);
    });

    listEl.innerHTML = keyframes
      .map((k, i) => {
        const uni = (k.scale[0] + k.scale[1] + k.scale[2]) / 3;
        const label =
          i === 0
            ? `${k.pct}% (start)`
            : `${k.pct}%  pos ${fmt(k.position[0], 1)},${fmt(k.position[1], 1)},${fmt(k.position[2], 1)}  ·  scale ${fmt(uni, 2)}`;
        const del =
          i === 0
            ? `<button class="se-del" disabled title="start keyframe cannot be deleted">🗑</button>`
            : `<button class="se-del" title="delete">🗑</button>`;
        return `<div class="se-row" data-i="${i}"><b>${label}</b>${del}</div>`;
      })
      .join('');

    updateReadout();
  }

  function setPreview(on) {
    previewing = on;
    window.__editorActive = !on;
    panel.style.display = on ? 'none' : '';
    exitBtn.style.display = on ? 'block' : 'none';
    helper.visible = on ? false : selected;
    tcontrols.enabled = !on && selected;
    orbit.enabled = !on;
    enableCanvasHits(!on);
    if (!on) {
      applySnap();
      if (selected) tcontrols.attach(model);
    }
  }

  function doExport() {
    const data = JSON.stringify(keyframes, null, 2);
    const snippet = buildExportSnippet(data);
    const blob = new Blob([snippet], { type: 'text/javascript' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scroll-animation.js';
    a.click();
    URL.revokeObjectURL(a.href);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(snippet).then(
        () => console.log('[scroll-editor] export copied to clipboard + downloaded as scroll-animation.js'),
        () => console.log('[scroll-editor] export downloaded as scroll-animation.js')
      );
    } else {
      console.log('[scroll-editor] export downloaded as scroll-animation.js');
    }
  }

  window.addEventListener('scroll', () => {
    if (!previewing) updatePanel();
  }, { passive: true });

  if (window.lenis && typeof window.lenis.on === 'function') {
    window.lenis.on('scroll', () => {
      if (!previewing) updatePanel();
    });
  }

  enableCanvasHits(true);
  select();
  updatePanel();

  const overlayHint = canvasHitsBlocked()
    ? '  ⚠ An HTML layer is still above the canvas. Give it pointer-events:none so clicks reach the model.'
    : '';

  console.log(
    `[scroll-editor] three r${REVISION} | model: ${model.name || model.type || 'Object3D'} | gizmo: ${gizmoMethod} | attached${overlayHint}`
  );
}

function canvasHitsBlocked() {
  const r = window.threeRenderer;
  if (!r) return false;
  const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  return el && el !== r.domElement && !r.domElement.contains(el) && el.id !== 'se-panel' && !el.closest('#se-root');
}

function buildExportSnippet(keyframesJson) {
  return `/* scroll-animation.js — drop onto window.threeModel. Hand-edit KEYFRAMES. */
const KEYFRAMES = ${keyframesJson};

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function getScrollPct() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return 0;
  const y = (window.lenis && typeof window.lenis.scroll === 'number')
    ? window.lenis.scroll
    : (window.scrollY || document.documentElement.scrollTop || 0);
  return Math.max(0, Math.min(100, (y / max) * 100));
}

const _pos = new THREE.Vector3();
const _posB = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _scaleB = new THREE.Vector3();

function applyScrollPose(model, pct) {
  const kfs = KEYFRAMES;
  const n = kfs.length;
  if (!n || !model) return;
  const p = Math.max(0, Math.min(100, pct));
  const first = kfs[0];
  const last = kfs[n - 1];

  // Clamp to ends — never extrapolate (overscroll must not drift).
  if (p <= first.pct) {
    model.position.fromArray(first.position);
    model.quaternion.fromArray(first.quaternion);
    model.scale.fromArray(first.scale);
    return;
  }
  if (p >= last.pct) {
    model.position.fromArray(last.position);
    model.quaternion.fromArray(last.quaternion);
    model.scale.fromArray(last.scale);
    return;
  }

  let i = 0;
  while (i < n - 1 && kfs[i + 1].pct < p) i++;
  const a = kfs[i];
  const b = kfs[i + 1];
  const span = b.pct - a.pct;
  const t = easeInOut(span <= 0 ? 1 : clamp01((p - a.pct) / span));

  _pos.fromArray(a.position).lerp(_posB.fromArray(b.position), t);
  _quat.fromArray(a.quaternion).slerp(_quatB.fromArray(b.quaternion), t);
  _scale.fromArray(a.scale).lerp(_scaleB.fromArray(b.scale), t);
  model.position.copy(_pos);
  model.quaternion.copy(_quat);
  model.scale.copy(_scale);
}

function onScroll() {
  applyScrollPose(window.threeModel, getScrollPct());
}

window.addEventListener('scroll', onScroll, { passive: true });
onScroll();
`;
}
