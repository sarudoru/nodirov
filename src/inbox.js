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
const END = " ";

export function createInbox(form, { invalidate = () => {}, onSend } = {}) {
  const textarea = form.querySelector("textarea");
  const status = form.querySelector("[aria-live]");
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
  let composing = false;

  const key = (r, c) => r * region.cols + c;
  const inside = (p) =>
    p.row >= 0 && p.row < region.rows && p.col >= 0 && p.col < region.cols;
  const focused = () => document.activeElement === textarea;
  // a fixed resting glyph per cell; the box never churns on its own
  const rest = (i) => {
    let h = Math.imul(i + 1, 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca77);
    h ^= h >>> 13;
    return glyphs[(h >>> 0) % glyphs.length] || " ";
  };

  function styleBox(el) {
    const { cellW, cellH, fontSize, pad, spacing } = metrics;
    Object.assign(el.style, {
      left: (xOffset + region.col * cellW).toFixed(2) + "px",
      top: region.worldRow * cellH + "px",
      width: region.cols * cellW + "px",
      height: region.rows * cellH + "px",
      paddingLeft: pad.toFixed(2) + "px",
      fontSize: fontSize + "px",
      lineHeight: cellH + "px",
      letterSpacing: spacing.toFixed(2) + "px",
    });
  }

  // Where the browser put character i of the mirrored text, in cells.
  const range = document.createRange();
  function place(i) {
    range.setStart(mirror.firstChild, i);
    range.setEnd(mirror.firstChild, i + 1);
    const rect = range.getBoundingClientRect();
    const box = mirror.getBoundingClientRect();
    return {
      row: Math.round((rect.top - box.top) / metrics.cellH),
      col: Math.round((rect.left - box.left - metrics.pad) / metrics.cellW),
    };
  }

  function layoutCaret() {
    caret = place(textarea.selectionEnd);
    selected = new Set();
    for (let i = textarea.selectionStart; i < textarea.selectionEnd; i++) {
      const p = place(i);
      if (inside(p)) selected.add(key(p.row, p.col));
    }
  }

  // Read the browser's own layout of the text back into cells. An edit that
  // would need more rows than the box has is refused, with the selection
  // put back where it was; a composition in progress is never touched.
  function layoutText() {
    if (!region || !metrics) return;
    mirror.textContent = textarea.value + END;
    if (
      !composing &&
      textarea.value !== lastValue &&
      place(textarea.value.length).row >= region.rows
    ) {
      const at = Math.min(textarea.selectionStart, lastValue.length);
      textarea.value = lastValue;
      textarea.setSelectionRange(at, at);
      mirror.textContent = lastValue + END;
    }
    lastValue = textarea.value;

    cells = new Map();
    const text = textarea.value;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") continue;
      const p = place(i);
      if (inside(p)) cells.set(key(p.row, p.col), text[i]);
    }
    layoutCaret();
    invalidate();
  }

  function setNotice(text) {
    notice = new Map();
    if (status) status.textContent = text;
    if (!text || !region) return;
    const row = Math.floor(region.rows / 2);
    const col = Math.max(0, Math.floor((region.cols - text.length) / 2));
    [...text].forEach((ch, i) => notice.set(key(row, col + i), ch));
  }

  textarea.addEventListener("input", layoutText);
  textarea.addEventListener("compositionstart", () => {
    composing = true;
  });
  textarea.addEventListener("compositionend", () => {
    composing = false;
    layoutText();
  });
  textarea.addEventListener("focus", () => {
    setNotice("");
    invalidate();
  });
  textarea.addEventListener("blur", invalidate);
  document.addEventListener("selectionchange", () => {
    if (!focused() || !region) return;
    layoutCaret();
    invalidate();
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
    const result = onSend?.(text);
    if (result === "sent") {
      textarea.value = "";
      textarea.blur();
      layoutText();
      setNotice("sent. thank you.");
    } else if (status) {
      status.textContent = "Your mail app should open with the message.";
    }
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
      layoutText();
    },
    // What the field paints at a cell: a typed character, a notice, or a
    // resting glyph. `cursor` asks for the line at the cell's left; it blinks
    // only while the field is animating, otherwise it stays lit.
    at(worldRow, col, now, blink = true) {
      if (!region) return null;
      const r = worldRow - region.worldRow;
      const c = col - region.col;
      if (r < 0 || r >= region.rows || c < 0 || c >= region.cols) return null;
      const k = key(r, c);
      const cursor =
        focused() &&
        caret?.row === r &&
        caret.col === c &&
        (!blink || Math.floor(now / BLINK_MS) % 2 === 0);
      const typed = cells.get(k);
      if (typed) return { ch: typed, ink: 1, accent: selected.has(k), cursor };
      const note = notice.get(k);
      if (note) return { ch: note, ink: 1, accent: true, cursor: false };
      return { ch: rest(k), ink: REST_INK, accent: false, cursor };
    },
    state: () => ({ typed: cells.size, caret, focused: focused() }),
  };
}
