// The message box: a native textarea that lives inside the grid. The browser
// keeps the typing, pasting, IME, and the caret; the field draws the result
// as cells. Cells nobody has typed into hold faint resting glyphs, so the box
// reads as a place where characters are waiting to be chosen.
//
// The textarea is transparent and sits exactly over its cells. A hidden
// mirror with the same metrics reports where the browser broke each line,
// so the drawn text, the native caret, and click-to-place agree.

const REST_INK = 0.2;
const BLINK_MS = 530;
// a real character after the text, so a trailing newline still makes a line
// box and the caret can be measured at the end of the text
const END = "\u00a0";

export function createInbox(form, { invalidate = () => {}, onSend } = {}) {
  const textarea = form.querySelector("textarea");
  const mirror = document.createElement("div");
  mirror.className = "inbox-mirror";
  mirror.setAttribute("aria-hidden", "true");
  form.appendChild(mirror);

  let region = null;
  let metrics = null;
  let xOffset = 0;
  let glyphs = "";
  let cells = new Map();
  let caret = null;
  let selected = new Set();
  let notice = new Map();
  let lastValue = "";

  const key = (r, c) => r * region.cols + c;
  // a fixed resting glyph per cell; the box never churns on its own
  const rest = (i) => {
    let h = Math.imul(i + 1, 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca77);
    h ^= h >>> 13;
    return glyphs[(h >>> 0) % glyphs.length] || " ";
  };

  function styleBox(el) {
    const { cellW, cellH, adv, fontSize } = metrics;
    Object.assign(el.style, {
      left: (xOffset + region.col * cellW).toFixed(2) + "px",
      top: region.worldRow * cellH + "px",
      width: region.cols * cellW + "px",
      height: region.rows * cellH + "px",
      paddingLeft: ((cellW - adv) / 2).toFixed(2) + "px",
      fontSize: fontSize + "px",
      lineHeight: cellH + "px",
      letterSpacing: (cellW - adv).toFixed(2) + "px",
    });
  }

  // Read the browser's own layout of the text back into cells.
  function relayout() {
    if (!region || !metrics) return;
    const box = mirror.getBoundingClientRect();
    const pad = (metrics.cellW - metrics.adv) / 2;
    const range = document.createRange();
    const place = (i) => {
      range.setStart(mirror.firstChild, i);
      range.setEnd(mirror.firstChild, i + 1);
      const rect = range.getBoundingClientRect();
      return {
        row: Math.round((rect.top - box.top) / metrics.cellH),
        col: Math.round((rect.left - box.left - pad) / metrics.cellW),
      };
    };
    mirror.textContent = textarea.value + END;
    // more lines than the box has rows: refuse the edit
    if (
      textarea.value.length > lastValue.length &&
      place(textarea.value.length).row >= region.rows
    ) {
      textarea.value = lastValue;
      mirror.textContent = lastValue + END;
    }
    lastValue = textarea.value;

    cells = new Map();
    const text = textarea.value;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\n") continue;
      const { row, col } = place(i);
      if (row < region.rows && col >= 0 && col < region.cols)
        cells.set(key(row, col), ch);
    }
    caret = place(textarea.selectionEnd);
    selected = new Set();
    for (let i = textarea.selectionStart; i < textarea.selectionEnd; i++) {
      const { row, col } = place(i);
      selected.add(key(row, col));
    }
    invalidate();
  }

  function setNotice(text) {
    notice = new Map();
    if (!text || !region) return;
    const row = Math.floor(region.rows / 2);
    const col = Math.max(0, Math.floor((region.cols - text.length) / 2));
    [...text].forEach((ch, i) => notice.set(key(row, col + i), ch));
  }

  textarea.addEventListener("input", relayout);
  const focused = () => document.activeElement === textarea;
  textarea.addEventListener("focus", () => {
    setNotice("");
    invalidate();
  });
  textarea.addEventListener("blur", invalidate);
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === textarea) relayout();
  });
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = textarea.value.trim();
    if (!text) {
      textarea.focus();
      return;
    }
    onSend?.(text);
    textarea.value = "";
    textarea.blur();
    relayout();
    setNotice("sent. thank you.");
    invalidate();
  });

  return {
    setMetrics(next, offset) {
      metrics = next;
      xOffset = offset;
    },
    setGlyphs(alphabet) {
      glyphs = alphabet;
    },
    place(worldRow, col, cols, rows) {
      region = { worldRow, col, cols, rows };
      styleBox(textarea);
      styleBox(mirror);
      relayout();
    },
    // what the field paints at a cell: a typed character, a notice, or a
    // resting glyph; `cursor` asks for the blinking line at the cell's left
    at(worldRow, col, now) {
      if (!region) return null;
      const r = worldRow - region.worldRow;
      const c = col - region.col;
      if (r < 0 || r >= region.rows || c < 0 || c >= region.cols) return null;
      const k = key(r, c);
      const cursor =
        focused() &&
        caret?.row === r &&
        caret.col === c &&
        Math.floor(now / BLINK_MS) % 2 === 0;
      const typed = cells.get(k);
      if (typed) return { ch: typed, ink: 1, accent: selected.has(k), cursor };
      const note = notice.get(k);
      if (note) return { ch: note, ink: 1, accent: true, cursor: false };
      return { ch: rest(k), ink: REST_INK, accent: false, cursor };
    },
    state: () => ({ typed: cells.size, caret, focused: focused() }),
  };
}
