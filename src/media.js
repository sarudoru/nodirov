// Sample at character resolution. Aspect uses the physical size of a cell.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function createSampler() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const palette = new Map();
  function rgb(r, g, b) {
    const values = [r, g, b].map((v) =>
      Math.max(0, Math.min(255, Math.round(v / 12) * 12)),
    );
    const key = values.join(",");
    if (!palette.has(key)) palette.set(key, `rgb(${key})`);
    return palette.get(key);
  }
  function sample(source, cols, rows, options = {}) {
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) return null;
    if (canvas.width !== cols || canvas.height !== rows) {
      canvas.width = cols;
      canvas.height = rows;
    }
    const aspect = options.aspect || 2;
    const scale =
      options.fit === "contain"
        ? Math.min(cols / sw, (rows * aspect) / sh)
        : Math.max(cols / sw, (rows * aspect) / sh);
    const dw = sw * scale,
      dh = (sh * scale) / aspect;
    context.fillStyle = options.invert ? "#000" : "#fff";
    context.fillRect(0, 0, cols, rows);
    context.imageSmoothingQuality = "high";
    context.drawImage(source, (cols - dw) / 2, (rows - dh) / 2, dw, dh);
    const pixels = context.getImageData(0, 0, cols, rows).data;
    const luma = new Float32Array(cols * rows);
    const colors = new Array(cols * rows);
    for (let i = 0; i < luma.length; i++) {
      const r = pixels[i * 4],
        g = pixels[i * 4 + 1],
        b = pixels[i * 4 + 2];
      const brightness = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
      luma[i] = Math.pow(
        options.invert ? brightness : 1 - brightness,
        options.gamma || 1,
      );
      colors[i] =
        options.color === "source"
          ? rgb(r * 0.92, g * 0.75, b * 0.55)
          : "";
    }
    return { luma, colors, cols, rows };
  }
  function toGlyphs(field, space, options = {}, out = null) {
    const n = field.cols * field.rows;
    const glyphs = out?.glyphs?.length === n ? out.glyphs : new Int16Array(n);
    const ink = out?.ink?.length === n ? out.ink : new Float32Array(n);
    const ramp = [...(options.ramp || ".,:;=+*#%@")].map((ch) =>
      space.indexOf(ch),
    );
    // an ordered dither keeps flat highlights from printing as one solid
    // glyph: neighbouring cells take turns one step apart
    const dither = options.dither || 0;
    for (let i = 0; i < n; i++) {
      const tone = field.luma[i];
      if (tone < 0.065) {
        glyphs[i] = -1;
        ink[i] = 0;
        continue;
      }
      const x = i % field.cols;
      const y = (i - x) / field.cols;
      const noise = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * dither;
      const slot = Math.max(
        0,
        Math.min(ramp.length - 1, Math.floor((tone + noise) * ramp.length)),
      );
      glyphs[i] = ramp[slot];
      ink[i] =
        options.color === "source"
          ? Math.min(1, 0.58 + tone)
          : Math.min(1, 0.22 + tone * 0.95);
    }
    return {
      glyphs,
      ink,
      colors: field.colors,
      cols: field.cols,
      rows: field.rows,
    };
  }
  return { sample, toGlyphs };
}
