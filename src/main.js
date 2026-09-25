// Boot and wiring. The browser keeps its native powers (scrolling, links,
// selection, find-in-page) while the field renders every visible mark.

import { createField } from "./field.js";
import { createInbox } from "./inbox.js";
import { createTicker } from "./tick.js";
import { parseArticle, typeset } from "./typesetter.js";
import { fromQuery, toQuery, defaults, needsRelayout, FONT, SCHEMA } from "./params.js";
import { POSTHOG, startAnalytics, track, identify } from "./analytics.js";

const scroller = document.getElementById("scroller");
const article = document.getElementById("article");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let P = fromQuery();
const field = createField(document.getElementById("field"), P);

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

const ticker = createTicker();

const inboxForm = article.querySelector("form[data-inbox]");
const inbox = inboxForm
  ? createInbox(inboxForm, { invalidate: () => field.requestDraw(), onSend: sendMessage, onType: () => ticker.key() })
  : null;
field.setInbox(inbox);

let blocks = null;
let layoutResult = null;
let metrics = null;
let resizeTimer = 0;
let scrollEndTimer = 0;
let lastPointer = { x: 0, y: 0, t: 0 };

function computeMetrics() {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  // phones get a smaller face; very wide screens a slightly larger one, so
  // the column keeps its proportion to the field
  const w = window.innerWidth;
  const fontSize = w < 720
    ? Math.max(12, Math.round(P.size * 0.8))
    : Math.round(P.size * Math.min(1.2, Math.max(1, w / 1680)));
  const font = `${fontSize}px "${FONT.family}", ui-monospace, Menlo, monospace`;
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = font;
  const adv = probe.measureText("M").width;
  // Cells are whole device pixels, so every cell starts on a pixel edge and
  // the atlas copies glyphs one to one.
  const cellWd = Math.round((adv + fontSize * P.tracking) * dpr);
  const cellHd = Math.round(fontSize * P.leading * dpr);
  const cellW = cellWd / dpr;
  const cellH = cellHd / dpr;
  return {
    family: FONT.family,
    font,
    fontSize,
    adv,
    dpr,
    cellWd,
    cellHd,
    cellW,
    cellH,
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
    placeInbox: (el, r, c, cc, rr) => inbox?.place(r, c, cc, rr),
  });
  field.setWorld(layoutResult.lines, layoutResult.worldRows, { left: layoutResult.left, width: layoutResult.contentW });
  bindLinks(layoutResult.links);
  article.classList.add("ready");
  placeSound();
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

const soundButton = document.getElementById("sound");

// The right of the status row names the section the board is showing.
function updateHud() {
  if (soundButton.hidden) return;
  field.setStatus({ right: currentSection().label, rightInk: P.faintAlpha });
}

// The sound switch lives on the status row, fixed to the screen. The button
// is real and transparent; the field draws its label.
function placeSound() {
  const text = ticker.enabled() ? "sound on" : "sound off";
  // the status row lives in the margins; a screen too narrow for that keeps
  // the document clear and goes without it
  const col = 2;
  const room = layoutResult.left - col - 2 >= "sound off".length;
  soundButton.hidden = !room;
  if (!room) {
    field.setStatus({ left: "", right: "" });
    return;
  }
  const row = field.rows() - 2;
  soundButton.textContent = text;
  Object.assign(soundButton.style, {
    left: field.xOffset() + col * metrics.cellW + "px",
    top: row * metrics.cellH + "px",
    width: text.length * metrics.cellW + "px",
    height: metrics.cellH + "px",
    fontSize: metrics.fontSize + "px",
    lineHeight: metrics.cellH + "px",
    letterSpacing: metrics.spacing + "px",
    paddingLeft: metrics.pad + "px",
  });
  field.setStatus({ left: text, leftCol: col, leftInk: soundHover ? P.textAlpha : P.faintAlpha });
}
let soundHover = false;

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
  field.setScroll(scroller.scrollTop);
}

// A jump (a key, a wheel notch, a section link) moves the real document at
// once; the board flips to it.
function jumpTo(px) {
  const max = scroller.scrollHeight - scroller.clientHeight;
  const target = Math.max(0, Math.min(max, Math.round(px / metrics.cellH) * metrics.cellH));
  window.cancelAnimationFrame(anim.raf);
  anim.target = null;
  scroller.scrollTop = target;
  syncFromScroll();
}

// The settle after a trackpad scroll: the page eases onto the nearest whole
// row, and the finger's half-turned flaps finish their turn.
function settleTo(target, duration) {
  window.cancelAnimationFrame(anim.raf);
  anim.target = target;
  const start = scroller.scrollTop;
  const dist = target - start;
  if (reducedMotion.matches || !duration || Math.abs(dist) < 0.5) {
    anim.lastWrite = target;
    scroller.scrollTop = target;
    anim.target = null;
    syncFromScroll();
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
  scrollEndTimer = window.setTimeout(onScrollSettled, 140);
}

function onScrollSettled() {
  if (anim.target === null) {
    const target = Math.round(scroller.scrollTop / metrics.cellH) * metrics.cellH;
    if (Math.abs(scroller.scrollTop - target) > 0.5) settleTo(target, P.settleMs);
  }
  const section = currentSection();
  const hash = section.id ? `#${section.id}` : "";
  if (window.location.hash !== hash) {
    history.replaceState(null, "", hash || window.location.pathname + window.location.search);
    if (hash) track("section_reached", { section: section.id });
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
    field.setScroll(scroller.scrollTop, true);
  }, 140);
}

function onKey(event) {
  if (event.target.closest("textarea, input, button, a")) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const page = (field.rows() - 4) * metrics.cellH;
  let to = null;
  if (event.key === "ArrowDown") to = scroller.scrollTop + metrics.cellH;
  else if (event.key === "ArrowUp") to = scroller.scrollTop - metrics.cellH;
  else if (event.key === "PageDown" || (event.key === " " && !event.shiftKey)) to = scroller.scrollTop + page;
  else if (event.key === "PageUp" || (event.key === " " && event.shiftKey)) to = scroller.scrollTop - page;
  else if (event.key === "Home") to = 0;
  else if (event.key === "End") to = scroller.scrollHeight;
  if (to !== null) {
    jumpTo(to);
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
  field.pointerAt(event.clientX, event.clientY);
}

// A finger on a phone presses the lattice while it rests there; once it
// starts to scroll, the browser takes the gesture and the lens lets go.
function onPointerDown(event) {
  if (event.pointerType !== "touch") return;
  lastPointer = { x: event.clientX, y: event.clientY, t: performance.now() };
  field.pointerAt(event.clientX, event.clientY);
}

function onPointerUp(event) {
  if (event.pointerType === "touch") field.pointerLeft();
}

function onClick(event) {
  if (event.target.closest("a, button, textarea")) return;
  field.strike(event.clientX, event.clientY);
}

async function loadFont() {
  try {
    await Promise.race([
      Promise.all([document.fonts.load(`16px "${FONT.family}"`), document.fonts.ready]),
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

// The name on the grid, for the opening: its row as the screen shows it.
function heroOnScreen(startRow) {
  const hero = layoutResult.hero;
  if (!hero || startRow > 0) return null;
  return { row: hero.row, col: hero.col, length: hero.length };
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
  if (startRow > 0) scroller.scrollTop = startRow * metrics.cellH;
  field.setScroll(scroller.scrollTop, true);
  field.onTurn((rows) => {
    ticker.tick(rows, performance.now());
    updateHud();
  });
  // the full opening once per visit; a reload in the same visit is brief
  let seen = false;
  try {
    seen = sessionStorage.getItem("glyph-seen") === "1";
    sessionStorage.setItem("glyph-seen", "1");
  } catch { /* private mode */ }
  field.crystallize(heroOnScreen(startRow), seen || startRow > 0);

  field.start();

  scroller.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKey);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  window.addEventListener("pointercancel", onPointerUp, { passive: true });
  document.documentElement.addEventListener("mouseleave", () => field.pointerLeft());
  window.addEventListener("blur", () => field.pointerLeft());
  scroller.addEventListener("click", onClick);
  soundButton.addEventListener("click", () => {
    const on = ticker.toggle();
    soundButton.setAttribute("aria-pressed", String(on));
    track("sound_toggled", { on });
    placeSound();
  });
  const hoverSound = (on) => () => {
    soundHover = on;
    placeSound();
  };
  soundButton.addEventListener("pointerenter", hoverSound(true));
  soundButton.addEventListener("pointerleave", hoverSound(false));
  soundButton.addEventListener("focus", hoverSound(true));
  soundButton.addEventListener("blur", hoverSound(false));

  // A mouse wheel moves in notches; each notch is one flip of the board.
  // Trackpads keep their native feel and turn the flaps continuously.
  scroller.addEventListener("wheel", (event) => {
    if (event.ctrlKey) return;
    const coarse = event.deltaMode === 1 || Math.abs(event.deltaY) >= 80;
    if (!coarse) return;
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * metrics.cellH : event.deltaY;
    jumpTo(scroller.scrollTop + delta);
  }, { passive: false });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") field.start();
    else field.stop();
  });

  reducedMotion.addEventListener("change", () => field.setReducedMotion(reducedMotion.matches));

  function navigateHash() {
    const section = layoutResult.sections.find((s) => s.id === decodeURIComponent(location.hash.slice(1)));
    if (section) jumpTo(section.row * metrics.cellH);
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
    renderAt: (now) => field.renderAt(now),
    probe: (row, col) => field.probe(row, col),
    inbox: () => inbox?.state() ?? null,
    sound: () => ticker.enabled(),
    stats: () => field.stats(),
    view: () => ({ scrollTop: scroller.scrollTop, cellH: metrics.cellH, cols: field.cols(), rows: field.rows() }),
    touch: (x, y, px, py, dt) => field.touch(x, y, px, py, dt),
    strike: (x, y) => field.strike(x, y),
    reveal: () => field.crystallize(heroOnScreen(field.camera()), false),
    set(patch) {
      const changed = Object.keys(patch);
      P = { ...P, ...patch };
      applyCssVars();
      if (needsRelayout(patch)) {
        const top = scroller.scrollTop;
        field.applyParams(P, changed);
        layout();
        scroller.scrollTop = top;
        syncFromScroll();
        return;
      }
      field.applyParams(P, changed);
    },
  };
  window.dispatchEvent(new CustomEvent("glyph-ready"));

  startAnalytics(POSTHOG, {
    grid: `${field.cols()}x${field.rows()}`,
    renderer: field.renderer,
    reduced_motion: reducedMotion.matches,
  });
}

boot();
