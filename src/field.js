// The field: a fixed grid of character cells, the only place anything is
// painted.
//
// Every cell is a small flap mechanism. Each frame it is told which face it
// shows (X), which face it is turning to (Y), and how far the turn has gone.
// A face is a glyph, its ink, its colour, and its underline.
//
//   the document   typeset into world rows. The scroll position says which
//                  world row each grid row shows.
//                  Slowly, the finger turns the flaps: half a row of scroll
//                  is every flap half turned, and scrolling back turns them
//                  back. Faster than a flap can be seen, the board stops
//                  following continuously and flips instead: every tenth of
//                  a second it turns over to wherever the page now is, in a
//                  cascade across the words and down the rows. A jump (a
//                  wheel notch, a key, a link) is one such flip.
//   the substrate  the resting lattice and everything that disturbs it.
//
// Changes while the page rests (a typed letter, a hovered link) flip on a
// clock, one cell at a time.
//
// Law: nothing moves; cells change.

import { createAtlas } from "./atlas.js";
import { createRenderer } from "./renderer.js";
import { createSubstrate } from "./substrate.js";

export const K_TEXT = 1;
export const K_FAINT = 2;
export const K_LINK = 3;

// flags shared with the shader
const F_ACCENT_X = 1;
const F_CARET = 2;
const F_FADE = 4;
const F_ACCENT_Y = 8;

const ACCENT_KEY = 0x8000;

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
  let blank = 0;
  let linkStart = new Map(); // link id -> its first column, for the stagger
  let textLeft = 0; // the text column, so cascades run across the words
  let textWidth = 1;

  // scroll
  let target = 0;   // where the real document is, in rows
  let shown = 0;    // where the board shows it while the finger drives
  let steps = [];   // board flips in flight: { from, to, t0, down }
  let speed = 0;    // rows per second, smoothed
  let lastTarget = 0;
  let lastTargetAt = 0;
  let jumped = false;
  let lastTurnRow = 0;
  let onTurn = () => {};

  // frame buffers handed to the renderer
  let glyphs = new Uint16Array(0);
  let inks = new Uint8Array(0);

  // clock flaps: what each resting cell last showed, and its flap in flight
  let lastShown = new Uint16Array(0);
  let lastInk = new Float32Array(0);
  let flapFrom = new Uint16Array(0);
  let flapFromInk = new Float32Array(0);
  let flapAt = new Float32Array(0);
  let restRow = -1;
  let steadyFrame = false;

  // view overlays
  const status = { left: "", leftCol: 2, leftInk: 0.5, right: "", rightInk: 0.5 };
  // the right label turns over letter by letter when it changes
  let rightWas = "";
  let rightAt = -1e9;
  let cursorCell = -1;
  let cursorGlyph = 0;
  let hoveredLink = -1;
  let inbox = null;

  let rafId = 0;
  let running = false;
  let lastFrame = 0;
  // Until this time the page is being touched and draws every frame. After
  // it, the only change left is the slow weather, and ten frames a second
  // show it as well as sixty.
  let activeUntil = 0;
  let flapsUntil = 0;

  const inkOf = (kind) => (kind === K_FAINT ? P.faintAlpha : P.textAlpha);
  const smooth = (t) => t * t * (3 - 2 * t);

  // ---------- the world ----------

  function buildWorld() {
    blank = atlas.ensure(" ");
    linkStart = new Map();
    worldGlyph = new Uint16Array(worldRows * cols);
    worldKind = new Uint8Array(worldRows * cols);
    worldLink = new Int16Array(worldRows * cols).fill(-1);
    for (const line of lines) {
      if (line.row < 0 || line.row >= worldRows) continue;
      for (let k = 0; k < line.text.length; k++) {
        const col = line.col + k;
        if (col < 0 || col >= cols) continue;
        const w = line.row * cols + col;
        if (line.linkId !== undefined && line.linkId >= 0) {
          worldLink[w] = line.linkId;
          linkStart.set(line.linkId, Math.min(linkStart.get(line.linkId) ?? col, col));
        }
        const ch = line.text[k];
        // a space inside a line belongs to the text: the cell holds a blank
        worldGlyph[w] = ch === " " ? blank : atlas.ensure(ch);
        worldKind[w] = line.kind;
      }
    }
  }

  // What the document holds at a world cell. Two reused faces, because a
  // turning cell reads two rows at once.
  const faceA = { glyph: 0, ink: 0, accent: false, under: 0 };
  const faceB = { glyph: 0, ink: 0, accent: false, under: 0 };
  function docAt(worldRow, col, face) {
    face.glyph = 0;
    face.ink = 0;
    face.accent = false;
    face.under = 0;
    if (worldRow < 0 || worldRow >= worldRows) return face;
    if (inbox) {
      const note = inbox.at(worldRow, col);
      if (note) {
        face.glyph = note.ch === " " ? blank : atlas.ensure(note.ch);
        face.ink = P.textAlpha;
        face.accent = note.accent;
        return face;
      }
    }
    const w = worldRow * cols + col;
    const g = worldGlyph[w];
    if (!g) return face;
    face.glyph = g;
    face.ink = inkOf(worldKind[w]);
    const link = worldLink[w];
    if (link >= 0 && worldKind[w] === K_LINK) {
      // a hovered link turns its letters over to the accent
      face.accent = link === hoveredLink;
      face.under = face.accent ? 0.85 : 0.3;
    }
    return face;
  }

  // ---------- scroll: the finger, and the flip ----------

  const colFrac = (c) => Math.min(1, Math.max(0, (c - textLeft) / textWidth));

  // The detent: a row holds still for part of the scroll before its flaps
  // turn, the way a picker wheel clicks into each position. Cells to the
  // left of the words turn a little before cells to the right.
  function turnOf(fraction, c) {
    const d = P.detent;
    const start = d / 2 + P.sweep * colFrac(c) * (1 - d);
    const span = (1 - d) * (1 - P.sweep);
    const t = Math.min(1, Math.max(0, (fraction - start) / Math.max(0.001, span)));
    return smooth(t);
  }

  // A flip reaches each cell a little later across the words and down (or
  // up) the rows, so the board turns over as a cascade.
  function cascadeOf(r, c, down) {
    const rowFrac = rows > 1 ? r / (rows - 1) : 0;
    return colFrac(c) * P.cascadeX + (down ? rowFrac : 1 - rowFrac) * P.cascadeY;
  }

  function advance(now, dt) {
    // scroll speed decays when no scroll events arrive
    if (now - lastTargetAt > 60) speed *= Math.exp(-dt / 80);

    if (reducedMotion) {
      steps = [];
      shown = Math.round(target);
      return;
    }

    if (!steps.length) {
      const fast = speed > P.fingerSpeed || jumped || Math.abs(target - shown) > 1;
      jumped = false;
      if (!fast) {
        shown = target;
        const row = Math.round(shown);
        if (row !== lastTurnRow) {
          onTurn(row - lastTurnRow, row);
          lastTurnRow = row;
        }
        return;
      }
      const from = Math.round(shown);
      const to = Math.round(target);
      if (from === to) {
        shown = target;
        return;
      }
      pushStep(from, to, now);
      return;
    }

    const last = steps[steps.length - 1];
    const settleAll = P.flipMs + P.cascadeX + P.cascadeY;
    if (now >= last.t0 + P.flipMs) {
      const next = Math.round(target);
      if (next !== last.to && !(speed < P.fingerSpeed && Math.abs(target - last.to) < 0.5)) {
        pushStep(last.to, next, now);
      } else if (now >= last.t0 + settleAll) {
        // every cell has landed: the finger drives again
        steps = [];
        shown = last.to;
        jumped = false;
      }
    }
    // a step every cell has moved past can be forgotten
    while (steps.length > 1 && now >= steps[1].t0 + P.cascadeX + P.cascadeY) steps.shift();
  }

  function pushStep(from, to, now) {
    steps.push({ from, to, t0: now, down: to > from });
    flapsUntil = Math.max(flapsUntil, now + P.flipMs + P.cascadeX + P.cascadeY);
    onTurn(to - from, to);
    lastTurnRow = to;
  }

  // ---------- the frame ----------

  function put(o, x, inkX, y, inkY, phase, flags, underX = 0, underY = 0) {
    glyphs[o] = x;
    glyphs[o + 1] = y;
    glyphs[o + 2] = flags;
    inks[o] = Math.round(Math.min(1, inkX) * 255);
    inks[o + 1] = Math.round(Math.min(1, inkY) * 255);
    inks[o + 2] = Math.round(phase * 255);
    inks[o + 3] = (Math.round(underX * 15) << 4) | Math.round(underY * 15);
  }

  // Paint a cell turning from face X to face Y; an empty face is whatever
  // the lattice holds.
  function turn(o, x, y, phase, sub) {
    put(o,
      x.glyph || sub.glyph, x.glyph ? x.ink : sub.ink,
      y.glyph || sub.glyph, y.glyph ? y.ink : sub.ink,
      phase,
      (x.accent ? F_ACCENT_X : 0) | (y.accent ? F_ACCENT_Y : 0),
      x.under, y.under);
  }

  function compose(now) {
    const stepping = steps.length > 0;
    const view = stepping ? steps[0].from : shown;
    const k = Math.floor(view);
    const fraction = stepping ? 0 : view - k;
    const blink = !reducedMotion && Math.floor(now / 530) % 2 === 0;
    const revealing = substrate.revealing();
    // clock flaps only compare a resting page with itself
    steadyFrame = !stepping && fraction === 0 && k === restRow && !revealing;
    restRow = !stepping && fraction === 0 ? k : -1;
    if (!steadyFrame) flapAt.fill(-1e9);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const o = i * 4;
        const sub = substrate.sample(i, now, reducedMotion);
        let shownInk = 0;
        let resting = false;

        if (stepping) {
          // the latest flip that has reached this cell
          const lag = cascadeOf(r, c, steps[steps.length - 1].down);
          let s = steps.length - 1;
          while (s > 0 && now < steps[s].t0 + lag) s--;
          const step = steps[s];
          const started = now >= step.t0 + lag;
          const phase = started ? smooth(Math.min(1, (now - step.t0 - lag) / P.flipMs)) : 0;
          const a = docAt((started ? step.from : step.from) + r, c, faceA);
          const b = docAt(step.to + r, c, faceB);
          if (a.glyph || (started && b.glyph)) {
            if (started) turn(o, a, b, phase, sub);
            else put(o, a.glyph, a.ink, 0, 0, 0, a.accent ? F_ACCENT_X : 0, a.under);
            shownInk = phase < 0.5 ? a.ink : b.ink;
          } else {
            put(o, sub.from, sub.fromInk, sub.glyph, sub.ink, sub.t, F_FADE);
          }
        } else {
          const phase = fraction > 0 ? turnOf(fraction, c) : 0;
          const a = docAt(k + r, c, faceA);
          const b = phase > 0 ? docAt(k + r + 1, c, faceB) : null;
          if (phase > 0 && (a.glyph || b.glyph)) {
            turn(o, a, b, phase, sub);
            shownInk = phase < 0.5 ? a.ink : b.ink;
          } else if (a.glyph) {
            resting = phase === 0;
            const gate = revealing ? substrate.contentGate(i, now) : 1;
            const delay = a.under && a.glyph !== blank
              ? (c - (linkStart.get(worldLink[(k + r) * cols + c]) ?? c)) * P.flipStagger
              : 0;
            if (gate < 1) {
              // first contact: the cell turns from its lattice mark to the letter
              put(o, sub.glyph, sub.ink, a.glyph, a.ink, gate, a.accent ? F_ACCENT_Y : 0, 0, a.under * gate);
              shownInk = gate > 0.5 ? a.ink : 0;
            } else {
              if (!clockFlap(i, o, now, a, sub.glyph, delay)) {
                put(o, a.glyph, a.ink, 0, 0, 0, a.accent ? F_ACCENT_X : 0, a.under);
              }
              shownInk = a.ink;
            }
          } else {
            resting = phase === 0;
            if (!(resting && clockFlap(i, o, now, null, sub.glyph, 0, sub))) {
              put(o, sub.from, sub.fromInk, sub.glyph, sub.ink, sub.t, F_FADE);
            }
          }
          if (resting) {
            lastShown[i] = a.glyph ? a.glyph | (a.accent ? ACCENT_KEY : 0) : 0;
            lastInk[i] = a.glyph ? a.ink : sub.ink;
            if (inbox && inbox.caretAt(k + r, c) && (blink || !inbox.focused())) glyphs[o + 2] |= F_CARET;
          }
        }

        if (i === cursorCell && P.cursorEmbed) {
          if (glyphs[o] && glyphs[o] !== blank && !(glyphs[o + 2] & F_FADE) && inks[o + 2] === 0) {
            glyphs[o + 2] |= F_ACCENT_X;
          } else if (glyphs[o + 2] & F_FADE) {
            put(o, cursorGlyph, 1, 0, 0, 0, 0);
          }
        }

        if (!reducedMotion && shownInk > 0) substrate.trailTo(i, shownInk * P.wake);
      }
    }

    // the status row, anchored to the screen rather than the document
    const r = rows - 2;
    const label = (text, start, ink) => {
      for (let q = 0; q < text.length; q++) {
        const c = start + q;
        if (r < 0 || c < 0 || c >= cols) continue;
        const i = r * cols + c;
        const gate = revealing ? substrate.contentGate(i, now) : 1;
        if (gate <= 0) continue;
        if (text[q] === " ") put(i * 4, blank, 1, 0, 0, 0, 0);
        else put(i * 4, atlas.ensure(text[q]), ink * gate, 0, 0, 0, 0);
      }
    };
    if (status.left) label(status.left, status.leftCol, status.leftInk);
    if (status.right || rightWas) {
      const end = cols - 2;
      const span = Math.max(status.right.length, rightWas.length);
      for (let q = 0; q < span; q++) {
        const c = end - span + q;
        if (r < 0 || c < 0 || c >= cols) continue;
        const i = r * cols + c;
        const gate = revealing ? substrate.contentGate(i, now) : 1;
        if (gate <= 0) continue;
        const was = rightWas[q - (span - rightWas.length)] ?? " ";
        const is = status.right[q - (span - status.right.length)] ?? " ";
        const t = (now - rightAt - q * P.flipStagger) / P.flipMs;
        const sub = substrate.sample(i, now, reducedMotion);
        const face = (ch) => (ch === " " ? sub.glyph : atlas.ensure(ch));
        const inkOfCh = (ch) => (ch === " " ? sub.ink : status.rightInk * gate);
        if (t >= 1 || reducedMotion) {
          if (is !== " ") put(i * 4, face(is), inkOfCh(is), 0, 0, 0, 0);
        } else if (t <= 0) {
          if (was !== " ") put(i * 4, face(was), inkOfCh(was), 0, 0, 0, 0);
        } else if (was !== is) {
          put(i * 4, face(was), inkOfCh(was), face(is), inkOfCh(is), smooth(t), 0);
        }
      }
      if (now - rightAt > P.flipMs + span * P.flipStagger) rightWas = status.right;
    }
  }

  // A resting cell whose content changed flaps from what it showed before.
  // `face` is the document's face, or null for the lattice; `delay` staggers
  // a word so it turns over letter by letter. Returns true when it painted.
  function clockFlap(i, o, now, face, latticeGlyph, delay, sub = null) {
    const key = face ? face.glyph | (face.accent ? ACCENT_KEY : 0) : 0;
    if (steadyFrame && key !== lastShown[i]) {
      flapFrom[i] = lastShown[i] || latticeGlyph;
      flapFromInk[i] = lastInk[i];
      flapAt[i] = now + delay;
      flapsUntil = Math.max(flapsUntil, flapAt[i] + P.flipMs);
    }
    const age = now - flapAt[i];
    if (age >= P.flipMs) return false;
    const from = flapFrom[i] & ~ACCENT_KEY;
    const fromAccent = flapFrom[i] & ACCENT_KEY ? F_ACCENT_X : 0;
    const under = face ? face.under : 0;
    if (age < 0) {
      put(o, from, flapFromInk[i], 0, 0, 0, fromAccent, under);
      return true;
    }
    const g = face ? face.glyph : sub.glyph;
    const ink = face ? face.ink : sub.ink;
    put(o, from, flapFromInk[i], g, ink, smooth(age / P.flipMs),
      fromAccent | (face && face.accent ? F_ACCENT_Y : 0), under, under);
    return true;
  }

  function frame(now) {
    const dt = lastFrame ? Math.min(100, now - lastFrame) : 16;
    lastFrame = now;
    advance(now, dt);
    if (!reducedMotion) substrate.step(now, dt);
    compose(now);
    renderer.atlas(atlas);
    renderer.draw(glyphs, inks);
  }

  function tick(now) {
    rafId = 0;
    const idle = now > activeUntil && now > flapsUntil && !steps.length && !substrate.busy();
    if (!idle || now - lastFrame >= 100) frame(now);
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
    activeUntil = performance.now() + 2500;
    if (running || !metrics || rafId) return;
    rafId = requestAnimationFrame((now) => {
      rafId = 0;
      frame(now);
    });
  }

  function applyStyle() {
    renderer.style({ paper: P.paper, ink: P.ink, accent: P.accent, turn: P.turn, shade: P.shade, body: P.body });
  }

  function pointerCell(x, y) {
    const dpr = metrics.dpr;
    const col = Math.floor((x * dpr - originX) / metrics.cellWd);
    const row = Math.floor((y * dpr) / metrics.cellHd);
    return { col, row, inside: col >= 0 && col < cols && row >= 0 && row < rows };
  }

  // ---------- public ----------

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
      const n = cols * rows;
      glyphs = new Uint16Array(n * 4);
      inks = new Uint8Array(n * 4);
      lastShown = new Uint16Array(n);
      lastInk = new Float32Array(n);
      flapFrom = new Uint16Array(n);
      flapFromInk = new Float32Array(n);
      flapAt = new Float32Array(n).fill(-1e9);
      restRow = -1;
      steps = [];
      substrate.resize(cols, rows, metrics.cellHd / metrics.cellWd);
      renderer.configure({
        cols, rows, cellWd: metrics.cellWd, cellHd: metrics.cellHd, originX,
        perRow: atlas.perRow, dpr, underY: Math.min(metrics.cellHd - dpr, atlas.baseline + Math.round(3 * dpr)),
      });
      applyStyle();
      cursorCell = -1;
    },

    setWorld(nextLines, totalRows, column) {
      lines = nextLines;
      worldRows = totalRows;
      textLeft = column.left;
      textWidth = Math.max(1, column.width);
      buildWorld();
      requestDraw();
    },

    // The real scroll position. The board follows it with the finger, or
    // flips to it.
    setScroll(px, instant = false) {
      let next = Math.max(0, px / metrics.cellH);
      // the browser keeps scroll offsets on whole pixels, so a row edge can
      // be missed by a fraction of one; that close is resting on it
      const nearest = Math.round(next);
      if (Math.abs(next - nearest) * metrics.cellH < 0.75) next = nearest;
      const now = performance.now();
      const dt = Math.max(1, now - lastTargetAt);
      const v = (Math.abs(next - lastTarget) / dt) * 1000;
      speed = dt > 200 ? v : speed * 0.6 + v * 0.4;
      if (Math.abs(next - lastTarget) > 1.2) jumped = true;
      lastTarget = next;
      lastTargetAt = now;
      target = next;
      if (instant) {
        steps = [];
        shown = target;
        lastTurnRow = Math.round(target);
        jumped = false;
      }
      requestDraw();
    },

    onTurn(callback) {
      onTurn = callback;
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

    // The pointer's path warms the cells it crosses.
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
      const pace = dt > 0 ? dist / (dt / 16.67) : 0;
      const n = Math.min(16, Math.max(1, Math.ceil(dist / 0.8)));
      const strength = Math.min(1.2, 0.15 + pace * 0.22);
      for (let s = 1; s <= n; s++) {
        const t = s / n;
        substrate.warm(pcol + dx * t, prow + dy * t, strength / Math.sqrt(n));
      }
      requestDraw();
    },

    strike(x, y) {
      if (reducedMotion) return;
      const { col, row } = pointerCell(x, y);
      substrate.impulse(col + 0.5, row + 0.5, performance.now());
      requestDraw();
    },

    hoverLink(linkId, on) {
      if (on) hoveredLink = linkId;
      else if (hoveredLink === linkId) hoveredLink = -1;
      requestDraw();
    },

    setStatus(next) {
      if (next.right !== undefined && next.right !== status.right) {
        rightWas = status.right;
        rightAt = performance.now();
        flapsUntil = Math.max(flapsUntil, rightAt + P.flipMs + 40 * P.flipStagger);
      }
      Object.assign(status, next);
      requestDraw();
    },

    // First contact: the empty board comes up, the name's cells turn one by
    // one, then a ring leaves the name and the rest turns in behind it.
    crystallize(hero, quick = false) {
      if (reducedMotion) return;
      substrate.startReveal(performance.now(), hero, quick);
      requestDraw();
    },

    setReducedMotion(v) {
      reducedMotion = v;
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

    stats: () => ({ ...substrate.stats(), glyphs: atlas.size(), renderer: renderer.kind, flipping: steps.length > 0 }),
    requestDraw,
    start,
    stop,
    cols: () => cols,
    rows: () => rows,
    // the row the board shows, or is flipping to
    camera: () => (steps.length ? steps[steps.length - 1].to : Math.round(shown)),
    worldRows: () => worldRows,
    // left edge of the grid in CSS px
    xOffset: () => originX / metrics.dpr,
  };
}
