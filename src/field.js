// The field: a fixed grid of character cells — the only place anything is
// ever painted.
//
// The murmur is still. Ambient glyphs belong to the screen, whisper-quiet,
// mutating one cell at a time. The document pours through them: committed
// text blends between rows with a phase tied directly to scroll position,
// displacing the murmur where it passes and letting it seep back after.
// Nothing ever moves; cells change what they hold.

import { AMBIENT, RAMP, WAVE, cousinsFor } from "./glyphs.js";

const INK = "#161616";
const ALPHA_TEXT = 1.0;
const ALPHA_FAINT = 0.42;
const ALPHA_AMBIENT = 0.055;
const ALPHA_UNDERLINE = 0.25;
const ALPHA_UNDERLINE_HOT = 0.85;
const ALPHA_CHROME_HOT = 0.9;

const TRACE_DURATION = 180;
const TRACE_STEP = 60;
const SHIMMER_TICK = 130;

// cell kinds
export const K_AMBIENT = 0;
export const K_TEXT = 1;
export const K_FAINT = 2;
export const K_LINK = 3;
export const K_HOLE = 4;
export const K_BUTTON = 5;

const KIND_ALPHA = [ALPHA_AMBIENT, ALPHA_TEXT, ALPHA_FAINT, ALPHA_TEXT, 0, ALPHA_TEXT];

// trace modes
const T_CONDENSE = 0;
const T_COUSIN = 1;
const T_WAVE = 2;

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
  const waveTokens = Array.from(WAVE, tokenOf);

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
  let frac = 0;
  let worldRows = 0;
  let reducedMotion = false;
  let lastScrollAt = 0;

  let worldData = new Map(); // row -> {chars, kinds, links}
  let haloRows = [];
  let masks = new Set(); // worldRow * 512 + col

  let ambient = new Uint16Array(0); // screen-fixed murmur

  // view-anchored buffers for the current integer camera
  let cellChar = new Uint16Array(0);
  let cellKind = new Uint8Array(0);
  let cellLink = new Int16Array(0);

  // one-shot transformation traces (view-anchored, idle-time only)
  let tStart = new Float64Array(0);
  let tFrom = new Uint16Array(0);
  let tFromAlpha = new Float32Array(0);
  let tSeed = new Uint32Array(0);
  let tMode = new Uint8Array(0);

  // looping cousin shimmer (hovered word or link)
  let shimmerCells = [];
  let shimmerShown = new Map(); // view index -> token
  let shimmerTimer = 0;
  let shimmerWordKey = "";

  let overlay = new Map();
  let hud = "";
  let hoveredLink = -1;

  let pointerCells = [];
  let pointerTokens = new Map();
  let pointerTimer = 0;
  let lastPointerCell = -1;

  const glitches = new Map();

  let frame = 0;
  let ambientTimer = 0;
  let glitchTimer = 0;

  const worldKey = (row, col) => row * 512 + col;

  function haloAt(worldRow, col) {
    const halo = haloRows[worldRow];
    return halo ? halo[col] : 0;
  }

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
      // masked committed cells are holes: they suppress the murmur too
      out.token = 0;
      out.kind = token !== 0 ? K_HOLE : K_AMBIENT;
      return;
    }
    out.token = 0;
    out.kind = K_AMBIENT;
    out.link = -1;
  }

  function inkAlpha(cell) {
    if (cell.kind === K_FAINT && cell.link !== -1 && cell.link === hoveredLink) {
      return ALPHA_CHROME_HOT; // button chrome lights up under the pointer
    }
    return KIND_ALPHA[cell.kind];
  }

  function composeView() {
    const n = cols * rows;
    if (cellChar.length !== n) {
      cellChar = new Uint16Array(n);
      cellKind = new Uint8Array(n);
      cellLink = new Int16Array(n);
      tStart = new Float64Array(n);
      tFrom = new Uint16Array(n);
      tFromAlpha = new Float32Array(n);
      tSeed = new Uint32Array(n);
      tMode = new Uint8Array(n);
    } else {
      tStart.fill(0);
    }
    stopShimmer();
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
  }

  const cellA = { token: 0, kind: 0, link: -1 };
  const cellB = { token: 0, kind: 0, link: -1 };

  function draw() {
    frame = 0;
    const now = performance.now();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.font = metrics.font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = INK;

    const ef = frac * frac * (3 - 2 * frac);
    const blending = ef > 0.004;
    let active = false;

    for (let row = 0; row < rows; row += 1) {
      const y = row * metrics.cellH + metrics.cellH / 2;
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

        const shimmerToken = shimmerShown.get(i);
        if (shimmerToken !== undefined && !blending) {
          context.globalAlpha = KIND_ALPHA[cellKind[i]] || ALPHA_TEXT;
          context.fillText(palette[shimmerToken], x, y);
          continue;
        }

        if (pointerTokens.has(i)) {
          context.globalAlpha = 0.3;
          context.fillText(palette[pointerTokens.get(i)], x, y);
          continue;
        }

        // one-shot traces (idle only)
        if (!blending && tStart[i] !== 0) {
          const elapsed = now - tStart[i];
          if (elapsed >= TRACE_DURATION) {
            tStart[i] = 0;
          } else {
            active = true;
            const target = cellChar[i];
            const ambientHere = ALPHA_AMBIENT * (1 + haloAt(worldA, col));
            const targetAlpha = target !== 0 ? KIND_ALPHA[cellKind[i]] : ambientHere;
            let token = target !== 0 ? target : ambient[i];
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
                }
              } else if (tMode[i] === T_WAVE) {
                token = waveTokens[stage % waveTokens.length];
                alpha = Math.max(0.24, targetAlpha * 0.5);
              }
            }
            if (token !== 0 && alpha > 0.015) {
              context.globalAlpha = Math.min(1, alpha);
              context.fillText(palette[token], x, y);
            }
            continue;
          }
        }

        // the pour: committed rows blend by scroll phase over a still murmur
        committedAt(worldA, col, cellA);
        let coverage = 0;
        if (cellA.kind === K_HOLE) coverage = blending ? 1 - ef : 1;
        else if (cellA.token !== 0) coverage = blending ? 1 - ef : 1;
        if (blending) {
          committedAt(worldA + 1, col, cellB);
          if (cellB.token !== 0 || cellB.kind === K_HOLE) coverage += ef;
        } else {
          cellB.token = 0;
        }

        if (coverage < 0.996 && ambient[i] !== 0) {
          const a = ALPHA_AMBIENT * (1 + haloAt(worldA, col)) * (1 - coverage);
          if (a > 0.012) {
            context.globalAlpha = a;
            context.fillText(palette[ambient[i]], x, y);
          }
        }
        if (cellA.token !== 0) {
          context.globalAlpha = inkAlpha(cellA) * (blending ? 1 - ef : 1);
          context.fillText(palette[cellA.token], x, y);
        }
        if (cellB.token !== 0) {
          context.globalAlpha = inkAlpha(cellB) * ef;
          context.fillText(palette[cellB.token], x, y);
        }
      }
    }

    drawChrome(ef);
    drawHud();
    context.globalAlpha = 1;

    if (active || shimmerShown.size > 0 || now - lastScrollAt < 220) scheduleDraw();
  }

  // underlines for links, highlight for hovered button chrome
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
      context.globalAlpha = alpha * (id === hoveredLink ? ALPHA_UNDERLINE_HOT : ALPHA_UNDERLINE);
      context.fillRect(xOffset + col * metrics.cellW + 1, y, (end - col) * metrics.cellW - 2, 1);
      col = end;
    }
  }

  function drawChrome(ef) {
    context.fillStyle = INK;
    for (let row = 0; row < rows; row += 1) {
      const y = row * metrics.cellH + metrics.cellH - 3;
      chromeRowFor(camera + row, y, 1 - ef);
      if (ef > 0.004) chromeRowFor(camera + row + 1, y, ef);
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
    if (document.visibilityState !== "visible" || ambient.length === 0 || reducedMotion) return;
    const i = rnd() % ambient.length;
    if (cellChar[i] !== 0 || overlay.has(i)) return;
    let next = ambientTokens[rnd() % ambientTokens.length];
    if (next === ambient[i]) next = ambientTokens[rnd() % ambientTokens.length];
    ambient[i] = next;
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
    tFrom[i] = cellChar[i] !== 0 ? cellChar[i] : ambient[i];
    tFromAlpha[i] = cellChar[i] !== 0 ? KIND_ALPHA[cellKind[i]] : ALPHA_AMBIENT;
    tSeed[i] = rnd();
    tMode[i] = mode;
  }

  // ---- looping shimmer ----

  function stopShimmer() {
    if (shimmerTimer) window.clearInterval(shimmerTimer);
    shimmerTimer = 0;
    shimmerCells = [];
    shimmerShown.clear();
    shimmerWordKey = "";
  }

  function startShimmer(indices, key) {
    stopShimmer();
    if (reducedMotion || indices.length === 0) return;
    shimmerCells = indices;
    shimmerWordKey = key;
    const tick = () => {
      for (const i of shimmerCells) {
        const base = palette[cellChar[i]];
        const family = cousinsFor(base);
        if (!family) continue;
        // mostly siblings, sometimes home — the word stays readable
        const pick = rnd() % family.length;
        shimmerShown.set(i, tokenOf(family[pick]));
      }
      scheduleDraw();
    };
    tick();
    shimmerTimer = window.setInterval(tick, SHIMMER_TICK);
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
      const n = cols * rows;
      ambient = new Uint16Array(n);
      for (let i = 0; i < n; i += 1) ambient[i] = ambientTokens[rnd() % ambientTokens.length];
      cellChar = new Uint16Array(0);
      composeView();
      scheduleDraw();
    },

    setWorld(lines, totalRows) {
      worldData = new Map();
      haloRows = new Array(totalRows);
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
          data.chars[col] = tokenOf(ch);
          data.kinds[col] = line.kind;

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
                if (w > 0) halo[hc] = Math.min(0.9, halo[hc] + w * 0.2);
              }
            }
          }
        }
      }
      composeView();
      scheduleDraw();
    },

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
          if (cellChar[i] === 0) continue;
          startTrace(i, T_CONDENSE, row * 16 + col * 1.4);
          tFrom[i] = 0;
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
          if (cellChar[i] !== 0 || overlay.has(i)) continue;
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
          startTrace(i, T_WAVE, dist * 36);
        }
      }
      scheduleDraw();
    },

    hoverLink(linkId, on) {
      hoveredLink = on ? linkId : -1;
      if (on) {
        const indices = [];
        for (let i = 0; i < cellLink.length; i += 1) {
          if (cellLink[i] === linkId && cellChar[i] !== 0 &&
              (cellKind[i] === K_LINK || cellKind[i] === K_BUTTON)) {
            indices.push(i);
          }
        }
        startShimmer(indices, "link:" + linkId);
      } else {
        stopShimmer();
      }
      scheduleDraw();
    },

    // loop the word under the pointer through its typographic siblings
    shimmerWordAt(x, y) {
      if (hoveredLink !== -1 || reducedMotion) return;
      const col = Math.floor((x - xOffset) / metrics.cellW);
      const row = Math.floor(y / metrics.cellH);
      if (row < 0 || row >= rows || col < 0 || col >= cols) {
        if (shimmerWordKey.startsWith("word:")) stopShimmer();
        return;
      }
      const i = row * cols + col;
      if (cellKind[i] !== K_TEXT || cellChar[i] === 0) {
        if (shimmerWordKey.startsWith("word:")) {
          stopShimmer();
          scheduleDraw();
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
      if (key === shimmerWordKey) return;
      const indices = [];
      for (let c = from; c <= to; c += 1) indices.push(row * cols + c);
      startShimmer(indices, key);
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
        for (const cell of cells) masks.add(worldKey(cell.worldRow, cell.col));
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

    setReducedMotion(v) {
      reducedMotion = v;
      if (v) stopShimmer();
    },
    requestDraw: scheduleDraw,
    cols: () => cols,
    rows: () => rows,
    camera: () => camera,
    worldRows: () => worldRows,
    xOffset: () => xOffset,

    start() {
      window.clearInterval(ambientTimer);
      window.clearInterval(glitchTimer);
      ambientTimer = window.setInterval(mutateAmbient, 420);
      glitchTimer = window.setInterval(flickerGlitch, 1900);
    },
  };
}
