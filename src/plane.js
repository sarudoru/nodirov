// Media regions write into the same world cells as the document.
import { createSampler } from "./media.js";

export function createPlanes(space, invalidate = () => {}) {
  let current = space;
  const sampler = createSampler();
  let planes = [];
  let paused = false;
  let visibleDocument = true;

  function collect(article) {
    const previous = new Map(planes.map((p) => [p.el, p]));
    planes = [...article.querySelectorAll("[data-glyph]")].map((el) => {
      if (previous.has(el)) {
        const p = previous.get(el);
        previous.delete(el);
        return p;
      }
      const kind = el.dataset.glyph;
      const media = kind === "video" ? el.querySelector("video") : new Image();
      const p = {
        el,
        kind,
        media,
        ready: false,
        dirty: true,
        visible: false,
        frame: null,
        lastSample: -Infinity,
        options: {
          gamma: Number(el.dataset.gamma || 1),
          invert: el.dataset.invert === "true",
          fit: el.dataset.fit || "cover",
          color: el.dataset.color || "mono",
          ramp: el.dataset.ramp || "",
          dither: Number(el.dataset.dither || 0),
        },
      };
      const ready = () => {
        p.ready = true;
        p.dirty = true;
        invalidate();
      };
      media.addEventListener(kind === "video" ? "loadeddata" : "load", ready);
      media.addEventListener("error", () => {
        p.failed = true;
        el.dataset.mediaState = "unavailable";
        const status = document.createElement("span");
        status.className = "sr-only";
        status.textContent = "This picture is unavailable.";
        el.appendChild(status);
        invalidate();
      });
      el.setAttribute(
        "aria-label",
        el.querySelector("img")?.alt ||
          media.getAttribute("aria-label") ||
          "Picture",
      );
      if (kind === "video") {
        media.muted = true;
        media.loop = true;
        media.playsInline = true;
        media.preload = "none";
      } else {
        media.decoding = "async";
        media.src = el.dataset.src;
      }
      el.classList.add("glyph-plane");
      return p;
    });
    for (const p of previous.values()) if (p.kind === "video") p.media.pause();
    return planes;
  }

  function place(el, worldRow, col, cols, rows, aspect = 2) {
    const p = planes.find((p) => p.el === el);
    if (!p) return;
    Object.assign(p, { worldRow, col, cols, rows, dirty: true });
    p.options.aspect = aspect;
    el.dataset.placedRow = String(worldRow);
    el.dataset.placedCol = String(col);
    el.dataset.placedCols = String(cols);
    el.dataset.placedRows = String(rows);
  }

  function update(now = performance.now()) {
    for (const p of planes) {
      if (!p.ready || !p.cols || !p.visible) continue;
      const live = !paused && p.kind === "video" && !p.media.paused;
      if (!p.dirty && (!live || now - p.lastSample < 1000 / 24)) continue;
      if (!p.dirty && p.kind === "video" && p.media.currentTime === p.lastTime)
        continue;
      const sample = sampler.sample(p.media, p.cols, p.rows, p.options, p.sample);
      if (!sample) continue;
      p.sample = sample;
      p.frame = sampler.toGlyphs(sample, current, p.options, p.frame);
      p.dirty = false;
      p.lastSample = now;
      p.lastTime = p.media.currentTime;
      p.el.dataset.mediaState = live ? "playing" : "still";
    }
  }

  function at(worldRow, col) {
    for (const p of planes) {
      if (!p.visible) continue;
      if (p.failed) {
        const label = "[ picture unavailable ]";
        const c =
          col - p.col - Math.max(0, Math.floor((p.cols - label.length) / 2));
        if (
          worldRow === p.worldRow + Math.floor(p.rows / 2) &&
          c >= 0 &&
          c < Math.min(label.length, p.cols)
        )
          return { glyph: current.indexOf(label[c]), ink: 0.7, color: "" };
        continue;
      }
      if (!p.frame) continue;
      const r = worldRow - p.worldRow,
        c = col - p.col;
      if (r < 0 || r >= p.rows || c < 0 || c >= p.cols) continue;
      const i = r * p.cols + c;
      if (p.frame.glyphs[i] < 0) continue;
      return {
        glyph: p.frame.glyphs[i],
        ink: p.frame.ink[i],
        color: p.frame.colors[i],
      };
    }
    return null;
  }

  function playVisible(camera, rows) {
    for (const p of planes) {
      p.visible =
        visibleDocument &&
        p.worldRow !== undefined &&
        p.worldRow + p.rows > camera &&
        p.worldRow < camera + rows + 1;
      if (p.kind !== "video") continue;
      if (p.visible && !p.requested) {
        p.requested = true;
        p.media.preload = "auto";
        p.media.load();
      }
      if (p.visible && p.ready && !paused) {
        if (p.media.paused && !p.playPending && !p.playBlocked) {
          p.playPending = true;
          p.media
            .play()
            .catch(() => {
              p.playBlocked = true;
            })
            .finally(() => {
              p.playPending = false;
            });
        }
      } else if (!p.media.paused) p.media.pause();
    }
  }

  return {
    collect,
    place,
    update,
    at,
    playVisible,
    setPaused(value) {
      paused = value;
      for (const p of planes) {
        if (paused && p.kind === "video") p.media.pause();
        if (!paused) p.playBlocked = false;
      }
    },
    setVisible(value) {
      visibleDocument = value;
      if (!value)
        for (const p of planes) if (p.kind === "video") p.media.pause();
    },
    setSpace(next) {
      current = next;
      for (const p of planes) p.dirty = true;
    },
    list: () => planes,
    count: () => planes.length,
  };
}
