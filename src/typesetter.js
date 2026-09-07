// The typesetter compiles the semantic HTML article into two aligned outputs:
//
//   1. field lines  — {row, col, text, kind, linkId} consumed by the canvas
//   2. positioned DOM spans — transparent, grid-aligned text laid over the
//      canvas so selection, find-in-page, focus, and links stay native
//
// The article element is the single source of truth. The field is a renderer.

import { K_TEXT, K_FAINT, K_LINK } from "./field.js";

// Parse once at boot; the blueprint keeps element references and raw runs so
// the article can be re-typeset at any column count (resize, zoom).
export function parseArticle(article) {
  const blocks = [];

  function runsOf(el) {
    const runs = [];
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        // whitespace between two controls is a run too: "[ a ] [ b ]"
        const text = node.textContent.replace(/\s+/g, " ");
        if (text) runs.push({ text, a: null });
      } else if (node.nodeType === Node.ELEMENT_NODE && ["A", "BUTTON"].includes(node.tagName)) {
        runs.push({ text: node.textContent.replace(/\s+/g, " ").trim(), a: node });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const text = node.textContent.replace(/\s+/g, " ");
        if (text.trim()) runs.push({ text, a: null });
      }
    }
    // trim outer whitespace across run boundaries
    if (runs.length) {
      runs[0].text = runs[0].text.replace(/^\s+/, "");
      runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");
    }
    return runs;
  }

  function walk(el) {
    for (const child of el.children) {
      const tag = child.tagName;
      if (tag === "HEADER" || tag === "SECTION") {
        if (tag === "SECTION") blocks.push({ type: "sectionStart", id: child.id });
        walk(child);
      } else if (tag === "NAV") {
        blocks.push({ type: "nav", el: child, runs: runsOf(child) });
      } else if (tag === "H1") {
        blocks.push({ type: "h1", el: child, text: child.textContent.trim() });
      } else if (tag === "H2") {
        blocks.push({ type: "h2", el: child, text: child.textContent.trim() });
      } else if (tag === "P") {
        const cls = child.classList;
        const type = cls.contains("tagline") ? "tagline"
          : cls.contains("hint") ? "hint"
          : cls.contains("interstitial") ? "interstitial"
          : "p";
        blocks.push({ type, el: child, runs: runsOf(child) });
      } else if (tag === "FIGURE" && child.dataset.glyph) {
        blocks.push({ type: "plane", el: child, rows: parseInt(child.dataset.rows ?? "16", 10),
                      aspect: parseFloat(child.dataset.aspect ?? "0"),
                      caption: child.querySelector("figcaption")?.textContent.trim() ?? "" });
      } else if (tag === "UL") {
        for (const li of child.children) {
          blocks.push({ type: "li", el: li, runs: runsOf(li) });
        }
      } else if (tag === "FORM" && child.hasAttribute("data-inbox")) {
        blocks.push({ type: "inbox", el: child, rows: parseInt(child.dataset.rows ?? "6", 10),
                      label: child.dataset.label || "" });
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
  const left = Math.floor((cols - contentW) / 2);

  const lines = [];
  const sections = [{ row: 0, id: "", label: "" }];
  const links = [];
  const glitchPool = [];
  let row = 0;

  const spacingWide = (spacing + cellW).toFixed(2);

  function span(el, text, r, c, wide, hidden) {
    const s = document.createElement("span");
    s.className = "gl";
    s.textContent = text;
    s.style.left = (xOffset + c * cellW + pad).toFixed(2) + "px";
    s.style.top = r * cellH + "px";
    s.style.fontSize = fontSize + "px";
    s.style.lineHeight = cellH + "px";
    s.style.letterSpacing = (wide ? spacingWide : spacing.toFixed(2)) + "px";
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
  function wrapRuns(runs, limit) {
    const widthLimit = Math.max(1, limit);
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

    function flush() {
      if (line.length) out.push(line);
      line = [];
      len = 0;
      pending = false;
      pendingA = null;
    }

    function push(piece) {
      const last = line[line.length - 1];
      if (last && last.a === piece.a) last.text += piece.text;
      else line.push({ text: piece.text, a: piece.a });
      len += piece.text.length;
    }

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
        if (len + need <= widthLimit) {
          if (pending) push({ text: " ", a: pendingA });
          pending = false;
          push({ text, a: word.a });
          text = "";
        } else if (text.length > widthLimit) {
          // a word longer than the measure: hard break
          pending = false;
          const take = widthLimit - len;
          if (take <= 0) { flush(); continue; }
          push({ text: text.slice(0, take), a: word.a });
          text = text.slice(take);
          flush();
        } else {
          flush();
        }
      }
    }
    flush();
    // wrapped lines lost their breaking space; remember it for DOM copy fidelity
    for (let i = 0; i < out.length - 1; i += 1) out[i].brokeAfter = true;
    return out;
  }

  // Lay out wrapped lines at a column, emitting field lines and DOM spans.
  function layoutRuns(block, startCol, widthLimit, kind, { center = false, gapAfter = 1 } = {}) {
    const el = block.el;
    el.textContent = "";
    const wrapped = wrapRuns(block.runs, widthLimit);
    for (const pieces of wrapped) {
      const lineLen = pieces.reduce((n, p) => n + p.text.length, 0);
      let c = center ? Math.max(startCol, Math.floor((cols - lineLen) / 2)) : startCol;
      pieces.forEach((piece, k) => {
        const domText = piece.text + (k === pieces.length - 1 && pieces.brokeAfter ? " " : "");
        if (piece.a) {
          const id = linkIdFor(piece.a);
          if (!piece.a.parentNode) el.appendChild(piece.a);
          span(piece.a, domText, row, c, false);
          emit(row, c, piece.text, K_LINK, id);
        } else {
          span(el, domText, row, c, false);
          emit(row, c, piece.text, kind);
          if (kind === K_TEXT) glitchPool.push({ row, col: c, len: piece.text.length });
        }
        c += piece.text.length;
      });
      row += 1;
    }
    row += gapAfter;
  }

  // --- reset the DOM we own ---
  for (const a of article.querySelectorAll("a, button")) a.textContent = "";

  for (const block of blocks) {
    switch (block.type) {
      case "sectionStart":
        break;

      case "nav": {
        row = 2;
        layoutRuns(block, left, contentW, K_LINK, { gapAfter: 2 });
        break;
      }

      case "h1": {
        // The name is a line of type, not a banner: the page is minimal and
        // the content starts almost at once. Letter-spaced capitals carry
        // enough weight to read as a heading without taking any room.
        row = Math.max(row, 2);
        const el = block.el;
        el.textContent = "";
        const text = block.text.toUpperCase();
        const wide = text.length * 2 - 1 <= contentW;
        span(el, text, row, left, wide);
        emit(row, left, wide ? [...text].join(" ") : text, K_TEXT);
        row += 1;
        break;
      }

      case "tagline": {
        layoutRuns(block, left, contentW, K_FAINT, { gapAfter: 2 });
        break;
      }

      case "hint": {
        // pinned near the bottom of the first viewport if we are still in it
        if (row < viewRows - 4) row = viewRows - 3;
        layoutRuns(block, left, contentW, K_FAINT, { center: true, gapAfter: 0 });
        break;
      }

      case "interstitial": {
        row += 3;
        const el = block.el;
        el.textContent = "";
        const text = block.runs.map((r) => r.text).join("").toUpperCase();
        const wide = text.length * 2 - 1 <= cols - 2;
        if (wide) {
          const width = text.length * 2 - 1;
          const c = Math.max(1, Math.floor((cols - width) / 2));
          span(el, text, row, c, true);
          emit(row, c, [...text].join(" "), K_TEXT);
          row += 1;
        } else {
          const wrapped = wrapRuns([{ text, a: null }], cols - 4);
          for (const pieces of wrapped) {
            const lineText = pieces.map((p) => p.text).join("");
            const c = Math.max(1, Math.floor((cols - lineText.length) / 2));
            span(el, lineText + (pieces.brokeAfter ? " " : ""), row, c, false);
            emit(row, c, lineText, K_TEXT);
            row += 1;
          }
        }
        row += 4;
        break;
      }

      case "h2": {
        row += 4;
        const el = block.el;
        el.textContent = "";
        const text = block.text.toUpperCase();
        const wide = text.length * 2 - 1 <= contentW;
        span(el, text, row, left, wide);
        emit(row, left, wide ? [...text].join(" ") : text, K_TEXT);
        const width = wide ? text.length * 2 - 1 : text.length;
        emit(row + 1, left, "─".repeat(width), K_FAINT);
        row += 3;
        const section = el.closest("section");
        sections.push({ row: row - 3, id: section ? section.id : "", label: block.text.toLowerCase() });
        break;
      }

      case "p": {
        layoutRuns(block, left, contentW, K_TEXT, { gapAfter: 1 });
        break;
      }

      case "plane": {
        const el = block.el;
        const planeCols = Math.min(contentW, cols - 4);
        const wanted = block.aspect
          ? Math.round((planeCols * cellW * block.aspect) / cellH)
          : block.rows;
        const planeRows = Math.max(4, Math.min(wanted, viewRows - 4));
        const c = Math.floor((cols - planeCols) / 2);
        row += 2;
        // The region is reserved here; the plane writes the glyphs each frame.
        // Screen readers and no-JS get the real <img>/<figcaption> instead.
        if (ctx.placePlane) ctx.placePlane(el, row, c, planeCols, planeRows);
        row += planeRows + 1;
        if (block.caption) {
          const width = Math.min(block.caption.length, contentW);
          const cc = Math.floor((cols - width) / 2);
          emit(row, cc, block.caption.slice(0, width), K_FAINT);
          row += 1;
        }
        row += 2;
        break;
      }

      case "inbox": {
        // A box drawn from the cells around it. The textarea is placed over
        // the interior, one cell in from the border, and paints itself.
        const boxCols = Math.min(70, contentW);
        const label = block.label && block.label.length + 6 < boxCols ? ` ${block.label} ` : "";
        row += 1;
        emit(row, left, "┌" + label + "─".repeat(boxCols - 2 - label.length) + "┐", K_FAINT);
        for (let r = 1; r <= block.rows; r += 1) {
          emit(row + r, left, "│", K_FAINT);
          emit(row + r, left + boxCols - 1, "│", K_FAINT);
        }
        emit(row + block.rows + 1, left, "└" + "─".repeat(boxCols - 2) + "┘", K_FAINT);
        ctx.placeInbox?.(block.el, row + 1, left + 2, boxCols - 4, block.rows);
        row += block.rows + 3;
        break;
      }

      case "li": {
        const el = block.el;
        el.textContent = "";
        span(el, "·", row, left, false, true);
        emit(row, left, "·", K_FAINT);
        // re-wrap runs at reduced width with a hanging indent of 2
        const saved = row;
        const wrapped = wrapRuns(block.runs, contentW - 2);
        for (const pieces of wrapped) {
          let c = left + 2;
          pieces.forEach((piece, k) => {
            const domText = piece.text + (k === pieces.length - 1 && pieces.brokeAfter ? " " : "");
            if (piece.a) {
              const id = linkIdFor(piece.a);
              if (!piece.a.parentNode) el.appendChild(piece.a);
              span(piece.a, domText, row, c, false);
              emit(row, c, piece.text, K_LINK, id);
            } else {
              span(el, domText, row, c, false);
              emit(row, c, piece.text, K_TEXT);
              glitchPool.push({ row, col: c, len: piece.text.length });
            }
            c += piece.text.length;
          });
          row += 1;
        }
        if (row === saved) row += 1;
        row += 1;
        break;
      }
    }
  }

  const worldRows = row + Math.round(viewRows * 0.5);
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

  // one unstable glyph per section, chosen from ordinary text
  const glitches = [];
  for (let s = 1; s < sections.length; s += 1) {
    const from = sections[s].row;
    const to = s + 1 < sections.length ? sections[s + 1].row : worldRows;
    const candidates = glitchPool.filter((g) => g.row >= from && g.row < to && g.len > 4);
    if (!candidates.length) continue;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const offset = 1 + Math.floor(Math.random() * (pick.len - 2));
    glitches.push({ row: pick.row, col: pick.col + offset });
  }

  return { lines, worldRows, sections, links, glitches };
}
