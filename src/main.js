import './style.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { ShoeScene } from './three-scene.js';
import { tickScrollAnimation } from './scroll-animation.js';

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
    lerp: 0.12,
    wheelMultiplier: 1.0,
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

scene.setScrollDriver((root, dt) => {
  tickScrollAnimation(root, dt, { reducedMotion: REDUCED });
});

/* -------------------------------------------------------------------------- */
/*  When the shoe is ready                                                    */
/* -------------------------------------------------------------------------- */
let built = false;

function onShoeReady(shoe) {
  if (!shoe) {
    loaderStat.textContent = 'RETRYING 3D MODEL';
    gsap.delayedCall(1.2, () => scene.load(MODEL_URL));
    return;
  }

  hideLoader();

  const start = () => {
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
  buildParallax();
  buildStoryZ();

  if (REDUCED) return;

  buildSpeedMoment();
}

/* --------- SPEED MOMENT: HTML streaks (shoe path is keyframe-owned) ------ */
function buildSpeedMoment() {
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
    ScrollTrigger.refresh();
  });
});

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    if (built) ScrollTrigger.refresh();
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

/* The shoe GLB is ~122MB — keep the loader until it actually arrives. */
gsap.delayedCall(180, () => {
  if (!loaderEl.classList.contains('is-hidden')) {
    loaderStat.textContent = 'STILL LOADING MODEL';
  }
});
