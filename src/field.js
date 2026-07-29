// The field: a fixed grid of character cells — the only place anything is
// ever painted. One fabric of glyphs, anchored to the document, rolls
// through the viewport aperture. No pixel ever moves: each cell blends
// between the glyph it holds and the glyph arriving from the next row,
// with the blend phase tied directly to scroll position.
//
// Transitions never scramble. Matter here condenses and dissolves along an
// ink-density ramp (· : + letter); typographic shimmer uses a glyph's own
// cousins. Law: cells change, nothing moves.

import { AMBIENT, RAMP, cousinsFor } from "./glyphs.js";

const INK = "#161616";
const ALPHA_TEXT = 1.0;
const ALPHA_FAINT = 0.42;
const ALPHA_AMBIENT = 0.07;
const ALPHA_UNDERLINE = 0.25;
const ALPHA_UNDERLINE_HOT = 0.85;

const TRACE_DURATION = 180;
const TRACE_STEP = 60;

// cell kinds
export const K_AMBIENT = 0;
export const K_TEXT = 1;
export const K_FAINT = 2;
export const K_LINK = 3;
export const K_HOLE = 4;

const KIND_ALPHA = [ALPHA_AMBIENT, ALPHA_TEXT, ALPHA_FAINT, ALPHA_TEXT, 0];

// trace modes
const T_CONDENSE = 0;
const T_COUSIN = 1;
const T_SHIMMER = 2;

export function createField(canvas) {
  const context = canvas.getContext("2d", { alpha: false });

  const palette = [" "];
  const paletteIndex = new Map([[" ", 0]]);
  function tokenOf(ch) {
    let i = paletteIndex.get(ch);
    if (i === undefined) {
      i = palette.length;
      palette.push(ch);
      paletteIndex.set(ch, i);
    }
    return i;
  }
  const ambientTokens = Array.from(AMBIENT, tokenOf);
  const rampTokens = Array.from(RAMP, tokenOf);

  const randomPool = new Uint32Array(512);
  let randomAt = randomPool.length;
  function rnd() {
    if (randomAt >= randomPool.length) {
      crypto.getRandomValues(randomPool);
      randomAt = 0;
    }
    return randomPool[randomAt++];
  }

  let metrics = null;
  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let xOffset = 0;
  let camera = 0; // integer world row of the top view row
  let frac = 0; // sub-row scroll phase in [0, 1)
  let worldRows = 0;
  let reducedMotion = false;
  let lastScrollAt = 0;

  // dense per-world-row buffers (only rows that hold content)
  let worldData = new Map(); // row -> {chars, kinds, links}
  let haloRows = []; // row -> Float32Array | undefined
  const mutations = new Map(); // worldRow * 512 + col -> ambient token
  const mutationOrder = [];

  let masks = new Set(); // worldRow * 512 + col

  // view-anchored buffers for the current integer camera
  let cellChar = new Uint16Array(0);
  let cellKind = new Uint8Array(0);
  let cellLink = new Int16Array(0);

  // idle-time transformation traces (view-anchored; cancelled by scroll)
  let tStart = new Float64Array(0);
  let tFrom = new Uint16Array(0);
  let tFromAlpha = new Float32Array(0);
  let tSeed = new Uint32Array(0);
  let tMode = new Uint8Array(0);

  let overlay = new Map(); // view index -> {ch, ink}
  let hud = "";
  let hoveredLink = -1;

  let pointerCells = [];
  let pointerTokens = new Map();
  let pointerTimer = 0;
  let lastPointerCell = -1;

  const glitches = new Map(); // "row:col" -> {row, col}

  let frame = 0;
  let ambientTimer = 0;
  let glitchTimer = 0;
  let breathTimer = 0;

  const maskKey = (row, col) => row * 512 + col;

  function ambientTokenAt(worldRow, col) {
    const m = mutations.get(maskKey(worldRow, col));
    if (m !== undefined) return m;
    let h = Math.imul(worldRow + 1, 2654435761) ^ Math.imul(col + 1, 40503);
    h ^= h >>> 13;
    return ambientTokens[(h >>> 0) % ambientTokens.length];
  }

  function ambientAlphaAt(worldRow, col, now) {
    const halo = haloRows[worldRow] ? haloRows[worldRow][col] : 0;
    let a = ALPHA_AMBIENT * (1 + halo);
    if (!reducedMotion) {
      a *= 0.8 + 0.2 * Math.sin(now * 0.00042 + worldRow * 0.31 + col * 0.11);
    }
    return a;
  }

  function vignette(row) {
    if (row === 0 || row === rows - 1) return 0.5;
    if (row === 1 || row === rows - 2) return 0.82;
    return 1;
  }

  // resolve what a world cell holds: [token, alpha, linkId, isHole]
  function resolveWorld(worldRow, col, now, out) {
    const data = worldData.get(worldRow);
    if (data && col < data.chars.length) {
      const token = data.chars[col];
      if (token !== 0) {
        if (masks.size > 0 && masks.has(maskKey(worldRow, col))) {
          out.token = 0;
          out.alpha = 0;
          out.link = -1;
          return;
        }
        out.token = token;
        out.alpha = KIND_ALPHA[data.kinds[col]];
        out.link = data.links[col];
        return;
      }
      out.link = data.links[col]; // spaces inside links keep the underline
    } else {
      out.link = -1;
    }
    out.token = ambientTokenAt(worldRow, col);
    out.alpha = ambientAlphaAt(worldRow, col, now);
  }

  function composeView() {
    const n = cols * rows;
    if (cellChar.length !== n) {
      cellChar = new Uint16Array(n);
      cellKind = new Uint8Array(n);
      cellLink = new Int16Array(n).fill(-1);
      tStart = new Float64Array(n);
      tFrom = new Uint16Array(n);
      tFromAlpha = new Float32Array(n);
      tSeed = new Uint32Array(n);
      tMode = new Uint8Array(n);
    } else {
      tStart.fill(0); // scroll cancels idle shimmer
    }
    for (let row = 0; row < rows; row += 1) {
      const worldRow = camera + row;
      const data = worldData.get(worldRow);
      const inRange = data && data.chars.length >= cols;
      for (let col = 0; col < cols; col += 1) {
        const i = row * cols + col;
        const token = inRange ? data.chars[col] : 0;
        if (token !== 0 && !(masks.size > 0 && masks.has(maskKey(worldRow, col)))) {
          cellChar[i] = token;
          cellKind[i] = data.kinds[col];
          cellLink[i] = data.links[col];
        } else {
          cellChar[i] = ambientTokenAt(worldRow, col);
          cellKind[i] = K_AMBIENT;
          cellLink[i] = inRange ? data.links[col] : -1;
        }
      }
    }
  }

  const cellA = { token: 0, alpha: 0, link: -1 };
  const cellB = { token: 0, alpha: 0, link: -1 };

  function draw() {
    frame = 0;
    const now = performance.now();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.font = metrics.font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = INK;

    const ef = frac * frac * (3 - 2 * frac); // smoothstep blend phase
    const blending = ef > 0.004;
    let active = false;

    for (let row = 0; row < rows; row += 1) {
      const y = row * metrics.cellH + metrics.cellH / 2;
      const vig = vignette(row);
      const worldA = camera + row;

      for (let col = 0; col < cols; col += 1) {
        const i = row * cols + col;
        const x = xOffset + col * metrics.cellW + metrics.cellW / 2;

        const over = overlay.get(i);
        if (over) {
          if (over.ch !== " ") {
            context.fillStyle = over.ink;
            context.globalAlpha = 1;
            context.fillText(over.ch, x, y);
            context.fillStyle = INK;
          }
          continue;
        }

        if (pointerTokens.has(i)) {
          context.globalAlpha = 0.32 * vig;
          context.fillText(palette[pointerTokens.get(i)], x, y);
          continue;
        }

        // idle transformation traces (never during the roll)
        if (!blending && tStart[i] !== 0) {
          const elapsed = now - tStart[i];
          if (elapsed >= TRACE_DURATION) {
            tStart[i] = 0;
          } else {
            active = true;
            const target = cellChar[i];
            const targetAlpha = KIND_ALPHA[cellKind[i]] ||
              ambientAlphaAt(worldA, col, now);
            let token = target;
            let alpha = targetAlpha;
            if (elapsed < 0) {
              token = tFrom[i];
              alpha = tFromAlpha[i];
            } else {
              const stage = Math.floor(elapsed / TRACE_STEP);
              if (tMode[i] === T_CONDENSE) {
                token = rampTokens[Math.min(stage, rampTokens.length - 1)];
                alpha = 0.3 + 0.25 * stage;
              } else if (tMode[i] === T_COUSIN) {
                const family = cousinsFor(palette[target]);
                if (family && stage < 2) {
                  token = tokenOf(family[(tSeed[i] + stage) % family.length]);
                  alpha = targetAlpha;
                }
              } else if (tMode[i] === T_SHIMMER) {
                token = rampTokens[stage === 1 ? 0 : 1];
                alpha = 0.3;
              }
            }
            if (token !== 0 && alpha > 0.015) {
              context.globalAlpha = Math.min(1, alpha) * vig;
              context.fillText(palette[token], x, y);
            }
            continue;
          }
        }

        // the roll: blend this world row with the one arriving beneath it
        resolveWorld(worldA, col, now, cellA);
        if (cellA.token !== 0) {
          const a = cellA.alpha * (blending ? 1 - ef : 1) * vig;
          if (a > 0.015) {
            context.globalAlpha = Math.min(1, a);
            context.fillText(palette[cellA.token], x, y);
          }
        }
        if (blending) {
          resolveWorld(worldA + 1, col, now, cellB);
          if (cellB.token !== 0) {
            const a = cellB.alpha * ef * vig;
            if (a > 0.015) {
              context.globalAlpha = Math.min(1, a);
              context.fillText(palette[cellB.token], x, y);
            }
          }
        }
      }
    }

    drawUnderlines(ef);
    drawHud();
    context.globalAlpha = 1;

    if (active || now - lastScrollAt < 220) scheduleDraw();
  }

  function underlineRunsFor(worldRow, y, alpha) {
    const data = worldData.get(worldRow);
    if (!data || data.links.length < cols || alpha < 0.02) return;
    let col = 0;
    while (col < cols) {
      const id = data.links[col];
      if (id === -1 || (masks.size > 0 && masks.has(maskKey(worldRow, col)))) {
        col += 1;
        continue;
      }
      let end = col;
      while (end < cols && data.links[end] === id &&
             !(masks.size > 0 && masks.has(maskKey(worldRow, end)))) end += 1;
      context.globalAlpha = alpha * (id === hoveredLink ? ALPHA_UNDERLINE_HOT : ALPHA_UNDERLINE);
      context.fillRect(xOffset + col * metrics.cellW + 1, y, (end - col) * metrics.cellW - 2, 1);
      col = end;
    }
  }

  function drawUnderlines(ef) {
    context.fillStyle = INK;
    for (let row = 0; row < rows; row += 1) {
      const y = row * metrics.cellH + metrics.cellH - 3;
      underlineRunsFor(camera + row, y, 1 - ef);
      if (ef > 0.004) underlineRunsFor(camera + row + 1, y, ef);
    }
  }

  function drawHud() {
    if (!hud) return;
    context.globalAlpha = ALPHA_FAINT;
    const row = rows - 2;
    const start = cols - hud.length - 2;
    const y = row * metrics.cellH + metrics.cellH / 2;
    for (let k = 0; k < hud.length; k += 1) {
      const ch = hud[k];
      if (ch === " ") continue;
      context.fillText(ch, xOffset + (start + k) * metrics.cellW + metrics.cellW / 2, y);
    }
  }

  function scheduleDraw() {
    if (frame !== 0) return;
    frame = requestAnimationFrame(draw);
  }

  function mutateAmbient() {
    if (document.visibilityState !== "visible" || reducedMotion || rows === 0) return;
    const row = camera + (rnd() % rows);
    const col = rnd() % cols;
    const data = worldData.get(row);
    if (data && data.chars[col] !== 0) return;
    const key = maskKey(row, col);
    mutations.set(key, ambientTokens[rnd() % ambientTokens.length]);
    mutationOrder.push(key);
    if (mutationOrder.length > 600) mutations.delete(mutationOrder.shift());
    scheduleDraw();
  }

  function flickerGlitch() {
    if (reducedMotion || glitches.size === 0 || document.visibilityState !== "visible") return;
    const all = [...glitches.values()];
    const g = all[rnd() % all.length];
    const row = g.row - camera;
    if (row < 1 || row >= rows - 1) return;
    startTrace(row * cols + g.col, T_COUSIN, 0);
    scheduleDraw();
  }

  function startTrace(i, mode, delay) {
    if (reducedMotion) return;
    tStart[i] = performance.now() + delay;
    tFrom[i] = cellChar[i];
    tFromAlpha[i] = KIND_ALPHA[cellKind[i]] || ALPHA_AMBIENT;
    tSeed[i] = rnd();
    tMode[i] = mode;
  }

  return {
    setMetrics(m) { metrics = m; },

    resize(w, h) {
      width = w;
      height = h;
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.ceil(w * ratio);
      canvas.height = Math.ceil(h * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      cols = Math.max(10, Math.floor(w / metrics.cellW));
      rows = Math.max(6, Math.ceil(h / metrics.cellH));
      xOffset = Math.floor((w - cols * metrics.cellW) / 2);
      cellChar = new Uint16Array(0); // force realloc on next compose
      composeView();
      scheduleDraw();
    },

    setWorld(lines, totalRows) {
      worldData = new Map();
      haloRows = new Array(totalRows);
      glitches.clear();
      mutations.clear();
      mutationOrder.length = 0;
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
          data.chars[col] = tokenOf(ch);
          data.kinds[col] = line.kind;

          // the field thickens toward meaning: splat a halo around content
          if (line.kind === K_TEXT || line.kind === K_LINK) {
            for (let dr = -2; dr <= 2; dr += 1) {
              const hr = line.row + dr;
              if (hr < 0 || hr >= totalRows) continue;
              let halo = haloRows[hr];
              if (!halo) halo = haloRows[hr] = new Float32Array(cols);
              for (let dc = -3; dc <= 3; dc += 1) {
                const hc = col + dc;
                if (hc < 0 || hc >= cols) continue;
                const w = 1 - (Math.abs(dr) / 3 + Math.abs(dc) / 4) / 2;
                if (w > 0) halo[hc] = Math.min(1.3, halo[hc] + w * 0.28);
              }
            }
          }
        }
      }
      composeView();
      scheduleDraw();
    },

    // scroll position in pixels drives the roll phase directly
    setScroll(scrollTopPx) {
      const rowFloat = Math.max(0, scrollTopPx / metrics.cellH);
      const nextCamera = Math.min(Math.floor(rowFloat), Math.max(0, worldRows - 1));
      frac = Math.min(0.999, Math.max(0, rowFloat - nextCamera));
      lastScrollAt = performance.now();
      if (nextCamera !== camera) {
        camera = nextCamera;
        composeView();
      }
      scheduleDraw();
    },

    crystallize() {
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const i = row * cols + col;
          if (cellKind[i] === K_AMBIENT) continue;
          startTrace(i, T_CONDENSE, row * 16 + col * 1.4);
          tFrom[i] = 0; // condense out of nothing
          tFromAlpha[i] = 0;
        }
      }
      scheduleDraw();
    },

    pulse(x, y) {
      const col = Math.floor((x - xOffset) / metrics.cellW);
      const row = Math.floor(y / metrics.cellH);
      if (row < 0 || row >= rows || col < 0 || col >= cols) return;
      const center = row * cols + col;
      if (center === lastPointerCell) return;
      lastPointerCell = center;
      window.clearTimeout(pointerTimer);
      for (const i of pointerCells) pointerTokens.delete(i);
      pointerCells = [];
      if (!reducedMotion) {
        const spread = rnd() % 2 === 0 ? [[0, 0], [0, -1], [0, 1]] : [[0, 0], [-1, 0], [1, 0]];
        for (const [dr, dc] of spread) {
          const r = row + dr;
          const c = col + dc;
          if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
          const i = r * cols + c;
          if (cellKind[i] !== K_AMBIENT || overlay.has(i)) continue;
          pointerTokens.set(i, rampTokens[rnd() % rampTokens.length]);
          pointerCells.push(i);
        }
      }
      pointerTimer = window.setTimeout(() => {
        for (const i of pointerCells) pointerTokens.delete(i);
        pointerCells = [];
        lastPointerCell = -1;
        scheduleDraw();
      }, 140);
      scheduleDraw();
    },

    rippleAt(x, y) {
      if (reducedMotion) return;
      const originCol = (x - xOffset) / metrics.cellW;
      const originRow = y / metrics.cellH;
      const aspect = metrics.cellH / metrics.cellW;
      const now = performance.now();
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const dc = (col + 0.5 - originCol) / aspect;
          const dr = row + 0.5 - originRow;
          const dist = Math.sqrt(dc * dc + dr * dr);
          if (dist > 7) continue;
          const i = row * cols + col;
          if (tStart[i] !== 0 && now - tStart[i] < TRACE_DURATION) continue;
          startTrace(i, T_SHIMMER, dist * 36);
        }
      }
      scheduleDraw();
    },

    hoverLink(linkId, on) {
      hoveredLink = on ? linkId : -1;
      if (on && !reducedMotion) {
        let k = 0;
        for (let i = 0; i < cellLink.length; i += 1) {
          if (cellLink[i] !== linkId || cellKind[i] === K_AMBIENT) continue;
          startTrace(i, T_COUSIN, k * 18);
          k += 1;
        }
      }
      scheduleDraw();
    },

    registerGlitches(cells) {
      glitches.clear();
      for (const cell of cells) glitches.set(cell.row + ":" + cell.col, cell);
    },

    visibleGlitches() {
      const out = [];
      for (const g of glitches.values()) {
        const row = g.row - camera;
        if (row >= 1 && row < rows - 1) out.push({ col: g.col, row, worldRow: g.row });
      }
      return out;
    },

    repairGlitch(worldRow, col) {
      glitches.delete(worldRow + ":" + col);
      const row = worldRow - camera;
      if (row < 0 || row >= rows) return;
      startTrace(row * cols + col, T_COUSIN, 0);
      scheduleDraw();
    },

    setOverlayCells(cells) {
      overlay.clear();
      for (const cell of cells) {
        if (cell.row < 0 || cell.row >= rows || cell.col < 0 || cell.col >= cols) continue;
        overlay.set(cell.row * cols + cell.col, { ch: cell.ch, ink: cell.ink ?? INK });
      }
      scheduleDraw();
    },

    setMasks(cells, restoreAnimate = false) {
      const previous = masks;
      masks = new Set();
      if (cells) {
        for (const cell of cells) masks.add(maskKey(cell.worldRow, cell.col));
      }
      composeView();
      if (!cells && restoreAnimate && previous.size > 0) {
        for (const key of previous) {
          const worldRow = Math.floor(key / 512);
          const col = key % 512;
          const row = worldRow - camera;
          if (row < 0 || row >= rows) continue;
          const i = row * cols + col;
          startTrace(i, T_CONDENSE, rnd() % 500);
          tFrom[i] = 0;
          tFromAlpha[i] = 0;
        }
      }
      scheduleDraw();
    },

    setHud(text) {
      if (text === hud) return;
      hud = text;
      scheduleDraw();
    },

    committedCellsInWorldRows(fromRow, toRow) {
      const out = [];
      for (let worldRow = fromRow; worldRow <= toRow; worldRow += 1) {
        const data = worldData.get(worldRow);
        if (!data) continue;
        for (let col = 0; col < cols; col += 1) {
          if (data.chars[col] === 0) continue;
          out.push({
            worldRow,
            col,
            ch: palette[data.chars[col]],
            faint: data.kinds[col] === K_FAINT,
          });
        }
      }
      return out;
    },

    setReducedMotion(v) { reducedMotion = v; },
    requestDraw: scheduleDraw,
    cols: () => cols,
    rows: () => rows,
    camera: () => camera,
    worldRows: () => worldRows,
    xOffset: () => xOffset,

    start() {
      window.clearInterval(ambientTimer);
      window.clearInterval(glitchTimer);
      window.clearInterval(breathTimer);
      ambientTimer = window.setInterval(mutateAmbient, 420);
      glitchTimer = window.setInterval(flickerGlitch, 1900);
      breathTimer = window.setInterval(() => {
        if (document.visibilityState === "visible" && !reducedMotion) scheduleDraw();
      }, 170);
    },
  };
}
