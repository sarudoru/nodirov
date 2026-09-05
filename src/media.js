// Sample at character resolution. Aspect uses the physical size of a cell.
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
    const zoom = options.animate ? 1.2 : 1;
    const dw = sw * scale * zoom,
      dh = (sh * scale * zoom) / aspect;
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
      if (options.color === "source")
        colors[i] =
          g > r * 0.85
            ? rgb(r * 0.5, g * 0.85, b * 0.4)
            : rgb(r * 0.92, g * 0.7, b * 0.5);
      else if (options.color === "blue") colors[i] = "#536b9a";
      else if (options.color === "duo")
        colors[i] = luma[i] > 0.5 ? "#514d66" : "#9d6259";
      else colors[i] = "";
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
    for (let i = 0; i < n; i++) {
      const tone = field.luma[i];
      if (tone < 0.065) {
        glyphs[i] = -1;
        ink[i] = 0;
        continue;
      }
      let slot = Math.min(ramp.length - 1, Math.floor(tone * ramp.length));
      if (
        options.animate &&
        slot >= 5 &&
        (i * 13 + (options.phase || 0)) % 7 < 2
      )
        slot = 5 + ((i + (options.phase || 0)) % Math.max(1, ramp.length - 5));
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
export function toGlyphFrame(source, space, cols, rows, options = {}) {
  const sampler = createSampler(),
    field = sampler.sample(source, cols, rows, options);
  return field ? sampler.toGlyphs(field, space, options) : null;
}
