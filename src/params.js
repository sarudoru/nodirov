// Every tunable of the field, in one schema.
//
// The schema is the single source of truth: it produces the defaults, the
// URL codec (so any tuning is a shareable link), and the workbench controls
// in lab.html. Add a knob here and it appears everywhere.

export const SCHEMA = [
  // ---- the substrate ----
  { key: "alpha", group: "Substrate", label: "base ink", type: "range", min: 0.005, max: 0.2, step: 0.005, def: 0.05 },
  { key: "density", group: "Substrate", label: "density", type: "range", min: 0.15, max: 1, step: 0.05, def: 1,
    help: "fraction of cells that hold a glyph at all" },
  { key: "ambientBand", group: "Substrate", label: "resting weight", type: "range", min: 0.1, max: 1, step: 0.05, def: 0.45,
    help: "how far up the ink ramp the resting field may draw" },
  { key: "restDensity", group: "Substrate", label: "resting density", type: "range", min: 0.01, max: 0.2, step: 0.005, def: 0.035,
    help: "ink density a cool cell settles toward" },
  { key: "fps", group: "Substrate", label: "animation fps", type: "range", min: 12, max: 60, step: 1, def: 45 },

  // ---- transitions through the morphospace ----
  { key: "restRate", group: "Change", label: "resting change rate", type: "range", min: 0, max: 2, step: 0.02, def: 0.14, unit: "/cell/s" },
  { key: "morphMs", group: "Change", label: "morph duration", type: "range", min: 120, max: 2500, step: 20, def: 520, unit: "ms" },
  { key: "morphSteps", group: "Change", label: "morph steps", type: "range", min: 2, max: 10, step: 1, def: 7,
    help: "intermediate glyphs walked through on the way" },
  { key: "hasteGain", group: "Change", label: "heat haste", type: "range", min: 0, max: 0.85, step: 0.05, def: 0.55,
    help: "how much faster hot cells settle" },
  { key: "twAmp", group: "Change", label: "twinkle depth", type: "range", min: 0, max: 1, step: 0.05, def: 0.4 },
  { key: "twMin", group: "Change", label: "twinkle period min", type: "range", min: 1, max: 20, step: 0.5, def: 4, unit: "s" },
  { key: "twMax", group: "Change", label: "twinkle period max", type: "range", min: 2, max: 40, step: 0.5, def: 11, unit: "s" },
  { key: "burstGain", group: "Change", label: "burst intensity", type: "range", min: 1, max: 20, step: 0.5, def: 7,
    help: "cells cluster into weather rather than changing at a uniform rate" },
  { key: "burstOn", group: "Change", label: "burst onset", type: "range", min: 0, max: 0.6, step: 0.01, def: 0.07, unit: "/s" },
  { key: "burstOff", group: "Change", label: "burst decay", type: "range", min: 0.05, max: 3, step: 0.05, def: 0.55, unit: "/s" },
  { key: "flipSharp", group: "Change", label: "flip sharpness", type: "range", min: 0, max: 1, step: 0.05, def: 0.72,
    help: "1 = discrete split-flap clicks, 0 = continuous cross-fade" },
  { key: "settleHold", group: "Change", label: "settle hold", type: "range", min: 0, max: 600, step: 10, def: 180, unit: "ms",
    help: "enforced stillness on arrival, so a change lands instead of merely stopping" },

  // ---- heat: the cursor warms the medium ----
  { key: "warmRadius", group: "Heat", label: "touch radius", type: "range", min: 1, max: 18, step: 0.5, def: 5.5, unit: "cells" },
  { key: "warmGain", group: "Heat", label: "touch strength", type: "range", min: 0, max: 2, step: 0.02, def: 0.42 },
  { key: "heatDiffuse", group: "Heat", label: "spread", type: "range", min: 0, max: 0.24, step: 0.005, def: 0.115 },
  { key: "heatCool", group: "Heat", label: "cooling", type: "range", min: 0.86, max: 0.999, step: 0.001, def: 0.9,
    help: "per-frame retention — higher lingers longer" },
  { key: "heatCeiling", group: "Heat", label: "heat ceiling", type: "range", min: 0.2, max: 3, step: 0.05, def: 1.15 },
  { key: "heatRate", group: "Heat", label: "heat change rate", type: "range", min: 0, max: 30, step: 0.5, def: 9, unit: "/cell/s",
    help: "extra transitions per second in hot cells" },
  { key: "heatAlpha", group: "Heat", label: "heat glow", type: "range", min: 0, max: 8, step: 0.1, def: 0,
    help: "leave at 0 — the cursor's signature is turnover, not brightness" },
  { key: "rateKnee", group: "Heat", label: "response knee", type: "range", min: 1, max: 8, step: 0.1, def: 5.2,
    help: "exponential steepness — a lazy hover does nothing, a real gesture melts the field" },
  { key: "densityGain", group: "Heat", label: "heat weight", type: "range", min: 0, max: 0.5, step: 0.01, def: 0.13,
    help: "how much denser glyphs get when hot" },
  { key: "energyThreshold", group: "Heat", label: "warm threshold", type: "range", min: 0, max: 0.5, step: 0.01, def: 0.05 },

  // ---- flow: strokes lean along the current ----
  { key: "flowGain", group: "Flow", label: "flow pickup", type: "range", min: 0, max: 3, step: 0.05, def: 1 },
  { key: "flowDecay", group: "Flow", label: "flow persistence", type: "range", min: 0.7, max: 0.999, step: 0.001, def: 0.86 },
  { key: "flowThreshold", group: "Flow", label: "flow threshold", type: "range", min: 0.01, max: 1.5, step: 0.01, def: 0.22,
    help: "current needed before strokes align to it" },

  // ---- waves: clicks ring outward ----
  { key: "waveSpeed", group: "Wave", label: "ripple speed", type: "range", min: 0, max: 0.9, step: 0.01, def: 0.42 },
  { key: "waveDamp", group: "Wave", label: "ripple damping", type: "range", min: 0.88, max: 0.999, step: 0.001, def: 0.955 },
  { key: "waveHeat", group: "Wave", label: "ripple energy", type: "range", min: 0, max: 3, step: 0.05, def: 1.1 },
  { key: "clickStrength", group: "Wave", label: "click force", type: "range", min: 0, max: 8, step: 0.1, def: 2.4 },

  // ---- the aperture ----
  { key: "vignette", group: "Aperture", label: "vignette", type: "range", min: 0, max: 1, step: 0.05, def: 0.4 },
  { key: "glitch", group: "Aperture", label: "unstable glyphs", type: "bool", def: true },
  { key: "glitchMs", group: "Aperture", label: "instability interval", type: "range", min: 400, max: 12000, step: 100, def: 2600, unit: "ms" },

  // ---- the board: scrolling is every cell flipping to its new letter ----
  { key: "flipMs", group: "Board", label: "flip duration", type: "range", min: 80, max: 900, step: 10, def: 260, unit: "ms",
    help: "how long a cell takes to become its new character" },
  { key: "flipSteps", group: "Board", label: "flip ladder", type: "range", min: 2, max: 8, step: 1, def: 5,
    help: "intermediate letterforms a cell walks through on the way" },
  { key: "flipSweep", group: "Board", label: "column sweep", type: "range", min: 0, max: 8, step: 0.25, def: 1, unit: "ms/col",
    help: "stagger across columns, so a row change ripples instead of snapping" },
  { key: "flipDrift", group: "Board", label: "row drift", type: "range", min: 0, max: 16, step: 0.5, def: 2, unit: "ms/row" },
  { key: "flipHysteresis", group: "Board", label: "row threshold", type: "range", min: 0.5, max: 0.9, step: 0.01, def: 0.58,
    help: "how far past a row boundary the scroll must travel before the board flips" },
  { key: "flipCoalesce", group: "Board", label: "coalesce window", type: "range", min: 0, max: 1.5, step: 0.05, def: 0.7,
    help: "a flip arriving while the last is still this far from done lands instantly — continuous scrolling never stacks ladders" },
  { key: "releaseRatio", group: "Board", label: "release speed", type: "range", min: 0.15, max: 1, step: 0.05, def: 0.45,
    help: "a departing letter sinks back faster than an arriving one rises, so no trail follows the text" },
  { key: "wheelMs", group: "Board", label: "wheel ease", type: "range", min: 0, max: 700, step: 10, def: 220, unit: "ms" },
  { key: "settleMs", group: "Board", label: "settle ease", type: "range", min: 0, max: 700, step: 10, def: 150, unit: "ms" },
  { key: "scrollHeat", group: "Board", label: "scroll warms field", type: "range", min: 0, max: 1.5, step: 0.05, def: 0.35 },

  // ---- reading ----
  { key: "shimmerTick", group: "Reading", label: "hover shimmer", type: "range", min: 60, max: 900, step: 10, def: 280, unit: "ms" },
  { key: "textAlpha", group: "Reading", label: "content ink", type: "range", min: 0.5, max: 1, step: 0.02, def: 1 },
  { key: "faintAlpha", group: "Reading", label: "secondary ink", type: "range", min: 0.08, max: 0.9, step: 0.02, def: 0.42 },
  { key: "shelter", group: "Reading", label: "text shelter", type: "range", min: 0, max: 1, step: 0.05, def: 0.55,
    help: "how much the substrate calms behind text so reading stays easy" },

  // ---- type ----
  { key: "font", group: "Type", label: "typeface", type: "select", def: "geist",
    options: [["geist", "Geist Mono"], ["plex", "IBM Plex Mono"], ["departure", "Departure Mono"], ["fragment", "Fragment Mono"], ["space", "Space Mono"],
              ["kode", "Kode Mono"], ["courier", "Courier Prime"], ["azeret", "Azeret Mono"]], layout: true },
  { key: "size", group: "Type", label: "size", type: "range", min: 11, max: 44, step: 1, def: 21, unit: "px", layout: true },
  { key: "tracking", group: "Type", label: "tracking", type: "range", min: 0.02, max: 0.45, step: 0.01, def: 0.18, layout: true },
  { key: "leading", group: "Type", label: "leading", type: "range", min: 1, max: 1.7, step: 0.02, def: 1.24, layout: true },
  { key: "measure", group: "Type", label: "measure", type: "range", min: 40, max: 96, step: 1, def: 66, unit: "cols", layout: true },
  { key: "alphabet", group: "Type", label: "alphabet", type: "select", def: "latin", layout: true,
    options: [["latin", "letters + digits"], ["marks", "marks & strokes"], ["wide", "everything"], ["geometric", "geometric"]] },

  // ---- ink ----
  { key: "paper", group: "Ink", label: "paper", type: "color", def: "#fdfdfb" },
  { key: "ink", group: "Ink", label: "ink", type: "color", def: "#1a1a1a" },
  { key: "accent", group: "Ink", label: "accent", type: "color", def: "#c8401f" },
];

export const FONTS = {
  // Geist Mono is the default: a contemporary vector mono that hints cleanly
  // and renders razor-crisp at native resolution — the "white page, black
  // text, why does this look so good" register.
  geist: { family: "Geist Mono", css: "Geist+Mono:wght@400" },
  // A true pixel face: unitsPerEm 550 with a 350 advance, so the advance is
  // only an integer at multiples of 11px (11->7, 22->14, 33->21). Its designed
  // cell is 7x14 units — a true 1:2 ratio — so it wants no added tracking and
  // its own 14/11 line box. computeMetrics() enforces this contract.
  departure: {
    family: "Departure Mono",
    local: true,
    grid: { sizeStep: 11, minSize: 11, tracking: 0, leading: 14 / 11 },
  },
  plex: { family: "IBM Plex Mono", css: "IBM+Plex+Mono:wght@400" },
  fragment: { family: "Fragment Mono", css: "Fragment+Mono" },
  space: { family: "Space Mono", css: "Space+Mono" },
  kode: { family: "Kode Mono", css: "Kode+Mono:wght@400" },
  courier: { family: "Courier Prime", css: "Courier+Prime" },
  azeret: { family: "Azeret Mono", css: "Azeret+Mono:wght@400" },
};

// Candidate glyph sets for the substrate. Every character here is verified to
// render with a consistent advance width in the mono faces we offer.
export const ALPHABETS = {
  latin: "abcdefghijklmnopqrstuvwxyz0123456789",
  marks: ".,:;'\"`^~-_=+*/\\|()[]{}<>!?iloxvnmwustcr0123456789",
  wide: "abcdefghijklmnopqrstuvwxyz0123456789.,:;'\"`^~-_=+*/\\|()[]{}<>!?@#$%&",
  geometric: ".,:;'`^~-_=+*/\\|()[]{}<>·•◦○◌□▫■▲▼◄►◊─│┌┐└┘├┤┬┴┼╱╲",
};

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
