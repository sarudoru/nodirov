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
// The other scroll, "settle": a real scroll turns the document's letters
// into characters that keep changing (or into dots), each in its cell, and
// while the page moves only those change. When the page rests, the marks
// hold still and each cell's flap turns over to its letter, slowly enough
// to watch, the way a departure board does.
//
// A hovered word turns through its letters' cousins while the page rests.
//
// Law: nothing moves; cells change.

import { createAtlas, TEXT_DOT } from "./atlas.js";
import { cousinsFor } from "./cousins.js";
import { createRenderer, TURN } from "./renderer.js";
import { createSubstrate } from "./substrate.js";

export const K_TEXT = 1;
export const K_FAINT = 2;
export const K_LINK = 3;

// flags shared with the shader; bits 6 to 8 carry the cell's turn style
const F_ACCENT_X = 1;
const F_CARET = 2;
const F_LATTICE = 4; // the cell shows the substrate, not the document
const F_ACCENT_Y = 8;
// a face that carries a letter shows its flap's card while it turns
const F_BODY_X = 16;
const F_BODY_Y = 32;

const ACCENT_KEY = 0x8000;

export function createField(canvasElement, params) {
  let P = params;
  const renderer = createRenderer(canvasElement);
  const canvas = renderer.canvas;
  // If the GPU drops the canvas, the real text shows until it comes back.
  renderer.onContext(
    () => {
      document.documentElement.classList.add("field-lost");
      stop();
    },
    () => {
      document.documentElement.classList.remove("field-lost");
      start();
    },
  );

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

  // settle
  let settle = "text"; // "text", "dots", or "resolve"
  let anchor = 0;      // the row the text last rested on
  let dotRow = 0;      // the row the moving marks show
  let leave = { at: -1e9, row: 0, settled: false, across: 0, fall: 0, down: true };
  let resolveRow = 0;
  let resolveAt = 0;
  let resolveSpread = 0;
  let resolveEnd = 0;
  let landRow = 0;     // the next screen row whose landing clicks
  let onLand = () => {};
  let dotGlyph = 0;
  let searchCache = new Map();

  // the word under the pointer, in world cells, and each letter's cousins
  const hover = { row: -1, from: 0, to: -1 };
  let cousinCache = new Map();
  let frameNow = 0;

  // frame buffers handed to the renderer
  let glyphs = new Uint16Array(0);
  let inks = new Uint8Array(0);

  // Clock flaps. Per cell: the face it shows or is turning to (a glyph with
  // an accent bit, or 0 for the lattice), the face it turns from, and when
  // the turn starts. Times are doubles: a tab left open for days must still
  // resolve a 110 ms flap.
  let flapTo = new Uint16Array(0);
  let flapToInk = new Float32Array(0);
  let flapFrom = new Uint16Array(0);
  let flapFromInk = new Float32Array(0);
  let flapAt = new Float64Array(0);
  let restRow = -1;
  let steadyFrame = false;

  // view overlays
  // `upper` sits on the row above `left`
  const status = { left: "", leftCol: 2, leftInk: 0.5, upper: "", upperInk: 0.5, right: "", rightInk: 0.5 };
  // a label turns over letter by letter when its text changes: what it said
  // before, and when it changed
  const relabel = {
    left: { was: "", at: -1e9 },
    upper: { was: "", at: -1e9 },
    right: { was: "", at: -1e9 },
  };
  let cursorCell = -1;
  let cursorGlyph = 0;
  let hoveredLink = -1;
  let focusedLink = -1;
  let inbox = null;

  let rafId = 0;
  let idleTimer = 0;
  let running = false;
  let lastFrame = 0;
  // Until this time the page is being touched and draws every frame. After
  // it, the only change left is the slow weather, and ten frames a second
  // show it as well as sixty.
  let activeUntil = 0;
  let flapsUntil = 0;

  const inkOf = (kind) => (kind === K_FAINT ? P.faintAlpha : P.textAlpha);

  // How a cell turns, as flag bits. "mix" gives each cell its own mechanism,
  // fixed for that cell, so the page reads as many small machines.
  const MIXED = [TURN.flap, TURN.roll, TURN.fold];
  function turnBits(name, i) {
    const named = TURN[name];
    const t = named !== undefined ? named : MIXED[(Math.imul(i + 1, 0x9e3779b1) >>> 29) % MIXED.length];
    return t << 6;
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  function hash(a, b, s) {
    let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(s, 0x61c88647);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  }

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
    face.glyph = worldRow === hover.row && col >= hover.from && col <= hover.to ? cousinOf(g, worldRow, col) : g;
    face.ink = inkOf(worldKind[w]);
    const link = worldLink[w];
    if (link >= 0 && worldKind[w] === K_LINK) {
      // a hovered or focused link turns its letters over to the accent
      face.accent = link === hoveredLink || link === focusedLink;
      face.under = face.accent ? 0.85 : 0.3;
    }
    return face;
  }

  // The word under the pointer, while the page rests on a row.
  function findHover(k, resting) {
    hover.row = -1;
    if (!resting || cursorCell < 0 || P.cousinMs <= 0) return;
    const row = k + Math.floor(cursorCell / cols);
    if (row >= worldRows) return;
    const w = row * cols;
    const lettered = (c) => c >= 0 && c < cols && worldGlyph[w + c] !== 0 && worldGlyph[w + c] !== blank;
    const col = cursorCell % cols;
    if (!lettered(col)) return;
    hover.row = row;
    hover.from = hover.to = col;
    while (lettered(hover.from - 1)) hover.from--;
    while (lettered(hover.to + 1)) hover.to++;
  }

  // Whether a screen cell lies on a line of the document, or right beside
  // one. There the pointer is reading, and the lattice stays out of it.
  function overText(i, k) {
    const row = k + Math.floor(i / cols);
    if (i < 0 || row >= worldRows) return false;
    const c = i % cols;
    for (let q = Math.max(0, c - 2); q <= Math.min(cols - 1, c + 2); q++) {
      if (worldKind[row * cols + q]) return true;
    }
    return false;
  }

  // The cousin a hovered letter shows now. The whole word changes on one
  // beat; each letter picks for itself, and sometimes picks its own.
  function cousinOf(glyph, row, col) {
    let family = cousinCache.get(glyph);
    if (family === undefined) {
      family = cousinsFor(atlas.char(glyph))?.map((ch) => atlas.ensure(ch)) ?? null;
      cousinCache.set(glyph, family);
    }
    if (!family) return glyph;
    return family[(hash(row, col, Math.floor(frameNow / P.cousinMs)) * family.length) | 0];
  }

  // During first contact a document cell may not be written yet.
  function gated(face, gate) {
    if (gate >= 1) return face;
    if (gate <= 0) {
      face.glyph = 0;
      face.under = 0;
    }
    face.ink *= gate;
    face.under *= gate;
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
  function cascadeOf(r, c, step) {
    const rowFrac = rows > 1 ? r / (rows - 1) : 0;
    return colFrac(c) * step.across + (step.down ? rowFrac : 1 - rowFrac) * step.fall;
  }

  function advance(now, dt) {
    // scroll speed decays when no scroll events arrive
    if (now - lastTargetAt > 60) speed *= Math.exp(-dt / 80);

    if (reducedMotion) {
      steps = [];
      shown = Math.round(target);
      if (shown !== lastTurnRow) {
        onTurn(shown - lastTurnRow, shown);
        lastTurnRow = shown;
      }
      return;
    }

    if (P.scroll === "settle" && settleAdvance(now)) return;

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
    const settleAll = last.flip + last.across + last.fall;
    if (now >= last.t0 + last.flip) {
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
    while (steps.length > 1 && now >= steps[1].t0 + steps[1].across + steps[1].fall) steps.shift();
  }

  // A lone jump of a screenful (a key, a link) turns the board over as a
  // slow, visible wave; a stream of steps (a flick) keeps the quick cascade.
  function pushStep(from, to, now) {
    const lone = !steps.length && Math.abs(to - from) >= 8;
    const step = lone
      ? { from, to, t0: now, down: to > from, flip: P.flipMs * 1.35, across: P.cascadeX * 2, fall: P.cascadeY * 2.6 }
      : { from, to, t0: now, down: to > from, flip: P.flipMs, across: P.cascadeX, fall: P.cascadeY };
    steps.push(step);
    flapsUntil = Math.max(flapsUntil, now + step.flip + step.across + step.fall);
    onTurn(to - from, to);
    lastTurnRow = to;
  }

  // ---------- settle: dots while the page moves, text once it rests ----------

  function turned(row) {
    if (row === lastTurnRow) return;
    onTurn(row - lastTurnRow, row);
    lastTurnRow = row;
  }

  // Returns true while the settle scroll owns the board.
  function settleAdvance(now) {
    const row = Math.round(target);
    const still = now - lastTargetAt > P.restWait;
    if (settle === "text") {
      if (still && !steps.length) anchor = row;
      // a nudge keeps the text, so reading is never interrupted by one
      if (Math.abs(target - anchor) <= P.dotsAfter) return false;
      toDots(now);
      return true;
    }
    if (settle === "resolve") {
      if (row !== resolveRow) {
        toDots(now);
        return true;
      }
      landing(now);
      if (now < resolveEnd) return true;
      settle = "text";
      anchor = resolveRow;
      shown = target;
      steps = [];
      jumped = false;
      return false;
    }
    dotRow = row;
    shown = target;
    turned(row);
    // the text turns to dots before it may settle again
    const left = now - leave.at > P.flipMs + leave.across + leave.fall;
    if (still && left) startResolve(now, row);
    return true;
  }

  function toDots(now) {
    const from = settle === "resolve" ? resolveRow : steps.length ? steps[steps.length - 1].to : Math.round(shown);
    leave = {
      at: now, row: from, settled: settle === "resolve",
      across: P.cascadeX, fall: P.cascadeY, down: target >= from,
    };
    settle = "dots";
    steps = [];
    dotRow = Math.round(target);
    shown = target;
    jumped = false;
    flapsUntil = Math.max(flapsUntil, now + P.flipMs + leave.across + leave.fall);
    turned(dotRow);
  }

  function startResolve(now, row) {
    settle = "resolve";
    resolveRow = row;
    resolveAt = now;
    const tail = (Math.round(P.resolveFlips) + 1) * P.searchMs;
    resolveSpread = Math.max(0, P.resolveMs - tail);
    resolveEnd = now + resolveSpread + tail + 20;
    landRow = 0;
    flapsUntil = Math.max(flapsUntil, resolveEnd);
  }

  // When a cell starts to settle, in ms after the screen began. Mostly a
  // moment of its own, so the board finds its words cell by cell, many
  // early and a few late; the rest is a sweep from the top and across.
  function resolveStart(r, c) {
    const own = Math.pow(hash(resolveRow + r, c, 1), 1.5);
    return resolveSpread * (sweepOf(r) + 0.14 * (1 - P.resolveGrain) * colFrac(c) + P.resolveGrain * own);
  }

  // the part of a cell's wait that comes from its row: the top-to-bottom
  // sweep, which the grain takes the place of
  function sweepOf(r) {
    return 0.86 * (1 - P.resolveGrain) * (rows > 1 ? r / (rows - 1) : 0);
  }

  // The letters a cell passes on the way to its own, in the order a
  // departure board holds them; a figure passes figures. Marks turn straight
  // from the dot. Returns atlas slots, the nearest predecessor last.
  const ORDERS = ["abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "0123456789"];
  const SEARCH_MAX = 12;
  function searchOf(glyph) {
    if (searchCache.has(glyph)) return searchCache.get(glyph);
    const ch = atlas.char(glyph);
    let seq = null;
    for (const order of ORDERS) {
      const at = order.indexOf(ch);
      if (at < 0) continue;
      seq = [];
      for (let k = SEARCH_MAX; k >= 1; k--) seq.push(atlas.ensure(order[(at - k + order.length * 2) % order.length]));
      break;
    }
    searchCache.set(glyph, seq);
    return seq;
  }

  function searchCount(glyph, r, c) {
    const most = Math.min(SEARCH_MAX, Math.round(P.resolveFlips));
    if (most <= 0 || !searchOf(glyph)) return 0;
    return Math.max(1, Math.round(most * (0.34 + 0.66 * hash(resolveRow + r, c, 2))));
  }

  // A row clicks as its first letters land.
  function landing(now) {
    const lead = (Math.round(P.resolveFlips) * 0.5 + 1) * P.searchMs;
    while (landRow < rows) {
      if (now - resolveAt < resolveSpread * sweepOf(landRow) + lead) break;
      const w = (resolveRow + landRow) * cols;
      if (resolveRow + landRow < worldRows) {
        for (let c = 0; c < cols; c++) {
          const g = worldGlyph[w + c];
          if (g && g !== blank) {
            onLand(now);
            break;
          }
        }
      }
      landRow++;
    }
  }

  // What a cell under a letter holds while the page moves: a character
  // that gives way to another on the cell's own beat, like a board running
  // through its cards, or the dot.
  function movingGlyph(r, c, at) {
    if (P.moving === "dots") return dotGlyph;
    const pool = substrate.pool();
    const beat = Math.floor(at / P.scrambleMs + hash(r, c, 3));
    return pool[(hash(r, c, beat) * pool.length) | 0];
  }

  // The document's face as the page moves: a letter becomes its cell's
  // moving mark in its ink, a space stays blank paper, so the words keep
  // their shapes.
  function dotFace(worldRow, r, c, face, gate, at = frameNow) {
    gated(docAt(worldRow, c, face), gate);
    if (face.glyph && face.glyph !== blank) {
      face.glyph = movingGlyph(r, c, at);
      face.ink *= P.dotInk;
    }
    face.accent = false;
    face.under = 0;
    return face;
  }

  // What a settling screen showed at a moment: the letter if the cell had
  // landed, else its moving mark.
  function settledFace(r, c, at, face, gate) {
    gated(docAt(resolveRow + r, c, face), gate);
    if (!face.glyph || face.glyph === blank) return face;
    const landed = at - resolveAt - resolveStart(r, c) >= (searchCount(face.glyph, r, c) + 1) * P.searchMs;
    return landed ? face : dotFace(resolveRow + r, r, c, face, gate, resolveAt);
  }

  function settleCell(o, i, r, c, now, sub, gate) {
    if (settle === "resolve") {
      resolveCell(o, i, r, c, now, sub, gate);
      return;
    }
    // the text leaves as a wave across the words and down the rows; a cell
    // mid-turn turns to the mark it will hold when the turn ends
    const lt = now - leave.at - cascadeOf(r, c, leave);
    const to = dotFace(dotRow + r, r, c, faceB, gate, lt < P.flipMs ? now - lt + P.flipMs : now);
    if (lt < P.flipMs) {
      // the cell's own flaps carry on from the mark this turn ends on
      flapTo[i] = to.glyph;
      flapToInk[i] = to.ink;
      flapAt[i] = -1e9;
      const from = leave.settled
        ? settledFace(r, c, leave.at, faceA, gate)
        : gated(docAt(leave.row + r, c, faceA), gate);
      if (!from.glyph && !to.glyph) {
        lattice(o, sub);
        return;
      }
      if (lt <= 0) {
        if (from.glyph) put(o, from.glyph, from.ink, 0, 0, 0, from.accent ? F_ACCENT_X : 0, from.under);
        else lattice(o, sub);
        return;
      }
      turn(o, from, to, smooth(lt / P.flipMs), sub);
      return;
    }
    moveCell(o, i, now, to, sub);
  }

  // A cell while the page moves. Every change in it is one flap from what it
  // showed: to the next character on its beat, and to or from the resting
  // field as the page brings text into the cell or takes it away.
  function moveCell(o, i, now, face, sub) {
    const held = face.glyph ? face : null;
    if (clockFlap(i, o, now, held, sub, 0, Math.min(P.flipMs, P.scrambleMs), true)) return;
    if (held) put(o, face.glyph, face.ink, 0, 0, 0, 0);
    else lattice(o, sub);
  }

  // A cell settling: its moving mark, then the letters before its own, then
  // its own.
  function resolveCell(o, i, r, c, now, sub, gate) {
    const face = gated(docAt(resolveRow + r, c, faceA), gate);
    if (!face.glyph) {
      lattice(o, sub);
      return;
    }
    const t = now - resolveAt - resolveStart(r, c);
    if (face.glyph === blank) {
      put(o, blank, face.ink, 0, 0, 0, 0, t > 0 ? face.under : 0);
      return;
    }
    const dotInk = face.ink * P.dotInk;
    // once the page rests the marks hold still: each cell waits with the
    // mark it had, then its flap turns over to its letter
    const mark = movingGlyph(r, c, resolveAt);
    if (t < 0) {
      // a flap already on its way to that mark finishes
      faceB.glyph = mark;
      faceB.ink = dotInk;
      faceB.accent = false;
      faceB.under = 0;
      moveCell(o, i, now, faceB, sub);
      return;
    }
    const k = searchCount(face.glyph, r, c);
    const f = P.searchMs;
    const j = Math.floor(t / f);
    if (j > k) {
      put(o, face.glyph, face.ink, 0, 0, 0, face.accent ? F_ACCENT_X : 0, face.under);
      return;
    }
    const seq = k ? searchOf(face.glyph) : null;
    const glyphAt = (q) => (q === 0 ? mark : q === k + 1 ? face.glyph : seq[SEARCH_MAX - k + q - 1]);
    const inkAt = (q) => (q === 0 ? dotInk : q === k + 1 ? face.ink : face.ink * P.searchInk);
    const last = j === k;
    put(o, glyphAt(j), inkAt(j), glyphAt(j + 1), inkAt(j + 1), smooth((t - j * f) / f),
      (last && face.accent ? F_ACCENT_Y : 0) | (inked(glyphAt(j)) ? F_BODY_X : 0) | F_BODY_Y | turnBits(P.turn, i),
      0, last ? face.under : 0);
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
  // the lattice holds. Only a flap with a letter on it shows its card.
  const inked = (glyph) => glyph !== 0 && glyph !== blank && glyph !== dotGlyph;

  function turn(o, x, y, phase, sub) {
    const inkedX = inked(x.glyph);
    const inkedY = inked(y.glyph);
    put(o,
      x.glyph || sub.glyph, x.glyph ? x.ink : sub.ink,
      y.glyph || sub.glyph, y.glyph ? y.ink : sub.ink,
      phase,
      (x.accent ? F_ACCENT_X : 0) | (y.accent ? F_ACCENT_Y : 0) |
        (inkedX ? F_BODY_X : 0) | (inkedY ? F_BODY_Y : 0) | turnBits(P.turn, o >> 2),
      x.under, y.under);
  }

  function lattice(o, sub) {
    put(o, sub.from, sub.fromInk, sub.glyph, sub.ink, sub.t, F_LATTICE | (sub.turn << 6));
  }

  function compose(now) {
    const settling = settle !== "text" && !reducedMotion;
    const stepping = !settling && steps.length > 0;
    const view = stepping ? steps[0].from : shown;
    const k = Math.floor(view);
    const fraction = stepping ? 0 : view - k;
    const revealing = substrate.revealing();
    frameNow = now;
    dotGlyph = atlas.ensure(TEXT_DOT[Math.max(0, Math.min(TEXT_DOT.length - 1, Math.round(P.dotSize)))]);
    // clock flaps only compare a resting page with itself
    steadyFrame = !reducedMotion && !settling && !stepping && fraction === 0 && k === restRow && !revealing;
    restRow = !settling && !stepping && fraction === 0 ? k : -1;
    findHover(k, steadyFrame);
    substrate.hush(overText(cursorCell, k));
    if (!steadyFrame && !settling) flapAt.fill(-1e9);
    // the caret, found once per frame: a line at the left of one cell,
    // blinking, or steady when motion is reduced
    const caret = inbox && !settling && !stepping && fraction === 0 ? inbox.caret() : null;
    const caretCell = caret && (reducedMotion || Math.floor(now / 530) % 2 === 0)
      ? (caret.row - k) * cols + caret.col
      : -1;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const o = i * 4;
        const sub = substrate.sample(i, r, c, now, reducedMotion);
        const gate = revealing ? substrate.contentGate(i, now) : 1;
        let shownInk = 0;

        if (settling) {
          settleCell(o, i, r, c, now, sub, gate);
          // whatever the document put here warms the cell like any letter
          if (!(glyphs[o + 2] & F_LATTICE)) shownInk = inks[o] / 255;
        } else if (stepping) {
          // the latest flip that has reached this cell
          let s = steps.length - 1;
          while (s > 0 && now < steps[s].t0 + cascadeOf(r, c, steps[s])) s--;
          const step = steps[s];
          const lag = cascadeOf(r, c, step);
          const started = now >= step.t0 + lag;
          const phase = started ? smooth(Math.min(1, (now - step.t0 - lag) / step.flip)) : 0;
          const a = gated(docAt(step.from + r, c, faceA), gate);
          const b = gated(docAt(step.to + r, c, faceB), gate);
          if (a.glyph || (started && b.glyph)) {
            if (started) turn(o, a, b, phase, sub);
            else put(o, a.glyph, a.ink, 0, 0, 0, a.accent ? F_ACCENT_X : 0, a.under);
            shownInk = phase < 0.5 ? a.ink : b.ink;
          } else {
            lattice(o, sub);
          }
        } else {
          const phase = fraction > 0 ? turnOf(fraction, c) : 0;
          const a = docAt(k + r, c, faceA);
          const b = phase > 0 ? docAt(k + r + 1, c, faceB) : null;
          if (phase > 0 && (a.glyph || b.glyph)) {
            turn(o, gated(a, gate), gated(b, gate), phase, sub);
            shownInk = phase < 0.5 ? a.ink : b.ink;
          } else if (a.glyph) {
            if (gate < 1) {
              // first contact: the cell turns from its lattice mark to the letter
              put(o, sub.glyph, sub.ink, a.glyph, a.ink, gate,
                (a.accent ? F_ACCENT_Y : 0) | F_BODY_Y | turnBits(P.turn, i), 0, a.under * gate);
              shownInk = gate > 0.5 ? a.ink : 0;
              flapTo[i] = a.glyph | (a.accent ? ACCENT_KEY : 0);
              flapToInk[i] = a.ink;
            } else {
              const link = a.under && a.glyph !== blank ? worldLink[(k + r) * cols + c] : -1;
              const delay = link >= 0 ? (c - (linkStart.get(link) ?? c)) * P.flipStagger : 0;
              if (!clockFlap(i, o, now, a, sub, delay)) {
                put(o, a.glyph, a.ink, 0, 0, 0, a.accent ? F_ACCENT_X : 0, a.under);
              }
              shownInk = a.ink;
            }
          } else if (!(phase === 0 && clockFlap(i, o, now, null, sub, 0))) {
            lattice(o, sub);
          }
        }

        if (i === caretCell) glyphs[o + 2] |= F_CARET;

        if (i === cursorCell && P.cursorEmbed) {
          if (glyphs[o] && glyphs[o] !== blank && !(glyphs[o + 2] & F_LATTICE) && inks[o + 2] === 0) {
            glyphs[o + 2] |= F_ACCENT_X;
          } else if (glyphs[o + 2] & F_LATTICE) {
            put(o, cursorGlyph, 1, 0, 0, 0, 0);
          }
        }

        if (!reducedMotion && shownInk > 0) substrate.trailTo(i, shownInk * P.wake);
      }
    }

    // the status row, anchored to the screen rather than the document
    const r = rows - 2;
    // `end`: the label ends at that column, else it starts at `start`.
    // `paper`: a space is blank paper, else the lattice shows through it.
    const label = (key, row, ink, { start = 0, end = null, paper = false }) => {
      const text = status[key];
      const state = relabel[key];
      if (!text && !state.was) return;
      const span = Math.max(text.length, state.was.length);
      const first = end === null ? start : end - span;
      const shift = (s) => (end === null ? 0 : span - s.length);
      for (let q = 0; q < span; q++) {
        const c = first + q;
        if (row < 0 || c < 0 || c >= cols) continue;
        const i = row * cols + c;
        const gate = revealing ? substrate.contentGate(i, now) : 1;
        if (gate <= 0) continue;
        const was = state.was[q - shift(state.was)];
        const is = text[q - shift(text)];
        const sub = substrate.sample(i, row, c, now, reducedMotion);
        // a cell the label leaves alone shows the lattice
        const bare = (ch) => ch === undefined || (ch === " " && !paper);
        const glyphOf = (ch) => (bare(ch) ? sub.glyph : ch === " " ? blank : atlas.ensure(ch));
        const inkOf = (ch) => (bare(ch) ? sub.ink : ch === " " ? 1 : ink * gate);
        const t = (now - state.at - q * P.flipStagger) / P.flipMs;
        const shown = t <= 0 && !reducedMotion ? was : is;
        if (t > 0 && t < 1 && was !== is && !reducedMotion) {
          put(i * 4, glyphOf(was), inkOf(was), glyphOf(is), inkOf(is), smooth(t), turnBits(P.clockTurn, i));
        } else if (!bare(shown)) {
          put(i * 4, glyphOf(shown), inkOf(shown), 0, 0, 0, 0);
        }
      }
      if (now - state.at > P.flipMs + span * P.flipStagger) state.was = text;
    };
    label("left", r, status.leftInk, { start: status.leftCol, paper: true });
    label("upper", r - 1, status.upperInk, { start: status.leftCol, paper: true });
    label("right", r, status.rightInk, { end: cols - 2 });
  }

  // A cell whose content changed flaps from what it showed before. `face` is
  // the document's face, or null for the lattice; `delay` staggers a word so
  // it turns over letter by letter; `ms` is how long the flap takes. Unless
  // `live`, a change is taken without a turn: the page is neither at rest
  // nor moving under the settle scroll. Returns true when it painted.
  function clockFlap(i, o, now, face, sub, delay, ms = P.flipMs, live = steadyFrame) {
    const key = face ? face.glyph | (face.accent ? ACCENT_KEY : 0) : 0;
    if (key !== flapTo[i]) {
      if (!live) {
        // not a page at rest: take the new content without a turn
        flapAt[i] = -1e9;
      } else if (now < flapAt[i] && key === flapFrom[i]) {
        // a turn that has not started yet is called off: the cell never left
        flapAt[i] = -1e9;
      } else {
        flapFrom[i] = flapTo[i] || sub.glyph;
        flapFromInk[i] = flapToInk[i];
        flapAt[i] = now + delay;
        flapsUntil = Math.max(flapsUntil, flapAt[i] + ms);
      }
      flapTo[i] = key;
    }
    flapToInk[i] = face ? face.ink : sub.ink;
    const age = now - flapAt[i];
    if (age >= ms) return false;
    const from = flapFrom[i] & ~ACCENT_KEY;
    const fromAccent = flapFrom[i] & ACCENT_KEY ? F_ACCENT_X : 0;
    const under = face ? face.under : 0;
    if (age < 0) {
      put(o, from, flapFromInk[i], 0, 0, 0, fromAccent, under);
      return true;
    }
    const g = face ? face.glyph : sub.glyph;
    const inked = (from && from !== blank ? F_BODY_X : 0) | (face && g !== blank ? F_BODY_Y : 0);
    put(o, from, flapFromInk[i], g, flapToInk[i], smooth(age / ms),
      fromAccent | (face && face.accent ? F_ACCENT_Y : 0) | inked | turnBits(P.clockTurn, i), under, under);
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

  // While idle the loop sleeps between weather updates instead of waking
  // every display frame; with reduced motion it sleeps until something
  // asks for a frame.
  function tick(now) {
    rafId = 0;
    const idle = now > activeUntil && now > flapsUntil && !steps.length && !substrate.busy();
    // Restless characters keep turning on their own; thirty frames a second
    // keeps those turns smooth. A still lattice only needs the weather's ten.
    // A hovered word changes on its own beat too.
    const pace = substrate.restless() || hover.row >= 0 ? 33 : 100;
    if (!idle || now - lastFrame >= pace - 5) frame(now);
    // a frame that asked for another (a row turning renames the section)
    // already has it; a second request here would start a second loop
    if (!running || rafId) return;
    if (!idle) rafId = requestAnimationFrame(tick);
    else if (!reducedMotion) {
      idleTimer = setTimeout(() => {
        idleTimer = 0;
        if (running) rafId = requestAnimationFrame(tick);
      }, pace);
    }
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
    if (idleTimer) clearTimeout(idleTimer);
    rafId = 0;
    idleTimer = 0;
  }

  function requestDraw() {
    activeUntil = performance.now() + 2500;
    if (!metrics || rafId) return;
    if (running) {
      // wake a sleeping loop at once
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = 0;
      rafId = requestAnimationFrame(tick);
      return;
    }
    rafId = requestAnimationFrame((now) => {
      rafId = 0;
      frame(now);
    });
  }

  function applyStyle() {
    renderer.style({ paper: P.paper, ink: P.ink, accent: P.accent, shade: P.shade, body: P.body });
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
      searchCache = new Map();
      cousinCache = new Map();
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
      flapTo = new Uint16Array(n);
      flapToInk = new Float32Array(n);
      flapFrom = new Uint16Array(n);
      flapFromInk = new Float32Array(n);
      flapAt = new Float64Array(n).fill(-1e9);
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
      substrate.setMargin(textLeft);
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
        settle = "text";
        anchor = Math.round(target);
      }
      requestDraw();
    },

    onTurn(callback) {
      onTurn = callback;
    },
    onLand(callback) {
      onLand = callback;
    },
    // the settle scroll is showing dots, or settling them into text
    settling: () => settle !== "text" && !reducedMotion,

    pointerAt(x, y) {
      const { col, row, inside } = pointerCell(x, y);
      cursorCell = inside ? row * cols + col : -1;
      // the cursor mark sits in a cell; the lens follows the pointer exactly
      if (inside && !reducedMotion) {
        substrate.setPointer((x * metrics.dpr - originX) / metrics.cellWd, (y * metrics.dpr) / metrics.cellHd);
      } else {
        substrate.setPointer(null);
      }
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
      const at = pointerCell(x, y);
      if (at.inside && overText(at.row * cols + at.col, Math.floor(shown))) return;
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
    focusLink(linkId, on) {
      if (on) focusedLink = linkId;
      else if (focusedLink === linkId) focusedLink = -1;
      requestDraw();
    },

    setStatus(next) {
      for (const key of ["left", "upper", "right"]) {
        if (next[key] === undefined || next[key] === status[key]) continue;
        relabel[key].was = status[key];
        relabel[key].at = performance.now();
        flapsUntil = Math.max(flapsUntil, relabel[key].at + P.flipMs + 40 * P.flipStagger);
      }
      Object.assign(status, next);
      requestDraw();
    },

    // First contact: the empty board comes up, the name's cells turn one by
    // one, then a ring leaves the name and the rest turns in behind it.
    crystallize(hero, quick = false, hint = null) {
      if (reducedMotion) return;
      substrate.startReveal(performance.now(), hero, quick, hint);
      requestDraw();
    },

    setReducedMotion(v) {
      reducedMotion = v;
      if (v) {
        substrate?.endReveal();
        steps = [];
        settle = "text";
      }
      requestDraw();
    },

    applyParams(next, changed = []) {
      P = next;
      if (changed.includes("scroll")) {
        settle = "text";
        anchor = Math.round(target);
      }
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
        accent: (glyphs[o + 2] & (F_ACCENT_X | F_ACCENT_Y)) !== 0,
        caret: (glyphs[o + 2] & F_CARET) !== 0,
        lattice: (glyphs[o + 2] & F_LATTICE) !== 0,
      };
    },

    stats: () => ({ ...substrate.stats(), glyphs: atlas.size(), renderer: renderer.kind, flipping: steps.length > 0, settle }),
    requestDraw,
    start,
    stop,
    cols: () => cols,
    rows: () => rows,
    // the row the board shows, or is flipping to
    camera: () => (steps.length ? steps[steps.length - 1].to : Math.round(shown)),
    // left edge of the grid in CSS px
    xOffset: () => originX / metrics.dpr,
  };
}
