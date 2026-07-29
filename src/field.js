// The field: a screen-fixed grid of character cells and the single place
// anything is ever painted. World content, ambient murmur, transitions,
// pointer disturbances, entities — all of it resolves to cell states here.
//
// Law: cells change; nothing moves.

import { AMBIENT, SCRAMBLE, cousinsFor } from "./glyphs.js";

const INK = "#161616";
const INK_FAINT = "rgba(22, 22, 22, 0.40)";
const INK_AMBIENT = "rgba(22, 22, 22, 0.055)";
const INK_TRACE_MID = "rgba(22, 22, 22, 0.30)";
const INK_TRACE_LOW = "rgba(22, 22, 22, 0.10)";
const UNDERLINE = "rgba(22, 22, 22, 0.22)";
const UNDERLINE_HOT = "rgba(22, 22, 22, 0.85)";

const TRACE_DURATION = 140;
const TRACE_STEP = 28;

// cell kinds
export const K_AMBIENT = 0;
export const K_TEXT = 1;
export const K_FAINT = 2;
export const K_LINK = 3;
export const K_HOLE = 4;

// trace modes
const T_TRANSITION = 0;
const T_SHIMMER = 1;
const T_COUSIN = 2;

const KIND_INK = [INK_AMBIENT, INK, INK_FAINT, INK, INK];

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
  const scrambleTokens = Array.from(SCRAMBLE, tokenOf);

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
  let camera = 0;
  let worldRows = 0;
  let world = new Map(); // row -> [{col, chars, kind, linkId}]
  let reducedMotion = false;

  let ambient = new Uint16Array(0);
  let cellChar = new Uint16Array(0);
  let cellKind = new Uint8Array(0);
  let cellLink = new Int16Array(0);
  let tStart = new Float64Array(0);
  let tFrom = new Uint16Array(0);
  let tFromKind = new Uint8Array(0);
  let tSeed = new Uint32Array(0);
  let tMode = new Uint8Array(0);

  let overlay = new Map(); // screenIndex -> {ch, ink}
  let masks = new Set(); // "worldRow:col"
  let hud = "";
  let hoveredLink = -1;

  let pointerCells = [];
  let pointerTokens = new Map();
  let pointerTimer = 0;
  let lastPointerCell = -1;

  const glitches = new Map(); // "row:col" -> {row, col}
  let glitchTimer = 0;

  let frame = 0;
  let ambientTimer = 0;

  function index(row, col) {
    return row * cols + col;
  }

  function alloc() {
    const n = cols * rows;
    ambient = new Uint16Array(n);
    cellChar = new Uint16Array(n);
    cellKind = new Uint8Array(n);
    cellLink = new Int16Array(n).fill(-1);
    tStart = new Float64Array(n);
    tFrom = new Uint16Array(n);
    tFromKind = new Uint8Array(n);
    tSeed = new Uint32Array(n);
    tMode = new Uint8Array(n);
    overlay = new Map();
    pointerCells = [];
    pointerTokens = new Map();
    lastPointerCell = -1;
    for (let i = 0; i < n; i += 1) {
      ambient[i] = ambientTokens[rnd() % ambientTokens.length];
    }
  }

  function compose(animate, delayPerRow = 4) {
    const now = performance.now();
    for (let row = 0; row < rows; row += 1) {
      const worldRow = camera + row;
      const segments = world.get(worldRow);
      const base = row * cols;

      for (let col = 0; col < cols; col += 1) {
        const i = base + col;
        commitCell(i, ambient[i], K_AMBIENT, -1, animate, now, row * delayPerRow);
      }
      if (!segments) continue;

      for (const segment of segments) {
        const chars = segment.chars;
        for (let k = 0; k < chars.length; k += 1) {
          const col = segment.col + k;
          if (col < 0 || col >= cols) continue;
          const i = base + col;
          const ch = chars[k];
          const masked = masks.size > 0 && masks.has(worldRow + ":" + col);
          if (masked) {
            commitCell(i, 0, K_HOLE, segment.linkId, animate, now, row * delayPerRow);
          } else if (ch === " ") {
            commitCell(i, ambient[i], K_AMBIENT, segment.linkId, animate, now, row * delayPerRow);
          } else {
            commitCell(i, tokenOf(ch), segment.kind, segment.linkId, animate, now, row * delayPerRow);
          }
        }
      }
    }
    scheduleDraw();
  }

  function commitCell(i, token, kind, linkId, animate, now, delay) {
    const prevToken = cellChar[i];
    const prevKind = cellKind[i];
    if (animate && !reducedMotion &&
        (prevKind !== K_AMBIENT || kind !== K_AMBIENT) &&
        (prevKind !== kind || prevToken !== token)) {
      tStart[i] = now + delay;
      tFrom[i] = prevToken;
      tFromKind[i] = prevKind;
      tSeed[i] = rnd();
      tMode[i] = T_TRANSITION;
    } else if (!animate) {
      tStart[i] = 0;
    }
    cellChar[i] = token;
    cellKind[i] = kind;
    cellLink[i] = linkId;
  }

  function draw() {
    frame = 0;
    const now = performance.now();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.font = metrics.font;
    context.textAlign = "center";
    context.textBaseline = "middle";

    let active = false;

    for (let row = 0; row < rows; row += 1) {
      const y = row * metrics.cellH + metrics.cellH / 2;
      for (let col = 0; col < cols; col += 1) {
        const i = row * cols + col;
        let token = cellChar[i];
        let ink = KIND_INK[cellKind[i]];

        const over = overlay.get(i);
        if (over) {
          if (over.ch !== " ") {
            context.fillStyle = over.ink;
            context.fillText(over.ch, xOffset + col * metrics.cellW + metrics.cellW / 2, y);
          }
          continue;
        }

        if (pointerTokens.has(i)) {
          token = pointerTokens.get(i);
          ink = INK_TRACE_MID;
        } else if (tStart[i] !== 0) {
          const elapsed = now - tStart[i];
          if (elapsed < 0) {
            // trace scheduled but not begun: hold the previous state
            active = true;
            token = tFrom[i];
            ink = KIND_INK[tFromKind[i]];
          } else if (elapsed < TRACE_DURATION) {
            active = true;
            const stage = Math.floor(elapsed / TRACE_STEP);
            if (stage === 0 && tMode[i] !== T_SHIMMER) {
              token = tFrom[i];
              ink = tFromKind[i] === K_AMBIENT ? INK_TRACE_LOW : KIND_INK[tFromKind[i]];
            } else if (stage < 3) {
              if (tMode[i] === T_COUSIN) {
                const family = cousinsFor(palette[cellChar[i]]);
                if (family) {
                  token = tokenOf(family[(tSeed[i] + stage) % family.length]);
                  ink = INK;
                } else {
                  token = scrambleTokens[(tSeed[i] + stage * 17) % scrambleTokens.length];
                  ink = INK_TRACE_MID;
                }
              } else {
                token = scrambleTokens[(tSeed[i] + stage * 17) % scrambleTokens.length];
                if (cellKind[i] !== K_AMBIENT) {
                  ink = INK_TRACE_MID;
                } else {
                  ink = stage === 1 ? INK_TRACE_MID : INK_TRACE_LOW;
                }
              }
            }
          } else {
            tStart[i] = 0;
          }
        }

        if (token === 0) continue; // space or hole
        context.fillStyle = ink;
        context.fillText(palette[token], xOffset + col * metrics.cellW + metrics.cellW / 2, y);
      }
    }

    drawUnderlines();
    drawHud();

    if (active) scheduleDraw();
  }

  function drawUnderlines() {
    for (let row = 0; row < rows; row += 1) {
      const y = row * metrics.cellH + metrics.cellH - 3;
      let col = 0;
      while (col < cols) {
        const i = row * cols + col;
        const id = cellLink[i];
        if (id === -1 || cellKind[i] === K_HOLE) {
          col += 1;
          continue;
        }
        let end = col;
        while (end < cols && cellLink[row * cols + end] === id &&
               cellKind[row * cols + end] !== K_HOLE) end += 1;
        context.fillStyle = id === hoveredLink ? UNDERLINE_HOT : UNDERLINE;
        context.fillRect(xOffset + col * metrics.cellW + 1, y, (end - col) * metrics.cellW - 2, 1);
        col = end;
      }
    }
  }

  function drawHud() {
    if (!hud) return;
    context.fillStyle = INK_FAINT;
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
    if (document.visibilityState !== "visible" || ambient.length === 0 || reducedMotion) return;
    const i = rnd() % ambient.length;
    if (cellKind[i] !== K_AMBIENT || overlay.has(i) || tStart[i] !== 0) return;
    let next = ambientTokens[rnd() % ambientTokens.length];
    if (next === ambient[i]) next = ambientTokens[rnd() % ambientTokens.length];
    ambient[i] = next;
    cellChar[i] = next;
    scheduleDraw();
  }

  function flickerGlitch() {
    if (reducedMotion || glitches.size === 0 || document.visibilityState !== "visible") return;
    const all = [...glitches.values()];
    const g = all[rnd() % all.length];
    const row = g.row - camera;
    if (row < 0 || row >= rows) return;
    const i = index(row, g.col);
    if (cellKind[i] === K_AMBIENT || tStart[i] !== 0) return;
    tStart[i] = performance.now();
    tFrom[i] = cellChar[i];
    tFromKind[i] = cellKind[i];
    tSeed[i] = rnd();
    tMode[i] = T_COUSIN;
    scheduleDraw();
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
      alloc();
      compose(false);
    },

    setWorld(lines, totalRows) {
      world = new Map();
      glitches.clear();
      for (const line of lines) {
        let segments = world.get(line.row);
        if (!segments) world.set(line.row, (segments = []));
        segments.push({ col: line.col, chars: line.text, kind: line.kind, linkId: line.linkId ?? -1 });
      }
      worldRows = totalRows;
      compose(false);
    },

    setCamera(row, animate = true, delayPerRow = 4) {
      const next = Math.max(0, Math.min(row, Math.max(0, worldRows - 1)));
      if (next === camera) return;
      camera = next;
      compose(animate, delayPerRow);
    },

    crystallize() {
      const now = performance.now();
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const i = row * cols + col;
          if (cellKind[i] === K_AMBIENT || reducedMotion) continue;
          tStart[i] = now + row * 14 + col * 1.6;
          tFrom[i] = ambient[i];
          tFromKind[i] = K_AMBIENT;
          tSeed[i] = rnd();
          tMode[i] = T_TRANSITION;
        }
      }
      scheduleDraw();
    },

    pulse(x, y) {
      const col = Math.floor((x - xOffset) / metrics.cellW);
      const row = Math.floor(y / metrics.cellH);
      if (row < 0 || row >= rows || col < 0 || col >= cols) return;
      const center = index(row, col);
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
          const i = index(r, c);
          if (cellKind[i] !== K_AMBIENT || overlay.has(i)) continue;
          pointerTokens.set(i, scrambleTokens[rnd() % scrambleTokens.length]);
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
      const now = performance.now();
      const aspect = metrics.cellH / metrics.cellW;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const dc = (col + 0.5 - originCol) / aspect;
          const dr = row + 0.5 - originRow;
          const dist = Math.sqrt(dc * dc + dr * dr);
          if (dist > 7) continue;
          const i = index(row, col);
          if (tStart[i] !== 0 && now - tStart[i] < TRACE_DURATION) continue;
          tStart[i] = now + dist * 34;
          tFrom[i] = cellChar[i];
          tFromKind[i] = cellKind[i];
          tSeed[i] = rnd();
          tMode[i] = T_SHIMMER;
        }
      }
      scheduleDraw();
    },

    hoverLink(linkId, on) {
      hoveredLink = on ? linkId : -1;
      if (on && !reducedMotion) {
        const now = performance.now();
        let k = 0;
        for (let i = 0; i < cellLink.length; i += 1) {
          if (cellLink[i] !== linkId || cellKind[i] === K_AMBIENT) continue;
          tStart[i] = now + k * 16;
          tFrom[i] = cellChar[i];
          tFromKind[i] = cellKind[i];
          tSeed[i] = rnd();
          tMode[i] = T_COUSIN;
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
      const i = index(row, col);
      tStart[i] = performance.now();
      tFrom[i] = cellChar[i];
      tFromKind[i] = cellKind[i];
      tSeed[i] = rnd();
      tMode[i] = T_COUSIN;
      scheduleDraw();
    },

    setOverlayCells(cells) {
      overlay.clear();
      for (const cell of cells) {
        if (cell.row < 0 || cell.row >= rows || cell.col < 0 || cell.col >= cols) continue;
        overlay.set(index(cell.row, cell.col), { ch: cell.ch, ink: cell.ink ?? INK });
      }
      scheduleDraw();
    },

    setMasks(keys, animate = false) {
      masks = keys ?? new Set();
      compose(animate, 8);
    },

    setHud(text) {
      if (text === hud) return;
      hud = text;
      scheduleDraw();
    },

    committedCellsInWorldRows(fromRow, toRow) {
      const out = [];
      for (let worldRow = fromRow; worldRow <= toRow; worldRow += 1) {
        const segments = world.get(worldRow);
        if (!segments) continue;
        for (const segment of segments) {
          for (let k = 0; k < segment.chars.length; k += 1) {
            const ch = segment.chars[k];
            if (ch !== " ") out.push({ worldRow, col: segment.col + k, ch, faint: segment.kind === K_FAINT });
          }
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
    metricsRef: () => metrics,

    start() {
      window.clearInterval(ambientTimer);
      window.clearInterval(glitchTimer);
      ambientTimer = window.setInterval(mutateAmbient, 380);
      glitchTimer = window.setInterval(flickerGlitch, 1700);
    },
  };
}
