// The field: a fixed grid of character cells — the only place anything is
// ever painted.
//
// Three things share this grid and never contradict each other:
//
//   the substrate   a living medium of glyphs (substrate.js), warmed by the
//                   cursor, transitioning through the morphospace
//   the document    committed text, poured row to row by scroll position
//   the aperture    vignette, and the small chrome of links and position
//
// Law: nothing moves; cells only change.

import { cousinsFor } from "./glyphs.js";
import { buildGlyphSpace } from "./glyphspace.js";
import { createSubstrate } from "./substrate.js";
import { createPlanes } from "./plane.js";
import { ALPHABETS } from "./params.js";

// cell kinds
export const K_AMBIENT = 0;
export const K_TEXT = 1;
export const K_FAINT = 2;
export const K_LINK = 3;
export const K_HOLE = 4;

const smoothstep = (p) => p * p * (3 - 2 * p);
const REVEAL_STEPS = 7;

export function createField(canvas, params) {
  const context = canvas.getContext("2d", { alpha: false });
  let P = params;

  let space = null;
  let substrate = null;
  let planes = null;

  let metrics = null;
  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let xOffset = 0;
  let camera = 0;
  let frac = 0;
  let worldRows = 0;
  let reducedMotion = false;
  let snap = false;
  let fastUntil = 0;
  let lastRowFloat = 0;

  let worldData = new Map();
  let masks = new Set();
  let vigMap = new Float32Array(0);
  let shelterMap = new Float32Array(0);

  // view-anchored committed content
  let cellChar = new Uint16Array(0);
  let cellKind = new Uint8Array(0);
  let cellLink = new Int16Array(0);
  const textPalette = [" "];
  const textIndex = new Map([[" ", 0]]);
  function textToken(ch) {
    let i = textIndex.get(ch);
    if (i === undefined) {
      i = textPalette.length;
      textPalette.push(ch);
      textIndex.set(ch, i);
    }
    return i;
  }

  // reveal: committed text condensing out of the substrate through the
  // morphospace, staggered so meaning arrives like a wave
  let revealPath = new Int16Array(0);
  let revealLen = new Uint8Array(0);
  let revealStart = new Float32Array(0);
  let revealDur = new Float32Array(0);
  let revealActive = false;

  let overlay = new Map();
  let hud = "";
  let hoveredLink = -1;

  const glitches = new Map();
  let glitchTimer = 0;
  let glitchCells = new Map(); // view index -> {until, token}

  // looping cousin shimmer on hovered words
  let shimmerCells = [];
  let shimmerShown = new Map();
  let shimmerTimer = 0;
  let shimmerKey = "";

  let rafId = 0;
  let running = false;
  let lastFrameAt = 0;

  const worldKey = (row, col) => row * 512 + col;

  // Every read out of the morphospace goes through here. An out-of-range or
  // negative index would otherwise reach fillText as `undefined` and paint
  // that word across the field, which is exactly the bug this guards.
  function glyphAt(index) {
    const ch = space.chars[index];
    return ch === undefined ? " " : ch;
  }

  // ---------- world & view ----------

  function committedAt(worldRow, col, out) {
    const data = worldData.get(worldRow);
    if (data && col < data.chars.length) {
      const token = data.chars[col];
      out.link = data.links[col];
      if (token !== 0 && !(masks.size > 0 && masks.has(worldKey(worldRow, col)))) {
        out.token = token;
        out.kind = data.kinds[col];
        return;
      }
      out.token = 0;
      out.kind = token !== 0 ? K_HOLE : K_AMBIENT;
      return;
    }
    out.token = 0;
    out.kind = K_AMBIENT;
    out.link = -1;
  }

  function kindAlpha(kind) {
    if (kind === K_TEXT || kind === K_LINK) return P.textAlpha;
    if (kind === K_FAINT) return P.faintAlpha;
    return 0;
  }

  function inkAlpha(cell) {
    if (cell.kind === K_FAINT && cell.link !== -1 && cell.link === hoveredLink) return 0.9;
    return kindAlpha(cell.kind);
  }

  function composeView() {
    const n = cols * rows;
    if (cellChar.length !== n) {
      cellChar = new Uint16Array(n);
      cellKind = new Uint8Array(n);
      cellLink = new Int16Array(n);
      shelterMap = new Float32Array(n);
    }
    stopShimmer();
    glitchCells.clear();
    shelterMap.fill(1);
    substrate.setShelter(shelterMap);
    for (let row = 0; row < rows; row += 1) {
      const worldRow = camera + row;
      const data = worldData.get(worldRow);
      const inRange = data && data.chars.length >= cols;
      for (let col = 0; col < cols; col += 1) {
        const i = row * cols + col;
        const token = inRange ? data.chars[col] : 0;
        if (token !== 0 && !(masks.size > 0 && masks.has(worldKey(worldRow, col)))) {
          cellChar[i] = token;
          cellKind[i] = data.kinds[col];
        } else {
          cellChar[i] = 0;
          cellKind[i] = K_AMBIENT;
        }
        cellLink[i] = inRange ? data.links[col] : -1;
      }
    }
    // Reading shelter: the substrate calms in the rows that carry text, so a
    // paragraph never has to compete with its own background. This is a
    // *rate* reduction, not a clearing — the murmur stays present.
    if (P.shelter > 0) {
      for (let row = 0; row < rows; row += 1) {
        let inked = 0;
        for (let col = 0; col < cols; col += 1) {
          if (cellKind[row * cols + col] === K_TEXT || cellKind[row * cols + col] === K_LINK) inked += 1;
        }
        if (inked < 3) continue;
        for (let dr = -1; dr <= 1; dr += 1) {
          const r = row + dr;
          if (r < 0 || r >= rows) continue;
          const factor = 1 - P.shelter * (dr === 0 ? 1 : 0.5);
          for (let col = 0; col < cols; col += 1) {
            const i = r * cols + col;
            if (factor < shelterMap[i]) shelterMap[i] = factor;
          }
        }
      }
    }
  }

  // ---------- the frame ----------

  const cellA = { token: 0, kind: 0, link: -1 };
  const cellB = { token: 0, kind: 0, link: -1 };

  function draw(now) {
    context.fillStyle = P.paper;
    context.fillRect(0, 0, width, height);
    context.font = metrics.font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = P.ink;

    const fast = P.fastSkip && now < fastUntil;
    const ef = fast ? (frac < 0.5 ? 0 : 1) : smoothstep(frac);
    const blending = ef > 0.004 && ef < 0.996;

    for (let row = 0; row < rows; row += 1) {
      let y = row * metrics.cellH + metrics.cellH / 2;
      if (snap) y = Math.round(y);
      const worldA = camera + row;

      for (let col = 0; col < cols; col += 1) {
        const i = row * cols + col;
        let x = xOffset + col * metrics.cellW + metrics.cellW / 2;
        if (snap) x = Math.round(x);

        const over = overlay.get(i);
        if (over) {
          if (over.ch !== " ") {
            context.fillStyle = over.ink;
            context.globalAlpha = 1;
            context.fillText(over.ch, x, y);
            context.fillStyle = P.ink;
          }
          continue;
        }

        const shimmerToken = shimmerShown.get(i);
        if (shimmerToken !== undefined && !blending) {
          context.globalAlpha = kindAlpha(cellKind[i]) || P.textAlpha;
          context.fillText(textPalette[shimmerToken], x, y);
          continue;
        }

        const glitch = glitchCells.get(i);
        if (glitch !== undefined && now < glitch.until && !blending) {
          context.globalAlpha = kindAlpha(cellKind[i]) || P.textAlpha;
          context.fillText(glitch.ch, x, y);
          continue;
        }

        // A media plane covers this cell unless the document has committed
        // text here — a photograph never paints over a word.
        const planeCell = planes && cellChar[i] === 0 ? planes.at(worldA, col) : null;
        if (planeCell) {
          context.globalAlpha = Math.min(1, 0.10 + planeCell.ink * 0.9);
          context.fillText(glyphAt(planeCell.glyph), x, y);
          continue;
        }

        // the pour: committed rows blend by scroll phase
        committedAt(worldA, col, cellA);
        let coverage = 0;
        if (cellA.kind === K_HOLE || cellA.token !== 0) coverage = blending ? 1 - ef : 1;
        if (blending) {
          committedAt(worldA + 1, col, cellB);
          if (cellB.token !== 0 || cellB.kind === K_HOLE) coverage += ef;
        } else {
          cellB.token = 0;
        }

        // the substrate shows wherever the document does not cover it
        if (coverage < 0.996 && substrate) {
          const s = substrate.read(i, now, vigMap[i]);
          const alpha = s.alpha * (1 - coverage);
          if (alpha > 0.006) {
            if (s.b < 0) {
              context.globalAlpha = Math.min(1, alpha);
              context.fillText(glyphAt(s.a), x, y);
            } else {
              // cross-fade only between adjacent hops of the morph walk
              const fromAlpha = alpha * (1 - s.blend);
              const toAlpha = alpha * s.blend;
              if (fromAlpha > 0.006) {
                context.globalAlpha = Math.min(1, fromAlpha);
                context.fillText(glyphAt(s.a), x, y);
              }
              if (toAlpha > 0.006) {
                context.globalAlpha = Math.min(1, toAlpha);
                context.fillText(glyphAt(s.b), x, y);
              }
            }
          }
        }

        if (cellA.token !== 0) {
          const a = inkAlpha(cellA) * (blending ? Math.pow(1 - ef, P.biasOut) : 1);
          if (a > 0.006) {
            context.globalAlpha = Math.min(1, a);
            // during the reveal a letter is still walking in from the murmur
            if (revealActive && revealLen[i] > 0) {
              const t = (now - revealStart[i]) / revealDur[i];
              if (t < 0) {
                context.globalAlpha = Math.min(1, a * 0.25);
                context.fillText(glyphAt(revealPath[i * REVEAL_STEPS]), x, y);
              } else if (t < 1 && revealLen[i] > 1) {
                const segments = revealLen[i] - 1;
                const scaled = t * segments;
                const hop = Math.min(segments - 1, Math.floor(scaled));
                const local = smoothstep(scaled - hop);
                const fade = 0.25 + 0.75 * t;
                context.globalAlpha = Math.min(1, a * fade * (1 - local));
                context.fillText(glyphAt(revealPath[i * REVEAL_STEPS + hop]), x, y);
                context.globalAlpha = Math.min(1, a * fade * local);
                context.fillText(glyphAt(revealPath[i * REVEAL_STEPS + hop + 1]), x, y);
              } else {
                revealLen[i] = 0;
                context.fillText(textPalette[cellA.token], x, y);
              }
            } else {
              context.fillText(textPalette[cellA.token], x, y);
            }
          }
        }
        if (cellB.token !== 0) {
          const a = inkAlpha(cellB) * Math.pow(ef, P.biasIn);
          if (a > 0.006) {
            context.globalAlpha = Math.min(1, a);
            context.fillText(textPalette[cellB.token], x, y);
          }
        }
      }
    }

    drawChrome(ef);
    drawHud();
    context.globalAlpha = 1;
  }

  function chromeRowFor(worldRow, y, alpha) {
    const data = worldData.get(worldRow);
    if (!data || data.links.length < cols || alpha < 0.02) return;
    let col = 0;
    while (col < cols) {
      const id = data.links[col];
      if (id === -1 || data.kinds[col] !== K_LINK ||
          (masks.size > 0 && masks.has(worldKey(worldRow, col)))) {
        col += 1;
        continue;
      }
      let end = col;
      while (end < cols && data.links[end] === id && data.kinds[end] === K_LINK &&
             !(masks.size > 0 && masks.has(worldKey(worldRow, end)))) end += 1;
      context.globalAlpha = alpha * (id === hoveredLink ? 0.85 : 0.25);
      context.fillRect(xOffset + col * metrics.cellW + 1, y, (end - col) * metrics.cellW - 2, 1);
      col = end;
    }
  }

  function drawChrome(ef) {
    context.fillStyle = P.ink;
    for (let row = 0; row < rows; row += 1) {
      const y = row * metrics.cellH + metrics.cellH - 3;
      chromeRowFor(camera + row, y, 1 - ef);
      if (ef > 0.004) chromeRowFor(camera + row + 1, y, ef);
    }
  }

  function drawHud() {
    if (!hud) return;
    context.globalAlpha = P.faintAlpha;
    const row = rows - 2;
    const start = cols - hud.length - 2;
    const y = row * metrics.cellH + metrics.cellH / 2;
    for (let k = 0; k < hud.length; k += 1) {
      if (hud[k] === " ") continue;
      context.fillText(hud[k], xOffset + (start + k) * metrics.cellW + metrics.cellW / 2, y);
    }
  }

  // ---------- the loop ----------

  function tick(now) {
    rafId = 0;
    const minDelta = 1000 / P.fps;
    const dt = now - lastFrameAt;
    if (dt >= minDelta - 1) {
      if (substrate && !reducedMotion) substrate.step(now, Math.min(dt, 120));
      if (planes) { planes.playVisible(camera, rows); planes.update(); }
      lastFrameAt = now;
      draw(now);
    }
    if (running) rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (running || !metrics) return;
    running = true;
    lastFrameAt = performance.now() - 1000;
    rafId = requestAnimationFrame(tick);
    restartGlitchTimer();
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function requestDraw() {
    if (running || !metrics) return;
    if (rafId) return;
    rafId = requestAnimationFrame((now) => {
      rafId = 0;
      draw(now);
    });
  }

  // ---------- shimmer & instability ----------

  function stopShimmer() {
    if (shimmerTimer) window.clearInterval(shimmerTimer);
    shimmerTimer = 0;
    shimmerCells = [];
    shimmerShown.clear();
    shimmerKey = "";
  }

  function startShimmer(indices, key) {
    stopShimmer();
    if (reducedMotion || indices.length === 0) return;
    shimmerCells = indices;
    shimmerKey = key;
    const step = () => {
      for (const i of shimmerCells) {
        const family = cousinsFor(textPalette[cellChar[i]]);
        if (!family) continue;
        shimmerShown.set(i, textToken(family[(Math.random() * family.length) | 0]));
      }
      requestDraw();
    };
    step();
    shimmerTimer = window.setInterval(step, P.shimmerTick);
  }

  function restartGlitchTimer() {
    window.clearInterval(glitchTimer);
    glitchTimer = 0;
    if (!P.glitch) return;
    glitchTimer = window.setInterval(() => {
      if (reducedMotion || glitches.size === 0 || document.visibilityState !== "visible") return;
      const all = [...glitches.values()];
      const g = all[(Math.random() * all.length) | 0];
      const row = g.row - camera;
      if (row < 1 || row >= rows - 1) return;
      const i = row * cols + g.col;
      const family = cousinsFor(textPalette[cellChar[i]]);
      if (!family) return;
      glitchCells.set(i, {
        ch: family[(Math.random() * family.length) | 0],
        until: performance.now() + 420,
      });
      requestDraw();
    }, P.glitchMs);
  }

  // ---------- public API ----------

  return {
    setMetrics(m) { metrics = m; },

    resize(w, h) {
      width = w;
      height = h;
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      snap = ratio === 1;
      canvas.width = Math.ceil(w * ratio);
      canvas.height = Math.ceil(h * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      cols = Math.max(10, Math.floor(w / metrics.cellW));
      rows = Math.max(6, Math.ceil(h / metrics.cellH));
      xOffset = Math.floor((w - cols * metrics.cellW) / 2);

      // The space spans the substrate alphabet AND every printable character
      // the document might use, so a letter of body text can be morphed into
      // from the murmur — the page condenses out of its own background.
      const alphabet = ALPHABETS[P.alphabet] ?? ALPHABETS.latin;
      let printable = "";
      for (let code = 33; code <= 126; code += 1) printable += String.fromCharCode(code);
      // Typographic characters the typesetter emits (rules, dashes, bullets)
      // and any character already committed by the document. Without these,
      // indexOf() returns -1 for them and the morphospace has no landing site.
      const typographic = "·—–—─│┌┐└┘├┤┬┴┼’‘“”…×";
      const committed = textPalette.join("");
      const chars = Array.from(new Set(Array.from(alphabet + printable + typographic + committed)));
      space = buildGlyphSpace(chars, metrics.font, metrics.cellW, metrics.cellH);

      const eligible = [];
      const inAlphabet = new Set(Array.from(alphabet));
      for (let i = 0; i < chars.length; i += 1) if (inAlphabet.has(chars[i])) eligible.push(i);

      if (!planes) planes = createPlanes(space);

      const subParams = { ...P, aspect: metrics.cellH / metrics.cellW };
      if (!substrate) substrate = createSubstrate(space, subParams, eligible);
      else substrate.setEligible(eligible), substrate.setParams(subParams, []);
      substrate.resize(cols, rows);
      revealLen = new Uint8Array(cols * rows);
      revealPath = new Int16Array(cols * rows * REVEAL_STEPS);
      revealStart = new Float32Array(cols * rows);
      revealDur = new Float32Array(cols * rows);

      const n = cols * rows;
      vigMap = new Float32Array(n);
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const dx = ((c + 0.5) / cols) * 2 - 1;
          const dy = ((r + 0.5) / rows) * 2 - 1;
          const excess = Math.max(0, Math.hypot(dx * 0.72, dy) - 0.78) / 0.5;
          vigMap[r * cols + c] = 1 - P.vignette * Math.min(1, excess * excess);
        }
      }

      cellChar = new Uint16Array(0);
      composeView();
      requestDraw();
    },

    setWorld(lines, totalRows) {
      worldData = new Map();
      glitches.clear();
      worldRows = totalRows;
      for (const line of lines) {
        let data = worldData.get(line.row);
        if (!data) {
          data = {
            chars: new Uint16Array(cols),
            kinds: new Uint8Array(cols),
            links: new Int16Array(cols).fill(-1),
          };
          worldData.set(line.row, data);
        }
        for (let k = 0; k < line.text.length; k += 1) {
          const col = line.col + k;
          if (col < 0 || col >= cols) continue;
          const ch = line.text[k];
          if (line.linkId !== undefined && line.linkId >= 0) data.links[col] = line.linkId;
          if (ch === " ") continue;
          data.chars[col] = textToken(ch);
          data.kinds[col] = line.kind;
        }
      }
      composeView();
      requestDraw();
    },

    setScroll(scrollTopPx) {
      const rowFloat = Math.max(0, scrollTopPx / metrics.cellH);
      const delta = Math.abs(rowFloat - lastRowFloat);
      if (delta > 2) fastUntil = performance.now() + 90;
      // scrolling stirs the medium: the document passing through leaves warmth
      if (substrate && P.scrollHeat > 0 && delta > 0.01 && !reducedMotion) {
        const strength = Math.min(1, delta * 0.5) * P.scrollHeat;
        const row = rows - 1;
        for (let c = 0; c < cols; c += 4) substrate.warm(c, row, 0, -1, strength * 0.35);
      }
      lastRowFloat = rowFloat;
      const nextCamera = Math.min(Math.floor(rowFloat), Math.max(0, worldRows - 1));
      frac = Math.min(0.999, Math.max(0, rowFloat - nextCamera));
      if (nextCamera !== camera) {
        camera = nextCamera;
        composeView();
      }
      requestDraw();
    },

    // The cursor warms the medium along its whole path, so a fast sweep
    // leaves a continuous wake rather than a dotted line.
    touch(x, y, px, py, dt) {
      if (!substrate || reducedMotion) return;
      const col = (x - xOffset) / metrics.cellW;
      const row = y / metrics.cellH;
      const pcol = (px - xOffset) / metrics.cellW;
      const prow = py / metrics.cellH;
      const dx = col - pcol;
      const dy = row - prow;
      const distance = Math.hypot(dx, dy);
      const speed = dt > 0 ? distance / (dt / 16.67) : 0;
      const steps = Math.min(12, Math.max(1, Math.ceil(distance / 1.2)));
      const vx = distance > 0.001 ? dx / distance : 0;
      const vy = distance > 0.001 ? dy / distance : 0;
      const push = Math.min(1.6, 0.35 + speed * 0.4);
      for (let s = 1; s <= steps; s += 1) {
        const t = s / steps;
        substrate.warm(pcol + dx * t, prow + dy * t, vx * push, vy * push, 1 / steps + 0.08);
      }
      requestDraw();
    },

    strike(x, y) {
      if (!substrate || reducedMotion) return;
      const col = Math.round((x - xOffset) / metrics.cellW);
      const row = Math.round(y / metrics.cellH);
      substrate.impulse(col, row, P.clickStrength);
      substrate.warm(col, row, 0, 0, 1.4);
      requestDraw();
    },

    hoverLink(linkId, on) {
      hoveredLink = on ? linkId : -1;
      if (on) {
        const indices = [];
        for (let i = 0; i < cellLink.length; i += 1) {
          if (cellLink[i] === linkId && cellChar[i] !== 0 && cellKind[i] === K_LINK) indices.push(i);
        }
        startShimmer(indices, "link:" + linkId);
      } else {
        stopShimmer();
      }
      requestDraw();
    },

    shimmerWordAt(x, y) {
      if (hoveredLink !== -1 || reducedMotion) return;
      const col = Math.floor((x - xOffset) / metrics.cellW);
      const row = Math.floor(y / metrics.cellH);
      if (row < 0 || row >= rows || col < 0 || col >= cols) {
        if (shimmerKey.startsWith("word:")) stopShimmer();
        return;
      }
      const i = row * cols + col;
      if (cellKind[i] !== K_TEXT || cellChar[i] === 0) {
        if (shimmerKey.startsWith("word:")) {
          stopShimmer();
          requestDraw();
        }
        return;
      }
      let from = col;
      while (from > 0 && cellKind[row * cols + from - 1] === K_TEXT &&
             cellChar[row * cols + from - 1] !== 0) from -= 1;
      let to = col;
      while (to < cols - 1 && cellKind[row * cols + to + 1] === K_TEXT &&
             cellChar[row * cols + to + 1] !== 0) to += 1;
      const key = "word:" + row + ":" + from + ":" + to;
      if (key === shimmerKey) return;
      const indices = [];
      for (let c = from; c <= to; c += 1) indices.push(row * cols + c);
      startShimmer(indices, key);
      requestDraw();
    },

    registerGlitches(cells) {
      glitches.clear();
      for (const cell of cells) glitches.set(cell.row + ":" + cell.col, cell);
    },

    setOverlayCells(cells) {
      overlay.clear();
      for (const cell of cells) {
        if (cell.row < 0 || cell.row >= rows || cell.col < 0 || cell.col >= cols) continue;
        overlay.set(cell.row * cols + cell.col, { ch: cell.ch, ink: cell.ink ?? P.ink });
      }
      requestDraw();
    },

    setHud(text) {
      if (text === hud) return;
      hud = text;
      requestDraw();
    },

    // First contact: every letter walks in from the murmur through the
    // morphospace, staggered by distance from the centre so meaning arrives
    // as an expanding wave rather than a curtain.
    crystallize() {
      if (reducedMotion || !space) return;
      const now = performance.now();
      const cx = cols / 2;
      const cy = rows * 0.42;
      const aspect = metrics.cellH / metrics.cellW;
      revealActive = true;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const i = row * cols + col;
          if (cellChar[i] === 0) continue;
          const target = space.indexOf(textPalette[cellChar[i]]);
          if (target < 0) continue;
          const seed = space.byDensity[(Math.random() * Math.min(10, space.size)) | 0];
          const sequence = space.morph(seed, target, REVEAL_STEPS - 1);
          const len = Math.min(REVEAL_STEPS, sequence.length);
          for (let s = 0; s < len; s += 1) revealPath[i * REVEAL_STEPS + s] = sequence[s];
          revealLen[i] = len;
          const dx = (col - cx) / aspect;
          const dy = row - cy;
          revealStart[i] = now + 120 + Math.hypot(dx, dy) * 11 + Math.random() * 90;
          revealDur[i] = 520 + Math.random() * 380;
        }
      }
      window.setTimeout(() => { revealActive = false; }, 4200);
      requestDraw();
    },

    setReducedMotion(v) {
      reducedMotion = v;
      if (v) {
        stopShimmer();
        stop();
        requestDraw();
      } else {
        start();
      }
    },

    applyParams(next, changed) {
      P = next;
      const touched = changed ?? Object.keys(next);
      if (substrate) substrate.setParams({ ...P, aspect: metrics.cellH / metrics.cellW }, touched);
      if (touched.includes("vignette") && cols > 0) {
        for (let r = 0; r < rows; r += 1) {
          for (let c = 0; c < cols; c += 1) {
            const dx = ((c + 0.5) / cols) * 2 - 1;
            const dy = ((r + 0.5) / rows) * 2 - 1;
            const excess = Math.max(0, Math.hypot(dx * 0.72, dy) - 0.78) / 0.5;
            vigMap[r * cols + c] = 1 - P.vignette * Math.min(1, excess * excess);
          }
        }
      }
      if (touched.includes("shelter")) composeView();
      if (touched.includes("glitch") || touched.includes("glitchMs")) restartGlitchTimer();
      if (touched.includes("shimmerTick") && shimmerTimer) startShimmer(shimmerCells, shimmerKey);
      requestDraw();
    },

    // Synchronous render at an explicit timestamp — deterministic frames for
    // the workbench and for tests, independent of the animation clock.
    renderAt(now, dt = 1000 / P.fps) {
      if (substrate) substrate.step(now, dt);
      draw(now);
    },

    collectPlanes(article) { return planes ? planes.collect(article) : []; },
    placePlane(el, worldRow, col, c, r) { if (planes) planes.place(el, worldRow, col, c, r); },
    planeCount: () => (planes ? planes.count() : 0),
    requestDraw,
    start,
    stop,
    stats: () => (substrate ? substrate.stats() : null),
    glyphCount: () => (space ? space.size : 0),
    cols: () => cols,
    rows: () => rows,
    camera: () => camera,
    worldRows: () => worldRows,
    xOffset: () => xOffset,
  };
}
