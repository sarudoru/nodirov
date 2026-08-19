// Display type for the grid.
//
// Headlines are set in real block letterforms — not letters built out of
// their own character, which is a pun that costs legibility. A cell is a
// pixel here in the literal sense: the grid's own tracking and leading
// separate the blocks, so a headline reads the way type reads on an LED
// matrix or a departure board.
//
// Faces are plain data, so a face is easy to draw by hand and easy to test.

const F7 = {
  A: [" ███ ", "█   █", "█   █", "█████", "█   █", "█   █", "█   █"],
  B: ["████ ", "█   █", "█   █", "████ ", "█   █", "█   █", "████ "],
  C: [" ████", "█    ", "█    ", "█    ", "█    ", "█    ", " ████"],
  D: ["████ ", "█   █", "█   █", "█   █", "█   █", "█   █", "████ "],
  E: ["█████", "█    ", "█    ", "████ ", "█    ", "█    ", "█████"],
  F: ["█████", "█    ", "█    ", "████ ", "█    ", "█    ", "█    "],
  G: [" ████", "█    ", "█    ", "█  ██", "█   █", "█   █", " ████"],
  H: ["█   █", "█   █", "█   █", "█████", "█   █", "█   █", "█   █"],
  I: ["█████", "  █  ", "  █  ", "  █  ", "  █  ", "  █  ", "█████"],
  J: ["████ ", "   █ ", "   █ ", "   █ ", "   █ ", "█  █ ", " ██  "],
  K: ["█   █", "█  █ ", "█ █  ", "██   ", "█ █  ", "█  █ ", "█   █"],
  L: ["█    ", "█    ", "█    ", "█    ", "█    ", "█    ", "█████"],
  M: ["█   █", "██ ██", "█ █ █", "█ █ █", "█   █", "█   █", "█   █"],
  N: ["█   █", "██  █", "██  █", "█ █ █", "█  ██", "█  ██", "█   █"],
  O: [" ███ ", "█   █", "█   █", "█   █", "█   █", "█   █", " ███ "],
  P: ["████ ", "█   █", "█   █", "████ ", "█    ", "█    ", "█    "],
  Q: [" ███ ", "█   █", "█   █", "█   █", "█ █ █", "█  █ ", " ██ █"],
  R: ["████ ", "█   █", "█   █", "████ ", "█  █ ", "█   █", "█   █"],
  S: [" ████", "█    ", "█    ", " ███ ", "    █", "    █", "████ "],
  T: ["█████", "  █  ", "  █  ", "  █  ", "  █  ", "  █  ", "  █  "],
  U: ["█   █", "█   █", "█   █", "█   █", "█   █", "█   █", " ███ "],
  V: ["█   █", "█   █", "█   █", "█   █", "█   █", " █ █ ", "  █  "],
  W: ["█   █", "█   █", "█   █", "█ █ █", "█ █ █", "██ ██", "█   █"],
  X: ["█   █", "█   █", " █ █ ", "  █  ", " █ █ ", "█   █", "█   █"],
  Y: ["█   █", "█   █", " █ █ ", "  █  ", "  █  ", "  █  ", "  █  "],
  Z: ["█████", "    █", "   █ ", "  █  ", " █   ", "█    ", "█████"],
  0: [" ███ ", "█   █", "█  ██", "█ █ █", "██  █", "█   █", " ███ "],
  1: ["  █  ", " ██  ", "  █  ", "  █  ", "  █  ", "  █  ", "█████"],
  2: [" ███ ", "█   █", "    █", "   █ ", "  █  ", " █   ", "█████"],
  3: ["█████", "   █ ", "  █  ", "   █ ", "    █", "█   █", " ███ "],
  4: ["   █ ", "  ██ ", " █ █ ", "█  █ ", "█████", "   █ ", "   █ "],
  5: ["█████", "█    ", "████ ", "    █", "    █", "█   █", " ███ "],
  6: [" ███ ", "█   █", "█    ", "████ ", "█   █", "█   █", " ███ "],
  7: ["█████", "    █", "   █ ", "  █  ", " █   ", " █   ", " █   "],
  8: [" ███ ", "█   █", "█   █", " ███ ", "█   █", "█   █", " ███ "],
  9: [" ███ ", "█   █", "█   █", " ████", "    █", "█   █", " ███ "],
  ".": ["     ", "     ", "     ", "     ", "     ", " ██  ", " ██  "],
  ",": ["     ", "     ", "     ", "     ", " ██  ", " ██  ", " █   "],
  "-": ["     ", "     ", "     ", "█████", "     ", "     ", "     "],
  "'": ["  █  ", "  █  ", "     ", "     ", "     ", "     ", "     "],
  "!": ["  █  ", "  █  ", "  █  ", "  █  ", "  █  ", "     ", "  █  "],
  "?": [" ███ ", "█   █", "    █", "   █ ", "  █  ", "     ", "  █  "],
  "&": [" ██  ", "█  █ ", "█ █  ", " █   ", "█ █ █", "█  █ ", " ██ █"],
  "/": ["    █", "    █", "   █ ", "  █  ", " █   ", "█    ", "█    "],
  ":": ["     ", " ██  ", " ██  ", "     ", " ██  ", " ██  ", "     "],
  " ": ["     ", "     ", "     ", "     ", "     ", "     ", "     "],
};

// A condensed five-row face for narrow viewports. Same letterform logic,
// less vertical room, tighter counters.
const F5 = {
  A: [" ██ ", "█  █", "████", "█  █", "█  █"],
  B: ["███ ", "█  █", "███ ", "█  █", "███ "],
  C: [" ███", "█   ", "█   ", "█   ", " ███"],
  D: ["███ ", "█  █", "█  █", "█  █", "███ "],
  E: ["████", "█   ", "███ ", "█   ", "████"],
  F: ["████", "█   ", "███ ", "█   ", "█   "],
  G: [" ███", "█   ", "█ ██", "█  █", " ███"],
  H: ["█  █", "█  █", "████", "█  █", "█  █"],
  I: ["███", " █ ", " █ ", " █ ", "███"],
  J: ["  ██", "   █", "   █", "█  █", " ██ "],
  K: ["█  █", "█ █ ", "██  ", "█ █ ", "█  █"],
  L: ["█   ", "█   ", "█   ", "█   ", "████"],
  M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
  N: ["█  █", "██ █", "█ ██", "█  █", "█  █"],
  O: [" ██ ", "█  █", "█  █", "█  █", " ██ "],
  P: ["███ ", "█  █", "███ ", "█   ", "█   "],
  Q: [" ██ ", "█  █", "█  █", "█ █ ", " ██ █"],
  R: ["███ ", "█  █", "███ ", "█ █ ", "█  █"],
  S: [" ███", "█   ", " ██ ", "   █", "███ "],
  T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
  U: ["█  █", "█  █", "█  █", "█  █", " ██ "],
  V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
  W: ["█   █", "█   █", "█ █ █", "██ ██", "█   █"],
  X: ["█  █", " ██ ", " ██ ", " ██ ", "█  █"],
  Y: ["█   █", " █ █ ", "  █  ", "  █  ", "  █  "],
  Z: ["████", "   █", " ██ ", "█   ", "████"],
  " ": ["   ", "   ", "   ", "   ", "   "],
};

export const FACES = {
  block7: { rows: 7, glyphs: F7, gap: 1 },
  block5: { rows: 5, glyphs: F5, gap: 1 },
};

function glyphOf(face, ch) {
  return face.glyphs[ch] ?? face.glyphs[ch.toUpperCase()] ?? null;
}

// Width in cells of a string set in a face, or -1 if any character is missing.
export function measure(text, faceName = "block7") {
  const face = FACES[faceName];
  let width = 0;
  for (let i = 0; i < text.length; i += 1) {
    const glyph = glyphOf(face, text[i]);
    if (!glyph) return -1;
    width += glyph[0].length + (i < text.length - 1 ? face.gap : 0);
  }
  return width;
}

// Render one line. Returns an array of `face.rows` equal-length strings.
export function render(text, faceName = "block7", fill = "█") {
  const face = FACES[faceName];
  const out = new Array(face.rows).fill("");
  for (let i = 0; i < text.length; i += 1) {
    const glyph = glyphOf(face, text[i]);
    if (!glyph) continue;
    for (let r = 0; r < face.rows; r += 1) {
      out[r] += glyph[r];
      if (i < text.length - 1) out[r] += " ".repeat(face.gap);
    }
  }
  return fill === "█" ? out : out.map((row) => row.replaceAll("█", fill));
}

// Set a headline into a given column width: pick the widest face that fits,
// break on spaces, and return laid-out lines. Falls back to letter-spaced
// plain text when even the condensed face cannot fit a single word.
export function headline(text, maxCols, fill = "█") {
  const words = text.split(/\s+/).filter(Boolean);

  for (const faceName of ["block7", "block5"]) {
    const face = FACES[faceName];
    if (words.some((w) => measure(w, faceName) < 0)) continue;
    if (words.some((w) => measure(w, faceName) > maxCols)) continue;

    // greedy line breaking on the cell grid
    const lines = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (measure(candidate, faceName) <= maxCols) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);

    return {
      face: faceName,
      rows: face.rows,
      lines: lines.map((l) => ({ text: l, grid: render(l, faceName, fill), width: measure(l, faceName) })),
    };
  }

  // last resort: the name in letter-spaced capitals, one word per line
  return {
    face: "plain",
    rows: 1,
    lines: words.map((w) => {
      const spaced = Array.from(w.toUpperCase()).join(" ");
      const text = spaced.length <= maxCols ? spaced : w.toUpperCase();
      return { text, grid: [text], width: text.length };
    }),
  };
}
