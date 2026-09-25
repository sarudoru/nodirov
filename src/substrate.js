// The substrate: what every cell shows when the document is not using it.
//
// At rest each cell holds one small mark, so the whole screen reads as a
// fixed lattice. That lattice is the reference the eye needs: whatever
// passes through it, the marks stay where they are.
//
// Each cell has an energy. Energy decides which character the cell holds:
// the resting mark when cool, then heavier marks up a ramp as it warms.
// Energy comes from four places, and all of them change cells in place:
//
//   heat      the cursor's path, and the document's ink as it passes
//             through (the wake a scrolled line leaves behind)
//   flow      the direction the cursor moved, so warm marks lean with it
//   ripples   a click sends a ring outward
//   weather   a slow field that swells and fades in place, never drifting

import { DOT } from "./atlas.js";

export function createSubstrate(atlas, params) {
  let P = params;
  let cols = 0;
  let rows = 0;
  let n = 0;
  let aspect = 1.5;

  let heat = new Float32Array(0);
  let trail = new Float32Array(0);
  let flowX = new Float32Array(0);
  let flowY = new Float32Array(0);
  // clicks: rings measured in screen distance, so they stay round on a
  // grid whose cells are taller than wide
  let ripples = [];

  let restGlyph = new Uint16Array(0);
  let restInk = new Float32Array(0);
  let vignette = new Float32Array(0);
  let level = new Int8Array(0);
  let shown = new Uint16Array(0);
  let from = new Uint16Array(0);
  let fromInk = new Float32Array(0);
  let changedAt = new Float32Array(0);
  let weather = new Float32Array(0);
  let weatherAt = -1e9;

  let rest = [];
  let ramp = [];
  let strokes = [];

  // the pointer presses on the lattice: marks swell around it
  let pointer = null;

  // first contact: a ring leaves the origin and switches the lattice on
  let reveal = null;
  let arrival = new Float32Array(0);

  let seed = 0x6d2b79f5;
  function rnd() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  }

  function hash3(x, y, z) {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x61c88647);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  }

  function noise3(x, y, z) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const fx = x - xi;
    const fy = y - yi;
    const fz = z - zi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const w = fz * fz * (3 - 2 * fz);
    const lerp = (a, b, t) => a + (b - a) * t;
    const x00 = lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u);
    const x10 = lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u);
    const x01 = lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u);
    const x11 = lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  }

  const SETS = {
    rest: {
      dot: [DOT[0]],
      plus: ["+"],
      mark: [DOT[0], DOT[0], DOT[0], ".", "'", "`", ","],
    },
    ramp: {
      dots: DOT.slice(1),
      marks: [":", "+", "*"],
      soft: [DOT[1], ":", "+", "*"],
    },
  };

  function buildSets() {
    rest = (SETS.rest[P.restMark] ?? SETS.rest.dot).map((ch) => atlas.ensure(ch));
    ramp = (SETS.ramp[P.ramp] ?? SETS.ramp.soft).map((ch) => atlas.ensure(ch));
    // strokes by orientation, a quarter turn in four steps
    strokes = ["-", "\\", "|", "/"].map((ch) => atlas.ensure(ch));
    for (let i = 0; i < n; i++) {
      restGlyph[i] = rest[(hash3(i, 7, 3) * rest.length) | 0];
      if (level[i] === 0) shown[i] = restGlyph[i];
    }
  }

  function buildVignette() {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dx = ((c + 0.5) / cols) * 2 - 1;
        const dy = ((r + 0.5) / rows) * 2 - 1;
        const excess = Math.max(0, Math.hypot(dx * 0.8, dy) - 0.7) / 0.6;
        vignette[r * cols + c] = 1 - P.vignette * Math.min(1, excess * excess);
      }
    }
  }

  function resize(nextCols, nextRows, nextAspect) {
    cols = nextCols;
    rows = nextRows;
    aspect = nextAspect;
    n = cols * rows;
    heat = new Float32Array(n);
    trail = new Float32Array(n);
    flowX = new Float32Array(n);
    flowY = new Float32Array(n);
    restGlyph = new Uint16Array(n);
    restInk = new Float32Array(n);
    vignette = new Float32Array(n);
    level = new Int8Array(n);
    shown = new Uint16Array(n);
    from = new Uint16Array(n);
    fromInk = new Float32Array(n);
    changedAt = new Float32Array(n).fill(-1e9);
    weather = new Float32Array(n);
    arrival = new Float32Array(n);
    for (let i = 0; i < n; i++) restInk[i] = 0.82 + rnd() * 0.36;
    buildSets();
    buildVignette();
    if (reveal) placeReveal();
  }

  // ---- input ----

  function warm(col, row, vx, vy, strength) {
    const radius = P.warmRadius;
    const r0 = Math.max(0, Math.floor(row - radius / aspect));
    const r1 = Math.min(rows - 1, Math.ceil(row + radius / aspect));
    const c0 = Math.max(0, Math.floor(col - radius));
    const c1 = Math.min(cols - 1, Math.ceil(col + radius));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dx = c + 0.5 - col;
        const dy = (r + 0.5 - row) * aspect;
        const d = Math.hypot(dx, dy) / radius;
        if (d >= 1) continue;
        const w = (1 - d) * (1 - d) * strength;
        const i = r * cols + c;
        heat[i] = Math.min(1.6, heat[i] + w * P.warmGain);
        flowX[i] += vx * w;
        flowY[i] += vy * w;
      }
    }
  }

  function impulse(col, row, now) {
    ripples.push({ col, row, t0: now });
    if (ripples.length > 6) ripples.shift();
  }

  // Energy a ring adds at a cell: a narrow band travelling outward, fading
  // with age.
  function rippleAt(c, r, now) {
    let e = 0;
    for (const ring of ripples) {
      const age = (now - ring.t0) / 1000;
      const radius = age * P.rippleSpeed;
      const d = Math.hypot(c - ring.col, (r - ring.row) * aspect);
      const band = 1 - Math.abs(d - radius) / P.rippleWidth;
      if (band <= 0) continue;
      e += band * band * P.rippleEnergy * Math.max(0, 1 - age / P.rippleLife);
    }
    return e;
  }

  function placeReveal() {
    const { oc, or } = reveal;
    let last = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const d = Math.hypot(c - oc, (r - or) * aspect);
        // a little grain in the front so it reads as matter, not a vector ring
        const t = (d / P.revealSpeed) * 1000 + hash3(c, r, 11) * 70;
        arrival[r * cols + c] = t;
        if (t > last) last = t;
      }
    }
    reveal.duration = last + 700;
  }

  // ---- simulation ----

  function step(now, dt) {
    const cool = Math.exp(-dt / Math.max(1, P.coolMs));
    const fade = Math.exp(-dt / Math.max(1, P.wakeMs));
    const slack = Math.exp(-dt / 180);
    for (let i = 0; i < n; i++) {
      heat[i] *= cool;
      trail[i] *= fade;
      flowX[i] *= slack;
      flowY[i] *= slack;
    }

    if (ripples.length) ripples = ripples.filter((ring) => now - ring.t0 < P.rippleLife * 1000);

    // weather changes slowly; ten updates a second are plenty
    if (P.weather > 0 && now - weatherAt > 100) {
      weatherAt = now;
      const z = now * 0.001 * P.weatherSpeed;
      const sx = 1 / P.weatherScale;
      const sy = aspect / P.weatherScale;
      const floor = 0.62;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = noise3(c * sx, r * sy, z);
          weather[r * cols + c] = v > floor ? ((v - floor) / (1 - floor)) * P.weather : 0;
        }
      }
    } else if (P.weather <= 0 && weatherAt !== -1e9) {
      weather.fill(0);
      weatherAt = -1e9;
    }

    if (reveal && now - reveal.t0 > reveal.duration) reveal = null;

    // the lens eases in and out rather than popping
    if (pointer) {
      const target = pointer.leaving ? 0 : 1;
      pointer.strength += (target - pointer.strength) * (1 - Math.exp(-dt / 90));
      if (pointer.leaving && pointer.strength < 0.01) pointer = null;
    }
  }

  // ---- readout ----

  // Content gate for the first-contact reveal: 0 before the ring reaches the
  // cell, 1 once it has passed.
  function contentGate(i, now) {
    if (!reveal) return 1;
    const d = now - reveal.t0 - arrival[i];
    return d <= 30 ? 0 : d >= 330 ? 1 : smooth((d - 30) / 300);
  }

  function smooth(t) {
    return t * t * (3 - 2 * t);
  }

  // What the lattice holds at a cell right now: the glyph, the glyph it is
  // fading from, and how far along that fade is. `out` is reused.
  const out = { glyph: 0, from: 0, t: 1, ink: 0, fromInk: 0 };

  function sample(i, now, still = false) {
    if (still) {
      out.glyph = restGlyph[i];
      out.from = restGlyph[i];
      out.t = 1;
      out.ink = out.fromInk = P.restAlpha * restInk[i] * vignette[i];
      return out;
    }
    // weather and the wake only darken a cell's mark; they never change
    // which mark it is. Changing marks is for touch.
    let e = heat[i];
    if (ripples.length) e += rippleAt((i % cols) + 0.5, Math.floor(i / cols) + 0.5, now);
    if (pointer) {
      const dx = (i % cols) + 0.5 - pointer.col;
      const dy = (Math.floor(i / cols) + 0.5 - pointer.row) * aspect;
      const d2 = (dx * dx + dy * dy) / (P.lensRadius * P.lensRadius);
      if (d2 < 1) e += (1 - d2) * (1 - d2) * P.lens * pointer.strength;
    }
    let lattice = 1;
    if (reveal) {
      const d = now - reveal.t0 - arrival[i];
      lattice = d <= -40 ? 0 : d >= 220 ? 1 : smooth((d + 40) / 260);
      // the ring itself: cells flare as it passes through them
      const ring = 1 - Math.abs(d - 40) / 90;
      if (ring > 0) e += ring * ring * P.revealRing;
    }

    // hysteresis keeps a cell on a level boundary from chattering
    const cur = level[i];
    const t0 = P.warmThreshold;
    const stepE = P.levelStep;
    let want = e < t0 ? 0 : Math.min(ramp.length, 1 + Math.floor((e - t0) / stepE));
    if (want !== cur) {
      const edge = want > cur ? t0 + (want - 1) * stepE : t0 + cur * stepE - stepE;
      if (Math.abs(e - edge) < 0.02) want = cur;
    }

    let target;
    if (want === 0) {
      target = restGlyph[i];
    } else {
      const fx = flowX[i];
      const fy = flowY[i];
      if (Math.hypot(fx, fy) > P.flowThreshold) {
        // orientation modulo a half turn, snapped to four strokes
        let angle = Math.atan2(fy * aspect, fx);
        if (angle < 0) angle += Math.PI;
        target = strokes[Math.round(angle / (Math.PI / 4)) % 4];
      } else {
        target = ramp[want - 1];
      }
    }
    level[i] = want;

    const ink = P.restAlpha * restInk[i] * vignette[i] * lattice *
      (1 + Math.min(e, 1.5) * P.heatInk + trail[i] * P.wakeInk + weather[i]);
    if (target !== shown[i]) {
      from[i] = shown[i];
      fromInk[i] = Math.min(1, ink);
      shown[i] = target;
      changedAt[i] = now;
    }
    const age = now - changedAt[i];
    out.glyph = shown[i];
    out.from = from[i];
    out.t = age >= P.fadeMs ? 1 : smooth(age / Math.max(1, P.fadeMs));
    out.ink = Math.min(1, ink);
    out.fromInk = Math.min(fromInk[i], out.ink + 0.05);
    return out;
  }

  return {
    resize,
    setParams(next, changed = []) {
      P = next;
      if (changed.some((k) => k === "restMark" || k === "ramp")) buildSets();
      if (changed.includes("vignette")) buildVignette();
    },
    warm,
    impulse,
    // the document's ink passing through leaves a trail that cools
    setPointer(col, row) {
      if (col === null) {
        if (pointer) pointer.leaving = true;
        return;
      }
      if (!pointer) pointer = { col, row, strength: 0, leaving: false };
      pointer.col = col;
      pointer.row = row;
      pointer.leaving = false;
    },
    trailTo(i, amount) {
      if (amount > trail[i]) trail[i] = amount;
    },
    step,
    sample,
    contentGate,
    startReveal(now, oc, or) {
      reveal = { t0: now, oc, or, duration: 0 };
      placeReveal();
    },
    revealing: () => reveal !== null,
    // something is changing that needs every frame
    busy: () => ripples.length > 0 || reveal !== null ||
      (pointer !== null && (pointer.leaving || pointer.strength < 0.99)),
    stats() {
      let hot = 0;
      for (let i = 0; i < n; i++) if (level[i] > 0) hot++;
      return { cells: n, hot, ripples: ripples.length };
    },
  };
}
