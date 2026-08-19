// Planes: rectangular regions of the grid that something other than the
// document is writing into.
//
// A plane owns a span of world rows and columns and produces glyph indices
// plus per-cell ink for them. The field composites planes above the living
// substrate and below committed text, so a photograph never covers a word.
//
// Sources are declared in the HTML and degrade honestly without JavaScript:
//
//   <figure data-glyph="image" data-src="portrait.jpg" data-rows="18">
//     <img src="portrait.jpg" alt="…">
//     <figcaption>…</figcaption>
//   </figure>
//
// With JS off the reader gets the real image and caption. With JS on the
// <img> is hidden and the figure becomes a region of the character field.

import { createSampler } from "./media.js";

export function createPlanes(space) {
  const sampler = createSampler();
  const planes = [];

  function add(plane) {
    planes.push(plane);
    return plane;
  }

  // Scan the article for declared media and build a plane for each.
  function collect(article) {
    planes.length = 0;
    const figures = article.querySelectorAll("[data-glyph]");
    for (const el of figures) {
      const kind = el.dataset.glyph;
      const rows = parseInt(el.dataset.rows ?? "16", 10);
      const options = {
        gamma: parseFloat(el.dataset.gamma ?? "1"),
        contrast: parseFloat(el.dataset.contrast ?? "1"),
        brightness: parseFloat(el.dataset.brightness ?? "0"),
        invert: el.dataset.invert === "true",
        edgeThreshold: parseFloat(el.dataset.edge ?? "0.22"),
        maxDensity: parseFloat(el.dataset.weight ?? "0.42"),
        fit: el.dataset.fit ?? "cover",
      };

      if (kind === "image") {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.src = el.dataset.src ?? el.querySelector("img")?.src ?? "";
        const plane = add({ el, kind, rows, options, media: image, ready: false, frame: null, dirty: true });
        image.addEventListener("load", () => { plane.ready = true; plane.dirty = true; });
      } else if (kind === "video") {
        const video = document.createElement("video");
        video.src = el.dataset.src ?? el.querySelector("video source")?.src ?? "";
        video.muted = true;
        video.loop = el.dataset.loop !== "false";
        video.playsInline = true;
        video.preload = "auto";
        video.crossOrigin = "anonymous";
        const plane = add({ el, kind, rows, options, media: video, ready: false, frame: null, dirty: true });
        video.addEventListener("loadeddata", () => { plane.ready = true; plane.dirty = true; });
      }
      el.classList.add("glyph-plane");
    }
    return planes;
  }

  // Called by the typesetter once it knows where each figure landed.
  function place(el, worldRow, col, cols, rows) {
    const plane = planes.find((p) => p.el === el);
    if (!plane) return;
    plane.worldRow = worldRow;
    plane.col = col;
    plane.cols = cols;
    plane.rows = rows;
    plane.dirty = true;
    // stamp the placement so it is inspectable from the document
    plane.el.dataset.placedRow = String(worldRow);
    plane.el.dataset.placedCols = String(cols);
  }

  // Re-sample any plane that needs it. Videos re-sample every frame while
  // playing; still images only when placed or resized.
  function update() {
    let changed = false;
    for (const plane of planes) {
      if (!plane.ready || !plane.cols) continue;
      const live = plane.kind === "video" && !plane.media.paused && !plane.media.ended;
      if (!plane.dirty && !live) continue;
      const field = sampler.sample(plane.media, plane.cols, plane.rows, plane.options);
      if (!field) continue;
      plane.frame = sampler.toGlyphs(field, space, plane.options, plane.frame);
      plane.dirty = false;
      changed = true;
    }
    return changed;
  }

  // Look up one world cell. Returns -1 when no plane covers it.
  function at(worldRow, col) {
    for (let i = planes.length - 1; i >= 0; i -= 1) {
      const p = planes[i];
      if (!p.frame || p.worldRow === undefined) continue;
      const r = worldRow - p.worldRow;
      const c = col - p.col;
      if (r < 0 || r >= p.rows || c < 0 || c >= p.cols) continue;
      const glyph = p.frame.glyphs[r * p.cols + c];
      if (glyph < 0) continue;
      return { glyph, ink: p.frame.ink[r * p.cols + c] };
    }
    return null;
  }

  function playVisible(cameraRow, viewRows) {
    for (const plane of planes) {
      if (plane.kind !== "video" || !plane.ready) continue;
      const visible = plane.worldRow !== undefined &&
        plane.worldRow + plane.rows > cameraRow && plane.worldRow < cameraRow + viewRows;
      if (visible && plane.media.paused) plane.media.play().catch(() => {});
      else if (!visible && !plane.media.paused) plane.media.pause();
    }
  }

  return { collect, place, update, at, playVisible, list: () => planes, count: () => planes.length };
}
