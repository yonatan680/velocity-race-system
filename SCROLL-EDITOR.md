# Scroll editor

One file: `scroll-editor.js`. Gizmo on the model, keyframes on scroll.

This project is **three r169** (`three@0.169.0`). Imports match `src/three-scene.js`:

```js
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
```

## 1. Setup

After the model is in the scene (and sitting at its start pose), assign:

```js
window.threeScene    = scene;
window.threeCamera   = camera;
window.threeRenderer = renderer;
window.threeModel    = myModel;   // the object you want to pose
```

For **this** site, add that in `onShoeReady` (after `applyHeroPlacement`) and expose Lenis so keyframe jumps stay smooth:

```js
window.threeScene    = scene.scene;
window.threeCamera   = scene.camera;
window.threeRenderer = scene.renderer;
window.threeModel    = scene.shoeRoot; // scroll-transform group, already centered
window.lenis         = lenis;
```

Then load the editor (Vite will bundle it from the HTML entry):

```html
<script type="module" src="/scroll-editor.js"></script>
```

## 2. Stop your animation from snapping the model back

The editor sets `window.__editorActive = true` in Edit mode (false during Preview).

Add this **one line at the top of any code that writes the model's transform** (idle float, GSAP, etc.) — **not** above `renderer.render()`, or the gizmo will never draw:

```js
if (window.__editorActive) return;
```

Exact place in this repo — inside `ShoeScene._animate`, around the idle writes only (do **not** return from the whole function or `render()` never runs):

```js
if (this._ready && this.shoe && !this.reducedMotion) {
  if (window.__editorActive) {
    // skip idle writes; fall through to renderer.render below
  } else {
    this.idle.y = Math.sin(t * (Math.PI / 1.8)) * 0.045;
    this.idle.z = Math.sin(t * 0.6) * 0.015;
    this.shoe.position.y = this._shoeBaseY + this.idle.y;
    this.shoe.rotation.z = this.idle.z;
  }
}

this.renderer.render(this.scene, this.camera);
```

Same one-liner at the top of any GSAP callback that writes `shoeRoot` / `shoePivot`.

The editor also re-applies its pose at the end of every `renderer.render` as a safety net (GSAP will still fight until you add the guard).

On load, the console should print something like:

`[scroll-editor] three r169 | model: … | gizmo: getHelper() (r169+) | attached`

## 3. Clicks must reach the canvas

The panel is a small box (`pointer-events: none` on the wrapper, `auto` only on the panel). It does not cover the page.

If an HTML layer sits over the canvas, give that layer `pointer-events: none` or clicks never hit the model.

This site already has `.canvas-wrap { pointer-events: none }`. While you are in **Edit**, the editor turns pointer-events on for the canvas so you can grab the shoe. Preview restores your styles.

## 4. Workflow

1. Drag the handles on the model (W move / E rotate / R scale). Center cube = free screen-plane drag. Click-drag the mesh itself does the same. Orbit with left-drag on empty space; pan with right-drag; **alt or ctrl + wheel** zooms. Plain wheel scrolls the page (that is your keyframe %).
2. At 0%, pose the start and click **+ Add keyframe** (it becomes **✓ Update keyframe** when a key already exists at this %). 0% is always there and can be overwritten; it cannot be deleted.
3. Scroll further, pose, add. Repeat. In-betweens are lerp (pos/scale) + slerp (rotation), easeInOut, clamped to the first/last key — no extrapolation.
4. **▶ Preview** hides the panel and gizmo and plays on scroll. **📤 Export** copies/downloads a standalone `scroll-animation.js` with `const KEYFRAMES = [...]` and the same math.
