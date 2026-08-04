// Boot and wiring. The browser keeps its native powers — scrolling, links,
// selection, find-in-page — while the field renders every visible mark.

import { createField } from "./field.js";
import { parseArticle, typeset } from "./typesetter.js";
import { createEntities } from "./entities.js";

const canvas = document.getElementById("field");
const scroller = document.getElementById("scroller");
const article = document.getElementById("article");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// The /lab page drives taste tests through URL params; absent params leave
// the production defaults untouched.
const params = new URLSearchParams(window.location.search);
const FONTS = {
  plex: { family: "IBM Plex Mono", css: "IBM+Plex+Mono:wght@400" },
  fragment: { family: "Fragment Mono", css: "Fragment+Mono" },
  space: { family: "Space Mono", css: "Space+Mono" },
  kode: { family: "Kode Mono", css: "Kode+Mono:wght@400" },
  courier: { family: "Courier Prime", css: "Courier+Prime" },
};
function hexParam(name) {
  const v = params.get(name);
  return v && /^[0-9a-fA-F]{6}$/.test(v) ? "#" + v : null;
}
const config = {
  font: FONTS[params.get("font")] ?? FONTS.plex,
  size: parseInt(params.get("size") ?? "", 10) || null,
  paper: hexParam("paper"),
  ink: hexParam("ink"),
  accent: hexParam("accent"),
  stagger: params.get("stagger") === "1",
};

const field = createField(canvas);
const entities = createEntities(field, config.accent ?? undefined);

let blocks = null;
let layoutResult = null;
let metrics = null;
let resizeTimer = 0;
let scrollEndTimer = 0;
let lastPointer = { x: 0, y: 0, t: 0 };
let booted = false;

function computeMetrics() {
  const desktop = config.size ?? 21;
  const fontSize = window.innerWidth < 720
    ? (config.size ? Math.max(12, Math.round(config.size * 0.72)) : 15)
    : desktop;
  const probe = document.createElement("canvas").getContext("2d");
  const font = `${fontSize}px "${config.font.family}", Menlo, monospace`;
  probe.font = font;
  const adv = probe.measureText("M").width;
  return {
    fontSize,
    adv,
    font,
    cellW: Math.round(adv + fontSize * 0.18),
    cellH: Math.round(fontSize * 1.24),
  };
}

function layout() {
  metrics = computeMetrics();
  field.setMetrics(metrics);
  field.resize(window.innerWidth, window.innerHeight);
  layoutResult = typeset(blocks, article, {
    cols: field.cols(),
    viewRows: field.rows(),
    cellW: metrics.cellW,
    cellH: metrics.cellH,
    adv: metrics.adv,
    fontSize: metrics.fontSize,
    xOffset: field.xOffset(),
  });
  field.setWorld(layoutResult.lines, layoutResult.worldRows);
  field.registerGlitches(layoutResult.glitches);
  bindLinks(layoutResult.links);
  article.classList.add("ready");
  updateHud();
}

function currentSection() {
  const camera = field.camera();
  let current = layoutResult.sections[0];
  for (const section of layoutResult.sections) {
    if (section.row <= camera + 3) current = section;
  }
  return current;
}

function updateHud() {
  const camera = field.camera();
  if (camera === 0) {
    field.setHud("");
    return;
  }
  const section = currentSection();
  const position = String(camera).padStart(3, "0");
  field.setHud(section.label ? `${position} · ${section.label}` : position);
}

function bindLinks(links) {
  links.forEach((a, id) => {
    if (a.dataset.bound) return;
    a.dataset.bound = "1";
    const on = () => field.hoverLink(id, true);
    const off = () => field.hoverLink(id, false);
    a.addEventListener("mouseenter", on);
    a.addEventListener("mouseleave", off);
    a.addEventListener("focus", on);
    a.addEventListener("blur", off);

    const experiment = a.dataset.experiment;
    if (experiment) {
      a.addEventListener("click", (event) => {
        event.preventDefault();
        runExperiment(experiment);
      });
    }
  });
}

function runExperiment(name) {
  if (reducedMotion.matches) return;
  if (name === "butterfly") entities.toggleButterfly();
}

// Native smooth scrolling is unreliable across environments, and the settle
// deserves a precise feel anyway: a short ease-out drives scrollTop directly.
const anim = { raf: 0, target: null, lastWrite: -1 };

// Keep the field in lockstep with the scroller. Called from the scroll event
// AND directly by the animator — some environments do not emit scroll events
// for programmatic scrollTop writes.
function syncFromScroll() {
  const before = field.camera();
  field.setScroll(scroller.scrollTop);
  if (field.camera() !== before) {
    entities.onCameraMove();
    updateHud();
  }
}

function animateScrollTo(target, duration = 180) {
  target = Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight));
  window.cancelAnimationFrame(anim.raf);
  anim.target = target;
  if (reducedMotion.matches || duration === 0) {
    anim.lastWrite = target;
    scroller.scrollTop = target;
    anim.target = null;
    syncFromScroll();
    return;
  }
  const start = scroller.scrollTop;
  const dist = target - start;
  if (Math.abs(dist) < 0.5) {
    anim.target = null;
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    anim.lastWrite = start + dist * eased;
    scroller.scrollTop = anim.lastWrite;
    syncFromScroll();
    if (p < 1) anim.raf = window.requestAnimationFrame(step);
    else anim.target = null;
  };
  anim.raf = window.requestAnimationFrame(step);
}

function onScroll() {
  // a user gesture mid-animation wins immediately
  if (anim.target !== null && Math.abs(scroller.scrollTop - anim.lastWrite) > 2) {
    window.cancelAnimationFrame(anim.raf);
    anim.target = null;
  }
  syncFromScroll();
  window.clearTimeout(scrollEndTimer);
  scrollEndTimer = window.setTimeout(onScrollSettled, 160);
}

function onScrollSettled() {
  // settle the pour onto a whole row
  if (anim.target === null) {
    const target = Math.round(scroller.scrollTop / metrics.cellH) * metrics.cellH;
    if (Math.abs(scroller.scrollTop - target) > 1) animateScrollTo(target, 150);
  }
  const section = currentSection();
  const hash = section.id ? `#${section.id}` : " ";
  if (window.location.hash !== hash) {
    history.replaceState(null, "", section.id ? `#${section.id}` : window.location.pathname);
  }
  try {
    sessionStorage.setItem("glyph-camera", String(field.camera()));
  } catch { /* private mode */ }
}

function onResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const oldSections = layoutResult ? layoutResult.sections : [];
    const camera = field.camera();
    let anchor = null;
    for (const section of oldSections) {
      if (section.row <= camera) anchor = { id: section.id, offset: camera - section.row };
    }
    layout();
    if (anchor) {
      const section = layoutResult.sections.find((s) => s.id === anchor.id);
      if (section) {
        scroller.scrollTop = (section.row + anchor.offset) * metrics.cellH;
      }
    }
    field.setScroll(scroller.scrollTop);
  }, 140);
}

function onKey(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const page = (field.rows() - 3) * metrics.cellH;
  let delta = null;
  if (event.key === "ArrowDown") delta = metrics.cellH;
  else if (event.key === "ArrowUp") delta = -metrics.cellH;
  else if (event.key === "PageDown" || (event.key === " " && !event.shiftKey)) delta = page;
  else if (event.key === "PageUp" || (event.key === " " && event.shiftKey)) delta = -page;
  else if (event.key === "Home") { animateScrollTo(0, 420); event.preventDefault(); return; }
  else if (event.key === "End") { animateScrollTo(scroller.scrollHeight, 420); event.preventDefault(); return; }
  if (delta !== null) {
    const base = anim.target !== null ? anim.target : scroller.scrollTop;
    animateScrollTo(base + delta, 200);
    event.preventDefault();
  }
}

function onPointerMove(event) {
  if (event.pointerType === "touch") return;
  const now = performance.now();
  const dt = now - lastPointer.t;
  const speed = dt > 0 ? Math.hypot(event.clientX - lastPointer.x, event.clientY - lastPointer.y) / dt : 0;
  lastPointer = { x: event.clientX, y: event.clientY, t: now };
  field.pulse(event.clientX, event.clientY);
  field.shimmerWordAt(event.clientX, event.clientY);
  const col = Math.floor((event.clientX - field.xOffset()) / metrics.cellW);
  const row = Math.floor(event.clientY / metrics.cellH);
  entities.pointer(col, row, speed > 1.4);
}

function onClick(event) {
  if (event.target.closest("a")) return;
  field.rippleAt(event.clientX, event.clientY);
}

async function boot() {
  if (config.font.family !== "IBM Plex Mono") {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${config.font.css}&display=swap`;
    document.head.appendChild(link);
  }
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`16px "${config.font.family}"`),
        document.fonts.ready,
      ]),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch { /* fall back to whatever monospace we have */ }

  const rootStyle = document.documentElement.style;
  if (config.paper) rootStyle.setProperty("--paper", config.paper);
  if (config.ink) rootStyle.setProperty("--ink", config.ink);
  if (config.accent) rootStyle.setProperty("--accent", config.accent);
  if (config.paper || config.ink) {
    field.setTheme({ paper: config.paper ?? undefined, ink: config.ink ?? undefined });
  }
  if (config.stagger) field.setOptions({ stagger: true });

  blocks = parseArticle(article);
  field.setReducedMotion(reducedMotion.matches);
  layout();

  // restore position: hash first, then session
  let startRow = 0;
  const hash = window.location.hash.slice(1);
  if (hash) {
    const section = layoutResult.sections.find((s) => s.id === hash);
    if (section) startRow = section.row;
  } else {
    try {
      startRow = parseInt(sessionStorage.getItem("glyph-camera") ?? "0", 10) || 0;
    } catch { /* private mode */ }
  }
  if (startRow > 0) {
    scroller.scrollTop = startRow * metrics.cellH;
    field.setScroll(scroller.scrollTop);
    updateHud();
  } else {
    field.crystallize();
  }

  field.start();
  booted = true;

  // the butterfly arrives on its own, a little after the reader does
  if (!reducedMotion.matches) {
    window.setTimeout(() => {
      if (!entities.hasButterfly()) entities.toggleButterfly();
    }, 7000);
  }

  scroller.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKey);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  scroller.addEventListener("click", onClick);

  // Discrete mouse wheels jump a hundred pixels per notch, which teleports
  // the pour. Route coarse deltas through the animator; trackpads (fine,
  // frequent deltas) keep their native feel. Pinch-zoom stays untouched.
  scroller.addEventListener("wheel", (event) => {
    if (event.ctrlKey) return;
    const coarse = event.deltaMode === 1 || Math.abs(event.deltaY) >= 80;
    if (!coarse) return;
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * metrics.cellH : event.deltaY;
    const base = anim.target !== null ? anim.target : scroller.scrollTop;
    animateScrollTo(base + delta, 220);
  }, { passive: false });

  document.documentElement.addEventListener("mouseleave", () => field.clearLantern());
  window.addEventListener("blur", () => field.clearLantern());

  reducedMotion.addEventListener("change", () => {
    field.setReducedMotion(reducedMotion.matches);
  });
}

boot();
