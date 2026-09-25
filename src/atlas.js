// The glyph atlas: every character the field can show, drawn once into a
// texture at device resolution, one slot per glyph, each slot exactly one
// cell. A cell on screen and its slot in the atlas are the same size, so the
// renderer copies pixels one to one and every glyph stays as crisp as text
// the browser would draw itself.
//
// Each glyph also gets a shape vector: its ink binned into a small grid. The
// optics use it to decide which character best stands for the part of a
// letter that is passing through a cell.

export const SHAPE_W = 5;
export const SHAPE_H = 20;
const DIMS = SHAPE_W * SHAPE_H;

// Glyphs drawn as cell geometry rather than taken from the font. A font's
// dots and blocks have its own sizes; these are exact fractions of the cell.
// The lattice's own dots live in the private use area, so they never
// collide with a "·" the document writes.
const DOT_SIZES = [0.11, 0.145, 0.18, 0.215, 0.25, 0.29, 0.33];
export const DOT = DOT_SIZES.map((_, k) => String.fromCharCode(0xe000 + k));

const PROCEDURAL = {
  // dot diameters as a share of the cell width
  ...Object.fromEntries(DOT.map((ch, k) => [ch, { dot: DOT_SIZES[k] }])),
  // block elements: [x, y, w, h] as cell fractions
  "█": { rect: [0, 0, 1, 1] },
  "▀": { rect: [0, 0, 1, 0.5] },
  "▄": { rect: [0, 0.5, 1, 0.5] },
  "▌": { rect: [0, 0, 0.5, 1] },
  "▐": { rect: [0.5, 0, 0.5, 1] },
  // light box drawing, stroked across the whole cell so rules and boxes
  // join without the gaps a font's own advance would leave: arms are
  // [left, right, up, down]
  "─": { box: [1, 1, 0, 0] },
  "│": { box: [0, 0, 1, 1] },
  "┌": { box: [0, 1, 0, 1] },
  "┐": { box: [1, 0, 0, 1] },
  "└": { box: [0, 1, 1, 0] },
  "┘": { box: [1, 0, 1, 0] },
  "├": { box: [0, 1, 1, 1] },
  "┤": { box: [1, 0, 1, 1] },
  "┬": { box: [1, 1, 0, 1] },
  "┴": { box: [1, 1, 1, 0] },
  "┼": { box: [1, 1, 1, 1] },
};

export function createAtlas({ family, size, dpr, cellWd, cellHd }) {
  const perRow = Math.max(8, Math.floor(2048 / cellWd));
  let capacityRows = 16;
  const canvas = document.createElement("canvas");
  canvas.width = perRow * cellWd;
  canvas.height = capacityRows * cellHd;
  let context = setup();

  const chars = [" "];          // slot 0 is the empty cell
  const index = new Map([[" ", 0]]);
  let vectors = new Float32Array(64 * DIMS);
  let norms = new Float32Array(64);
  let density = new Float32Array(64);
  let dirty = true;             // texture needs an upload
  let grown = true;             // texture needs reallocation

  // Where the baseline sits so that canvas glyphs and the browser's own text
  // layout (line-height = cell height) agree to the device pixel.
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = fontAt(size);
  const m = probe.measureText("Hxgy");
  const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
  const baselineCss = (cellHd / dpr - (ascent + descent)) / 2 + ascent;
  const baseline = Math.round(baselineCss * dpr);
  const xHeight = probe.measureText("x").actualBoundingBoxAscent || size * 0.5;
  const midline = baseline - (xHeight * dpr) / 2;

  function fontAt(px) {
    return `${px}px "${family}", ui-monospace, Menlo, monospace`;
  }

  function setup() {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = fontAt(size * dpr);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    return ctx;
  }

  function grow() {
    const old = context.getImageData(0, 0, canvas.width, canvas.height);
    capacityRows *= 2;
    canvas.height = capacityRows * cellHd;
    context = setup();
    context.putImageData(old, 0, 0);
    const cap = perRow * capacityRows;
    const v = new Float32Array(cap * DIMS); v.set(vectors); vectors = v;
    const n = new Float32Array(cap); n.set(norms); norms = n;
    const d = new Float32Array(cap); d.set(density); density = d;
    grown = true;
  }

  function draw(slot, ch) {
    const x = (slot % perRow) * cellWd;
    const y = Math.floor(slot / perRow) * cellHd;
    context.fillStyle = "#000";
    context.fillRect(x, y, cellWd, cellHd);
    context.fillStyle = "#fff";
    const shape = PROCEDURAL[ch];
    if (shape?.dot) {
      const r = Math.max(1, (shape.dot * cellWd) / 2);
      context.beginPath();
      context.arc(x + cellWd / 2, y + Math.round(cellHd / 2), r, 0, Math.PI * 2);
      context.fill();
    } else if (shape?.box) {
      const [left, right, up, down] = shape.box;
      const t = Math.max(1, Math.round(dpr));
      const cx = x + Math.floor((cellWd - t) / 2);
      // the horizontal stroke sits on the x-height's middle, where a dash sits
      const cy = y + Math.round(midline - t / 2);
      if (left) context.fillRect(x, cy, cx - x + t, t);
      if (right) context.fillRect(cx, cy, x + cellWd - cx, t);
      if (up) context.fillRect(cx, y, t, cy - y + t);
      if (down) context.fillRect(cx, cy, t, y + cellHd - cy);
    } else if (shape?.rect) {
      const [rx, ry, rw, rh] = shape.rect;
      context.fillRect(
        x + Math.round(rx * cellWd), y + Math.round(ry * cellHd),
        Math.round(rw * cellWd), Math.round(rh * cellHd),
      );
    } else {
      context.save();
      context.beginPath();
      context.rect(x, y, cellWd, cellHd);
      context.clip();
      context.fillText(ch, x + cellWd / 2, y + baseline);
      context.restore();
    }
    analyze(slot, x, y);
    dirty = true;
  }

  function analyze(slot, x, y) {
    const pixels = context.getImageData(x, y, cellWd, cellHd).data;
    const out = vectors.subarray(slot * DIMS, (slot + 1) * DIMS);
    out.fill(0);
    const counts = new Float32Array(DIMS);
    let total = 0;
    for (let py = 0; py < cellHd; py++) {
      const by = Math.min(SHAPE_H - 1, Math.floor((py * SHAPE_H) / cellHd));
      for (let px = 0; px < cellWd; px++) {
        const bx = Math.min(SHAPE_W - 1, Math.floor((px * SHAPE_W) / cellWd));
        const ink = pixels[(py * cellWd + px) * 4] / 255;
        out[by * SHAPE_W + bx] += ink;
        counts[by * SHAPE_W + bx] += 1;
        total += ink;
      }
    }
    let norm = 0;
    for (let k = 0; k < DIMS; k++) {
      out[k] = counts[k] ? out[k] / counts[k] : 0;
      norm += out[k] * out[k];
    }
    norms[slot] = norm;
    density[slot] = total / (cellWd * cellHd);
  }

  function ensure(ch) {
    let slot = index.get(ch);
    if (slot !== undefined) return slot;
    slot = chars.length;
    if (slot >= perRow * capacityRows) grow();
    chars.push(ch);
    index.set(ch, slot);
    draw(slot, ch);
    return slot;
  }

  return {
    canvas,
    perRow,
    cellWd,
    cellHd,
    baseline,
    ensure,
    has: (ch) => index.has(ch),
    char: (slot) => chars[slot] ?? " ",
    size: () => chars.length,
    vector: (slot) => vectors.subarray(slot * DIMS, (slot + 1) * DIMS),
    norm: (slot) => norms[slot],
    density: (slot) => density[slot],
    // the renderer asks once per frame; true means the pixels changed
    takeDirty() {
      const state = { dirty, grown };
      dirty = false;
      grown = false;
      return state;
    },
  };
}
