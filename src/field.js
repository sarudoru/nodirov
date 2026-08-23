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
  let worldRows = 0;
  let reducedMotion = false;
  let ratio = 1;
  let prevChar = new Uint16Array(0);
  let lastFlipAt = -1e9; // when the board last received a flip request
  let scrollSpeed = 0;   // rows per second, smoothed
  let lastScrollAt = 0;

  // the embedded cursor: one glyph that lives in the grid
  let cursorCell = -1;

  // paper: static per-cell handwriting, and a grain tile
  let inkNoise = new Float32Array(0);
  let jitterNoise = new Float32Array(0);
  let grainTile = null;
  let grainTileScale = 0;
  let tokenGlyph = new Int16Array(0); // text token -> morphospace index
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

  function kindAlpha(kind) {
    if (kind === K_TEXT || kind === K_LINK) return P.textAlpha;
    if (kind === K_FAINT) return P.faintAlpha;
    return 0;
  }

  function glyphForToken(token) {
    if (token < tokenGlyph.length) return tokenGlyph[token];
    // a character committed after the space was built: resolve live
    return space ? space.indexOf(textPalette[token]) : -1;
  }

  // Compose the view for the current camera, then hand every changed cell to
  // the substrate: a cell that gains a character commits (its glyph walks up
  // out of the murmur), a cell that loses one releases (walks back down).
  // mode: "instant" | "flip" | "reveal"
  function composeView(mode = "instant", direction = 1) {
    const n = cols * rows;
    const fresh = cellChar.length !== n;
    if (fresh) {
      prevChar = new Uint16Array(n);
      cellChar = new Uint16Array(n);
      cellKind = new Uint8Array(n);
      cellLink = new Int16Array(n);
      shelterMap = new Float32Array(n);
    } else {
      prevChar.set(cellChar);
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

    driveBoard(mode, direction, fresh);
  }

  // The board: every cell whose character changed flips. A scroll is a wave
  // of flips sweeping the grid; nothing slides, nothing is covered.
  function driveBoard(mode, direction, fresh) {
    if (!substrate) return;
    const now = performance.now();
    // A flip that arrives while the previous one is still mostly in flight
    // lands instantly. Deliberate steps ripple; continuous scrolling never
    // stacks ladders into a jumble, and costs one paint per cell.
    const crowded = mode === "flip" && now - lastFlipAt < P.flipMs * P.flipCoalesce;
    const instant = mode === "instant" || reducedMotion || crowded;
    if (mode === "flip") lastFlipAt = now; // every request counts: a pause earns the ripple
    // Under continuous scroll, a departing letter lingers for traceRows of
    // travel — the trace is a distance, so it looks the same at any speed.
    // At rest it is a fraction of a flip.
    const releaseMs = crowded
      ? Math.max(40, Math.min(P.flipMs * 2.5, (P.traceRows / Math.max(scrollSpeed, 0.5)) * 1000))
      : P.flipMs * P.releaseRatio;
    const fadeTrace = crowded && P.traceRows > 0;
    const cx = cols / 2;
    const cy = rows * 0.42;
    const aspect = metrics.cellH / metrics.cellW;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const i = row * cols + col;
        const token = cellChar[i];
        const before = fresh ? 0 : prevChar[i];
        if (token === before && !fresh && mode !== "reveal") continue;

        let delay = 0;
        if (!instant) {
          if (mode === "reveal") {
            const dx = (col - cx) / aspect;
            const dy = row - cy;
            delay = 140 + Math.hypot(dx, dy) * 12 + Math.random() * 80;
          } else {
            const sweepRow = direction >= 0 ? row : rows - 1 - row;
            delay = col * P.flipSweep + sweepRow * P.flipDrift;
          }
        }

        if (token !== 0) {
          const glyph = glyphForToken(token);
          if (glyph < 0) continue;
          if (mode === "reveal") substrate.release(i, now, 0, true);
          substrate.commit(i, glyph, kindAlpha(cellKind[i]), now, delay, instant);
        } else if (before !== 0 || fresh) {
          // a departing letter sinks: quickly at rest, as a measured trace
          // while scrolling (dimming in place, never cycling)
          substrate.release(i, now, delay * 0.5, instant && !fadeTrace, releaseMs, fadeTrace);
        }
      }
    }
    if (cursorCell >= 0) placeCursor(cursorCell, true);
  }

  // ---------- the embedded cursor ----------

  function cursorGlyph() {
    return space ? space.indexOf(P.cursorGlyph) : -1;
  }

  // Give a cell back whatever it should be holding: its letter, or nothing.
  function restoreCell(i, now, instant) {
    const token = cellChar[i];
    if (token !== 0) {
      const glyph = glyphForToken(token);
      if (glyph >= 0) substrate.commit(i, glyph, kindAlpha(cellKind[i]), now, 0, instant, P.cursorMs);
    } else {
      substrate.release(i, now, 0, instant, P.cursorMs);
    }
  }

  function placeCursor(i, reassert = false) {
    if (!substrate || !P.cursorEmbed) return;
    const glyph = cursorGlyph();
    if (glyph < 0) return;
    const now = performance.now();
    if (i !== cursorCell) {
      if (cursorCell >= 0) restoreCell(cursorCell, now, false);
      cursorCell = i;
    }
    // the oncoming cell becomes the cursor — instantly after a board flip so
    // it never flickers, otherwise through a quick ladder
    substrate.commit(i, glyph, 1, now, 0, reassert, P.cursorMs);
    requestDraw();
  }

  function clearCursor() {
    if (cursorCell < 0 || !substrate) return;
    restoreCell(cursorCell, performance.now(), false);
    cursorCell = -1;
    requestDraw();
  }

  // ---------- paper ----------

  function buildGrain() {
    const size = 192;
    const tile = document.createElement("canvas");
    tile.width = size;
    tile.height = size;
    const tc = tile.getContext("2d");
    const img = tc.createImageData(size, size);
    const d = img.data;
    for (let k = 0; k < d.length; k += 4) {
      // paper tooth: mostly white, a few fibres pressing darker
      const v = 255 - Math.min(60, Math.pow(Math.random(), 2.2) * 70);
      d[k] = v; d[k + 1] = v; d[k + 2] = v; d[k + 3] = 255;
    }
    tc.putImageData(img, 0, 0);
    grainTile = tile;
  }

  function drawPaper(now) {
    if (P.grain <= 0) return;
    if (!grainTile) buildGrain();
    const tileCss = (192 * P.grainScale) / ratio;
    const ox = P.grainLive ? -Math.random() * tileCss : 0;
    const oy = P.grainLive ? -Math.random() * tileCss : 0;
    context.save();
    context.globalCompositeOperation = "multiply";
    context.globalAlpha = P.grain;
    for (let y = oy; y < height; y += tileCss) {
      for (let x = ox; x < width; x += tileCss) context.drawImage(grainTile, x, y, tileCss, tileCss);
    }
    context.restore();
  }


  // Block elements mean "this much of the cell is ink". A font's █ fills
  // its own advance, not our tracked cell, so on the grid it would read as
  // a slat. Painting blocks as cell geometry keeps display type solid and
  // makes the metaphor exact: the cell is the pixel.
  const BLOCKS = {
    "█": [0, 0, 1, 1],
    "▀": [0, 0, 1, 0.5], "▄": [0, 0.5, 1, 0.5],
    "▌": [0, 0, 0.5, 1], "▐": [0.5, 0, 0.5, 1],
    "▘": [0, 0, 0.5, 0.5], "▝": [0.5, 0, 0.5, 0.5],
    "▖": [0, 0.5, 0.5, 0.5], "▗": [0.5, 0.5, 0.5, 0.5],
  };

  function paintGlyph(ch, x, y) {
    const block = BLOCKS[ch];
    if (!block) {
      context.fillText(ch, x, y);
      return;
    }
    const cw = metrics.cellW;
    const chh = metrics.cellH;
    // snap rect edges to device pixels so adjacent cells tile without seams
    const left = Math.round((x - cw / 2 + block[0] * cw) * ratio) / ratio;
    const top = Math.round((y - chh / 2 + block[1] * chh) * ratio) / ratio;
    const right = Math.round((x - cw / 2 + (block[0] + block[2]) * cw) * ratio) / ratio;
    const bottom = Math.round((y - chh / 2 + (block[1] + block[3]) * chh) * ratio) / ratio;
    context.fillRect(left, top, right - left, bottom - top);
  }

  // ---------- the frame ----------


  function draw(now) {
    context.fillStyle = P.paper;
    context.fillRect(0, 0, width, height);
    context.font = metrics.font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    // A pixel face wants its edges untouched; a vector face wants the
    // platform rasterizer's hinting, which geometricPrecision disables.
    if (context.textRendering !== undefined) {
      context.textRendering = metrics.pixelFace ? "geometricPrecision" : "auto";
    }
    context.fillStyle = P.ink;

    for (let row = 0; row < rows; row += 1) {
      // glyph origins land on whole device pixels, so stems never straddle
      // two columns of the backing store
      const y = Math.round((row * metrics.cellH + metrics.cellH / 2) * ratio) / ratio;
      const worldA = camera + row;

      for (let col = 0; col < cols; col += 1) {
        const i = row * cols + col;
        const x = Math.round((xOffset + col * metrics.cellW + metrics.cellW / 2) * ratio) / ratio;

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
        if (shimmerToken !== undefined) {
          context.globalAlpha = kindAlpha(cellKind[i]) || P.textAlpha;
          context.fillText(textPalette[shimmerToken], x, y);
          continue;
        }

        const glitch = glitchCells.get(i);
        if (glitch !== undefined && now < glitch.until) {
          context.globalAlpha = kindAlpha(cellKind[i]) || P.textAlpha;
          context.fillText(glitch.ch, x, y);
          continue;
        }

        // A media plane covers this cell unless the document has committed
        // text here — a photograph never paints over a word.
        const planeCell = planes && cellChar[i] === 0 ? planes.at(worldA, col) : null;
        if (planeCell) {
          context.globalAlpha = Math.min(1, 0.10 + planeCell.ink * 0.9);
          paintGlyph(glyphAt(planeCell.glyph), x, y);
          continue;
        }

        // One readout for every cell. Murmur, a letter rising out of it, a
        // letter settled, a letter sinking back: all the same call.
        const s = substrate.read(i, now, vigMap[i]);
        if (s.alpha <= 0.006) continue;

        // handwriting: a ribbon that does not strike evenly, keys that sit
        // a hair high or low. Static per cell, snapped to device pixels, so
        // the page reads as typed rather than rendered, and stays crisp.
        const weight = 1 - P.inkVariance * inkNoise[i] * 0.35;
        const yy = P.baselineJitter > 0 && jitterNoise[i] < P.baselineJitter
          ? y + (inkNoise[i] < 0.5 ? -1 : 1) / ratio
          : y;
        const ink = s.alpha * weight;
        if (s.b < 0) {
          context.globalAlpha = Math.min(1, ink);
          paintGlyph(glyphAt(s.a), x, yy);
          if (P.bleed > 0 && ink > 0.5) {
            // a second, fainter impression a hair off: ink spreading into fibre
            context.globalAlpha = Math.min(1, ink * P.bleed * 0.35);
            paintGlyph(glyphAt(s.a), x + 1 / ratio, yy);
          }
        } else {
          // cross-fade only between adjacent hops of the morph walk
          const fromAlpha = ink * (1 - s.blend);
          const toAlpha = ink * s.blend;
          if (fromAlpha > 0.006) {
            context.globalAlpha = Math.min(1, fromAlpha);
            paintGlyph(glyphAt(s.a), x, yy);
          }
          if (toAlpha > 0.006) {
            context.globalAlpha = Math.min(1, toAlpha);
            paintGlyph(glyphAt(s.b), x, yy);
          }
        }
      }
    }

    drawChrome(0);
    drawHud();
    context.globalAlpha = 1;
    drawPaper(now);
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

  // The morphospace spans the substrate alphabet, every printable ASCII
  // character, the typographic set the typesetter emits, the block elements
  // display type is built from, and every character the document has
  // committed so far. Characters are appended in a stable order, so indices
  // already held by cells survive a rebuild.
  function buildSpace() {
    const alphabet = ALPHABETS[P.alphabet] ?? ALPHABETS.latin;
    let printable = "";
    for (let code = 33; code <= 126; code += 1) printable += String.fromCharCode(code);
    const typographic = "·—–─│┌┐└┘├┤┬┴┼’‘“”…×█▓▒░▀▄▌▐■□▪▫●○◦•";
    const committed = textPalette.join("");
    const chars = Array.from(new Set(Array.from(alphabet + printable + typographic + committed)));
    space = buildGlyphSpace(chars, metrics.font, metrics.cellW, metrics.cellH, metrics.pixelFace);
    tokenGlyph = new Int16Array(textPalette.length);
    for (let t = 0; t < textPalette.length; t += 1) tokenGlyph[t] = space.indexOf(textPalette[t]);

    const eligible = [];
    const inAlphabet = new Set(Array.from(alphabet));
    for (let i = 0; i < chars.length; i += 1) if (inAlphabet.has(chars[i])) eligible.push(i);
    return eligible;
  }

  // ---------- public API ----------

  return {
    setMetrics(m) { metrics = m; },

    resize(w, h) {
      width = w;
      height = h;
      ratio = Math.min(window.devicePixelRatio || 1, 3);
      // The backing store and the CSS box must agree exactly, or the browser
      // resamples the whole canvas and every glyph edge goes soft.
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      cols = Math.max(10, Math.floor(w / metrics.cellW));
      rows = Math.max(6, Math.ceil(h / metrics.cellH));
      xOffset = Math.floor((w - cols * metrics.cellW) / 2);

      const eligible = buildSpace();

      if (!planes) planes = createPlanes(space);
      else planes.setSpace(space);

      const subParams = { ...P, aspect: metrics.cellH / metrics.cellW };
      if (!substrate) substrate = createSubstrate(space, subParams, eligible);
      else substrate.setSpace(space), substrate.setEligible(eligible), substrate.setParams(subParams, []);
      substrate.resize(cols, rows);

      const n = cols * rows;
      inkNoise = new Float32Array(n);
      jitterNoise = new Float32Array(n);
      for (let i = 0; i < n; i += 1) {
        inkNoise[i] = Math.random();
        jitterNoise[i] = Math.random();
      }
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
      composeView("instant");
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
      if (space) {
        let missing = tokenGlyph.length < textPalette.length;
        if (!missing) for (let t = 1; t < tokenGlyph.length; t += 1) if (tokenGlyph[t] < 0) { missing = true; break; }
        if (missing) {
          const eligible = buildSpace();
          if (substrate) substrate.setSpace(space), substrate.setEligible(eligible);
          if (planes) planes.setSpace(space);
        }
      }
      composeView("instant");
      requestDraw();
    },

    setScroll(scrollTopPx) {
      const rowFloat = Math.max(0, scrollTopPx / metrics.cellH);
      const delta = Math.abs(rowFloat - lastRowFloat);
      const tNow = performance.now();
      if (lastScrollAt > 0) {
        const dt = Math.max(1, tNow - lastScrollAt);
        const v = (delta / dt) * 1000;
        scrollSpeed = dt > 400 ? v : scrollSpeed * 0.6 + v * 0.4;
      }
      lastScrollAt = tNow;
      // scrolling stirs the medium: the document passing through leaves warmth
      if (substrate && P.scrollHeat > 0 && delta > 0.01 && !reducedMotion) {
        const strength = Math.min(1, delta * 0.5) * P.scrollHeat;
        const row = rows - 1;
        for (let c = 0; c < cols; c += 4) substrate.warm(c, row, 0, -1, strength * 0.35);
      }
      lastRowFloat = rowFloat;

      // The board only ever shows whole rows. A flip needs the scroll to
      // travel past the midpoint by a margin (hysteresis), so resting on a
      // boundary never chatters; a long jump always lands on its row.
      const maxCamera = Math.max(0, worldRows - 1);
      const candidate = Math.min(maxCamera, Math.round(rowFloat));
      if (candidate !== camera &&
          (Math.abs(rowFloat - camera) >= P.flipHysteresis || Math.abs(candidate - camera) > 1)) {
        const direction = candidate > camera ? 1 : -1;
        camera = candidate;
        composeView("flip", direction);
      }
      requestDraw();
    },

    // The cursor warms the medium along its whole path, so a fast sweep
    // leaves a continuous wake rather than a dotted line.
    // the cursor glyph follows the pointer through the grid
    pointerAt(x, y) {
      if (!P.cursorEmbed) return;
      const col = Math.floor((x - xOffset) / metrics.cellW);
      const row = Math.floor(y / metrics.cellH);
      if (col < 0 || col >= cols || row < 0 || row >= rows) { clearCursor(); return; }
      placeCursor(row * cols + col);
    },
    pointerLeft() { clearCursor(); },

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
    // Workbench/diagnostic: what one cell holds and what it would paint.
    probe(row, col) {
      const i = row * cols + col;
      const token = cellChar[i];
      const r = substrate ? substrate.read(i, performance.now(), vigMap[i]) : null;
      return {
        token, ch: textPalette[token], kind: cellKind[i],
        glyph: glyphForToken(token), glyphCh: glyphForToken(token) >= 0 ? glyphAt(glyphForToken(token)) : null,
        committed: substrate ? substrate.isCommitted(i) : null,
        read: r ? { a: r.a, aCh: glyphAt(r.a), b: r.b, bCh: r.b >= 0 ? glyphAt(r.b) : null, blend: r.blend, alpha: r.alpha } : null,
      };
    },

    crystallize() {
      if (reducedMotion || !space || !substrate) return;
      driveBoard("reveal", 1, false);
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
      if ((changed ?? []).some((k) => k === "grainScale" || k === "grain")) grainTile = null;
      if ((changed ?? []).includes("cursorEmbed") && !next.cursorEmbed) clearCursor();
      if ((changed ?? []).includes("cursorGlyph") && cursorCell >= 0) { const c = cursorCell; P = next; placeCursor(c, true); }
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
