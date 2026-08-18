// The glyph morphospace.
//
// A character set has no inherent order — 'a' is not "next to" 'b' in any
// visual sense. So we build the geometry ourselves: every glyph is rasterized
// once at boot, reduced to a low-resolution coverage vector, and placed in a
// metric space where distance means *looks different*. From that we derive:
//
//   · a k-nearest-neighbour graph over glyphs
//   · all-pairs shortest paths through it (precomputed next-hop table)
//   · a dominant stroke angle and anisotropy per glyph (structure tensor)
//   · a density ordering (the ink ramp, discovered rather than hand-written)
//
// A transition between two glyphs is then a *geodesic*: a short walk through
// visually adjacent shapes. Cross-fading between successive hops blends
// near-identical forms, so the eye reads one shape deforming into another
// instead of two unrelated shapes interfering.

const SAMPLE_W = 6;
const SAMPLE_H = 8;
const DIMS = SAMPLE_W * SAMPLE_H;
const NEIGHBOURS = 7;
const MAX_PATH = 6;

// Rasterize one glyph and return {coverage, density, angle, anisotropy}.
function analyze(context, ch, w, h) {
  context.clearRect(0, 0, w, h);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, w, h);
  context.fillStyle = "#000";
  context.fillText(ch, w / 2, h / 2);

  const pixels = context.getImageData(0, 0, w, h).data;
  const coverage = new Float32Array(DIMS);
  let total = 0;
  let mx = 0;
  let my = 0;

  // first pass: bin into the low-resolution shape vector, and accumulate the
  // ink centroid for the structure tensor
  for (let y = 0; y < h; y += 1) {
    const by = Math.min(SAMPLE_H - 1, (y * SAMPLE_H / h) | 0);
    for (let x = 0; x < w; x += 1) {
      const ink = 1 - pixels[(y * w + x) * 4] / 255;
      if (ink <= 0.01) continue;
      const bx = Math.min(SAMPLE_W - 1, (x * SAMPLE_W / w) | 0);
      coverage[by * SAMPLE_W + bx] += ink;
      total += ink;
      mx += x * ink;
      my += y * ink;
    }
  }

  if (total <= 0) {
    return { coverage, density: 0, angle: 0, anisotropy: 0 };
  }

  // normalize bins to 0..1 by their maximum possible ink
  const perBin = (w / SAMPLE_W) * (h / SAMPLE_H);
  for (let i = 0; i < DIMS; i += 1) coverage[i] = Math.min(1, coverage[i] / perBin);

  mx /= total;
  my /= total;

  // second pass: second moments of the ink distribution. The principal axis
  // of this covariance matrix is the glyph's dominant stroke direction —
  // '|' resolves to vertical, '-' to horizontal, '/' and '\' to the diagonals.
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const ink = 1 - pixels[(y * w + x) * 4] / 255;
      if (ink <= 0.01) continue;
      const dx = x - mx;
      const dy = y - my;
      sxx += ink * dx * dx;
      syy += ink * dy * dy;
      sxy += ink * dx * dy;
    }
  }
  sxx /= total;
  syy /= total;
  sxy /= total;

  // eigen-decomposition of the 2x2 symmetric covariance matrix
  const trace = sxx + syy;
  const diff = Math.sqrt(Math.max(0, (sxx - syy) * (sxx - syy) + 4 * sxy * sxy));
  const l1 = (trace + diff) / 2;
  const l2 = (trace - diff) / 2;
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy); // −π/2..π/2, screen coords
  const anisotropy = l1 + l2 > 0 ? (l1 - l2) / (l1 + l2) : 0;

  return {
    coverage,
    density: total / (w * h),
    angle,
    anisotropy,
  };
}

function distance(vectors, a, b) {
  let sum = 0;
  const ao = a * DIMS;
  const bo = b * DIMS;
  for (let i = 0; i < DIMS; i += 1) {
    const d = vectors[ao + i] - vectors[bo + i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function buildGlyphSpace(chars, font, cellW, cellH) {
  const n = chars.length;
  const scale = 2;
  const w = Math.max(8, Math.round(cellW * scale));
  const h = Math.max(10, Math.round(cellH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.font = font.replace(/^\d+(\.\d+)?px/, `${Math.round(parseFloat(font) * scale)}px`);
  context.textAlign = "center";
  context.textBaseline = "middle";

  const vectors = new Float32Array(n * DIMS);
  const density = new Float32Array(n);
  const angle = new Float32Array(n);
  const anisotropy = new Float32Array(n);
  const index = new Map();

  for (let i = 0; i < n; i += 1) {
    const info = analyze(context, chars[i], w, h);
    vectors.set(info.coverage, i * DIMS);
    density[i] = info.density;
    angle[i] = info.angle;
    anisotropy[i] = info.anisotropy;
    index.set(chars[i], i);
  }

  // --- k-nearest-neighbour graph ---
  const neighbours = new Int16Array(n * NEIGHBOURS).fill(-1);
  const neighbourDist = new Float32Array(n * NEIGHBOURS);
  const scratch = new Array(n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) scratch[j] = { j, d: i === j ? Infinity : distance(vectors, i, j) };
    scratch.sort((a, b) => a.d - b.d);
    for (let k = 0; k < NEIGHBOURS; k += 1) {
      neighbours[i * NEIGHBOURS + k] = scratch[k].j;
      neighbourDist[i * NEIGHBOURS + k] = scratch[k].d;
    }
  }

  // --- all-pairs shortest paths (Floyd–Warshall over the kNN graph) ---
  // n is ~100, so this is ~1e6 operations at boot: a few milliseconds, once.
  // The payoff is O(1) lookup of the next hop for any transition at runtime.
  const INF = 1e9;
  const dist = new Float32Array(n * n).fill(INF);
  const next = new Int16Array(n * n).fill(-1);
  for (let i = 0; i < n; i += 1) {
    dist[i * n + i] = 0;
    next[i * n + i] = i;
    for (let k = 0; k < NEIGHBOURS; k += 1) {
      const j = neighbours[i * NEIGHBOURS + k];
      if (j < 0) continue;
      const d = neighbourDist[i * NEIGHBOURS + k];
      if (d < dist[i * n + j]) {
        dist[i * n + j] = d;
        next[i * n + j] = j;
        // keep the graph undirected so paths exist in both directions
        if (d < dist[j * n + i]) {
          dist[j * n + i] = d;
          next[j * n + i] = i;
        }
      }
    }
  }
  for (let k = 0; k < n; k += 1) {
    const kn = k * n;
    for (let i = 0; i < n; i += 1) {
      const inn = i * n;
      const ik = dist[inn + k];
      if (ik >= INF) continue;
      for (let j = 0; j < n; j += 1) {
        const alt = ik + dist[kn + j];
        if (alt < dist[inn + j]) {
          dist[inn + j] = alt;
          next[inn + j] = next[inn + k];
        }
      }
    }
  }

  // density ordering: the ink ramp, discovered from the font rather than guessed
  const byDensity = Array.from({ length: n }, (_, i) => i).sort((a, b) => density[a] - density[b]);

  return {
    chars,
    size: n,
    density,
    angle,
    anisotropy,
    indexOf: (ch) => index.get(ch) ?? -1,
    byDensity,

    // The geodesic between two glyphs, as an array of glyph indices
    // (inclusive of both ends). Falls back to a direct hop if the graph is
    // disconnected or the walk runs long.
    path(a, b) {
      if (a === b || a < 0 || b < 0) return [b];
      let cursor = a;
      const out = [a];
      let guard = 0;
      while (cursor !== b && guard < MAX_PATH) {
        const step = next[cursor * n + b];
        if (step < 0 || step === cursor) break;
        cursor = step;
        out.push(cursor);
        guard += 1;
      }
      if (out[out.length - 1] !== b) out.push(b);
      return out;
    },

    // The morph sequence between two glyphs: interpolate their shape vectors
    // and snap each intermediate point to the nearest real glyph. Unlike the
    // graph geodesic this guarantees a fixed number of steps, so transitions
    // have predictable duration, and every consecutive pair is close in shape
    // — which is what makes the cross-fade read as deformation.
    morph(a, b, steps) {
      if (a < 0 || b < 0 || a === b) return [b];
      const out = [a];
      const ao = a * DIMS;
      const bo = b * DIMS;
      const probe = new Float32Array(DIMS);
      const used = new Set([a, b]);
      // distance-to-target must strictly decrease, so the walk never doubles
      // back — the eye reads steady progress rather than indecision
      let ceiling = distance(vectors, a, b);
      const kappaDir = Math.sign(density[b] - density[a]);
      let kappaLast = density[a];

      for (let s = 1; s < steps; s += 1) {
        const t = s / steps;
        for (let d = 0; d < DIMS; d += 1) {
          probe[d] = vectors[ao + d] * (1 - t) + vectors[bo + d] * t;
        }
        let best = -1;
        let bestScore = Infinity;
        for (let i = 0; i < n; i += 1) {
          if (used.has(i)) continue;
          const toTarget = distance(vectors, i, b);
          if (toTarget >= ceiling) continue;
          // Monotone in ink: at these opacities brightness is almost the only
          // channel the eye has, so a ladder that brightens then darkens reads
          // as a glitch however well the shapes match. Forcing the walk to
          // move steadily along the density axis makes the cell read as
          // condensing or evaporating — one process, not a flicker.
          if (kappaDir !== 0 && (density[i] - kappaLast) * kappaDir < -0.004) continue;
          let sum = 0;
          const io = i * DIMS;
          for (let d = 0; d < DIMS; d += 1) {
            const diff = vectors[io + d] - probe[d];
            sum += diff * diff;
          }
          if (sum < bestScore) {
            bestScore = sum;
            best = i;
          }
        }
        if (best < 0) break; // nothing closer remains: settle early
        used.add(best);
        ceiling = distance(vectors, best, b);
        kappaLast = density[best];
        out.push(best);
      }
      out.push(b);
      return out;
    },

    // Nearest glyph to a target ink density — used for ramps and for mapping
    // simulation energy onto characters.
    atDensity(target) {
      let lo = 0;
      let hi = byDensity.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (density[byDensity[mid]] < target) lo = mid + 1;
        else hi = mid;
      }
      return byDensity[lo];
    },

    // Glyph whose dominant stroke best matches a flow direction, at roughly a
    // given ink density. This is what lets a cursor wake read as *current*.
    forFlow(theta, targetDensity, minAnisotropy = 0.25) {
      let best = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < n; i += 1) {
        if (anisotropy[i] < minAnisotropy) continue;
        // orientation is modulo π: a stroke has no head or tail
        let delta = angle[i] - theta;
        while (delta > Math.PI / 2) delta -= Math.PI;
        while (delta < -Math.PI / 2) delta += Math.PI;
        const align = Math.cos(2 * delta); // 1 aligned, −1 perpendicular
        const densityPenalty = Math.abs(density[i] - targetDensity) * 3;
        const score = align * anisotropy[i] - densityPenalty;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      return best >= 0 ? best : byDensity[0];
    },
  };
}
