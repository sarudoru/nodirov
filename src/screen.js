// The screen: moving pictures in cell state.
//
// A baked sprite sheet is sampled down to one luminance per cell, and each
// cell reports its reading in the only language the site has — a character.
// The ramp is not authored: it is the ink ordering the morphospace measures
// from the live font. Two details carry the look, both inherited from the
// reference replica in experiments/ascii-cards: the source is shaded by
// facing (density falls toward the silhouette in every direction), and the
// cut-off is dithered per cell, so the edge dissolves instead of stencilling.

import { buildGlyphSpace } from "./glyphspace.js";

const ATLAS = { cols: 8, rows: 4, frames: 32, fps: 16 };

const DEFAULTS = {
  source: "a",        // a = rock, b = cloud
  mode: "ramp",       // ramp = halftone by glyph density; binary = 0/1 by alpha
  cell: 8,            // cell width in px; height follows the font
  floor: 0.13,        // luminance below which a cell is skipped
  dither: 0.13,       // randomness added to the floor: the dissolving edge
  gamma: 0.6,         // alpha curve: solid core, faded fringe
  settle: 2.6,        // seconds the form takes to settle from accent to ink
  invert: 0,          // 1 = dark marks are the form (ink-on-paper sources)
  grain: 0.16,
  paper: "#fdfdfb",
  ink: "#1a1a1a",
  accent: "#c8401f",
};

const hash = (x, y) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

export function readOptions(search = window.location.search) {
  const q = new URLSearchParams(search);
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (!q.has(key)) continue;
    const raw = q.get(key);
    if (typeof DEFAULTS[key] === "number") {
      const v = parseFloat(raw);
      if (Number.isFinite(v)) out[key] = v;
    } else if (/^[0-9a-fA-F]{6}$/.test(raw)) {
      out[key] = "#" + raw;
    } else {
      out[key] = raw;
    }
  }
  return out;
}

export function createScreen(canvas, opt) {
  const context = canvas.getContext("2d", { alpha: false });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let width = 0;
  let height = 0;
  let ratio = 1;
  let cols = 0;
  let rows = 0;
  let cellW = 0;
  let cellH = 0;
  let font = "";
  let ramp = [];       // glyphs by ink, light -> dense, from the morphospace
  let sheet = null;   // sprite-sheet image, or a <video> for footage sources
  let isVideo = false;
  let sample = null;
  let sampleCtx = null;
  let grainTile = null;
  let rafId = 0;
  let startedAt = 0;

  const inkRgb = hex(opt.ink);
  const accentRgb = hex(opt.accent);

  // The measured halftone ramp: quantiles of the font's own ink ordering,
  // restricted to unambiguous letterforms.
  function buildRamp() {
    let chars = "";
    for (let code = 33; code <= 126; code += 1) chars += String.fromCharCode(code);
    const space = buildGlyphSpace(Array.from(chars), font, cellW, cellH, false);
    const orderedIndices = space.byDensity.filter((i) => {
      const ch = space.chars[i];
      return !"\"'`(){}[]|\\_".includes(ch);
    });
    const steps = 16;
    ramp = [];
    for (let s = 0; s < steps; s += 1) {
      const at = Math.min(orderedIndices.length - 1, Math.round((s / (steps - 1)) * (orderedIndices.length - 1)));
      ramp.push(space.chars[orderedIndices[at]]);
    }
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const fontSize = Math.max(7, Math.round(opt.cell * 1.55));
    font = `${fontSize}px "Geist Mono", Menlo, monospace`;
    cellW = opt.cell;
    cellH = Math.round(fontSize * 1.08);
    cols = Math.max(1, Math.floor(width / cellW));
    rows = Math.max(1, Math.floor(height / cellH));

    sample = document.createElement("canvas");
    sample.width = cols;
    sample.height = rows;
    sampleCtx = sample.getContext("2d", { willReadFrequently: true });
    buildRamp();
  }

  function buildGrain() {
    const size = 192;
    const tile = document.createElement("canvas");
    tile.width = size;
    tile.height = size;
    const tc = tile.getContext("2d");
    const img = tc.createImageData(size, size);
    for (let k = 0; k < img.data.length; k += 4) {
      const v = 255 - Math.min(60, Math.pow(Math.random(), 2.2) * 70);
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
    tc.putImageData(img, 0, 0);
    grainTile = tile;
  }

  function drawFrame(now) {
    const elapsed = (now - startedAt) / 1000;
    let tileW;
    let tileH;
    let sx = 0;
    let sy = 0;
    if (isVideo) {
      // the <video> advances itself; every draw samples whatever frame it
      // is showing, so playback, seeking and looping all come for free
      tileW = sheet.videoWidth;
      tileH = sheet.videoHeight;
      if (!tileW) return;
    } else {
      const frame = reduced ? 6 : Math.floor(elapsed * ATLAS.fps) % ATLAS.frames;
      tileW = sheet.naturalWidth / ATLAS.cols;
      tileH = sheet.naturalHeight / ATLAS.rows;
      sx = (frame % ATLAS.cols) * tileW;
      sy = Math.floor(frame / ATLAS.cols) * tileH;
    }

    // cover-fit the source tile onto the cell grid; the browser's box filter
    // during drawImage IS the sampling
    const cellAspect = cellW / cellH;
    const srcAspect = tileW / tileH;
    const gridAspect = (cols * cellW) / (rows * cellH);
    let dw = cols;
    let dh = rows;
    if (srcAspect > gridAspect) dh = Math.round(cols / (srcAspect / cellAspect));
    else dw = Math.round(rows * (srcAspect / cellAspect));
    const dx = Math.floor((cols - dw) / 2);
    const dy = Math.floor((rows - dh) / 2);
    // the empty buffer must read as "no form": black normally, white when
    // dark marks are the form — otherwise letterbox bars become solid ink
    sampleCtx.fillStyle = opt.invert ? "#fff" : "#000";
    sampleCtx.fillRect(0, 0, cols, rows);
    sampleCtx.drawImage(sheet, sx, sy, tileW, tileH, dx, dy, dw, dh);
    const data = sampleCtx.getImageData(0, 0, cols, rows).data;

    // the settle: the form arrives in the accent and quiets into ink
    const t = Math.min(1, opt.settle > 0 ? elapsed / opt.settle : 1);
    const rgb = mix(accentRgb, inkRgb, t * t * (3 - 2 * t));

    context.fillStyle = opt.paper;
    context.fillRect(0, 0, width, height);
    context.font = font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

    for (let y = 0; y < rows; y += 1) {
      const py = Math.round((y * cellH + cellH / 2) * ratio) / ratio;
      for (let x = 0; x < cols; x += 1) {
        let lum = data[(y * cols + x) * 4] / 255;
        if (opt.invert) lum = 1 - lum;
        // dithered cut-off: the silhouette dissolves instead of stencilling
        if (lum < opt.floor + hash(x, y) * opt.dither) continue;
        lum = Math.min(1, (lum - opt.floor) / (0.98 - opt.floor));

        let ch;
        let alpha;
        if (opt.mode === "binary") {
          ch = hash(x * 1.7, y + elapsed * 2) < 0.5 ? "0" : "1";
          alpha = 0.1 + Math.pow(lum, opt.gamma) * 0.9;
        } else {
          ch = ramp[Math.min(ramp.length - 1, Math.floor(Math.pow(lum, opt.gamma) * ramp.length))];
          alpha = 0.24 + Math.pow(lum, opt.gamma) * 0.76;
        }
        context.globalAlpha = alpha;
        context.fillText(ch, Math.round((x * cellW + cellW / 2) * ratio) / ratio, py);
      }
    }
    context.globalAlpha = 1;

    if (opt.grain > 0) {
      if (!grainTile) buildGrain();
      const tileCss = 192 / ratio;
      context.save();
      context.globalCompositeOperation = "multiply";
      context.globalAlpha = opt.grain;
      for (let gy = 0; gy < height; gy += tileCss) {
        for (let gx = 0; gx < width; gx += tileCss) context.drawImage(grainTile, gx, gy, tileCss, tileCss);
      }
      context.restore();
    }
  }

  function loop(now) {
    drawFrame(now);
    if (!reduced) rafId = requestAnimationFrame(loop);
  }

  return {
    async start() {
      isVideo = opt.source !== "a" && opt.source !== "b";
      if (isVideo) {
        const video = document.createElement("video");
        video.src = `assets/screen/${opt.source.replace(/[^a-z0-9-]/gi, "")}.mp4`;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "auto";
        await new Promise((resolve, reject) => {
          video.addEventListener("loadeddata", resolve, { once: true });
          video.addEventListener("error", reject, { once: true });
          video.load();
        });
        if (!reduced) video.play().catch(() => { /* a paused first frame is fine */ });
        sheet = video;
      } else {
        sheet = new Image();
        sheet.src = `experiments/ascii-cards/src-${opt.source === "b" ? "b" : "a"}.png`;
        await sheet.decode();
      }
      try {
        await Promise.race([
          document.fonts.load('16px "Geist Mono"'),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
      } catch { /* fallback face is fine */ }
      resize();
      window.addEventListener("resize", () => { resize(); });
      startedAt = performance.now();
      rafId = requestAnimationFrame(loop);
    },
    renderAt(now) {
      if (!sheet || !sampleCtx) return;
      if (width !== window.innerWidth || height !== window.innerHeight) resize();
      if (!startedAt) startedAt = now;
      drawFrame(now);
    },
    seek(seconds) {
      if (isVideo && sheet) sheet.currentTime = seconds;
    },
    stop() {
      cancelAnimationFrame(rafId);
    },
  };
}
