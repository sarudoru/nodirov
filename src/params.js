// Every tunable of the field, in one schema.
//
// The schema is the single source of truth: it produces the defaults, the
// URL codec (so any tuning is a shareable link), and the workbench controls
// in lab.html. Add a knob here and it appears everywhere.

export const SCHEMA = [
  // ---- the substrate ----
  { key: "alpha", group: "Substrate", label: "base ink", type: "range", min: 0.005, max: 0.16, step: 0.005, def: 0.045 },
  { key: "density", group: "Substrate", label: "density", type: "range", min: 0.15, max: 1, step: 0.05, def: 1,
    help: "fraction of cells that hold a glyph at all" },
  { key: "fps", group: "Substrate", label: "animation fps", type: "range", min: 12, max: 60, step: 1, def: 30 },

  // ---- how the substrate lives ----
  { key: "twAmp", group: "Life", label: "twinkle depth", type: "range", min: 0, max: 1, step: 0.05, def: 0.5,
    help: "how far each cell's opacity drifts from base" },
  { key: "twMin", group: "Life", label: "twinkle period min", type: "range", min: 1, max: 20, step: 0.5, def: 4, unit: "s" },
  { key: "twMax", group: "Life", label: "twinkle period max", type: "range", min: 2, max: 40, step: 0.5, def: 11, unit: "s" },
  { key: "churn", group: "Life", label: "glyph changes", type: "range", min: 0, max: 120, step: 1, def: 22, unit: "/s" },
  { key: "fade", group: "Life", label: "crossfade", type: "range", min: 150, max: 4000, step: 50, def: 1500, unit: "ms" },
  { key: "fadeEase", group: "Life", label: "crossfade shape", type: "select", def: "smooth",
    options: [["smooth", "smoothstep"], ["linear", "linear"], ["ramp", "through · : +"]] },

  // ---- large-scale motion ----
  { key: "tideAmp", group: "Tide", label: "tide depth", type: "range", min: 0, max: 1, step: 0.05, def: 0.25 },
  { key: "tidePeriod", group: "Tide", label: "tide period", type: "range", min: 4, max: 90, step: 1, def: 26, unit: "s" },
  { key: "tideScale", group: "Tide", label: "tide grain", type: "range", min: 0.02, max: 0.6, step: 0.01, def: 0.11,
    help: "small = broad slow bands, large = fine ripples" },

  // ---- reader-driven ----
  { key: "lanternR", group: "Cursor", label: "lantern radius", type: "range", min: 0, max: 26, step: 0.5, def: 6.5 },
  { key: "lanternGain", group: "Cursor", label: "lantern gain", type: "range", min: 0, max: 3, step: 0.05, def: 0.75 },
  { key: "pulse", group: "Cursor", label: "cursor disturbance", type: "bool", def: true },
  { key: "rippleR", group: "Cursor", label: "click splash radius", type: "range", min: 0, max: 18, step: 0.5, def: 7 },
  { key: "rippleSpeed", group: "Cursor", label: "splash spread", type: "range", min: 8, max: 140, step: 2, def: 36, unit: "ms/cell" },
  { key: "shimmerTick", group: "Cursor", label: "hover shimmer", type: "range", min: 60, max: 900, step: 10, def: 280, unit: "ms" },

  // ---- the aperture ----
  { key: "vignette", group: "Aperture", label: "vignette", type: "range", min: 0, max: 1, step: 0.05, def: 0.4 },
  { key: "glitch", group: "Aperture", label: "unstable glyphs", type: "bool", def: true },
  { key: "glitchMs", group: "Aperture", label: "instability interval", type: "range", min: 400, max: 12000, step: 100, def: 2600, unit: "ms" },

  // ---- the pour ----
  { key: "biasOut", group: "Pour", label: "outgoing bias", type: "range", min: 0.6, max: 3, step: 0.05, def: 1.35 },
  { key: "biasIn", group: "Pour", label: "incoming bias", type: "range", min: 0.4, max: 2, step: 0.05, def: 0.8 },
  { key: "wheelMs", group: "Pour", label: "wheel ease", type: "range", min: 0, max: 700, step: 10, def: 220, unit: "ms" },
  { key: "settleMs", group: "Pour", label: "settle ease", type: "range", min: 0, max: 700, step: 10, def: 150, unit: "ms" },
  { key: "fastSkip", group: "Pour", label: "crisp fast flicks", type: "bool", def: true },
  { key: "stagger", group: "Pour", label: "fabric stagger", type: "bool", def: false },

  // ---- type ----
  { key: "font", group: "Type", label: "typeface", type: "select", def: "plex",
    options: [["plex", "IBM Plex Mono"], ["fragment", "Fragment Mono"], ["space", "Space Mono"],
              ["kode", "Kode Mono"], ["courier", "Courier Prime"], ["azeret", "Azeret Mono"]], layout: true },
  { key: "size", group: "Type", label: "size", type: "range", min: 13, max: 30, step: 1, def: 21, unit: "px", layout: true },
  { key: "tracking", group: "Type", label: "tracking", type: "range", min: 0.02, max: 0.45, step: 0.01, def: 0.18, layout: true },
  { key: "leading", group: "Type", label: "leading", type: "range", min: 1, max: 1.7, step: 0.02, def: 1.24, layout: true },
  { key: "measure", group: "Type", label: "measure", type: "range", min: 40, max: 96, step: 1, def: 66, unit: "cols", layout: true },

  // ---- ink ----
  { key: "paper", group: "Ink", label: "paper", type: "color", def: "#fdfdfb" },
  { key: "ink", group: "Ink", label: "ink", type: "color", def: "#1a1a1a" },
  { key: "accent", group: "Ink", label: "accent", type: "color", def: "#c8401f" },
  { key: "textAlpha", group: "Ink", label: "content ink", type: "range", min: 0.5, max: 1, step: 0.02, def: 1 },
  { key: "faintAlpha", group: "Ink", label: "secondary ink", type: "range", min: 0.08, max: 0.9, step: 0.02, def: 0.42 },
];

export const FONTS = {
  plex: { family: "IBM Plex Mono", css: "IBM+Plex+Mono:wght@400" },
  fragment: { family: "Fragment Mono", css: "Fragment+Mono" },
  space: { family: "Space Mono", css: "Space+Mono" },
  kode: { family: "Kode Mono", css: "Kode+Mono:wght@400" },
  courier: { family: "Courier Prime", css: "Courier+Prime" },
  azeret: { family: "Azeret Mono", css: "Azeret+Mono:wght@400" },
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
