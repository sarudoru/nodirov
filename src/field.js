// The field: a fixed grid of character cells, the only place anything is
// painted.
//
// Every cell is a small flap mechanism. Each frame it is told which glyph
// it shows, which glyph it is turning to, and how far the turn has gone:
//
//   the document   typeset into world rows. The scroll position says which
//                  world row each grid row shows, and its fraction is the
//                  turn: half a row of scroll is every flap half turned.
//                  Nothing is on a timer; the reader's finger turns the flaps
//                  and turns them back.
//   the substrate  the resting lattice and everything that disturbs it.
//
// Law: nothing moves; cells change.

import { createAtlas } from "./atlas.js";
import { createRenderer } from "./renderer.js";
import { createSubstrate } from "./substrate.js";
import { cousinsFor } from "./glyphs.js";

export const K_TEXT = 1;
export const K_FAINT = 2;
export const K_LINK = 3;

// flags shared with the shader
const F_ACCENT_X = 1;
const F_CARET = 2;
const F_FADE = 4;
const F_ACCENT_Y = 8;

export function createField(canvasElement, params) {
  let P = params;
  const renderer = createRenderer(canvasElement);
  const canvas = renderer.canvas;

  let metrics = null;
  let atlas = null;
  let substrate = null;

  let cols = 0;
  let rows = 0;
  let originX = 0; // device px
  let reducedMotion = false;

  // the document, typeset: one glyph per world cell
  let worldRows = 0;
  let worldGlyph = new Uint16Array(0);
  let worldKind = new Uint8Array(0);
  let worldLink = new Int16Array(0);
  let lines = [];

  // scroll: the camera is a real number of rows
  let camera = 0;

  // frame buffers handed to the renderer
  let glyphs = new Uint16Array(0);
  let inks = new Uint8Array(0);

  // Changes that happen while the page rests (a typed letter, a hovered
  // link's cousins) turn on a clock instead of the scroll: each cell
  // remembers what it last showed and flaps from it.
  let lastShown = new Uint16Array(0);
  let lastInk = new Float32Array(0);
  let flapFrom = new Uint16Array(0);
  let flapFromInk = new Float32Array(0);
  let flapAt = new Float32Array(0);
  let restRow = -1;
  let steadyFrame = false;

  // view overlays
  const status = { left: "", leftCol: 2, leftInk: 0.5, right: "" };
  let cursorCell = -1;
  let cursorGlyph = 0;
  let hoveredLink = -1;
  const shimmer = new Map(); // world index -> glyph
  let shimmerCells = [];
  let shimmerTimer = 0;
  let inbox = null;

  let rafId = 0;
  let running = false;
  let lastFrame = 0;

  const inkOf = (kind) => (kind === K_FAINT ? P.faintAlpha : P.textAlpha);

  // ---------- the world ----------

  let blank = 0;

  function buildWorld() {
    blank = atlas.ensure("\u00a0");
    worldGlyph = new Uint16Array(worldRows * cols);
    worldKind = new Uint8Array(worldRows * cols);
    worldLink = new Int16Array(worldRows * cols).fill(-1);
    for (const line of lines) {
      if (line.row < 0 || line.row >= worldRows) continue;
      for (let k = 0; k < line.text.length; k++) {
        const col = line.col + k;
        if (col < 0 || col >= cols) continue;
        const w = line.row * cols + col;
        if (line.linkId !== undefined && line.linkId >= 0) worldLink[w] = line.linkId;
        const ch = line.text[k];
        // a space inside a line belongs to the text: the cell holds a blank
        worldGlyph[w] = ch === " " ? blank : atlas.ensure(ch);
        worldKind[w] = line.kind;
      }
    }
  }

  // What the document holds at a world cell: glyph, ink, accent. Reused.
  const doc = { glyph: 0, ink: 0, accent: false };
  function docAt(worldRow, col) {
    doc.glyph = 0;
    doc.ink = 0;
    doc.accent = false;
    if (worldRow < 0 || worldRow >= worldRows) return doc;
    const w = worldRow * cols + col;
    if (inbox) {
      const note = inbox.at(worldRow, col);
      if (note) {
        doc.glyph = atlas.ensure(note.ch);
        doc.ink = P.textAlpha;
        doc.accent = note.accent;
        return doc;
      }
    }
    const g = shimmer.get(w) ?? worldGlyph[w];
    if (g) {
      doc.glyph = g;
      doc.ink = inkOf(worldKind[w]);
    }
    return doc;
  }

  // ---------- the frame ----------

  // The detent: a row holds still for part of the scroll before its flaps
  // turn, the way a picker wheel clicks into each position.
  function turnOf(fraction, col) {
    const sweep = P.sweep * (col / Math.max(1, cols - 1));
    const d = P.detent;
    const start = d / 2 + sweep * (1 - d);
    const span = (1 - d) * (1 - P.sweep);
    const t = Math.min(1, Math.max(0, (fraction - start) / Math.max(0.001, span)));
    return t * t * (3 - 2 * t);
  }

  function put(o, x, inkX, y, inkY, phase, flags, under = 0) {
    glyphs[o] = x;
    glyphs[o + 1] = y;
    glyphs[o + 2] = flags;
    inks[o] = Math.round(Math.min(1, inkX) * 255);
    inks[o + 1] = Math.round(Math.min(1, inkY) * 255);
    inks[o + 2] = Math.round(phase * 255);
    inks[o + 3] = Math.round(under * 255);
  }

  function compose(now) {
    const view = reducedMotion ? Math.round(camera) : camera;
    const k = Math.floor(view);
    const fraction = view - k;
    const blink = !reducedMotion && Math.floor(now / 530) % 2 === 0;
    const revealing = substrate.revealing();
    // clock flaps only compare a resting page with itself
    steadyFrame = fraction === 0 && k === restRow && !revealing;
    restRow = fraction === 0 ? k : -1;
    if (!steadyFrame) flapAt.fill(-1e9);

    for (let r = 0; r < rows; r++) {
      const wa = k + r;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const o = i * 4;
        const sub = substrate.sample(i, now, reducedMotion);
        const phase = fraction > 0 ? turnOf(fraction, c) : 0;

        const a = docAt(wa, c);
        const gA = a.glyph;
        const inkA = a.ink;
        const accA = a.accent;
        let gB = 0;
        let inkB = 0;
        let accB = false;
        if (phase > 0) {
          const b = docAt(wa + 1, c);
          gB = b.glyph;
          inkB = b.ink;
          accB = b.accent;
        }

        // the ink the document puts in this cell right now, for the wake
        let shownInk = phase < 0.5 ? inkA : inkB;

        if (gA || gB) {
          if (phase > 0) {
            // the document turns this cell from one row to the next; an empty
            // side is whatever the lattice holds
            put(o,
              gA || sub.glyph, gA ? inkA : sub.ink,
              gB || sub.glyph, gB ? inkB : sub.ink,
              phase, (accA ? F_ACCENT_X : 0) | (accB ? F_ACCENT_Y : 0));
          } else {
            let under = 0;
            let flags = accA ? F_ACCENT_X : 0;
            const w = wa * cols + c;
            const link = worldLink[w];
            if (link >= 0 && worldKind[w] === K_LINK) under = link === hoveredLink ? 0.85 : 0.3;
            const gate = revealing ? substrate.contentGate(i, now) : 1;
            if (gate < 1) {
              // first contact: the cell turns from its lattice mark to the letter
              put(o, sub.glyph, sub.ink, gA, inkA, gate, flags << 3, under * gate);
              shownInk = gate > 0.5 ? inkA : 0;
            } else if (!clockFlap(i, o, now, gA, gA, inkA, flags << 3, sub.glyph)) {
              put(o, gA, inkA, 0, 0, 0, flags, under);
            }
          }
        } else if (!(phase === 0 && clockFlap(i, o, now, 0, sub.glyph, sub.ink, 0, sub.glyph))) {
          put(o, sub.from, sub.fromInk, sub.glyph, sub.ink, sub.t, F_FADE);
        }
        if (phase === 0) {
          lastShown[i] = gA;
          lastInk[i] = gA ? inkA : sub.ink;
        }

        if (inbox && phase === 0 && inbox.caretAt(wa, c) && (blink || !inbox.focused())) glyphs[o + 2] |= F_CARET;

        if (i === cursorCell && P.cursorEmbed) {
          if (gA && gA !== blank && phase === 0) {
            glyphs[o + 2] |= F_ACCENT_X;
          } else if ((!gA || gA === blank) && !gB) {
            put(o, cursorGlyph, 1, 0, 0, 0, 0);
          }
        }

        if (!reducedMotion && shownInk > 0) substrate.trailTo(i, shownInk * P.wake);
      }
    }

    // the status row, anchored to the screen rather than the document: the
    // sound switch on the left, the read head's position on the right
    const r = rows - 2;
    const label = (text, start, ink) => {
      for (let q = 0; q < text.length; q++) {
        const c = start + q;
        if (r < 0 || c < 0 || c >= cols) continue;
        const o = (r * cols + c) * 4;
        if (text[q] === " ") put(o, blank, 1, 0, 0, 0, 0);
        else put(o, atlas.ensure(text[q]), ink, 0, 0, 0, 0);
      }
    };
    if (status.left) label(status.left, status.leftCol, status.leftInk);
    if (status.right) label(status.right, cols - status.right.length - 2, P.faintAlpha);
  }

  // A resting cell whose content changed flaps from what it showed before.
  // `target` is the document glyph, or 0 for the lattice. Returns true when
  // it painted the cell.
  function clockFlap(i, o, now, target, g, ink, flagsY, latticeGlyph) {
    if (steadyFrame && target !== lastShown[i]) {
      flapFrom[i] = lastShown[i] || latticeGlyph;
      flapFromInk[i] = lastInk[i];
      flapAt[i] = now;
    }
    const age = now - flapAt[i];
    if (age < 0 || age >= P.flipMs) return false;
    const t = age / P.flipMs;
    put(o, flapFrom[i], flapFromInk[i], g, ink, t * t * (3 - 2 * t), flagsY);
    return true;
  }

  function frame(now) {
    const dt = lastFrame ? Math.min(100, now - lastFrame) : 16;
    lastFrame = now;
    if (!reducedMotion) substrate.step(now, dt);
    compose(now);
    renderer.atlas(atlas);
    renderer.draw(glyphs, inks);
  }

  function tick(now) {
    rafId = 0;
    frame(now);
    if (running) rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (running || !metrics) return;
    running = true;
    lastFrame = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function requestDraw() {
    if (running || !metrics || rafId) return;
    rafId = requestAnimationFrame((now) => {
      rafId = 0;
      frame(now);
    });
  }

  function applyStyle() {
    renderer.style({ paper: P.paper, ink: P.ink, accent: P.accent, turn: P.turn, shade: P.shade });
  }

  // ---------- shimmer: hovered links walk through their cousins ----------

  function stopShimmer() {
    if (shimmerTimer) clearInterval(shimmerTimer);
    shimmerTimer = 0;
    shimmerCells = [];
    shimmer.clear();
  }

  function startShimmer(cells) {
    stopShimmer();
    if (reducedMotion || !cells.length) return;
    shimmerCells = cells;
    const step = () => {
      for (const w of shimmerCells) {
        const family = cousinsFor(atlas.char(worldGlyph[w]));
        if (!family) continue;
        shimmer.set(w, atlas.ensure(family[(Math.random() * family.length) | 0]));
      }
      requestDraw();
    };
    step();
    shimmerTimer = setInterval(step, P.shimmerTick);
  }

  // ---------- public ----------

  function pointerCell(x, y) {
    const dpr = metrics.dpr;
    const col = Math.floor((x * dpr - originX) / metrics.cellWd);
    const row = Math.floor((y * dpr) / metrics.cellHd);
    return { col, row, inside: col >= 0 && col < cols && row >= 0 && row < rows };
  }

  return {
    canvas,
    renderer: renderer.kind,

    setMetrics(m) {
      metrics = m;
      atlas = createAtlas({ family: m.family, size: m.fontSize, dpr: m.dpr, cellWd: m.cellWd, cellHd: m.cellHd });
      cursorGlyph = atlas.ensure(P.cursorGlyph);
      substrate = createSubstrate(atlas, P);
    },

    resize(w, h) {
      const dpr = metrics.dpr;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      cols = Math.max(10, Math.floor(canvas.width / metrics.cellWd));
      rows = Math.max(6, Math.ceil(canvas.height / metrics.cellHd));
      originX = Math.floor((canvas.width - cols * metrics.cellWd) / 2);
      glyphs = new Uint16Array(cols * rows * 4);
      inks = new Uint8Array(cols * rows * 4);
      lastShown = new Uint16Array(cols * rows);
      lastInk = new Float32Array(cols * rows);
      flapFrom = new Uint16Array(cols * rows);
      flapFromInk = new Float32Array(cols * rows);
      flapAt = new Float32Array(cols * rows).fill(-1e9);
      restRow = -1;
      substrate.resize(cols, rows, metrics.cellHd / metrics.cellWd);
      renderer.configure({
        cols, rows, cellWd: metrics.cellWd, cellHd: metrics.cellHd, originX,
        perRow: atlas.perRow, dpr, underY: Math.min(metrics.cellHd - dpr, atlas.baseline + Math.round(3 * dpr)),
      });
      applyStyle();
      cursorCell = -1;
    },

    setWorld(nextLines, totalRows) {
      lines = nextLines;
      worldRows = totalRows;
      stopShimmer();
      buildWorld();
      requestDraw();
    },

    setScroll(px) {
      camera = Math.max(0, px / metrics.cellH);
      requestDraw();
    },

    pointerAt(x, y) {
      const { col, row, inside } = pointerCell(x, y);
      cursorCell = inside ? row * cols + col : -1;
      if (inside && !reducedMotion) substrate.setPointer(col + 0.5, row + 0.5);
      else substrate.setPointer(null);
      requestDraw();
    },
    pointerLeft() {
      cursorCell = -1;
      substrate.setPointer(null);
      requestDraw();
    },

    touch(x, y, px, py, dt) {
      if (reducedMotion) return;
      const dpr = metrics.dpr;
      const col = (x * dpr - originX) / metrics.cellWd;
      const row = (y * dpr) / metrics.cellHd;
      const pcol = (px * dpr - originX) / metrics.cellWd;
      const prow = (py * dpr) / metrics.cellHd;
      const dx = col - pcol;
      const dy = row - prow;
      const dist = Math.hypot(dx, dy * (metrics.cellHd / metrics.cellWd));
      const speed = dt > 0 ? dist / (dt / 16.67) : 0;
      const steps = Math.min(16, Math.max(1, Math.ceil(dist / 0.8)));
      const vx = dist > 1e-3 ? dx / dist : 0;
      const vy = dist > 1e-3 ? dy / dist : 0;
      const strength = Math.min(1.2, 0.15 + speed * 0.22);
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        substrate.warm(pcol + dx * t, prow + dy * t, vx * P.flowGain, vy * P.flowGain, strength / Math.sqrt(steps));
      }
      requestDraw();
    },

    strike(x, y) {
      if (reducedMotion) return;
      const { col, row } = pointerCell(x, y);
      substrate.impulse(col, row, P.clickStrength);
      requestDraw();
    },

    hoverLink(linkId, on) {
      hoveredLink = on ? linkId : -1;
      if (!on) {
        stopShimmer();
        requestDraw();
        return;
      }
      const cells = [];
      for (let w = 0; w < worldLink.length; w++) {
        if (worldLink[w] === linkId && worldGlyph[w] && worldKind[w] === K_LINK) cells.push(w);
      }
      startShimmer(cells);
    },

    setStatus(next) {
      Object.assign(status, next);
      requestDraw();
    },

    // First contact: the lattice switches on from the origin outward, and the
    // document's cells turn to their letters in the ring's wake.
    crystallize(originCol, originRow) {
      if (reducedMotion) return;
      substrate.startReveal(performance.now(), originCol ?? cols / 2, originRow ?? rows / 3);
      requestDraw();
    },

    setReducedMotion(v) {
      reducedMotion = v;
      if (v) stopShimmer();
      requestDraw();
    },

    applyParams(next, changed = []) {
      P = next;
      substrate.setParams(P, changed);
      if (changed.includes("cursorGlyph")) cursorGlyph = atlas.ensure(P.cursorGlyph);
      applyStyle();
      requestDraw();
    },

    setInbox(value) {
      inbox = value;
    },

    // Deterministic frames for tests and the workbench.
    renderAt(now) {
      frame(now);
    },

    // What one cell holds right now, for tests.
    probe(row, col) {
      const o = (row * cols + col) * 4;
      return {
        x: atlas.char(glyphs[o]),
        y: atlas.char(glyphs[o + 1]),
        inkX: inks[o] / 255,
        inkY: inks[o + 1] / 255,
        phase: inks[o + 2] / 255,
      };
    },

    stats: () => ({ ...substrate.stats(), glyphs: atlas.size(), renderer: renderer.kind }),
    requestDraw,
    start,
    stop,
    cols: () => cols,
    rows: () => rows,
    camera: () => Math.round(camera),
    worldRows: () => worldRows,
    // left edge of the grid in CSS px
    xOffset: () => originX / metrics.dpr,
  };
}
