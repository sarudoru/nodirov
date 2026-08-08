// The field: a fixed grid of character cells — the only place anything is
// ever painted.
//
// The substrate is never still. Every cell owns a slow opacity oscillation
// with its own period and phase, so the whole surface breathes at once
// while no single cell draws attention; on top of that, cells continuously
// cross-dissolve into new glyphs at a tunable rate. A tide passes across
// the grid, the cursor carries a lantern, the corners fall away.
//
// The document pours through all of it: committed glyphs blend between the
// row they hold and the row arriving beneath, with the blend phase tied
// directly to scroll position. Nothing moves; cells change.

import { AMBIENT, RAMP, cousinsFor } from "./glyphs.js";

// cell kinds
export const K_AMBIENT = 0;
export const K_TEXT = 1;
export const K_FAINT = 2;
export const K_LINK = 3;
export const K_HOLE = 4;

// one-shot trace modes
const T_CONDENSE = 0;
const T_COUSIN = 1;
const T_SPLASH = 2;

const TRACE_DURATION = 180;
const TRACE_STEP = 60;

const smoothstep = (p) => p * p * (3 - 2 * p);

export function createField(canvas, params) {
  const context = canvas.getContext("2d", { alpha: false });
  let P = params;

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

  const randomPool = new Uint32Array(1024);
  let randomAt = randomPool.length;
  function rnd() {
    if (randomAt >= randomPool.length) {
      crypto.getRandomValues(randomPool);
      randomAt = 0;
    }
    return randomPool[randomAt++];
  }
  const rndF = () => rnd() / 4294967296;

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
  let lanternCol = -1;
  let lanternRow = -1;

  let worldData = new Map(); // world row -> {chars, kinds, links}
  let masks = new Set();

  // --- the living substrate, one entry per view cell ---
  let subToken = new Uint16Array(0);   // glyph shown now
  let subNext = new Uint16Array(0);    // glyph fading in (0 = idle)
  let subStart = new Float64Array(0);  // ms when the crossfade began
  let subLit = new Uint8Array(0);      // density mask
  let twPhase = new Float32Array(0);   // 0..1 offset into the twinkle cycle
  let twRate = new Float32Array(0);    // cycles per ms
  let vigMap = new Float32Array(0);
  let colPhase = new Float32Array(0);

  // view-anchored committed content
  let cellChar = new Uint16Array(0);
  let cellKind = new Uint8Array(0);
  let cellLink = new Int16Array(0);

  // one-shot traces (crystallize, cousins, splash)
  let tStart = new Float64Array(0);
  let tFrom = new Uint16Array(0);
  let tFromAlpha = new Float32Array(0);
  let tSeed = new Uint32Array(0);
  let tMode = new Uint8Array(0);

  let overlay = new Map();
  let hud = "";
  let hoveredLink = -1;

  let pointerCells = [];
  let pointerTokens = new Map();
  let pointerTimer = 0;
  let lastPointerCell = -1;

  const glitches = new Map();
  let glitchTimer = 0;

  // looping cousin shimmer
  let shimmerCells = [];
  let shimmerShown = new Map();
  let shimmerTimer = 0;
  let shimmerKey = "";

  let rafId = 0;
  let running = false;
  let lastFrameAt = 0;
  let churnCarry = 0;

  const worldKey = (row, col) => row * 512 + col;

  // ---------- substrate ----------

  function seedSubstrate() {
    const n = cols * rows;
    subToken = new Uint16Array(n);
    subNext = new Uint16Array(n);
    subStart = new Float64Array(n);
    subLit = new Uint8Array(n);
    twPhase = new Float32Array(n);
    twRate = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      subToken[i] = ambientTokens[rnd() % ambientTokens.length];
      subLit[i] = rndF() < P.density ? 1 : 0;
      twPhase[i] = rndF();
      const period = (P.twMin + rndF() * Math.max(0.1, P.twMax - P.twMin)) * 1000;
      twRate[i] = 1 / period;
    }
  }

  function reseedTwinkle() {
    for (let i = 0; i < twRate.length; i += 1) {
      const period = (P.twMin + rndF() * Math.max(0.1, P.twMax - P.twMin)) * 1000;
      twRate[i] = 1 / period;
    }
  }

  function reseedDensity() {
    for (let i = 0; i < subLit.length; i += 1) subLit[i] = rndF() < P.density ? 1 : 0;
  }

  // Start `churn` crossfades per second, spread randomly across the field.
  function advanceChurn(now, dt) {
    if (reducedMotion || P.churn <= 0) return;
    churnCarry += (P.churn * dt) / 1000;
    let starts = Math.floor(churnCarry);
    churnCarry -= starts;
    const n = subToken.length;
    if (n === 0) return;
    while (starts > 0) {
      starts -= 1;
      const i = rnd() % n;
      if (!subLit[i] || subNext[i] !== 0 || cellChar[i] !== 0) continue;
      let next = ambientTokens[rnd() % ambientTokens.length];
      if (next === subToken[i]) next = ambientTokens[rnd() % ambientTokens.length];
      subNext[i] = next;
      subStart[i] = now;
    }
  }

  // Base opacity of one substrate cell, before the glyph crossfade.
  function substrateAlpha(i, row, col, now) {
    if (!subLit[i]) return 0;
    let a = P.alpha * vigMap[i];
    if (!reducedMotion && P.twAmp > 0) {
      const phase = (twPhase[i] + now * twRate[i]) % 1;
      a *= 1 + P.twAmp * Math.sin(phase * Math.PI * 2);
    }
    if (!reducedMotion && P.tideAmp > 0) {
      a *= 1 + P.tideAmp *
        Math.sin(now * (Math.PI * 2 / (P.tidePeriod * 1000)) + (row + col * 0.7) * P.tideScale);
    }
    if (lanternCol >= 0 && P.lanternR > 0 && P.lanternGain > 0) {
      const dx = (col - lanternCol) * (metrics.cellW / metrics.cellH);
      const dy = row - lanternRow;
      const f = Math.max(0, 1 - Math.hypot(dx, dy) / P.lanternR);
      a *= 1 + P.lanternGain * f * f;
    }
    return a > 0 ? a : 0;
  }

  // Paint one substrate cell, resolving any in-flight glyph crossfade.
  function paintSubstrate(i, row, col, x, y, now, scale) {
    const base = substrateAlpha(i, row, col, now) * scale;
    if (base <= 0.004) return;

    if (subNext[i] === 0) {
      if (subToken[i] === 0) return;
      context.globalAlpha = Math.min(1, base);
      context.fillText(palette[subToken[i]], x, y);
      return;
    }

    const p = (now - subStart[i]) / P.fade;
    if (p >= 1) {
      subToken[i] = subNext[i];
      subNext[i] = 0;
      context.globalAlpha = Math.min(1, base);
      context.fillText(palette[subToken[i]], x, y);
      return;
    }

    const e = P.fadeEase === "linear" ? p : smoothstep(p);
    if (P.fadeEase === "ramp") {
      // pass through the density ramp: glyph → · → glyph
      const mid = rampTokens[0];
      if (p < 0.5) {
        const q = smoothstep(p * 2);
        drawAt(subToken[i], base * (1 - q), x, y);
        drawAt(mid, base * q, x, y);
      } else {
        const q = smoothstep((p - 0.5) * 2);
        drawAt(mid, base * (1 - q), x, y);
        drawAt(subNext[i], base * q, x, y);
      }
      return;
    }
    drawAt(subToken[i], base * (1 - e), x, y);
    drawAt(subNext[i], base * e, x, y);
  }

  function drawAt(token, alpha, x, y) {
    if (token === 0 || alpha <= 0.004) return;
    context.globalAlpha = Math.min(1, alpha);
    context.fillText(palette[token], x, y);
  }

  // ---------- committed content ----------

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
    const efBase = fast ? (frac < 0.5 ? 0 : 1) : smoothstep(frac);
    const anyBlend = efBase > 0.004 && efBase < 0.996;

    for (let row = 0; row < rows; row += 1) {
      let y = row * metrics.cellH + metrics.cellH / 2;
      if (snap) y = Math.round(y);
      const worldA = camera + row;

      for (let col = 0; col < cols; col += 1) {
        const i = row * cols + col;
        let x = xOffset + col * metrics.cellW + metrics.cellW / 2;
        if (snap) x = Math.round(x);
        const ef = P.stagger && anyBlend
          ? Math.min(1, Math.max(0, efBase + colPhase[col]))
          : efBase;
        const blending = ef > 0.004 && ef < 0.996;

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
          context.fillText(palette[shimmerToken], x, y);
          continue;
        }

        if (pointerTokens.has(i)) {
          context.globalAlpha = 0.3;
          context.fillText(palette[pointerTokens.get(i)], x, y);
          continue;
        }

        // one-shot traces on committed cells
        if (!blending && tStart[i] !== 0) {
          const elapsed = now - tStart[i];
          if (elapsed >= TRACE_DURATION) {
            tStart[i] = 0;
          } else {
            const target = cellChar[i];
            const targetAlpha = target !== 0 ? kindAlpha(cellKind[i]) : substrateAlpha(i, row, col, now);
            let token = target !== 0 ? target : subToken[i];
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
                if (family && stage < 2) token = tokenOf(family[(tSeed[i] + stage) % family.length]);
              } else if (tMode[i] === T_SPLASH) {
                token = ambientTokens[(tSeed[i] + stage * 13) % ambientTokens.length];
                alpha = Math.max(0.24, targetAlpha * 0.5);
              }
            }
            drawAt(token, alpha, x, y);
            continue;
          }
        }

        // the pour
        committedAt(worldA, col, cellA);
        let coverage = 0;
        if (cellA.kind === K_HOLE || cellA.token !== 0) coverage = blending ? 1 - ef : 1;
        if (blending) {
          committedAt(worldA + 1, col, cellB);
          if (cellB.token !== 0 || cellB.kind === K_HOLE) coverage += ef;
        } else {
          cellB.token = 0;
        }

        if (coverage < 0.996) paintSubstrate(i, row, col, x, y, now, 1 - coverage);
        if (cellA.token !== 0) {
          drawAt(cellA.token, inkAlpha(cellA) * (blending ? Math.pow(1 - ef, P.biasOut) : 1), x, y);
        }
        if (cellB.token !== 0) {
          drawAt(cellB.token, inkAlpha(cellB) * Math.pow(ef, P.biasIn), x, y);
        }
      }
    }

    drawChrome(efBase);
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
      advanceChurn(now, Math.min(dt, 250));
      lastFrameAt = now;
      draw(now);
    }
    if (running) rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
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

  // ---------- traces & shimmer ----------

  function startTrace(i, mode, delay) {
    if (reducedMotion) return;
    tStart[i] = performance.now() + delay;
    tFrom[i] = cellChar[i] !== 0 ? cellChar[i] : subToken[i];
    tFromAlpha[i] = cellChar[i] !== 0 ? kindAlpha(cellKind[i]) : P.alpha;
    tSeed[i] = rnd();
    tMode[i] = mode;
  }

  function restartGlitchTimer() {
    window.clearInterval(glitchTimer);
    glitchTimer = 0;
    if (!P.glitch) return;
    glitchTimer = window.setInterval(() => {
      if (reducedMotion || glitches.size === 0 || document.visibilityState !== "visible") return;
      const all = [...glitches.values()];
      const g = all[rnd() % all.length];
      const row = g.row - camera;
      if (row < 1 || row >= rows - 1) return;
      startTrace(row * cols + g.col, T_COUSIN, 0);
      requestDraw();
    }, P.glitchMs);
  }

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
        const family = cousinsFor(palette[cellChar[i]]);
        if (!family) continue;
        shimmerShown.set(i, tokenOf(family[rnd() % family.length]));
      }
      requestDraw();
    };
    step();
    shimmerTimer = window.setInterval(step, P.shimmerTick);
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

      seedSubstrate();

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

      colPhase = new Float32Array(cols);
      for (let c = 0; c < cols; c += 1) {
        const h2 = Math.imul(c + 7, 2654435761) >>> 0;
        colPhase[c] = ((h2 % 1000) / 1000 - 0.5) * 0.16;
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
          data.chars[col] = tokenOf(ch);
          data.kinds[col] = line.kind;
        }
      }
      composeView();
      requestDraw();
    },

    setScroll(scrollTopPx) {
      const rowFloat = Math.max(0, scrollTopPx / metrics.cellH);
      if (Math.abs(rowFloat - lastRowFloat) > 2) fastUntil = performance.now() + 90;
      lastRowFloat = rowFloat;
      const nextCamera = Math.min(Math.floor(rowFloat), Math.max(0, worldRows - 1));
      frac = Math.min(0.999, Math.max(0, rowFloat - nextCamera));
      if (nextCamera !== camera) {
        camera = nextCamera;
        composeView();
      }
      requestDraw();
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
      requestDraw();
    },

    pulse(x, y) {
      const col = Math.floor((x - xOffset) / metrics.cellW);
      const row = Math.floor(y / metrics.cellH);
      if (row < 0 || row >= rows || col < 0 || col >= cols) return;
      lanternCol = col;
      lanternRow = row;
      const center = row * cols + col;
      if (center === lastPointerCell) return;
      lastPointerCell = center;
      window.clearTimeout(pointerTimer);
      for (const i of pointerCells) pointerTokens.delete(i);
      pointerCells = [];
      if (!reducedMotion && P.pulse) {
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
        requestDraw();
      }, 140);
      requestDraw();
    },

    rippleAt(x, y) {
      if (reducedMotion || P.rippleR <= 0) return;
      const originCol = (x - xOffset) / metrics.cellW;
      const originRow = y / metrics.cellH;
      const aspect = metrics.cellH / metrics.cellW;
      const now = performance.now();
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const dc = (col + 0.5 - originCol) / aspect;
          const dr = row + 0.5 - originRow;
          const dist = Math.sqrt(dc * dc + dr * dr);
          if (dist > P.rippleR) continue;
          const i = row * cols + col;
          if (tStart[i] !== 0 && now - tStart[i] < TRACE_DURATION) continue;
          startTrace(i, T_SPLASH, dist * P.rippleSpeed);
        }
      }
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

    setReducedMotion(v) {
      reducedMotion = v;
      if (v) {
        stopShimmer();
        stop();
        requestDraw();
      } else if (metrics) {
        start();
      }
    },

    // Live parameter updates from the workbench. Only re-derives what changed.
    applyParams(next, changed) {
      P = next;
      const touched = changed ?? Object.keys(next);
      if (touched.includes("density")) reseedDensity();
      if (touched.includes("twMin") || touched.includes("twMax")) reseedTwinkle();
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
      if (touched.includes("glitch") || touched.includes("glitchMs")) restartGlitchTimer();
      if (touched.includes("shimmerTick") && shimmerTimer) startShimmer(shimmerCells, shimmerKey);
      requestDraw();
    },

    clearLantern() {
      lanternCol = -1;
      lanternRow = -1;
      requestDraw();
    },

    requestDraw,
    start,
    stop,

    // Synchronous render at an explicit timestamp. Used by the workbench and
    // by tests to step the substrate without waiting on the animation clock.
    renderAt(now, dt = 1000 / P.fps) {
      advanceChurn(now, dt);
      draw(now);
    },
    cols: () => cols,
    rows: () => rows,
    camera: () => camera,
    worldRows: () => worldRows,
    xOffset: () => xOffset,
  };
}
