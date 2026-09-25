// The typesetter compiles the semantic HTML article into two aligned outputs:
//
//   1. field lines  {row, col, text, kind, linkId}, which the field turns
//      into cells
//   2. positioned DOM spans: transparent, grid-aligned text laid over the
//      canvas so selection, find-in-page, focus, and links stay native
//
// The article element is the single source of truth. The field is a renderer.
//
// What it understands:
//   h1                 the name
//   p.tagline          a faint line under the name
//   p                  a paragraph
//   p.hint             a faint aside
//   p.colophon         a faint closing line
//   h2                 a section heading, ruled to the column's edge
//   li                 an entry: its text on the left, a <time> at the
//                      column's right edge, an optional <small> note below.
//                      The cells between them are left to the lattice, so
//                      its dots become the leaders.
//   form[data-inbox]   the message box, drawn from box cells
//   .actions           a row of links or buttons

import { K_TEXT, K_FAINT, K_LINK } from "./field.js";

const collapse = (text) => text.replace(/\s+/g, " ");

// Split an element's content into runs of plain text and controls.
function runsOf(el, skip = () => false) {
  const runs = [];
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = collapse(node.textContent);
      if (text) runs.push({ text, a: null });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (skip(node)) continue;
      if (node.tagName === "A" || node.tagName === "BUTTON") {
        runs.push({ text: collapse(node.textContent).trim(), a: node });
      } else {
        for (const run of runsOf(node, skip)) runs.push(run);
      }
    }
  }
  if (runs.length) {
    runs[0].text = runs[0].text.replace(/^\s+/, "");
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");
  }
  return runs.filter((r) => r.text || r.a);
}

// Parse once at boot; the blueprint keeps element references and raw runs so
// the article can be re-typeset at any column count.
export function parseArticle(article) {
  const blocks = [];
  function walk(el) {
    for (const child of el.children) {
      const tag = child.tagName;
      if (tag === "HEADER" || tag === "SECTION" || tag === "FOOTER") {
        walk(child);
      } else if (tag === "H1") {
        blocks.push({ type: "name", el: child, text: collapse(child.textContent).trim() });
      } else if (tag === "H2") {
        blocks.push({ type: "heading", el: child, text: collapse(child.textContent).trim() });
      } else if (tag === "P" || tag === "DIV") {
        const cls = child.classList;
        const type = cls.contains("tagline") ? "tagline"
          : cls.contains("hint") ? "hint"
          : cls.contains("colophon") ? "colophon"
          : cls.contains("actions") ? "actions"
          : "p";
        blocks.push({ type, el: child, runs: runsOf(child) });
      } else if (tag === "UL") {
        for (const li of child.children) {
          const time = li.querySelector(":scope > time");
          const note = li.querySelector(":scope > small");
          blocks.push({
            type: "entry",
            el: li,
            runs: runsOf(li, (n) => n === time || n === note),
            time: time ? { el: time, text: collapse(time.textContent).trim() } : null,
            note: note ? { el: note, runs: runsOf(note) } : null,
          });
        }
      } else if (tag === "FORM" && child.hasAttribute("data-inbox")) {
        blocks.push({ type: "inbox", el: child, rows: parseInt(child.dataset.rows ?? "6", 10) });
        walk(child);
      }
    }
  }
  walk(article);
  return blocks;
}

export function typeset(blocks, article, ctx) {
  const { cols, viewRows, cellW, cellH, fontSize, xOffset, measure, pad, spacing } = ctx;
  const contentW = Math.min(cols - 4, measure);
  // the column sits a little left of centre, so the lattice keeps a wide
  // field on the right
  const slack = cols - contentW;
  const left = Math.max(2, Math.min(Math.floor(slack * 0.34), slack - 2));

  const lines = [];
  const sections = [{ row: 0, id: "", label: "" }];
  const links = [];
  let hero = null;
  let row = 3;

  function span(el, text, r, c, hidden = false) {
    const s = document.createElement("span");
    s.className = "gl";
    s.textContent = text;
    s.style.left = (xOffset + c * cellW + pad).toFixed(2) + "px";
    s.style.top = (r * cellH).toFixed(2) + "px";
    s.style.fontSize = fontSize + "px";
    s.style.lineHeight = cellH + "px";
    s.style.letterSpacing = spacing.toFixed(3) + "px";
    if (hidden) s.setAttribute("aria-hidden", "true");
    el.appendChild(s);
    return s;
  }

  function emit(r, c, text, kind, linkId = -1) {
    lines.push({ row: r, col: c, text, kind, linkId });
  }

  function linkIdFor(a) {
    let id = links.indexOf(a);
    if (id === -1) {
      id = links.length;
      links.push(a);
    }
    return id;
  }

  // Wrap runs into lines of pieces; a piece is {text, a}.
  function wrap(runs, limit) {
    const width = Math.max(1, limit);
    const words = [];
    for (const run of runs) {
      for (const part of run.text.split(/(\s+)/)) {
        if (!part) continue;
        words.push({ text: part, a: run.a, space: /^\s+$/.test(part) });
      }
    }
    const out = [];
    let line = [];
    let len = 0;
    let pending = false;
    let pendingA = null;
    const flush = () => {
      if (line.length) out.push(line);
      line = [];
      len = 0;
      pending = false;
      pendingA = null;
    };
    const push = (text, a) => {
      const last = line[line.length - 1];
      if (last && last.a === a) last.text += text;
      else line.push({ text, a });
      len += text.length;
    };
    for (const word of words) {
      if (word.space) {
        if (len > 0) {
          pending = true;
          pendingA = word.a;
        }
        continue;
      }
      let text = word.text;
      while (text.length > 0) {
        const need = text.length + (pending ? 1 : 0);
        if (len + need <= width) {
          if (pending) push(" ", pendingA);
          pending = false;
          push(text, word.a);
          text = "";
        } else if (text.length > width) {
          pending = false;
          const take = width - len;
          if (take <= 0) { flush(); continue; }
          push(text.slice(0, take), word.a);
          text = text.slice(take);
          flush();
        } else {
          flush();
        }
      }
    }
    flush();
    // wrapped lines lost their breaking space; keep it for copy fidelity
    for (let i = 0; i < out.length - 1; i++) out[i].brokeAfter = true;
    return out;
  }

  // Place runs at a column, wrapping at a width; returns the rows used.
  function place(el, runs, r, c, width, kind) {
    const wrapped = wrap(runs, width);
    wrapped.forEach((pieces, n) => {
      let cc = c;
      pieces.forEach((piece, k) => {
        const text = piece.text + (k === pieces.length - 1 && pieces.brokeAfter ? " " : "");
        if (piece.a) {
          const id = linkIdFor(piece.a);
          if (!piece.a.parentNode || !el.contains(piece.a)) el.appendChild(piece.a);
          span(piece.a, text, r + n, cc);
          emit(r + n, cc, piece.text, K_LINK, id);
        } else {
          span(el, text, r + n, cc);
          emit(r + n, cc, piece.text, kind);
        }
        cc += piece.text.length;
      });
    });
    return Math.max(1, wrapped.length);
  }

  // --- reset the DOM we own ---
  for (const a of article.querySelectorAll("a, button")) a.textContent = "";
  for (const b of blocks) {
    if (b.type === "entry") {
      b.el.textContent = "";
      if (b.time) b.time.el.textContent = "";
      if (b.note) b.note.el.textContent = "";
    } else if (b.type !== "inbox") {
      b.el.textContent = "";
    }
  }

  let first = true;
  for (const block of blocks) {
    switch (block.type) {
      case "name": {
        span(block.el, block.text, row, left);
        emit(row, left, block.text, K_TEXT);
        hero = { row, col: left };
        row += 1;
        break;
      }

      case "tagline": {
        row += place(block.el, block.runs, row, left, contentW, K_FAINT);
        row += 2;
        break;
      }

      case "p": {
        row += place(block.el, block.runs, row, left, contentW, K_TEXT);
        row += 1;
        break;
      }

      case "hint": {
        row += place(block.el, block.runs, row, left, contentW, K_FAINT);
        row += 1;
        break;
      }

      case "heading": {
        row += first ? 1 : 3;
        first = false;
        const text = block.text;
        span(block.el, text, row, left);
        emit(row, left, text, K_TEXT);
        const ruleFrom = left + text.length + 2;
        const ruleLen = left + contentW - ruleFrom;
        if (ruleLen > 2) emit(row, ruleFrom, "─".repeat(ruleLen), K_FAINT);
        const section = block.el.closest("section");
        sections.push({ row: Math.max(0, row - 3), id: section ? section.id : "", label: text.toLowerCase() });
        row += 2;
        break;
      }

      case "entry": {
        const when = block.time?.text ?? "";
        const gap = when ? when.length + 3 : 0;
        const used = place(block.el, block.runs, row, left, contentW - gap, K_TEXT);
        if (when) {
          const c = left + contentW - when.length;
          block.el.appendChild(block.time.el);
          // the space before the date belongs to the copied text
          span(block.time.el, " " + when, row, c - 1);
          emit(row, c, when, K_FAINT);
        }
        let r = row + used;
        if (block.note) {
          block.el.appendChild(block.note.el);
          span(block.note.el, " ", r, left - 1);
          r += place(block.note.el, block.note.runs, r, left, contentW, K_FAINT);
        }
        row = r + 1;
        break;
      }

      case "inbox": {
        // A box drawn from the cells around it. The textarea sits over the
        // interior, one cell in from the border; untyped cells stay lattice.
        const boxCols = contentW;
        emit(row, left, "┌" + "─".repeat(boxCols - 2) + "┐", K_FAINT);
        for (let r = 1; r <= block.rows; r++) {
          emit(row + r, left, "│", K_FAINT);
          emit(row + r, left + boxCols - 1, "│", K_FAINT);
        }
        emit(row + block.rows + 1, left, "└" + "─".repeat(boxCols - 2) + "┘", K_FAINT);
        ctx.placeInbox?.(block.el, row + 1, left + 2, boxCols - 4, block.rows);
        row += block.rows + 3;
        break;
      }

      case "actions": {
        row += place(block.el, block.runs, row, left, contentW, K_TEXT);
        row += 1;
        break;
      }

      case "colophon": {
        row += 3;
        row += place(block.el, block.runs, row, left, contentW, K_FAINT);
        break;
      }
    }
  }

  // the document ends a little before the screen does, so the last line can
  // rise to the middle rather than pin to the bottom edge
  const worldRows = row + Math.round(viewRows * 0.45);
  article.style.height = worldRows * cellH + "px";

  // Native controls need a real box for focus, accessibility, and hit testing.
  // Only their text spans receive pointer events, including wrapped labels.
  for (const control of links) {
    const spans = [...control.querySelectorAll(".gl")];
    if (!spans.length) continue;
    const x = Math.min(...spans.map((s) => parseFloat(s.style.left)));
    const y = Math.min(...spans.map((s) => parseFloat(s.style.top)));
    const right = Math.max(...spans.map((s) => parseFloat(s.style.left) + s.textContent.length * cellW));
    const bottom = Math.max(...spans.map((s) => parseFloat(s.style.top) + cellH));
    Object.assign(control.style, {
      position: "absolute", left: x + "px", top: y + "px",
      width: right - x + "px", height: bottom - y + "px",
    });
    for (const s of spans) {
      s.style.left = parseFloat(s.style.left) - x + "px";
      s.style.top = parseFloat(s.style.top) - y + "px";
    }
  }

  return { lines, worldRows, sections, links, hero, left, contentW };
}
