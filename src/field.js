// One viewport, one character lattice. The document and media resolve into
// fixed cell origins; native scroll position chooses their contents.
import { buildGlyphSpace } from "./glyphspace.js";
import { createSubstrate } from "./substrate.js";
import { createPlanes } from "./plane.js";
import { ALPHABETS } from "./params.js";

export const K_TEXT = 1;
export const K_FAINT = 2;
export const K_LINK = 3;

export function createField(canvas, params) {
  const context = canvas.getContext("2d", { alpha: false });
  let P = params;
  let metrics, space, substrate, planes, inbox;
  let width = 0,
    height = 0,
    cols = 0,
    rows = 0,
    xOffset = 0,
    ratio = 1;
  let camera = 0,
    scrollPhase = 0,
    worldRows = 0;
  let reducedMotion = false,
    mediaPaused = false,
    visible = true;
  let running = false,
    rafId = 0,
    lastFrameAt = 0,
    scrollDirty = true;
  let drawMs = 0,
    frameMs = 0,
    renderedFrames = 0,
    hoveredLink = -1;
  let worldData = new Map();
  let vigMap = new Float32Array(0);
  const textPalette = [" "];
  const textIndex = new Map([[" ", 0]]);
  function textToken(ch) {
    if (!textIndex.has(ch)) {
      textIndex.set(ch, textPalette.length);
      textPalette.push(ch);
    }
    return textIndex.get(ch);
  }
  const glyphAt = (i) => space.chars[i] || " ";
  const kindAlpha = (kind) => (kind === K_FAINT ? P.faintAlpha : P.textAlpha);

  // Cache the two typographic inks. Source-colored media uses the same font.
  let atlases = new Map();
  function paintGlyph(ch, x, y) {
    const color = context.fillStyle;
    if (color !== P.ink && color !== P.accent) {
      context.fillText(ch, x, y);
      return;
    }
    let atlas = atlases.get(color);
    if (!atlas) {
      const tile = document.createElement("canvas");
      tile.width = Math.ceil(metrics.cellW * ratio) * 16;
      tile.height =
        Math.ceil(metrics.cellH * ratio) * Math.ceil(space.chars.length / 16);
      const ctx = tile.getContext("2d");
      const tw = Math.ceil(metrics.cellW * ratio),
        th = Math.ceil(metrics.cellH * ratio);
      ctx.scale(ratio, ratio);
      ctx.font = metrics.font;
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      space.chars.forEach((glyph, i) =>
        ctx.fillText(
          glyph,
          ((i % 16) * tw + tw / 2) / ratio,
          (Math.floor(i / 16) * th + th / 2) / ratio,
        ),
      );
      atlas = { tile, tw, th };
      atlases.set(color, atlas);
    }
    const i = space.indexOf(ch);
    if (i < 0) {
      context.fillText(ch, x, y);
      return;
    }
    const { tile, tw, th } = atlas;
    context.drawImage(
      tile,
      (i % 16) * tw,
      Math.floor(i / 16) * th,
      tw,
      th,
      x - tw / ratio / 2,
      y - th / ratio / 2,
      tw / ratio,
      th / ratio,
    );
  }

  // ---------- the frame ----------

  function draw(now) {
    const began = performance.now();
    context.globalAlpha = 1;
    context.fillStyle = P.paper;
    context.fillRect(0, 0, width, height);
    context.font = metrics.font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    // The two readings cross-fade at a fixed cell origin. No pixel translates.
    const phase = reducedMotion ? (scrollPhase < 0.5 ? 0 : 1) : scrollPhase;
    const blend = phase * phase * (3 - 2 * phase);
    for (let row = 0; row < rows; row++) {
      const a = worldData.get(camera + row),
        b = worldData.get(camera + row + 1);
      const y =
        Math.round((row * metrics.cellH + metrics.cellH / 2) * ratio) / ratio;
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const x =
          Math.round(
            (xOffset + col * metrics.cellW + metrics.cellW / 2) * ratio,
          ) / ratio;
        const ta = a?.chars[col] || 0,
          tb = b?.chars[col] || 0;
        let occupied = false;
        for (let next = 0; next < 2; next++) {
          const weight = next ? blend : 1 - blend;
          if (weight < 0.005) continue;
          const data = next ? b : a,
            token = next ? tb : ta;
          if (token) {
            const kind = data.kinds[col];
            const link = data.links[col];
            context.fillStyle =
              data.colors[col] === "accent" || kind === K_LINK
                ? P.accent
                : P.ink;
            context.globalAlpha = kindAlpha(kind) * weight;
            if (link === hoveredLink && kind === K_LINK)
              context.fillStyle = P.ink;
            paintGlyph(textPalette[token], x, y);
            occupied = true;
          } else {
            const media = planes?.at(camera + row + next, col);
            if (media) {
              context.fillStyle = media.color || P.ink;
              context.globalAlpha = media.ink * weight;
              paintGlyph(glyphAt(media.glyph), x, y);
              occupied = true;
              continue;
            }
            const note = inbox?.at(camera + row + next, col, now);
            if (note) {
              context.fillStyle = note.accent ? P.accent : P.ink;
              context.globalAlpha = note.ink * weight;
              paintGlyph(note.ch, x, y);
              if (note.cursor) {
                context.globalAlpha = weight;
                context.fillRect(
                  x - metrics.cellW / 2,
                  y - metrics.cellH / 2 + 2,
                  2,
                  metrics.cellH - 4,
                );
              }
              occupied = true;
            }
          }
        }
        if (!occupied) {
          const cell = substrate.read(i, now, vigMap[i]);
          // A document cell can be in the other half of a reduced-motion step.
          if (ta || tb) continue;
          context.fillStyle = P.ink;
          context.globalAlpha = Math.min(P.alpha * 2.5, cell.alpha);
          if (cell.b < 0) paintGlyph(glyphAt(cell.a), x, y);
          else {
            context.globalAlpha =
              Math.min(P.alpha * 2.5, cell.alpha) * (1 - cell.blend);
            paintGlyph(glyphAt(cell.a), x, y);
            context.globalAlpha =
              Math.min(P.alpha * 2.5, cell.alpha) * cell.blend;
            paintGlyph(glyphAt(cell.b), x, y);
          }
        }
      }
    }
    context.globalAlpha = 1;
    drawMs = performance.now() - began;
    renderedFrames++;
  }

  function updateMedia(now) {
    if (!planes) return;
    planes.playVisible(camera, rows);
    planes.update(now);
  }

  function tick(now) {
    rafId = 0;
    const dt = now - lastFrameAt;
    if (scrollDirty || dt >= 1000 / P.fps - 1) {
      const began = performance.now();
      scrollDirty = false;
      if (!reducedMotion) substrate.step(now, Math.min(dt, 80));
      updateMedia(now);
      draw(now);
      frameMs = performance.now() - began;
      lastFrameAt = now;
    }
    if (running) rafId = requestAnimationFrame(tick);
  }
  function start() {
    if (running || !metrics || !visible || reducedMotion) return;
    running = true;
    lastFrameAt = performance.now() - 100;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  function requestDraw() {
    scrollDirty = true;
    if (running || rafId || !metrics || !visible) return;
    rafId = requestAnimationFrame((now) => {
      rafId = 0;
      updateMedia(now);
      draw(now);
    });
  }
  function buildSpace() {
    const alphabet = ALPHABETS[P.alphabet];
    const printable = Array.from({ length: 95 }, (_, i) =>
      String.fromCharCode(32 + i),
    ).join("");
    const marks = "·─│┌┐└┘├┤┬┴┼↑↓↗’‘“”…×";
    const chars = [
      ...new Set([...alphabet, ...printable, ...marks, ...textPalette]),
    ];
    space = buildGlyphSpace(
      chars,
      metrics.font,
      metrics.cellW,
      metrics.cellH,
      metrics.pixelFace,
    );
    atlases.clear();
    const eligible = chars.flatMap((ch, i) =>
      alphabet.includes(ch) ? [i] : [],
    );
    const subParams = { ...P, aspect: metrics.cellH / metrics.cellW };
    if (!substrate) substrate = createSubstrate(space, subParams, eligible);
    else {
      substrate.setSpace(space);
      substrate.setEligible(eligible);
      substrate.setParams(subParams, []);
    }
    if (!planes) planes = createPlanes(space, requestDraw);
    else planes.setSpace(space);
    planes.setPaused(reducedMotion || mediaPaused);
  }
  function buildVignette() {
    vigMap = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const dx = ((c + 0.5) / cols) * 2 - 1,
          dy = ((r + 0.5) / rows) * 2 - 1;
        vigMap[r * cols + c] =
          1 -
          P.vignette *
            Math.min(
              1,
              Math.pow(Math.max(0, Math.hypot(dx * 0.72, dy) - 0.78) / 0.5, 2),
            );
      }
  }
  function readingShelter() {
    const shelter = new Float32Array(cols * rows).fill(1);
    for (let r = 0; r < rows; r++) {
      if (!worldData.has(camera + r)) continue;
      for (let c = 0; c < cols; c++) shelter[r * cols + c] = 1 - P.shelter;
    }
    substrate.setShelter(shelter);
  }
  return {
    setMetrics(value) {
      metrics = value;
    },
    resize(w, h) {
      width = w;
      height = h;
      ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      cols = Math.max(10, Math.floor(w / metrics.cellW));
      rows = Math.ceil(h / metrics.cellH);
      xOffset = Math.floor((w - cols * metrics.cellW) / 2);
      buildSpace();
      substrate.resize(cols, rows);
      buildVignette();
      requestDraw();
    },
    setWorld(lines, totalRows) {
      worldRows = totalRows;
      worldData = new Map();
      for (const line of lines) {
        let data = worldData.get(line.row);
        if (!data) {
          data = {
            chars: new Uint16Array(cols),
            kinds: new Uint8Array(cols),
            links: new Int16Array(cols).fill(-1),
            colors: new Array(cols).fill(""),
          };
          worldData.set(line.row, data);
        }
        for (let k = 0; k < line.text.length; k++) {
          const col = line.col + k;
          if (col < 0 || col >= cols) continue;
          if (line.linkId >= 0) data.links[col] = line.linkId;
          if (line.text[k] === " ") continue;
          data.chars[col] = textToken(line.text[k]);
          data.kinds[col] = line.kind;
          data.colors[col] = line.color || "";
        }
      }
      if (textPalette.some((ch) => space.indexOf(ch) < 0)) buildSpace();
      readingShelter();
      requestDraw();
    },
    setScroll(scrollTop) {
      const value = Math.max(0, scrollTop / metrics.cellH),
        next = Math.floor(value);
      scrollPhase = value - next;
      if (next !== camera) {
        camera = next;
        readingShelter();
      }
      requestDraw();
    },
    touch(x, y, px, py, dt) {
      if (reducedMotion || !substrate) return;
      const c = (x - xOffset) / metrics.cellW,
        r = y / metrics.cellH;
      const pc = (px - xOffset) / metrics.cellW,
        pr = py / metrics.cellH;
      const steps = Math.max(
        1,
        Math.min(30, Math.ceil(Math.hypot(c - pc, r - pr))),
      );
      for (let i = 1; i <= steps; i++)
        substrate.warm(
          pc + ((c - pc) * i) / steps,
          pr + ((r - pr) * i) / steps,
          c - pc,
          r - pr,
          Math.min(1, (Math.hypot(c - pc, r - pr) / Math.max(1, dt)) * 4),
        );
      requestDraw();
    },
    strike(x, y) {
      if (reducedMotion || !substrate) return;
      substrate.impulse(
        Math.round((x - xOffset) / metrics.cellW),
        Math.round(y / metrics.cellH),
        P.clickStrength,
      );
      requestDraw();
    },
    hoverLink(id, on) {
      hoveredLink = on ? id : -1;
      requestDraw();
    },
    probe(row, col) {
      const token = worldData.get(camera + row)?.chars[col] || 0;
      const read = substrate.read(row * cols + col, performance.now(), 1);
      return {
        ch: textPalette[token],
        committed: token !== 0,
        read: { ...read, aCh: glyphAt(read.a), bCh: glyphAt(read.b) },
      };
    },
    setReducedMotion(value) {
      reducedMotion = value;
      planes?.setPaused(value || mediaPaused);
      if (value) stop();
      else start();
      requestDraw();
    },
    setMediaPaused(value) {
      mediaPaused = value;
      planes?.setPaused(value || reducedMotion);
      requestDraw();
    },
    setVisible(value) {
      visible = value;
      planes?.setVisible(value);
      if (value) {
        start();
        requestDraw();
      } else stop();
    },
    applyParams(next, changed = []) {
      P = next;
      atlases.clear();
      if (substrate)
        substrate.setParams(
          { ...P, aspect: metrics.cellH / metrics.cellW },
          changed,
        );
      if (changed.includes("vignette")) buildVignette();
      if (changed.includes("shelter")) readingShelter();
      requestDraw();
    },
    renderAt(now, dt = 1000 / P.fps) {
      if (!reducedMotion) substrate.step(now, dt);
      updateMedia(now);
      draw(now);
    },
    setInbox(value) {
      inbox = value;
      inbox?.setGlyphs(ALPHABETS[P.alphabet] ?? ALPHABETS.marks);
    },
    collectPlanes(article) {
      return planes.collect(article);
    },
    placePlane(el, row, col, c, r) {
      planes.place(el, row, col, c, r, metrics.cellH / metrics.cellW);
    },
    planeCount: () => planes?.count() || 0,
    mediaStats: () =>
      planes
        ?.list()
        .map((p) => ({
          id: p.el.id,
          ready: p.ready,
          visible: p.visible,
          paused: p.kind === "video" ? p.media.paused : mediaPaused,
          time: p.media.currentTime || 0,
        })),
    renderStats: () => ({
      drawMs,
      frameMs,
      renderedFrames,
      camera,
      phase: scrollPhase,
      cols,
      rows,
      cellW: metrics.cellW,
      cellH: metrics.cellH,
    }),
    stats: () => substrate?.stats(),
    glyphCount: () => space?.size || 0,
    cols: () => cols,
    rows: () => rows,
    camera: () => camera,
    worldRows: () => worldRows,
    xOffset: () => xOffset,
    requestDraw,
    start,
    stop,
  };
}
