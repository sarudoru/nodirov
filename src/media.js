// Media → glyphs.
//
// Any raster source (image, video frame, canvas, camera) is read into the
// grid using the *same* morphospace the substrate uses. Nothing here knows
// about ASCII ramps or hand-picked character sets: tone is answered by the
// glyph the font says has that ink density, and edges are answered by the
// glyph whose strokes lean that way. The character ROM is the font itself.
//
// Two channels per cell, both derived from the font rather than authored:
//
//   tone   mean luminance of the cell's pixels  -> space.atDensity()
//   edge   Sobel magnitude + orientation        -> space.forFlow()
//
// Where an edge is strong the glyph follows the contour; elsewhere it
// follows the tone. That combination is what separates ASCII art that reads
// as a drawing from ASCII art that reads as a grey smear.

const SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
const SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

export function createSampler() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let luma = new Float32Array(0);
  let gx = new Float32Array(0);
  let gy = new Float32Array(0);

  // Draw the source into a cols x rows buffer, "cover"-cropped, and reduce
  // it to per-cell luminance. One getImageData per frame is the only readback.
  function sample(source, cols, rows, options = {}) {
    const { fit = "cover", gamma = 1, invert = false, contrast = 1, brightness = 0 } = options;
    if (canvas.width !== cols || canvas.height !== rows) {
      canvas.width = cols;
      canvas.height = rows;
    }
    const sw = source.videoWidth ?? source.naturalWidth ?? source.width;
    const sh = source.videoHeight ?? source.naturalHeight ?? source.height;
    if (!sw || !sh) return null;

    context.clearRect(0, 0, cols, rows);
    const scale = fit === "contain"
      ? Math.min(cols / sw, rows / sh)
      : Math.max(cols / sw, rows / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    context.drawImage(source, (cols - dw) / 2, (rows - dh) / 2, dw, dh);

    const n = cols * rows;
    if (luma.length !== n) {
      luma = new Float32Array(n);
      gx = new Float32Array(n);
      gy = new Float32Array(n);
    }
    const pixels = context.getImageData(0, 0, cols, rows).data;
    for (let i = 0; i < n; i += 1) {
      // Rec. 709 luma, then the artistic controls
      let v = (0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2]) / 255;
      const alpha = pixels[i * 4 + 3] / 255;
      v = v * alpha + (1 - alpha); // composite onto white paper
      v = (v - 0.5) * contrast + 0.5 + brightness;
      v = Math.min(1, Math.max(0, v));
      if (gamma !== 1) v = Math.pow(v, gamma);
      luma[i] = invert ? v : 1 - v; // store as INK: dark pixels want dense glyphs
    }

    // Sobel on the reduced buffer: cheap, and at grid resolution it is exactly
    // the scale we care about — contours between cells, not within them.
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        let sx = 0;
        let sy = 0;
        for (let k = 0; k < 9; k += 1) {
          const yy = Math.min(rows - 1, Math.max(0, y + ((k / 3) | 0) - 1));
          const xx = Math.min(cols - 1, Math.max(0, x + (k % 3) - 1));
          const v = luma[yy * cols + xx];
          sx += v * SOBEL_X[k];
          sy += v * SOBEL_Y[k];
        }
        gx[y * cols + x] = sx;
        gy[y * cols + x] = sy;
      }
    }
    return { luma, gx, gy, cols, rows };
  }

  return {
    sample,

    // Read a sampled field out as glyph indices + per-cell ink.
    // `space` is a glyph morphospace; `out` may be reused across frames.
    toGlyphs(field, space, options = {}, out = null) {
      const { edgeThreshold = 0.22, edgeBoost = 1, inkFloor = 0.02, maxDensity = 0.42 } = options;
      const n = field.cols * field.rows;
      const glyphs = out?.glyphs?.length === n ? out.glyphs : new Int16Array(n);
      const ink = out?.ink?.length === n ? out.ink : new Float32Array(n);

      for (let i = 0; i < n; i += 1) {
        const tone = field.luma[i];
        const ex = field.gx[i];
        const ey = field.gy[i];
        const edge = Math.hypot(ex, ey) * edgeBoost;

        // Tone drives how much ink this cell is allowed to spend.
        const density = Math.min(maxDensity, tone * maxDensity);
        if (tone < inkFloor) {
          glyphs[i] = -1; // transparent: the substrate shows through
          ink[i] = 0;
          continue;
        }

        if (edge > edgeThreshold) {
          // Gradient points across the edge; the stroke should run ALONG it.
          const theta = Math.atan2(ey, ex) + Math.PI / 2;
          glyphs[i] = space.forFlow(theta, Math.max(density, 0.05));
        } else {
          glyphs[i] = space.atDensity(density);
        }
        ink[i] = tone;
      }
      return { glyphs, ink, cols: field.cols, rows: field.rows };
    },
  };
}

// Convenience: one-shot conversion of any drawable source to a glyph frame.
export function toGlyphFrame(source, space, cols, rows, options = {}) {
  const sampler = createSampler();
  const field = sampler.sample(source, cols, rows, options);
  if (!field) return null;
  return sampler.toGlyphs(field, space, options);
}
