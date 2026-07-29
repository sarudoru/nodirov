// Boot and wiring. The browser keeps its native powers — scrolling, links,
// selection, find-in-page — while the field renders every visible mark.

import { createField } from "./field.js";
import { parseArticle, typeset } from "./typesetter.js";
import { createEntities } from "./entities.js";

const canvas = document.getElementById("field");
const scroller = document.getElementById("scroller");
const article = document.getElementById("article");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const field = createField(canvas);
const entities = createEntities(field);

let blocks = null;
let layoutResult = null;
let metrics = null;
let resizeTimer = 0;
let scrollEndTimer = 0;
let lastPointer = { x: 0, y: 0, t: 0 };
let booted = false;

function computeMetrics() {
  const fontSize = window.innerWidth < 720 ? 15 : 21;
  const probe = document.createElement("canvas").getContext("2d");
  const font = `${fontSize}px "IBM Plex Mono", Menlo, monospace`;
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
  if (name === "train") {
    entities.runTrain();
  } else if (name === "butterfly") {
    entities.toggleButterfly();
  } else if (name === "gravity") {
    const sections = layoutResult.sections;
    const index = sections.findIndex((s) => s.id === "experiments");
    if (index === -1) return;
    const from = sections[index].row;
    const to = index + 1 < sections.length ? sections[index + 1].row - 1 : field.worldRows();
    entities.dropRows(from, to);
  }
}

function onScroll() {
  const before = field.camera();
  field.setScroll(scroller.scrollTop);
  if (field.camera() !== before) {
    entities.onCameraMove();
    updateHud();
  }
  window.clearTimeout(scrollEndTimer);
  scrollEndTimer = window.setTimeout(onScrollSettled, 160);
}

function onScrollSettled() {
  // settle the roll onto a whole row; smooth so the last fraction pours home
  const target = Math.round(scroller.scrollTop / metrics.cellH) * metrics.cellH;
  if (Math.abs(scroller.scrollTop - target) > 1 &&
      target <= scroller.scrollHeight - scroller.clientHeight) {
    scroller.scrollTo({ top: target, behavior: reducedMotion.matches ? "instant" : "smooth" });
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
  else if (event.key === "Home") { scroller.scrollTo({ top: 0, behavior: "smooth" }); event.preventDefault(); return; }
  else if (event.key === "End") { scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" }); event.preventDefault(); return; }
  if (delta !== null) {
    scroller.scrollBy({ top: delta, behavior: "smooth" });
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
  const col = Math.floor((event.clientX - field.xOffset()) / metrics.cellW);
  const row = Math.floor(event.clientY / metrics.cellH);
  entities.pointer(col, row, speed > 1.4);
}

function onClick(event) {
  if (event.target.closest("a")) return;
  field.rippleAt(event.clientX, event.clientY);
}

async function boot() {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('16px "IBM Plex Mono"'),
        document.fonts.ready,
      ]),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch { /* fall back to whatever monospace we have */ }

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

  scroller.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKey);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  scroller.addEventListener("click", onClick);
  reducedMotion.addEventListener("change", () => {
    field.setReducedMotion(reducedMotion.matches);
  });
}

boot();
