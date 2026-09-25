// Every tunable of the field, in one schema.
//
// The schema is the single source of truth: it produces the defaults, the
// URL codec (so any tuning is a shareable link), and the workbench controls
// in lab.html. Add a knob here and it appears everywhere.

export const SCHEMA = [
  // ---- type: the grid is derived from the face ----
  { key: "size", group: "Type", label: "size", type: "range", min: 11, max: 32, step: 1, def: 17, unit: "px", layout: true },
  { key: "tracking", group: "Type", label: "tracking", type: "range", min: 0, max: 0.4, step: 0.01, def: 0.1, layout: true,
    help: "extra space per cell, as a share of the font size" },
  { key: "leading", group: "Type", label: "leading", type: "range", min: 1.1, max: 2, step: 0.02, def: 1.5, layout: true },
  { key: "measure", group: "Type", label: "measure", type: "range", min: 40, max: 96, step: 1, def: 60, unit: "cols", layout: true },

  // ---- the lattice: what a cell holds at rest ----
  { key: "restMark", group: "Lattice", label: "resting mark", type: "select", def: "dot",
    options: [["dot", "dot"], ["plus", "plus"]] },
  { key: "ramp", group: "Lattice", label: "warm marks", type: "select", def: "dots",
    options: [["dots", "growing dots"], ["marks", "colon, plus, star"]] },
  { key: "latticeStride", group: "Lattice", label: "dot spacing", type: "range", min: 1, max: 3, step: 1, def: 2, unit: "cols",
    help: "a dot in every column, or every second or third" },
  { key: "restAlpha", group: "Lattice", label: "lattice ink", type: "range", min: 0.02, max: 0.5, step: 0.01, def: 0.26 },
  { key: "heatInk", group: "Lattice", label: "warm ink", type: "range", min: 0, max: 6, step: 0.05, def: 2.4,
    help: "how much darker a warm cell draws" },
  { key: "warmThreshold", group: "Lattice", label: "warm threshold", type: "range", min: 0.02, max: 0.6, step: 0.01, def: 0.12 },
  { key: "levelStep", group: "Lattice", label: "level step", type: "range", min: 0.05, max: 0.8, step: 0.01, def: 0.16 },
  { key: "fadeMs", group: "Lattice", label: "mark change", type: "range", min: 0, max: 500, step: 10, def: 110, unit: "ms" },
  { key: "weather", group: "Lattice", label: "weather", type: "range", min: 0, max: 1, step: 0.01, def: 0.3,
    help: "a slow field that swells marks in place" },
  { key: "weatherScale", group: "Lattice", label: "weather size", type: "range", min: 3, max: 40, step: 1, def: 11, unit: "cells" },
  { key: "weatherSpeed", group: "Lattice", label: "weather pace", type: "range", min: 0, max: 1, step: 0.01, def: 0.12 },
  { key: "vignette", group: "Lattice", label: "vignette", type: "range", min: 0, max: 1, step: 0.05, def: 0.5 },

  // ---- scrolling: the scroll position turns every cell's flap ----
  { key: "turn", group: "Scroll", label: "turn", type: "select", def: "flap",
    options: [["flap", "split-flap"], ["drum", "drum"]] },
  { key: "detent", group: "Scroll", label: "detent", type: "range", min: 0, max: 0.9, step: 0.01, def: 0.3,
    help: "how much of each row of scroll the flaps hold still" },
  { key: "sweep", group: "Scroll", label: "sweep", type: "range", min: 0, max: 0.8, step: 0.01, def: 0.35,
    help: "across the words, left cells turn a little before right ones" },
  { key: "fingerSpeed", group: "Scroll", label: "finger speed", type: "range", min: 2, max: 40, step: 0.5, def: 9, unit: "rows/s",
    help: "slower than this the finger turns the flaps; faster, the board flips to keep up" },
  { key: "cascadeX", group: "Scroll", label: "flip across", type: "range", min: 0, max: 300, step: 5, def: 70, unit: "ms",
    help: "how long a flip takes to cross the words" },
  { key: "cascadeY", group: "Scroll", label: "flip down", type: "range", min: 0, max: 400, step: 5, def: 110, unit: "ms",
    help: "how long a flip takes to travel down the screen" },
  { key: "flipMs", group: "Scroll", label: "flap", type: "range", min: 40, max: 600, step: 10, def: 110, unit: "ms",
    help: "how long one flap takes when it runs on a clock: a flip, a typed letter, a hover" },
  { key: "flipStagger", group: "Scroll", label: "word stagger", type: "range", min: 0, max: 80, step: 1, def: 22, unit: "ms/letter",
    help: "a hovered link turns over one letter after another" },
  { key: "shade", group: "Scroll", label: "fold shade", type: "range", min: 0, max: 1, step: 0.05, def: 0.6,
    help: "how much a face dims as it turns edge-on" },
  { key: "body", group: "Scroll", label: "flap body", type: "range", min: 0, max: 0.2, step: 0.005, def: 0.045,
    help: "a faint tint on the moving flap, so a turning cell reads as a card" },
  { key: "wake", group: "Scroll", label: "wake", type: "range", min: 0, max: 1.5, step: 0.05, def: 1,
    help: "warmth a passing letter leaves in its cell" },
  { key: "wakeInk", group: "Scroll", label: "wake ink", type: "range", min: 0, max: 4, step: 0.05, def: 1.5,
    help: "how much darker a cell's mark draws while it is still warm" },
  { key: "wakeMs", group: "Scroll", label: "wake cooling", type: "range", min: 40, max: 1500, step: 10, def: 260, unit: "ms" },
  { key: "settleMs", group: "Scroll", label: "settle ease", type: "range", min: 0, max: 700, step: 10, def: 220, unit: "ms" },

  // ---- touch: the cursor warms the lattice ----
  { key: "lens", group: "Touch", label: "lens", type: "range", min: 0, max: 3, step: 0.05, def: 1.1,
    help: "how much the marks swell around the pointer" },
  { key: "lensRadius", group: "Touch", label: "lens radius", type: "range", min: 1, max: 16, step: 0.5, def: 7, unit: "cells" },
  { key: "warmRadius", group: "Touch", label: "wake radius", type: "range", min: 1, max: 12, step: 0.5, def: 3.5, unit: "cells" },
  { key: "warmGain", group: "Touch", label: "wake strength", type: "range", min: 0, max: 3, step: 0.02, def: 1.2 },
  { key: "coolMs", group: "Touch", label: "cooling", type: "range", min: 60, max: 3000, step: 20, def: 520, unit: "ms" },
  { key: "rippleSpeed", group: "Touch", label: "ripple speed", type: "range", min: 5, max: 200, step: 1, def: 48, unit: "cols/s" },
  { key: "rippleWidth", group: "Touch", label: "ripple width", type: "range", min: 0.5, max: 8, step: 0.25, def: 2.5, unit: "cols" },
  { key: "rippleEnergy", group: "Touch", label: "ripple energy", type: "range", min: 0, max: 3, step: 0.05, def: 1.1 },
  { key: "rippleLife", group: "Touch", label: "ripple life", type: "range", min: 0.2, max: 4, step: 0.1, def: 1.4, unit: "s" },
  { key: "cursorEmbed", group: "Touch", label: "embedded cursor", type: "bool", def: true,
    help: "hide the pointer; the cell under it becomes the cursor" },
  { key: "cursorGlyph", group: "Touch", label: "cursor glyph", type: "select", def: "+",
    options: [["+", "+"], ["×", "×"], ["•", "•"], ["○", "○"]] },

  // ---- first contact ----
  { key: "revealBoardMs", group: "Reveal", label: "board up", type: "range", min: 0, max: 1500, step: 10, def: 380, unit: "ms",
    help: "the empty board comes up before anything is written" },
  { key: "revealLetterMs", group: "Reveal", label: "name letter", type: "range", min: 0, max: 200, step: 5, def: 42, unit: "ms" },
  { key: "revealSpeed", group: "Reveal", label: "ring speed", type: "range", min: 10, max: 300, step: 5, def: 85, unit: "cols/s" },
  { key: "revealRing", group: "Reveal", label: "ring energy", type: "range", min: 0, max: 2, step: 0.05, def: 1 },

  // ---- ink ----
  { key: "textAlpha", group: "Ink", label: "content ink", type: "range", min: 0.5, max: 1, step: 0.02, def: 1 },
  { key: "faintAlpha", group: "Ink", label: "secondary ink", type: "range", min: 0.1, max: 0.9, step: 0.02, def: 0.46 },
  { key: "paper", group: "Ink", label: "paper", type: "color", def: "#fdfdfb" },
  { key: "ink", group: "Ink", label: "ink", type: "color", def: "#1a1a1a" },
  { key: "accent", group: "Ink", label: "accent", type: "color", def: "#c8401f" },
];

export const FONT = { family: "Geist Mono" };

export const BY_KEY = new Map(SCHEMA.map((entry) => [entry.key, entry]));

export function defaults() {
  const out = {};
  for (const entry of SCHEMA) out[entry.key] = entry.def;
  return out;
}

export function fromQuery(search = window.location.search) {
  const query = new URLSearchParams(search);
  const out = defaults();
  for (const [key, raw] of query) {
    const entry = BY_KEY.get(key);
    if (!entry) continue;
    if (entry.type === "range") {
      const value = parseFloat(raw);
      if (Number.isFinite(value)) out[key] = Math.min(entry.max, Math.max(entry.min, value));
    } else if (entry.type === "bool") {
      out[key] = raw === "1" || raw === "true";
    } else if (entry.type === "color") {
      if (/^#?[0-9a-fA-F]{6}$/.test(raw)) out[key] = raw.startsWith("#") ? raw : "#" + raw;
    } else if (entry.type === "select") {
      if (entry.options.some(([v]) => v === raw)) out[key] = raw;
    }
  }
  return out;
}

// Only non-default values reach the URL, so a tuned link stays readable.
export function toQuery(params) {
  const query = new URLSearchParams();
  for (const entry of SCHEMA) {
    const value = params[entry.key];
    if (value === entry.def) continue;
    query.set(entry.key, entry.type === "bool" ? (value ? "1" : "0")
      : entry.type === "color" ? String(value).replace("#", "")
      : String(value));
  }
  return query.toString();
}

export function needsRelayout(patch) {
  return Object.keys(patch).some((key) => BY_KEY.get(key)?.layout);
}
