// Boot and wiring. The browser keeps its native powers — scrolling, links,
// selection, find-in-page — while the field renders every visible mark.

import { createField } from "./field.js";
import { createInbox } from "./inbox.js";
import { parseArticle, typeset } from "./typesetter.js";
import { fromQuery, toQuery, defaults, needsRelayout, FONTS, SCHEMA } from "./params.js";
import { POSTHOG, startAnalytics, track, identify } from "./analytics.js";

const canvas = document.getElementById("field");
const scroller = document.getElementById("scroller");
const article = document.getElementById("article");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let P = fromQuery();
const field = createField(canvas, P);

// Messages go to PostHog as events. Without analytics the mail client opens
// with the text filled in; the box keeps the text then, since a mail handler
// may be missing.
function sendMessage(text) {
  const contact = text.match(/[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[a-z]{2,}/i)?.[0];
  identify(contact);
  if (track("message_sent", { message: text, contact })) return "sent";
  window.open(
    `mailto:sardor@nodirov.com?subject=${encodeURIComponent("From nodirov.com")}&body=${encodeURIComponent(text)}`,
    "_self",
  );
  return "mail";
}

const inboxForm = article.querySelector("form[data-inbox]");
const inbox = inboxForm
  ? createInbox(inboxForm, { invalidate: () => field.requestDraw(), onSend: sendMessage })
  : null;
field.setInbox(inbox);

let blocks = null;
let layoutResult = null;
let metrics = null;
let resizeTimer = 0;
let scrollEndTimer = 0;
let lastPointer = { x: 0, y: 0, t: 0 };

function computeMetrics() {
  const face = FONTS[P.font];
  const grid = face.grid;
  let fontSize = window.innerWidth < 720 ? Math.max(12, Math.round(P.size * 0.72)) : P.size;

  // A pixel face has no fractional sizes: off-step, its advance lands between
  // device pixels and every stem smears. Snap to the design step instead of
  // letting the workbench hand it an unrenderable size.
  if (grid) fontSize = Math.max(grid.minSize, Math.round(fontSize / grid.sizeStep) * grid.sizeStep);

  const probe = document.createElement("canvas").getContext("2d");
  const font = `${fontSize}px "${face.family}", Menlo, monospace`;
  probe.font = font;
  if (probe.textRendering !== undefined) probe.textRendering = "geometricPrecision";
  const adv = probe.measureText("M").width;

  const tracking = grid ? grid.tracking : P.tracking;
  const leading = grid ? grid.leading : P.leading;
  const cellW = Math.round(adv + fontSize * tracking);
  return {
    fontSize,
    adv,
    font,
    pixelFace: !!grid,
    cellW,
    cellH: Math.round(fontSize * leading),
    // a glyph sits centred in its cell: this much on the left, and this much
    // added after every character
    pad: (cellW - adv) / 2,
    spacing: cellW - adv,
  };
}

function layout() {
  metrics = computeMetrics();
  field.setMetrics(metrics);
  field.resize(window.innerWidth, window.innerHeight);
  field.collectPlanes(article);
  inbox?.setMetrics(metrics, field.xOffset());
  layoutResult = typeset(blocks, article, {
    cols: field.cols(),
    viewRows: field.rows(),
    cellW: metrics.cellW,
    cellH: metrics.cellH,
    fontSize: metrics.fontSize,
    xOffset: field.xOffset(),
    pad: metrics.pad,
    spacing: metrics.spacing,
    measure: P.measure,
    placePlane: (el, r, c, cc, rr) => field.placePlane(el, r, c, cc, rr),
    placeInbox: (el, r, c, cc, rr) => inbox?.place(r, c, cc, rr),
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
  for (const a of links) {
    if (a.dataset.bound) continue;
    a.dataset.bound = "1";
    const on = () => field.hoverLink(layoutResult.links.indexOf(a), true);
    const off = () => field.hoverLink(layoutResult.links.indexOf(a), false);
    a.addEventListener("mouseenter", on);
    a.addEventListener("mouseleave", off);
    a.addEventListener("focus", on);
    a.addEventListener("blur", off);
  }
}

const anim = { raf: 0, target: null, lastWrite: -1 };

function syncFromScroll() {
  const before = field.camera();
  field.setScroll(scroller.scrollTop);
  if (field.camera() !== before) updateHud();
}

function animateScrollTo(target, duration) {
  target = Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight));
  window.cancelAnimationFrame(anim.raf);
  anim.target = target;
  if (reducedMotion.matches || !duration) {
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
    anim.lastWrite = start + dist * (1 - Math.pow(1 - p, 3));
    scroller.scrollTop = anim.lastWrite;
    syncFromScroll();
    if (p < 1) anim.raf = window.requestAnimationFrame(step);
    else anim.target = null;
  };
  anim.raf = window.requestAnimationFrame(step);
}

function onScroll() {
  if (anim.target !== null && Math.abs(scroller.scrollTop - anim.lastWrite) > 2) {
    window.cancelAnimationFrame(anim.raf);
    anim.target = null;
  }
  syncFromScroll();
  window.clearTimeout(scrollEndTimer);
  scrollEndTimer = window.setTimeout(onScrollSettled, 160);
}

function onScrollSettled() {
  if (anim.target === null) {
    const target = Math.round(scroller.scrollTop / metrics.cellH) * metrics.cellH;
    if (Math.abs(scroller.scrollTop - target) > 1) animateScrollTo(target, P.settleMs);
  }
  const section = currentSection();
  const hash = section.id ? `#${section.id}` : "";
  if (hash && window.location.hash !== hash) {
    history.replaceState(null, "", hash);
    track("section_reached", { section: section.id });
  }
  try {
    sessionStorage.setItem("glyph-camera", String(field.camera()));
  } catch { /* private mode */ }
}

function onResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const camera = field.camera();
    let anchor = null;
    for (const section of layoutResult ? layoutResult.sections : []) {
      if (section.row <= camera) anchor = { id: section.id, offset: camera - section.row };
    }
    layout();
    if (anchor) {
      const section = layoutResult.sections.find((s) => s.id === anchor.id);
      if (section) scroller.scrollTop = (section.row + anchor.offset) * metrics.cellH;
    }
    field.setScroll(scroller.scrollTop);
  }, 140);
}

function onKey(event) {
  if (event.target.closest("textarea, input, button, a")) return;
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
  const now = performance.now();
  const dt = Math.min(120, now - lastPointer.t);
  const px = lastPointer.t === 0 ? event.clientX : lastPointer.x;
  const py = lastPointer.t === 0 ? event.clientY : lastPointer.y;
  lastPointer = { x: event.clientX, y: event.clientY, t: now };
  field.touch(event.clientX, event.clientY, px, py, dt);
  if (event.pointerType !== "touch") {
    field.shimmerWordAt(event.clientX, event.clientY);
    field.pointerAt(event.clientX, event.clientY);
  }
}

function onClick(event) {
  if (event.target.closest("a, button, textarea")) return;
  field.strike(event.clientX, event.clientY);
}

async function loadFont() {
  const font = FONTS[P.font];
  if (!font.local && font.family !== "IBM Plex Mono" && !document.querySelector(`link[data-font="${P.font}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.font = P.font;
    link.href = `https://fonts.googleapis.com/css2?family=${font.css}&display=swap`;
    document.head.appendChild(link);
  }
  try {
    await Promise.race([
      Promise.all([document.fonts.load(`16px "${font.family}"`), document.fonts.ready]),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch { /* fall back to whatever monospace we have */ }
}

function applyCssVars() {
  document.documentElement.classList.toggle("embed-cursor", !!P.cursorEmbed);
  const style = document.documentElement.style;
  style.setProperty("--paper", P.paper);
  style.setProperty("--ink", P.ink);
  style.setProperty("--accent", P.accent);
}

async function boot() {
  await loadFont();
  applyCssVars();

  blocks = parseArticle(article);
  field.setReducedMotion(reducedMotion.matches);
  layout();

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

  if (!reducedMotion.matches) field.start();

  scroller.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKey);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.documentElement.addEventListener("mouseleave", () => field.pointerLeft());
  window.addEventListener("blur", () => field.pointerLeft());
  scroller.addEventListener("click", onClick);

  // Discrete wheels jump ~100px per notch, which teleports the pour. Route
  // coarse deltas through the animator; trackpads keep their native feel.
  scroller.addEventListener("wheel", (event) => {
    if (event.ctrlKey || !P.wheelMs) return;
    const coarse = event.deltaMode === 1 || Math.abs(event.deltaY) >= 80;
    if (!coarse) return;
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * metrics.cellH : event.deltaY;
    const base = anim.target !== null ? anim.target : scroller.scrollTop;
    animateScrollTo(base + delta, P.wheelMs);
  }, { passive: false });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !reducedMotion.matches) field.start();
    else field.stop();
  });

  reducedMotion.addEventListener("change", () => field.setReducedMotion(reducedMotion.matches));

  function navigateHash() {
    const section = layoutResult.sections.find((s) => s.id === decodeURIComponent(location.hash.slice(1)));
    if (section) animateScrollTo(section.row * metrics.cellH, 420);
  }
  window.addEventListener("hashchange", navigateHash);
  scroller.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    if (location.hash === link.hash) navigateHash();
    else location.hash = link.hash;
  });

  // The workbench (lab.html) drives this page live, same-origin.
  window.__glyph = {
    schema: SCHEMA,
    defaults,
    get: () => ({ ...P }),
    query: () => toQuery(P),
    renderAt: (now, dt) => field.renderAt(now, dt),
    probe: (row, col) => field.probe(row, col),
    planeCount: () => field.planeCount(),
    inbox: () => inbox?.state() ?? null,
    stats: () => field.stats(),
    glyphCount: () => field.glyphCount(),
    touch: (x, y, px, py, dt) => field.touch(x, y, px, py, dt),
    strike: (x, y) => field.strike(x, y),
    reveal: () => field.crystallize(),
    set(patch) {
      const changed = Object.keys(patch);
      P = { ...P, ...patch };
      applyCssVars();
      if (needsRelayout(patch)) {
        if (patch.font) {
          loadFont().then(() => {
            const top = scroller.scrollTop;
            layout();
            scroller.scrollTop = top;
            field.applyParams(P, changed);
          });
          return;
        }
        const top = scroller.scrollTop;
        layout();
        scroller.scrollTop = top;
      }
      field.applyParams(P, changed);
    },
  };
  window.dispatchEvent(new CustomEvent("glyph-ready"));

  startAnalytics(POSTHOG, {
    font: P.font,
    grid: `${field.cols()}x${field.rows()}`,
    reduced_motion: reducedMotion.matches,
  });
}

boot();
