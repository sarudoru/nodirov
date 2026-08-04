// The field has one inhabitant: the butterfly. It is a formation of cells
// moving in discrete steps — the only colored thing in the world. It flies
// where it pleases, lingers, repairs broken glyphs, and is fond of idle
// cursors. Motion is a cell that stops being one character and a neighbor
// that starts.

const DEFAULT_ACCENT = "#c8401f";

export function createEntities(field, accent = DEFAULT_ACCENT) {
  let timer = 0;
  let butterfly = null;
  const cursor = { col: -1, row: -1, at: 0, fast: 0 };

  function ensureLoop() {
    if (timer || !butterfly) return;
    timer = window.setInterval(tick, 50);
  }

  function stopLoopIfIdle() {
    if (!butterfly && timer) {
      window.clearInterval(timer);
      timer = 0;
      field.setOverlayCells([]);
    }
  }

  function tick() {
    if (butterfly) tickButterfly(performance.now());
    render();
    stopLoopIfIdle();
  }

  // Two rows, two frames. Body ï — the diaeresis reads as antennae.
  //   open:   \ /      folded:
  //           (ï)               )ï(
  function render() {
    const cells = [];
    if (butterfly) {
      const b = butterfly;
      const col = Math.round(b.x);
      const row = Math.round(b.y);
      const slow = b.mode === "hover" || b.mode === "visit";
      const open = (slow ? b.flap % 4 < 2 : b.flap % 2 === 0);
      if (open) {
        cells.push({ col: col - 1, row: row - 1, ch: "\\", ink: accent });
        cells.push({ col: col + 1, row: row - 1, ch: "/", ink: accent });
        cells.push({ col: col - 1, row, ch: "(", ink: accent });
        cells.push({ col, row, ch: "ï", ink: accent });
        cells.push({ col: col + 1, row, ch: ")", ink: accent });
      } else {
        cells.push({ col: col - 1, row, ch: ")", ink: accent });
        cells.push({ col, row, ch: "ï", ink: accent });
        cells.push({ col: col + 1, row, ch: "(", ink: accent });
      }
    }
    field.setOverlayCells(cells);
  }

  function spawnButterfly() {
    const fromLeft = Math.random() < 0.5;
    butterfly = {
      x: fromLeft ? -2 : field.cols() + 2,
      y: 2 + Math.random() * (field.rows() * 0.5),
      tx: field.cols() * (0.3 + Math.random() * 0.4),
      ty: field.rows() * (0.25 + Math.random() * 0.5),
      flap: 0,
      mode: "wander", // wander | visit | hover | flee
      hoverUntil: 0,
      lastTick: 0,
      retargetAt: 0,
      glitch: null,
    };
    ensureLoop();
  }

  function pickTarget(b, now) {
    b.retargetAt = now + 2600 + Math.random() * 3400;
    const glitches = field.visibleGlitches();
    const roll = Math.random();
    if (glitches.length && roll < 0.3) {
      const g = glitches[Math.floor(Math.random() * glitches.length)];
      b.mode = "visit";
      b.glitch = g;
      b.tx = g.col;
      b.ty = g.row;
    } else if (roll < 0.5) {
      // linger where it is, drifting
      b.mode = "hover";
      b.hoverUntil = now + 1200 + Math.random() * 2200;
    } else {
      b.mode = "wander";
      b.glitch = null;
      b.tx = 2 + Math.random() * (field.cols() - 4);
      b.ty = 2 + Math.random() * (field.rows() - 4);
    }
  }

  function tickButterfly(now) {
    const b = butterfly;
    if (now - b.lastTick < 105) return;
    b.lastTick = now;
    b.flap += 1;

    // a fast cursor nearby startles it
    if (cursor.fast > 0 && now - cursor.at < 400) {
      const d = Math.hypot(b.x - cursor.col, b.y - cursor.row);
      if (d < 9 && b.mode !== "flee") {
        b.mode = "flee";
        b.tx = b.x + (b.x - cursor.col) * 3 + (Math.random() - 0.5) * 6;
        b.ty = b.y + (b.y - cursor.row) * 3 + (Math.random() - 0.5) * 4;
      }
    }

    // an idle cursor is interesting
    if (b.mode === "wander" && cursor.col >= 0 && now - cursor.at > 5000) {
      b.tx = cursor.col + 2;
      b.ty = cursor.row - 1;
    }

    if (b.mode === "hover") {
      b.x += (Math.random() - 0.5) * 0.7;
      b.y += (Math.random() - 0.5) * 0.5;
      if (now >= b.hoverUntil) pickTarget(b, now);
      clampToView(b);
      return;
    }

    if (b.mode !== "flee" && now >= b.retargetAt) pickTarget(b, now);
    if (b.mode === "hover") return;

    const dx = b.tx - b.x;
    const dy = b.ty - b.y;
    const dist = Math.hypot(dx, dy);
    const speed = b.mode === "flee" ? 2.2 : 0.8;

    if (dist < 1.2) {
      if (b.mode === "visit" && b.glitch) {
        field.repairGlitch(b.glitch.worldRow, b.glitch.col);
        b.glitch = null;
      }
      b.mode = "hover";
      b.hoverUntil = now + 1400 + Math.random() * 2000;
      return;
    }

    b.x += (dx / dist) * speed + (Math.random() - 0.5) * 0.55;
    b.y += (dy / dist) * speed * 0.8 + (Math.random() - 0.5) * 0.55;
    if (b.mode === "flee" && dist < 3) {
      b.mode = "wander";
      b.retargetAt = now;
    }
    clampToView(b);
  }

  function clampToView(b) {
    b.x = Math.max(1, Math.min(field.cols() - 2, b.x));
    b.y = Math.max(1.5, Math.min(field.rows() - 2, b.y));
  }

  return {
    toggleButterfly() {
      if (butterfly) {
        butterfly = null;
        render();
        stopLoopIfIdle();
        return false;
      }
      spawnButterfly();
      return true;
    },
    hasButterfly: () => !!butterfly,
    onCameraMove() { /* the butterfly is unbothered by scrolling */ },
    pointer(col, row, fast) {
      cursor.col = col;
      cursor.row = row;
      cursor.at = performance.now();
      cursor.fast = fast ? 1 : 0;
    },
  };
}
