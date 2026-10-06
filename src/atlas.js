// The glyph atlas: every character the field can show, drawn once into a
// canvas at device resolution, one slot per glyph, each slot exactly one
// cell. A cell on screen and its slot in the atlas are the same size, so the
// renderer copies pixels one to one and every resting glyph stays as crisp
// as text the browser would draw itself.

// The lattice's own dots live in the private use area, so they never
// collide with a "·" the document writes.
const DOT_SIZES = [0.11, 0.145, 0.18, 0.215, 0.25, 0.29, 0.33];
export const DOT = DOT_SIZES.map((_, k) => String.fromCharCode(0xe000 + k));
// The dots a letter becomes while the page moves sit on the middle of the
// x-height, where the letters' own weight is, so a letter and its dot share
// a line.
export const TEXT_DOT = DOT_SIZES.map((_, k) => String.fromCharCode(0xe010 + k));

// Glyphs drawn as cell geometry rather than taken from the font: the font's
// own dots and strokes have its sizes and its advance; these are exact
// fractions of the cell, so dots scale cleanly and rules join.
const PROCEDURAL = {
  // dot diameters as a share of the cell width
  ...Object.fromEntries(DOT.map((ch, k) => [ch, { dot: DOT_SIZES[k] }])),
  ...Object.fromEntries(TEXT_DOT.map((ch, k) => [ch, { dot: DOT_SIZES[k], mid: true }])),
  // block elements: [x, y, w, h] as cell fractions
  "█": { rect: [0, 0, 1, 1] },
  "▀": { rect: [0, 0, 1, 0.5] },
  "▄": { rect: [0, 0.5, 1, 0.5] },
  "▌": { rect: [0, 0, 0.5, 1] },
  "▐": { rect: [0.5, 0, 0.5, 1] },
  // light box drawing, stroked across the whole cell: arms are
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

  const chars = [" "]; // slot 0 is the empty cell
  const index = new Map([[" ", 0]]);
  let dirty = true; // the renderer needs a fresh upload

  // Where the baseline sits so that canvas glyphs and the browser's own text
  // layout (line-height = cell height) agree to the device pixel.
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = fontAt(size);
  const m = probe.measureText("Hxgy");
  const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
  const baseline = Math.round(((cellHd / dpr - (ascent + descent)) / 2 + ascent) * dpr);
  // rules sit on the middle of the x-height, where a dash sits
  const xHeight = probe.measureText("x").actualBoundingBoxAscent || size * 0.5;
  const midline = baseline - (xHeight * dpr) / 2;

  function fontAt(px) {
    return `${px}px "${family}", ui-monospace, Menlo, monospace`;
  }

  function setup() {
    const ctx = canvas.getContext("2d");
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
      context.arc(x + cellWd / 2, y + Math.round(shape.mid ? midline : cellHd / 2), r, 0, Math.PI * 2);
      context.fill();
    } else if (shape?.box) {
      const [left, right, up, down] = shape.box;
      const t = Math.max(1, Math.round(dpr));
      const cx = x + Math.floor((cellWd - t) / 2);
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
    dirty = true;
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
    baseline,
    ensure,
    char: (slot) => chars[slot] ?? " ",
    size: () => chars.length,
    // the renderer asks once per frame; true means the pixels changed
    takeDirty() {
      const was = dirty;
      dirty = false;
      return was;
    },
  };
}
