import './style.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { ShoeScene } from './three-scene.js';

gsap.registerPlugin(ScrollTrigger);

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* -------------------------------------------------------------------------- */
/*  DOM references                                                            */
/* -------------------------------------------------------------------------- */
const canvasWrap = document.getElementById('canvasWrap');
const loaderEl = document.getElementById('loader');
const loaderBar = document.getElementById('loaderBarFill');
const loaderPct = document.getElementById('loaderPct');
const loaderStat = document.getElementById('loaderStat');
const productStory = document.getElementById('productStory');

document.documentElement.classList.add('js-loading');

/* -------------------------------------------------------------------------- */
/*  Lenis smooth scroll                                                       */
/* -------------------------------------------------------------------------- */
let lenis = null;
if (!REDUCED) {
  lenis = new Lenis({
    lerp: 0.16,
    wheelMultiplier: 1.08,
    touchMultiplier: 1,
    smoothWheel: true,
  });

  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => {
    lenis.raf(time * 1000);
  });
  gsap.ticker.lagSmoothing(0);
}

window.lenis = lenis;

/* -------------------------------------------------------------------------- */
/*  Loader progress                                                           */
/* -------------------------------------------------------------------------- */
const loaderStages = ['3D PERFORMANCE MODEL', 'CARBON SYSTEM', 'AERO GEOMETRY', 'READY'];
let displayedPct = 0;

function setLoaderProgress(p) {
  const target = Math.round(p * 100);
  // ease displayed number toward target for a premium readout feel
  gsap.to(
    { v: displayedPct },
    {
      v: target,
      duration: 0.4,
      ease: 'power2.out',
      onUpdate: function () {
        displayedPct = this.targets()[0].v;
        const val = Math.round(displayedPct);
        loaderPct.textContent = String(val).padStart(2, '0') + '%';
        loaderBar.style.width = val + '%';
        loaderStat.textContent = loaderStages[Math.min(loaderStages.length - 1, Math.floor(val / 26))];
      },
    }
  );
}

function hideLoader() {
  loaderStat.textContent = 'READY';
  gsap.delayedCall(0.35, () => {
    loaderEl.classList.add('is-hidden');
    document.documentElement.classList.remove('js-loading');
  });
}

/* -------------------------------------------------------------------------- */
/*  3D scene                                                                  */
/* -------------------------------------------------------------------------- */
const scene = new ShoeScene({
  container: canvasWrap,
  reducedMotion: REDUCED,
  onProgress: (p) => setLoaderProgress(p),
  onLoaded: (shoe) => onShoeReady(shoe),
});

const MODEL_URL = `${import.meta.env.BASE_URL}models/shoe.glb`;
scene.load(MODEL_URL);

/* -------------------------------------------------------------------------- */
/*  Hero slot -> world projection                                             */
/* -------------------------------------------------------------------------- */
const heroState = {
  worldX: 0,
  worldY: 0,
  scale: 1,
};

function computeHeroPlacement() {
  const worldH = scene.worldHeightAtZ0();
  const worldW = worldH * scene.camera.aspect;
  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  const targetFrac = isMobile ? 0.72 : 0.52;
  const desiredWorldWidth = worldW * targetFrac;
  heroState.scale = desiredWorldWidth / 3.4;
  heroState.worldX = worldW * (isMobile ? 0.12 : 0.38);
  heroState.worldY = 0;
}

function applyHeroPlacement() {
  computeHeroPlacement();
  scene.shoeRoot.position.set(heroState.worldX, heroState.worldY, 0);
  scene.shoeRoot.scale.setScalar(heroState.scale);
  scene.shoeRoot.rotation.set(0.08, -0.15, -0.04);
  scene.shoePivot.position.set(0, 0, 0);
}

/* -------------------------------------------------------------------------- */
/*  When the shoe is ready                                                    */
/* -------------------------------------------------------------------------- */
let built = false;
let loadAttempts = 0;

function onShoeReady(shoe) {
  if (!shoe) {
    loadAttempts += 1;
    if (loadAttempts < 2) {
      loaderStat.textContent = 'RETRYING 3D MODEL';
      gsap.delayedCall(0.8, () => scene.load(MODEL_URL));
      return;
    }
    hideLoader();
    return;
  }

  hideLoader();

  const start = () => {
    applyHeroPlacement();
    if (!built) {
      buildTimelines();
      built = true;
    }
    ScrollTrigger.refresh();
  };

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(start);
  } else {
    start();
  }
}

/* -------------------------------------------------------------------------- */
/*  Timelines                                                                 */
/* -------------------------------------------------------------------------- */
function buildTimelines() {
  buildEditorialReveals();

  if (REDUCED) {
    return;
  }

  buildHeroPin();
  buildProductStory();
  buildSpeedMoment();
  buildParallax();
  buildStoryZ();

  ScrollTrigger.addEventListener('refreshInit', () => computeHeroPlacement());
}

/* --------- HERO PIN: cinematic product rotation --------------------------- */
function buildHeroPin() {
  const worldH = scene.worldHeightAtZ0();
  const centerY = 0;

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '.hero',
      start: 'top top',
      end: '+=1400',
      scrub: true,
      pin: true,
      pinSpacing: true,
    },
  });

  const rootPos = scene.shoeRoot.position;
  const rootRot = scene.shoeRoot.rotation;
  const rootScale = scene.shoeRoot.scale;
  const s = (mult) => heroState.scale * mult;

  tl.to(rootPos, { x: heroState.worldX, y: centerY + worldH * 0.02, duration: 0.3, ease: 'power1.inOut' }, 0)
    .to(rootRot, { x: -0.18, y: 0.55, z: -0.02, duration: 0.3, ease: 'power1.inOut' }, 0)
    .to(rootScale, { x: s(1.12), y: s(1.12), z: s(1.12), duration: 0.3, ease: 'power1.inOut' }, 0);

  tl.to(rootPos, { y: centerY - worldH * 0.05, duration: 0.25, ease: 'power1.inOut' }, 0.3)
    .to(rootRot, { x: 0.75, y: 1.0, z: 0.0, duration: 0.25, ease: 'power1.inOut' }, 0.3);

  tl.to(rootPos, { y: centerY, duration: 0.2, ease: 'power1.inOut' }, 0.55)
    .to(rootRot, { x: 0.12, y: -0.35, z: 0.03, duration: 0.2, ease: 'power1.inOut' }, 0.55);

  tl.to(rootPos, { x: heroState.worldX, y: centerY - worldH * 0.01, duration: 0.25, ease: 'power2.inOut' }, 0.75)
    .to(rootRot, { x: 0.1, y: -0.32, z: 0.02, duration: 0.25, ease: 'power2.inOut' }, 0.75)
    .to(rootScale, { x: s(0.98), y: s(0.98), z: s(0.98), duration: 0.25, ease: 'power2.inOut' }, 0.75);
}

/* --------- PRODUCT STORY: turntable + Y drift ----------------------------- */
function buildProductStory() {
  gsap.fromTo(
    scene.shoePivot.position,
    { y: 0 },
    {
      y: 0,
      ease: 'none',
      scrollTrigger: {
        trigger: '.product-story',
        start: 'top bottom',
        end: 'top 20%',
        scrub: true,
      },
    }
  );

  gsap.to(scene.shoeRoot.rotation, {
    y: '+=' + Math.PI * 2,
    ease: 'none',
    scrollTrigger: {
      trigger: '.product-story',
      start: 'top 55%',
      end: 'bottom top',
      scrub: true,
    },
  });
}

/* --------- SPEED MOMENT: L->R acceleration then settle -------------------- */
function buildSpeedMoment() {
  const worldH = scene.worldHeightAtZ0();
  const worldW = worldH * scene.camera.aspect;
  const dash = worldW * 0.34;

  gsap.timeline({
    scrollTrigger: {
      trigger: '#speedMoment',
      start: 'top bottom',
      end: 'bottom top',
      scrub: 0.6,
    },
  })
    .fromTo(scene.shoePivot.position, { x: -dash }, { x: dash, duration: 0.5, ease: 'power3.in' }, 0)
    .to(scene.shoePivot.position, { x: 0, duration: 0.5, ease: 'power3.out' }, 0.5)
    .fromTo(
      scene.shoeRoot.scale,
      { x: heroState.scale * 0.98, y: heroState.scale * 0.98, z: heroState.scale * 0.98 },
      {
        x: heroState.scale * 1.1,
        y: heroState.scale * 1.1,
        z: heroState.scale * 1.1,
        duration: 0.5,
        ease: 'power2.in',
      },
      0
    )
    .to(
      scene.shoeRoot.scale,
      {
        x: heroState.scale * 0.98,
        y: heroState.scale * 0.98,
        z: heroState.scale * 0.98,
        duration: 0.5,
        ease: 'power2.out',
      },
      0.5
    );

  const streaks = gsap.utils.toArray('.speed-moment__streaks span');
  gsap.timeline({
    scrollTrigger: {
      trigger: '#speedMoment',
      start: 'top 80%',
      end: 'bottom top',
      scrub: 0.6,
    },
  })
    .fromTo(
      streaks,
      { xPercent: -140, opacity: 0 },
      { xPercent: 260, opacity: 1, stagger: 0.04, ease: 'power2.in' }
    )
    .to(streaks, { opacity: 0, duration: 0.4 }, '>-0.2');

  gsap.fromTo(
    '.speed-moment__word',
    { xPercent: -6, letterSpacing: '-0.05em' },
    {
      xPercent: 6,
      ease: 'none',
      scrollTrigger: { trigger: '#speedMoment', start: 'top bottom', end: 'bottom top', scrub: true },
    }
  );
}

/* --------- EDITORIAL REVEALS ---------------------------------------------- */
function buildEditorialReveals() {
  gsap.utils.toArray('.reveal-group').forEach((group) => {
    const items = group.querySelectorAll('.reveal');
    if (!items.length) return;

    gsap.to(items, {
      opacity: 1,
      y: 0,
      x: 0,
      stagger: 0.05,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: group,
        start: 'top 82%',
        end: 'top 40%',
        scrub: REDUCED ? false : 0.85,
        toggleActions: REDUCED ? 'play none none none' : undefined,
      },
    });
  });

  // SVG line draw-on
  gsap.utils.toArray('.exploded__path, .anno__path').forEach((path) => {
    const len = path.getTotalLength ? path.getTotalLength() : 300;
    gsap.set(path, { strokeDasharray: len, strokeDashoffset: len });
    gsap.to(path, {
      strokeDashoffset: 0,
      ease: 'none',
      scrollTrigger: {
        trigger: path.closest('.chapter') || path.closest('.hero') || path,
        start: 'top 70%',
        end: 'center center',
        scrub: 0.85,
      },
    });
  });

  // speed lines grow horizontally on scroll
  gsap.utils.toArray('.speedlines span').forEach((line, i) => {
    gsap.fromTo(
      line,
      { scaleX: 0.2 },
      {
        scaleX: 1,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: line.closest('.chapter'),
          start: 'top 75%',
          end: 'center center',
          scrub: 0.85,
        },
      }
    );
  });
}

/* --------- BACKGROUND PARALLAX -------------------------------------------- */
function buildParallax() {
  // ghost numbers scale/opacity
  gsap.utils.toArray('.chapter__ghost').forEach((ghost) => {
    gsap.fromTo(
      ghost,
      { scale: 0.9, opacity: 0.04 },
      {
        scale: 1.08,
        opacity: 0.1,
        ease: 'none',
        scrollTrigger: {
          trigger: ghost.closest('.chapter'),
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1.5,
        },
      }
    );
  });

  // hero glow drift + scale breathing
  gsap.to('.glow--a', {
    scale: 1.08,
    yPercent: -8,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 1.5 },
  });
  gsap.to('.glow--b', {
    scale: 0.92,
    yPercent: 6,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 1.5 },
  });
}

/* --------- STORY Z-INDEX / CANVAS ELEVATION ------------------------------- */
function buildStoryZ() {
  ScrollTrigger.create({
    trigger: '.product-story',
    start: 'top 60%',
    end: 'bottom bottom',
    onToggle: (self) => {
      canvasWrap.classList.toggle('is-story', self.isActive);
    },
  });
}

/* -------------------------------------------------------------------------- */
/*  Resize                                                                    */
/* -------------------------------------------------------------------------- */
let resizeRAF = null;
window.addEventListener('resize', () => {
  if (resizeRAF) cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(() => {
    computeHeroPlacement();
    ScrollTrigger.refresh();
  });
});

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    if (built) {
      computeHeroPlacement();
      ScrollTrigger.refresh();
    }
  });
}

/* Anchor links respect Lenis */
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const el = document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(el, { offset: -80 });
    else el.scrollIntoView({ behavior: 'smooth' });
  });
});

gsap.delayedCall(18, () => {
  if (!loaderEl.classList.contains('is-hidden')) {
    hideLoader();
    if (!built) {
      applyHeroPlacement();
      buildTimelines();
      built = true;
      ScrollTrigger.refresh();
    }
  }
});
