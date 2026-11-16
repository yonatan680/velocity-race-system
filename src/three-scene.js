import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Premium studio 3D scene for the racing shoe.
 *
 * Object hierarchy (each layer owns ONE responsibility so ScrollTriggers
 * never fight over the same transform):
 *   shoePivot       -> product-story Y drift only
 *   shoeRoot        -> major scroll position + rotation
 *   shoeOrientation -> permanent GLB orientation correction (static)
 *   shoe            -> gltf.scene, idle motion only
 */
export class ShoeScene {
  constructor({ container, onProgress, onLoaded, reducedMotion }) {
    this.container = container;
    this.onProgress = onProgress || (() => {});
    this.onLoaded = onLoaded || (() => {});
    this.reducedMotion = !!reducedMotion;

    this.isMobile = window.matchMedia('(max-width: 900px)').matches;

    this.clock = new THREE.Clock();
    this._raf = null;
    this._ready = false;
    this._scrollDriver = null;

    // idle motion accumulators (kept separate & additive)
    this.idle = { y: 0, z: 0 };

    this._initRenderer();
    this._initScene();
    this._initCamera();
    this._initEnvironment();
    this._initLights();
    this._initPivots();

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);

    this._animate = this._animate.bind(this);
    this._raf = requestAnimationFrame(this._animate);
  }

  /* ------------------------------------------------------------ renderer */
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isMobile,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0); // transparent
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this._setSize();
    this.container.appendChild(this.renderer.domElement);
  }

  _dprCap() {
    return this.isMobile ? 1.45 : 1.85;
  }

  _setSize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this._dprCap()));
    this.renderer.setSize(w, h, false);
  }

  /* --------------------------------------------------------------- scene */
  _initScene() {
    this.scene = new THREE.Scene();
  }

  /* -------------------------------------------------------------- camera */
  _initCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(36, aspect, 0.1, 100);
    this.camera.position.set(0, 0, 7);
    this.camera.lookAt(0, 0, 0);
  }

  /* ---------------------------------------------------------- environment */
  _initEnvironment() {
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new RoomEnvironment();
    this.envMap = this.pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environment = this.envMap;
    // background stays null so HTML gradients show through
  }

  /* -------------------------------------------------------------- lights */
  _initLights() {
    const hemi = new THREE.HemisphereLight(0xfff4ec, 0x6d7078, 0.55);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(4, 5, 5);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.65);
    fill.position.set(-4, 2, 3);
    this.scene.add(fill);

    // orange rim / energy accent
    const rim = new THREE.PointLight(0xff4b24, 1.5, 12, 2);
    rim.position.set(-1, 2, -4);
    this.scene.add(rim);
  }

  /* -------------------------------------------------------------- pivots */
  _initPivots() {
    this.shoePivot = new THREE.Group();       // product-story Y drift
    this.shoeRoot = new THREE.Group();         // scroll transforms
    this.shoeOrientation = new THREE.Group();  // static GLB correction
    this.shoePivot.add(this.shoeRoot);
    this.shoeRoot.add(this.shoeOrientation);
    this.scene.add(this.shoePivot);

    // baseline transforms that scroll timelines read/write
    this.shoeRoot.position.set(0, 0, 0);
    this.shoeRoot.rotation.set(0.08, -0.15, -0.04);
    this.baseScale = 1;
  }

  /* ---------------------------------------------------------- load model */
  load(url) {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => this._onModelLoaded(gltf),
      (evt) => {
        if (evt.lengthComputable) {
          this.onProgress(evt.loaded / evt.total);
        } else {
          // stream without content-length: nudge progress forward
          this.onProgress(Math.min(0.9, (evt.loaded || 0) / (12 * 1024 * 1024)));
        }
      },
      (err) => {
        console.error('[ShoeScene] GLB load error', err);
        this.onProgress(1);
        this.onLoaded(null);
      }
    );
  }

  _onModelLoaded(gltf) {
    this.shoe = gltf.scene;

    // --- material tuning: keep it premium, never plastic ---
    this.shoe.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = false;
        node.receiveShadow = false;
        node.frustumCulled = false;
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach((m) => {
          if (!m) return;
          if ('envMapIntensity' in m) m.envMapIntensity = 1.15;
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          m.needsUpdate = true;
        });
      }
    });

    // --- normalize scale so world width ~= 3.4 units ---
    let box = new THREE.Box3().setFromObject(this.shoe);
    const size = box.getSize(new THREE.Vector3());
    const longestHoriz = Math.max(size.x, size.z); // horizontal object
    const targetWidth = 3.4;
    const scale = longestHoriz > 0 ? targetWidth / longestHoriz : 1;
    this.shoe.scale.setScalar(scale);

    // --- recenter about bounding-box center (visual center) ---
    box = new THREE.Box3().setFromObject(this.shoe);
    const center = box.getCenter(new THREE.Vector3());
    this.shoe.position.sub(center);

    // --- orientation correction on the dedicated static group ---
    // Meshy exports vary; establish a premium side-profile resting pose:
    // toe -> right, heel -> left, slight upward pitch, outsole hinted.
    this._orientToSideProfile();
    this.shoeOrientation.add(this.shoe);
    this._recenterAfterOrientation();

    this._ready = true;
    this.onProgress(1);
    this.onLoaded(this.shoe);
  }

  /**
   * Rotate the orientation group so the imported GLB rests as a
   * side-profile product shot. We detect the model's proportions to
   * pick a sensible base rotation, then apply a small upward pitch.
   */
  _orientToSideProfile() {
    const box = new THREE.Box3().setFromObject(this.shoe);
    const size = box.getSize(new THREE.Vector3());

    // If the model is "tall" (y is the longest axis) it was likely
    // exported standing up; lay it down onto its side profile.
    const longest = Math.max(size.x, size.y, size.z);
    if (size.y === longest) {
      this.shoeOrientation.rotation.z = -Math.PI / 2;
    } else if (size.z > size.x) {
      // depth-dominant: turn so length runs along screen X
      this.shoeOrientation.rotation.y = Math.PI / 2;
    }

    // slight upward pitch (5–10°) + micro yaw for perspective toward camera
    this.shoeOrientation.rotation.x += THREE.MathUtils.degToRad(7);
    // Meshy export faces toe toward -X; turn so toe points right in the hero.
    this.shoeOrientation.rotation.y += Math.PI;
  }

  /**
   * After orientation, shift so the visible AABB is centered on shoeRoot.
   * Meshy (and similar) exports often leave the mesh origin at a heel/toe,
   * which would otherwise park the shoe on the left of the hero.
   */
  _recenterAfterOrientation() {
    this.shoeOrientation.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.shoeOrientation);
    const centerWorld = box.getCenter(new THREE.Vector3());
    const parent = this.shoeOrientation.parent;
    if (parent) {
      parent.updateMatrixWorld(true);
      parent.worldToLocal(centerWorld);
    }
    this.shoeOrientation.position.sub(centerWorld);
    this._baseY = this.shoe.position.y;
  }

  /* ------------------------------------------------------ slot projection */
  /**
   * Project the screen-center of the hero slot rect onto the world plane
   * at z = 0, and return the world {x, y}. Used to seat the shoe inside
   * the hero typography.
   */
  screenToWorldAtZ0(clientX, clientY) {
    const ndc = new THREE.Vector3(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
      0.5
    );
    ndc.unproject(this.camera);
    const dir = ndc.sub(this.camera.position).normalize();
    const distance = -this.camera.position.z / dir.z; // intersect z=0
    return this.camera.position.clone().add(dir.multiplyScalar(distance));
  }

  /** Visible world height at z=0 for the current camera — used for sizing. */
  worldHeightAtZ0() {
    const dist = this.camera.position.z;
    return 2 * Math.tan((this.camera.fov * Math.PI) / 180 / 2) * dist;
  }

  /* --------------------------------------------------------------- resize */
  _onResize() {
    this.isMobile = window.matchMedia('(max-width: 900px)').matches;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this._setSize();
  }

  setScrollDriver(fn) {
    this._scrollDriver = fn;
  }

  /* ---------------------------------------------------------------- loop */
  _animate() {
    this._raf = requestAnimationFrame(this._animate);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    if (this._scrollDriver && this.shoeRoot) {
      this._scrollDriver(this.shoeRoot, dt);
    }

    if (this._ready && this.shoe && !this.reducedMotion) {
      // idle floating + breathing — additive on the mesh, independent of scroll
      this.idle.y = Math.sin(t * (Math.PI / 1.8)) * 0.028;
      this.idle.z = Math.sin(t * 0.6) * 0.01;
      this.shoe.position.y = this._shoeBaseY + this.idle.y;
      this.shoe.rotation.z = this.idle.z;
    }

    this.renderer.render(this.scene, this.camera);
  }

  get _shoeBaseY() {
    return this._baseY || 0;
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this.pmrem?.dispose();
    this.renderer?.dispose();
  }
}
