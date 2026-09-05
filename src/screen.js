// The screen: moving pictures in cell state.
//
// A source (baked sprite sheet or footage in a <video>) is sampled down to
// one reading per cell, and each cell reports that reading in characters.
// Five algorithms interpret the reading:
//
//   ramp     tone picks a glyph from an ink-ordered ramp (halftone)
//   diffuse  tone quantized with Atkinson error diffusion — the classic
//            dithered print, tone carried entirely by glyph choice
//   quad     each cell is a 2x2 micro-image drawn as exact cell geometry;
//            four times the spatial resolution at the same cell size
//   edge     Sobel contours drawn with strokes that lean along the edge,
//            picked by the morphospace's structure tensor; tone whispers
//   binary   0 and 1, brightness carried by alpha
//
// Any charset works for the tonal modes: glyphs are rasterized and sorted
// by measured ink, never trusted to be in order.

import { buildGlyphSpace } from "./glyphspace.js";

const ATLAS = { cols: 8, rows: 4, frames: 32, fps: 16 };

export const CHARSETS = {
  measured: null, // printable ASCII, ordered by the morphospace
  classic: " .,:;i1tfLCG08@",
  blocks: " ░▒▓█",
  dots: " ·:∴*#",
  digits: " 0123456789",
  letters: " iltcoexbdgqAHMW",
};

const DEFAULTS = {
  source: "a",
  algorithm: "ramp",  // ramp | diffuse | quad | edge | binary
  charset: "measured",
  custom: "",         // overrides charset when non-empty
  cell: 8,
  floor: 0.13,
  dither: 0.13,
  gamma: 0.6,
  black: 0,           // input level mapped to no ink
  white: 1,           // input level mapped to full ink
  edgeGain: 2.2,      // edge mode: gradient magnitude amplifier
  colorMode: "mono",  // mono | source | duo
  invert: 0,
  settle: 2.6,
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
  if (q.has("mode")) out.algorithm = q.get("mode"); // older links
  for (const key of Object.keys(DEFAULTS)) {
    if (!q.has(key)) continue;
    const raw = q.get(key);
    if (typeof DEFAULTS[key] === "number") {
      const v = parseFloat(raw);
      if (Number.isFinite(v)) out[key] = v;
    } else if (["paper", "ink", "accent"].includes(key)) {
      if (/^[0-9a-fA-F]{6}$/.test(raw)) out[key] = "#" + raw;
    } else {
      out[key] = raw;
    }
  }
  return out;
}

export function toQuery(opt) {
  const q = new URLSearchParams();
  for (const key of Object.keys(DEFAULTS)) {
    if (opt[key] === DEFAULTS[key]) continue;
    q.set(key, typeof opt[key] === "string" ? opt[key].replace("#", "") : String(opt[key]));
  }
  return q.toString();
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
  let space = null;
  let ramp = [];
  let sheet = null;
  let isVideo = false;
  let sample = null;
  let sampleCtx = null;
  let lum = new Float32Array(0);     // post-invert, post-levels reading, 2x grid
  let scratch = new Float32Array(0); // error-diffusion working copy
  let rgb = null;                    // raw sample bytes for colour modes
  let grainTile = null;
  let rafId = 0;
  let startedAt = 0;
  let paused = false;

  // The ramp for the current charset: rasterized and ordered by measured
  // ink — never trusted to be written in order.
  function buildRamp() {
    let charset = opt.custom && opt.custom.length >= 2 ? " " + opt.custom : CHARSETS[opt.charset];
    if (charset === null || charset === undefined) {
      charset = "";
      for (let code = 33; code <= 126; code += 1) charset += String.fromCharCode(code);
    }
    const chars = Array.from(new Set(Array.from(charset))).filter((c) => c !== " ");
    if (chars.length < 2) return;
    space = buildGlyphSpace(chars, font, cellW, cellH, false);
    const banned = "\"'`(){}[]|\\_";
    let ordered = space.byDensity.filter((i) => !banned.includes(space.chars[i]));
    if (ordered.length < 2) ordered = space.byDensity.slice();
    const steps = Math.min(16, ordered.length);
    ramp = [];
    for (let s = 0; s < steps; s += 1) {
      const at = Math.min(ordered.length - 1, Math.round((s / Math.max(1, steps - 1)) * (ordered.length - 1)));
      ramp.push(space.chars[ordered[at]]);
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
    font = `${fontSize}px "IBM Plex Mono", Menlo, monospace`;
    cellW = opt.cell;
    cellH = Math.round(fontSize * 1.08);
    cols = Math.max(1, Math.floor(width / cellW));
    rows = Math.max(1, Math.floor(height / cellH));

    // sampling runs at double grid resolution: quad mode reads each cell as
    // a 2x2 micro-image, the other modes average the quadrants
    sample = document.createElement("canvas");
    sample.width = cols * 2;
    sample.height = rows * 2;
    sampleCtx = sample.getContext("2d", { willReadFrequently: true });
    lum = new Float32Array(cols * 2 * rows * 2);
    scratch = new Float32Array(cols * 2 * rows * 2);
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

  // Sample the source into `lum` and `rgb` at the 2x grid. Inversion and
  // levels are applied here once, so every algorithm sees the same reading.
  function sampleSource() {
    let tileW;
    let tileH;
    let sx = 0;
    let sy = 0;
    if (isVideo) {
      tileW = sheet.videoWidth;
      tileH = sheet.videoHeight;
      if (!tileW) return false;
    } else {
      const elapsed = (performance.now() - startedAt) / 1000;
      const frame = reduced ? 6 : Math.floor(elapsed * ATLAS.fps) % ATLAS.frames;
      tileW = sheet.naturalWidth / ATLAS.cols;
      tileH = sheet.naturalHeight / ATLAS.rows;
      sx = (frame % ATLAS.cols) * tileW;
      sy = Math.floor(frame / ATLAS.cols) * tileH;
    }
    const sw = cols * 2;
    const sh = rows * 2;
    const cellAspect = cellW / cellH;
    const srcAspect = tileW / tileH;
    const gridAspect = (cols * cellW) / (rows * cellH);
    let dw = sw;
    let dh = sh;
    if (srcAspect > gridAspect) dh = Math.max(2, Math.round(sw / (srcAspect / cellAspect) / 2) * 2);
    else dw = Math.max(2, Math.round(sh * (srcAspect / cellAspect) / 2) * 2);
    const dx = Math.floor((sw - dw) / 2);
    const dy = Math.floor((sh - dh) / 2);
    // the empty buffer must read as "no form" under the current polarity
    sampleCtx.fillStyle = opt.invert ? "#fff" : "#000";
    sampleCtx.fillRect(0, 0, sw, sh);
    sampleCtx.drawImage(sheet, sx, sy, tileW, tileH, dx, dy, dw, dh);
    rgb = sampleCtx.getImageData(0, 0, sw, sh).data;

    const lo = opt.black;
    const hi = Math.max(opt.black + 0.02, opt.white);
    for (let i = 0; i < sw * sh; i += 1) {
      // true luma, so colour footage reads correctly
      let v = (rgb[i * 4] * 0.2126 + rgb[i * 4 + 1] * 0.7152 + rgb[i * 4 + 2] * 0.0722) / 255;
      if (opt.invert) v = 1 - v;
      // levels: clamp the wash — greys below black vanish, above white saturate
      v = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
      lum[i] = v;
    }
    return true;
  }

  // cell-resolution reading: mean of the four quadrants
  function cellLum(x, y) {
    const sw = cols * 2;
    const i = y * 2 * sw + x * 2;
    return (lum[i] + lum[i + 1] + lum[i + sw] + lum[i + sw + 1]) / 4;
  }

  function cellFill(x, y) {
    if (opt.colorMode !== "source") return null;
    const sw = cols * 2;
    const i = (y * 2 * sw + x * 2) * 4;
    const j = i + 4;
    const k = i + sw * 4;
    // darkest of three samples, capped away from white, so pale source
    // colours still print as ink rather than vanishing on the paper
    const r = Math.min(rgb[i], rgb[j], rgb[k], 225);
    const g = Math.min(rgb[i + 1], rgb[j + 1], rgb[k + 1], 225);
    const b = Math.min(rgb[i + 2], rgb[j + 2], rgb[k + 2], 225);
    return `rgb(${r},${g},${b})`;
  }

  function drawFrame(now) {
    if (!sampleSource()) return;
    const elapsed = (now - startedAt) / 1000;
    const t = Math.min(1, opt.settle > 0 ? elapsed / opt.settle : 1);
    const inkRgb = hex(opt.ink);
    const accentRgb = hex(opt.accent);
    const settled = mix(accentRgb, inkRgb, t * t * (3 - 2 * t));
    const inkFill = `rgb(${inkRgb[0]},${inkRgb[1]},${inkRgb[2]})`;
    const accentFill = `rgb(${accentRgb[0]},${accentRgb[1]},${accentRgb[2]})`;
    const baseFill = opt.colorMode === "duo" ? accentFill : `rgb(${settled[0]},${settled[1]},${settled[2]})`;

    context.fillStyle = opt.paper;
    context.fillRect(0, 0, width, height);
    context.font = font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = baseFill;

    const algo = opt.algorithm;
    if (algo === "diffuse" || algo === "quad") prepareDiffusion(algo === "quad");

    let currentFill = baseFill;
    for (let y = 0; y < rows; y += 1) {
      const py = Math.round((y * cellH + cellH / 2) * ratio) / ratio;
      for (let x = 0; x < cols; x += 1) {
        const px = Math.round((x * cellW + cellW / 2) * ratio) / ratio;

        // duo: dense cells print in ink, light cells in accent
        const fill = cellFill(x, y)
          ?? (opt.colorMode === "duo" ? (cellLum(x, y) > 0.55 ? inkFill : accentFill) : baseFill);
        if (fill !== currentFill) {
          context.fillStyle = fill;
          currentFill = fill;
        }

        if (algo === "quad") drawQuad(px, py, x, y);
        else if (algo === "edge") drawEdge(px, py, x, y);
        else if (algo === "diffuse") drawDiffuse(px, py, x, y);
        else if (algo === "binary") drawBinary(px, py, x, y, elapsed);
        else drawRamp(px, py, x, y);
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

  // ---- algorithms ----

  function drawRamp(px, py, x, y) {
    let v = cellLum(x, y);
    if (v < opt.floor + hash(x, y) * opt.dither) return;
    v = Math.min(1, (v - opt.floor) / (0.98 - opt.floor));
    const shaped = Math.pow(v, opt.gamma);
    context.globalAlpha = 0.24 + shaped * 0.76;
    context.fillText(ramp[Math.min(ramp.length - 1, Math.floor(shaped * ramp.length))], px, py);
  }

  function drawBinary(px, py, x, y, elapsed) {
    let v = cellLum(x, y);
    if (v < opt.floor + hash(x, y) * opt.dither) return;
    v = Math.min(1, (v - opt.floor) / (0.98 - opt.floor));
    context.globalAlpha = 0.1 + Math.pow(v, opt.gamma) * 0.9;
    context.fillText(hash(x * 1.7, y + elapsed * 2) < 0.5 ? "0" : "1", px, py);
  }

  // Atkinson error diffusion. For quad mode the 2x grid is quantized to
  // on/off; for diffuse mode the cell grid is quantized to ramp levels.
  // Tone is then carried entirely by structure — the classic print look.
  function prepareDiffusion(fine) {
    const sw = cols * 2;
    const sh = rows * 2;
    if (fine) {
      scratch.set(lum);
      for (let y = 0; y < sh; y += 1) {
        for (let x = 0; x < sw; x += 1) {
          const i = y * sw + x;
          const q = scratch[i] > 0.5 ? 1 : 0;
          const err = (scratch[i] - q) / 8;
          scratch[i] = q;
          if (x + 1 < sw) scratch[i + 1] += err;
          if (x + 2 < sw) scratch[i + 2] += err;
          if (y + 1 < sh) {
            if (x > 0) scratch[i + sw - 1] += err;
            scratch[i + sw] += err;
            if (x + 1 < sw) scratch[i + sw + 1] += err;
          }
          if (y + 2 < sh) scratch[i + 2 * sw] += err;
        }
      }
      return;
    }
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const v = cellLum(x, y);
        scratch[y * cols + x] = v <= opt.floor ? 0 : Math.pow(v, opt.gamma);
      }
    }
    const levels = ramp.length;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const i = y * cols + x;
        const q = Math.round(scratch[i] * (levels - 1)) / (levels - 1);
        const err = (scratch[i] - q) / 8;
        scratch[i] = q;
        if (x + 1 < cols) scratch[i + 1] += err;
        if (x + 2 < cols) scratch[i + 2] += err;
        if (y + 1 < rows) {
          if (x > 0) scratch[i + cols - 1] += err;
          scratch[i + cols] += err;
          if (x + 1 < cols) scratch[i + cols + 1] += err;
        }
        if (y + 2 < rows) scratch[i + 2 * cols] += err;
      }
    }
  }

  function drawDiffuse(px, py, x, y) {
    const q = scratch[y * cols + x];
    if (q <= 0.001) return;
    context.globalAlpha = 1;
    context.fillText(ramp[Math.min(ramp.length - 1, Math.round(q * (ramp.length - 1)))], px, py);
  }

  // Each cell is a 2x2 micro-image drawn as exact cell geometry: four times
  // the spatial resolution at the same cell size, so detail survives big,
  // readable cells. This is the honest LED-panel mode.
  function drawQuad(px, py, x, y) {
    const sw = cols * 2;
    const base = y * 2 * sw + x * 2;
    const q0 = scratch[base];
    const q1 = scratch[base + 1];
    const q2 = scratch[base + sw];
    const q3 = scratch[base + sw + 1];
    if (q0 + q1 + q2 + q3 === 0) return;
    context.globalAlpha = 1;
    const hw = cellW / 2;
    const hh = cellH / 2;
    const left = Math.round((px - cellW / 2) * ratio) / ratio;
    const top = Math.round((py - cellH / 2) * ratio) / ratio;
    if (q0) context.fillRect(left, top, hw, hh);
    if (q1) context.fillRect(left + hw, top, hw, hh);
    if (q2) context.fillRect(left, top + hh, hw, hh);
    if (q3) context.fillRect(left + hw, top + hh, hw, hh);
  }

  // Sobel contours as strokes leaning along the edge — the morphospace's
  // structure tensor picks the glyph. The interior whispers in ramp tone.
  // Structure survives at low resolution where tone cannot.
  function drawEdge(px, py, x, y) {
    const v = (dx, dy) => cellLum(Math.min(cols - 1, Math.max(0, x + dx)), Math.min(rows - 1, Math.max(0, y + dy)));
    const gx = (v(1, -1) + 2 * v(1, 0) + v(1, 1)) - (v(-1, -1) + 2 * v(-1, 0) + v(-1, 1));
    const gy = (v(-1, 1) + 2 * v(0, 1) + v(1, 1)) - (v(-1, -1) + 2 * v(0, -1) + v(1, -1));
    const mag = Math.hypot(gx, gy) * opt.edgeGain;
    if (mag > 0.55) {
      const theta = Math.atan2(gy, gx) + Math.PI / 2; // along the contour
      // contour strokes are light, directional glyphs — / \ | ~ — with the
      // weight carried by alpha, so edges read as pen lines, not smears
      const glyph = space.forFlow(theta, 0.1 + Math.min(0.12, mag * 0.04));
      context.globalAlpha = Math.min(1, 0.5 + mag * 0.35);
      context.fillText(space.chars[glyph], px, py);
      return;
    }
    let tone = cellLum(x, y);
    if (tone < opt.floor + hash(x, y) * opt.dither) return;
    tone = Math.min(1, (tone - opt.floor) / (0.98 - opt.floor));
    const shaped = Math.pow(tone, opt.gamma);
    context.globalAlpha = (0.24 + shaped * 0.76) * 0.35;
    context.fillText(ramp[Math.min(ramp.length - 1, Math.floor(shaped * ramp.length))], px, py);
  }

  // ---- loop & api ----

  function loop(now) {
    if (!paused) drawFrame(now);
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
        if (!reduced) video.play().catch(() => { /* paused first frame is fine */ });
        sheet = video;
      } else {
        sheet = new Image();
        sheet.src = `assets/screen/${opt.source === "b" ? "cloud" : "matter"}-atlas.png`;
        await sheet.decode();
      }
      try {
        await Promise.race([
          document.fonts.load('16px "IBM Plex Mono"'),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
      } catch { /* fallback face is fine */ }
      resize();
      window.addEventListener("resize", resize);
      startedAt = performance.now();
      rafId = requestAnimationFrame(loop);
    },

    // Live option updates from the tuning panel.
    set(key, value) {
      opt[key] = value;
      if (key === "cell") resize();
      else if (key === "charset" || key === "custom") buildRamp();
    },
    options: () => ({ ...opt }),
    query: () => toQuery(opt),

    playPause() {
      paused = !paused;
      if (isVideo && sheet) (paused ? sheet.pause() : sheet.play().catch(() => {}));
      return paused;
    },
    seek(seconds) {
      if (isVideo && sheet) sheet.currentTime = seconds;
    },
    duration: () => (isVideo && sheet ? sheet.duration || 0 : ATLAS.frames / ATLAS.fps),
    time: () => (isVideo && sheet ? sheet.currentTime : 0),

    renderAt(now) {
      if (!sheet || !sampleCtx) return;
      if (width !== window.innerWidth || height !== window.innerHeight) resize();
      if (!startedAt) startedAt = now;
      drawFrame(now);
    },
    stop() {
      cancelAnimationFrame(rafId);
    },
  };
}
