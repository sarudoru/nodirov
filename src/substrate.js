// The living substrate.
//
// One law governs the whole field: every cell has a temperature. Temperature
// decides how dense a glyph the cell wants to hold, how quickly it changes,
// and how brightly it burns. A separate flow vector decides which way its
// strokes lean. The cursor does not "trigger an effect" — it warms the medium,
// and the medium answers the only way it can: by changing glyphs.
//
//   heat   diffuses and cools     -> density, transition rate, opacity
//   flow   advects and slackens   -> stroke orientation
//   wave   propagates and damps   -> click ripples, expanding rings
//
// Transitions are never a cross-fade between unrelated shapes. Each is a walk
// through the glyph morphospace (see glyphspace.js), cross-fading only between
// visually adjacent hops, so a change reads as one form deforming into another.

const MAX_STEPS = 8;

export function createSubstrate(space, params, eligible) {
  let P = params;
  // indices of glyphs the resting field is allowed to draw from — the space
  // itself is wider, because reveals morph into arbitrary text characters
  let allowed = eligible && eligible.length ? eligible.slice() : null;
  let cols = 0;
  let rows = 0;
  let n = 0;

  // simulation channels
  let heat = new Float32Array(0);
  let heatNext = new Float32Array(0);
  let flowX = new Float32Array(0);
  let flowY = new Float32Array(0);
  let wave = new Float32Array(0);
  let wavePrev = new Float32Array(0);
  let waveNext = new Float32Array(0);

  // per-cell glyph animation
  let bursting = new Uint8Array(0);  // two-state Markov: still or in weather
  let shelter = new Float32Array(0); // 1 = open field, <1 = calm, near text
  let current = new Int16Array(0);   // settled glyph index
  let path = new Int16Array(0);      // morph sequence, MAX_STEPS per cell
  let pathLen = new Uint8Array(0);
  let started = new Float32Array(0); // ms
  let duration = new Float32Array(0);
  let lit = new Uint8Array(0);       // density mask
  let twPhase = new Float32Array(0);
  let twRate = new Float32Array(0);

  let ambientPool = [];
  let rngState = 0x2f6e2b1;

  // xorshift: deterministic, allocation-free, and faster than Math.random
  function rnd() {
    rngState ^= rngState << 13;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;
    return ((rngState >>> 0) % 100000) / 100000;
  }

  function buildAmbientPool() {
    // the resting field draws from the quiet end of the density ramp,
    // restricted to the chosen alphabet
    const ordered = allowed
      ? space.byDensity.filter((i) => allowed.includes(i))
      : space.byDensity.slice();
    const cut = Math.max(4, Math.round(ordered.length * P.ambientBand));
    ambientPool = ordered.slice(0, cut);
    if (ambientPool.length === 0) ambientPool = space.byDensity.slice(0, 8);
  }

  function resize(nextCols, nextRows) {
    cols = nextCols;
    rows = nextRows;
    n = cols * rows;

    heat = new Float32Array(n);
    heatNext = new Float32Array(n);
    flowX = new Float32Array(n);
    flowY = new Float32Array(n);
    wave = new Float32Array(n);
    wavePrev = new Float32Array(n);
    waveNext = new Float32Array(n);

    current = new Int16Array(n);
    path = new Int16Array(n * MAX_STEPS);
    pathLen = new Uint8Array(n);
    started = new Float32Array(n);
    duration = new Float32Array(n);
    lit = new Uint8Array(n);
    bursting = new Uint8Array(n);
    twPhase = new Float32Array(n);
    twRate = new Float32Array(n);

    buildAmbientPool();
    for (let i = 0; i < n; i += 1) {
      current[i] = ambientPool[(rnd() * ambientPool.length) | 0];
      lit[i] = rnd() < P.density ? 1 : 0;
      twPhase[i] = rnd();
      twRate[i] = 1 / ((P.twMin + rnd() * Math.max(0.1, P.twMax - P.twMin)) * 1000);
    }
  }

  // --- injection -------------------------------------------------------

  // Warm a disc of cells and push flow through them. Called along the pointer's
  // path, not just at its destination, so a fast sweep leaves a continuous
  // wake instead of a dotted line.
  function warm(col, row, vx, vy, strength) {
    const radius = P.warmRadius;
    const r2 = radius * radius;
    const c0 = Math.max(0, Math.floor(col - radius));
    const c1 = Math.min(cols - 1, Math.ceil(col + radius));
    const r0 = Math.max(0, Math.floor(row - radius));
    const r1 = Math.min(rows - 1, Math.ceil(row + radius));
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const dx = c - col;
        const dy = (r - row) * P.aspect;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const falloff = 1 - Math.sqrt(d2) / radius;
        const w = falloff * falloff * strength;
        const i = r * cols + c;
        heat[i] = Math.min(P.heatCeiling, heat[i] + w * P.warmGain);
        flowX[i] += vx * w * P.flowGain;
        flowY[i] += vy * w * P.flowGain;
      }
    }
  }

  function impulse(col, row, strength) {
    const i = (row | 0) * cols + (col | 0);
    if (i < 0 || i >= n) return;
    wave[i] += strength;
    wavePrev[i] -= strength * 0.5;
  }

  // --- simulation ------------------------------------------------------

  function stepSimulation(dt) {
    const k = Math.min(1, dt / 16.67);

    // heat: 5-point diffusion, then exponential cooling
    const diffuse = P.heatDiffuse * k;
    const cool = Math.pow(P.heatCool, k);
    for (let r = 0; r < rows; r += 1) {
      const up = r > 0 ? -cols : 0;
      const down = r < rows - 1 ? cols : 0;
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        const left = c > 0 ? -1 : 0;
        const right = c < cols - 1 ? 1 : 0;
        const laplace = heat[i + up] + heat[i + down] + heat[i + left] + heat[i + right] - 4 * heat[i];
        heatNext[i] = (heat[i] + diffuse * laplace) * cool;
      }
    }
    const swapHeat = heat;
    heat = heatNext;
    heatNext = swapHeat;

    // flow simply slackens; direction matters, magnitude decays
    const slack = Math.pow(P.flowDecay, k);
    for (let i = 0; i < n; i += 1) {
      flowX[i] *= slack;
      flowY[i] *= slack;
    }

    // wave equation with damping: expanding rings from clicks
    if (P.waveSpeed > 0) {
      const c2 = P.waveSpeed * P.waveSpeed * k;
      const damp = Math.pow(P.waveDamp, k);
      let energy = 0;
      for (let r = 0; r < rows; r += 1) {
        const up = r > 0 ? -cols : 0;
        const down = r < rows - 1 ? cols : 0;
        for (let c = 0; c < cols; c += 1) {
          const i = r * cols + c;
          const left = c > 0 ? -1 : 0;
          const right = c < cols - 1 ? 1 : 0;
          const laplace = wave[i + up] + wave[i + down] + wave[i + left] + wave[i + right] - 4 * wave[i];
          waveNext[i] = ((2 * wave[i] - wavePrev[i]) + c2 * laplace) * damp;
          energy += Math.abs(waveNext[i]);
        }
      }
      const swapPrev = wavePrev;
      wavePrev = wave;
      wave = waveNext;
      waveNext = swapPrev;
      if (energy < 0.01) wave.fill(0), wavePrev.fill(0);
    }
  }

  // --- glyph transitions ----------------------------------------------

  function startTransition(i, now) {
    const energy = Math.min(1, heat[i] + Math.abs(wave[i]) * P.waveHeat);
    const vx = flowX[i];
    const vy = flowY[i];
    const speed = Math.hypot(vx, vy);

    // temperature decides how dense a glyph this cell wants
    const targetDensity = P.restDensity + energy * P.densityGain;
    let target;
    if (speed > P.flowThreshold) {
      // flowing: choose a glyph whose strokes lean along the current
      target = space.forFlow(Math.atan2(vy * P.aspect, vx), targetDensity);
    } else if (energy > P.energyThreshold) {
      target = space.atDensity(targetDensity + (rnd() - 0.5) * 0.02);
    } else {
      target = ambientPool[(rnd() * ambientPool.length) | 0];
    }
    if (target === current[i]) return;

    // hotter cells settle faster; the field feels quick where you touch it
    const steps = Math.max(2, Math.round(P.morphSteps - energy * 1.5));
    const sequence = space.morph(current[i], target, steps);
    const len = Math.min(MAX_STEPS, sequence.length);
    for (let s = 0; s < len; s += 1) path[i * MAX_STEPS + s] = sequence[s];
    pathLen[i] = len;
    started[i] = now;
    duration[i] = (P.morphMs * (1 - energy * P.hasteGain)) * (0.75 + rnd() * 0.5);
  }

  function stepTransitions(now, dt) {
    const perCell = dt / 1000;
    for (let i = 0; i < n; i += 1) {
      if (!lit[i]) continue;
      if (pathLen[i] > 0) {
        if (now - started[i] >= duration[i]) {
          current[i] = path[i * MAX_STEPS + pathLen[i] - 1];
          pathLen[i] = 0;
        }
        continue;
      }
      const energy = Math.min(1, heat[i] + Math.abs(wave[i]) * P.waveHeat);

      // Two-state Markov chain per cell. Uniform turnover reads as a
      // screensaver; long-tailed inter-event times with genuinely still
      // regions between drifting clumps is what weather does.
      if (bursting[i]) {
        if (rnd() < P.burstOff * perCell) bursting[i] = 0;
      } else if (rnd() < P.burstOn * perCell) {
        bursting[i] = 1;
      }

      // Arrhenius rather than linear: below the knee almost nothing happens,
      // above it the field liquefies. A lazy hover does nothing; a real
      // gesture finds the melting point. Shelter raises the activation
      // energy near text, so protection is exponential and never touches ink.
      const calm = shelter.length ? 1 - shelter[i] : 0;
      const rate = P.restRate
        * Math.exp(P.rateKnee * energy - 3.6 * calm)
        * (bursting[i] ? P.burstGain : 1);
      if (rnd() < rate * perCell) startTransition(i, now);
    }
  }

  function step(now, dt) {
    stepSimulation(dt);
    stepTransitions(now, dt);
  }

  // --- readout ---------------------------------------------------------

  // Resolve one cell to what should actually be painted: up to two glyph
  // indices and the blend between them. Consecutive hops are visually adjacent,
  // so this cross-fade reads as deformation rather than interference.
  const out = { a: 0, b: -1, blend: 0, alpha: 0, energy: 0 };

  function read(i, now, vignetteValue) {
    const energy = Math.min(1.4, heat[i] + Math.abs(wave[i]) * P.waveHeat);
    out.energy = energy;

    // The cursor's entire signature is a change in turnover rate. A
    // screenshot taken under the pointer is identical to one at rest — this
    // is what keeps disturbance from becoming the lantern glow cliche.
    let alpha = P.alpha * (1 + energy * P.heatAlpha) * vignetteValue;
    if (P.twAmp > 0) {
      const phase = (twPhase[i] + now * twRate[i]) % 1;
      alpha *= 1 + P.twAmp * Math.sin(phase * Math.PI * 2);
    }
    out.alpha = lit[i] ? alpha : 0;

    if (pathLen[i] === 0) {
      out.a = current[i];
      out.b = -1;
      out.blend = 0;
      return out;
    }

    // The Solari law: a drum spins fast, then decelerates into its landing.
    // Progress through the ladder is quadratically eased so early hops flick
    // past and the last one arrives slowly — the eye can predict the landing
    // before it happens, which is what makes a change feel *settled* rather
    // than merely finished. The tail of the duration is held still on the
    // final glyph so the arrival has a beat.
    const raw = Math.min(1, (now - started[i]) / duration[i]);
    const hold = P.settleHold / Math.max(1, duration[i]);
    const t = hold >= 1 ? 1 : Math.min(1, raw / (1 - hold));
    const eased = 1 - (1 - t) * (1 - t);

    const segments = pathLen[i] - 1;
    if (segments < 1) {
      out.a = path[i * MAX_STEPS];
      out.b = -1;
      out.blend = 0;
      return out;
    }
    const scaled = eased * segments;
    const hop = Math.min(segments - 1, Math.floor(scaled));
    let local = scaled - hop;

    // flipSharp compresses the cross-fade into the end of each dwell, so most
    // frames show one clean letterform. A blend is only ever between glyphs
    // that are neighbours in the morphospace, and at sharpness 1 there is no
    // blend at all: every rendered frame is a real character, which is the
    // whole reason this reads as transformation instead of malfunction.
    const window = Math.max(0.001, 1 - P.flipSharp);
    local = local <= 1 - window ? 0 : (local - (1 - window)) / window;
    local = local * local * (3 - 2 * local);

    out.a = path[i * MAX_STEPS + hop];
    out.b = path[i * MAX_STEPS + hop + 1];
    out.blend = local;
    return out;
  }

  return {
    setShelter(map) { shelter = map; },
    resize,
    step,
    read,
    warm,
    impulse,
    setEligible(next) {
      allowed = next && next.length ? next.slice() : null;
      buildAmbientPool();
    },
    heatAt: (i) => heat[i],
    cellCount: () => n,
    setParams(next, changed) {
      P = next;
      const touched = changed ?? [];
      if (touched.includes("ambientBand")) buildAmbientPool();
      if (touched.includes("density")) {
        for (let i = 0; i < n; i += 1) lit[i] = rnd() < P.density ? 1 : 0;
      }
      if (touched.includes("twMin") || touched.includes("twMax")) {
        for (let i = 0; i < n; i += 1) {
          twRate[i] = 1 / ((P.twMin + rnd() * Math.max(0.1, P.twMax - P.twMin)) * 1000);
        }
      }
    },
    // diagnostics for the workbench
    stats() {
      let hot = 0;
      let moving = 0;
      let totalHeat = 0;
      for (let i = 0; i < n; i += 1) {
        totalHeat += heat[i];
        if (heat[i] > 0.05) hot += 1;
        if (pathLen[i] > 0) moving += 1;
      }
      return { cells: n, hot, moving, meanHeat: totalHeat / Math.max(1, n) };
    },
  };
}
