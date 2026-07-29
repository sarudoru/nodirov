// Inhabitants of the field. Every entity is a set of cell states refreshed on
// a discrete tick — no pixels, no tweens. Motion is a cell that stops being
// one character and a neighbor that starts.

const ACCENT = "#c8401f";
const INK = "#161616";
const INK_FAINT = "rgba(22, 22, 22, 0.40)";
const STEAM = "rgba(22, 22, 22, 0.30)";

const TRAIN_ART = [
  "       ___                              ",
  "  ____| | |__   __________  __________  ",
  " |o o o  SN |==|  ______  ||  ______  | ",
  " |__________|  |__________||__________| ",
];
const TRAIN_WHEELS_A = "   o-o    o-o     o------o    o------o  ";
const TRAIN_WHEELS_B = "   0-0    0-0     0------0    0------0  ";
const TRAIN_W = TRAIN_ART[0].length;
const TRAIN_H = TRAIN_ART.length + 1;
const STACK_COL = 8;

export function createEntities(field) {
  let timer = 0;
  let butterfly = null;
  let train = null;
  let gravity = null;
  let cursor = { col: -1, row: -1, at: 0, fast: 0 };

  function active() {
    return butterfly || train || gravity;
  }

  function ensureLoop() {
    if (timer || !active()) return;
    timer = window.setInterval(tick, 50);
  }

  function stopLoopIfIdle() {
    if (!active() && timer) {
      window.clearInterval(timer);
      timer = 0;
      field.setOverlayCells([]);
    }
  }

  function tick() {
    const now = performance.now();
    if (butterfly) tickButterfly(now);
    if (train) tickTrain(now);
    if (gravity) tickGravity(now);
    render();
    stopLoopIfIdle();
  }

  function render() {
    const cells = [];
    if (train) {
      const x = Math.round(train.x);
      const wheels = train.frame % 2 === 0 ? TRAIN_WHEELS_A : TRAIN_WHEELS_B;
      const artRows = [...TRAIN_ART, wheels];
      for (let r = 0; r < artRows.length; r += 1) {
        const rowText = artRows[r];
        // opaque silhouette: blank cells inside the body occlude the field
        const start = rowText.search(/\S/);
        if (start === -1) continue;
        const end = rowText.length - [...rowText].reverse().join("").search(/\S/);
        for (let c = start; c < end; c += 1) {
          cells.push({ col: x + c, row: train.row + r, ch: rowText[c], ink: INK });
        }
      }
      for (const puff of train.steam) {
        const chars = "@Oo°·";
        const ch = chars[Math.min(chars.length - 1, puff.age)];
        cells.push({ col: Math.round(puff.col), row: Math.round(puff.row), ch, ink: STEAM });
      }
    }
    if (gravity) {
      for (const p of gravity.particles) {
        cells.push({ col: p.col, row: Math.round(p.y), ch: p.ch, ink: p.faint ? INK_FAINT : INK });
      }
    }
    if (butterfly) {
      const col = Math.round(butterfly.x);
      const row = Math.round(butterfly.y);
      const open = butterfly.flap % 2 === 0 && butterfly.mode !== "rest";
      cells.push({ col: col - 1, row, ch: open ? "\\" : ")", ink: ACCENT });
      cells.push({ col, row, ch: "·", ink: ACCENT });
      cells.push({ col: col + 1, row, ch: open ? "/" : "(", ink: ACCENT });
    }
    field.setOverlayCells(cells);
  }

  // ---- butterfly ----

  function spawnButterfly() {
    butterfly = {
      x: -2,
      y: Math.round(field.rows() * 0.3),
      tx: Math.round(field.cols() * 0.5),
      ty: Math.round(field.rows() * 0.4),
      flap: 0,
      mode: "wander", // wander | visit | rest | flee
      restUntil: 0,
      lastTick: 0,
      retargetAt: 0,
      glitch: null,
    };
    ensureLoop();
  }

  function tickButterfly(now) {
    const b = butterfly;
    if (now - b.lastTick < 105) return;
    b.lastTick = now;
    b.flap += 1;

    if (b.mode === "rest") {
      if (now >= b.restUntil) b.mode = "wander";
      else return;
    }

    // flee a fast cursor
    if (cursor.fast > 0 && now - cursor.at < 400) {
      const d = Math.hypot(b.x - cursor.col, b.y - cursor.row);
      if (d < 9 && b.mode !== "flee") {
        b.mode = "flee";
        b.tx = b.x + (b.x - cursor.col) * 3;
        b.ty = b.y + (b.y - cursor.row) * 3;
      }
    }

    // an idle cursor is interesting
    if (b.mode === "wander" && cursor.col >= 0 && now - cursor.at > 5000) {
      b.tx = cursor.col + 2;
      b.ty = cursor.row - 1;
    }

    if (b.mode !== "flee" && now >= b.retargetAt) {
      b.retargetAt = now + 3800 + Math.random() * 3200;
      const glitches = field.visibleGlitches();
      if (glitches.length && Math.random() < 0.65) {
        const g = glitches[Math.floor(Math.random() * glitches.length)];
        b.mode = "visit";
        b.glitch = g;
        b.tx = g.col;
        b.ty = g.row;
      } else {
        b.mode = "wander";
        b.glitch = null;
        b.tx = 3 + Math.random() * (field.cols() - 6);
        b.ty = 2 + Math.random() * (field.rows() - 5);
      }
    }

    const dx = b.tx - b.x;
    const dy = b.ty - b.y;
    const dist = Math.hypot(dx, dy);
    const speed = b.mode === "flee" ? 2.2 : 0.85;

    if (dist < 1.2) {
      if (b.mode === "visit" && b.glitch) {
        field.repairGlitch(b.glitch.worldRow, b.glitch.col);
        b.glitch = null;
        b.mode = "rest";
        b.restUntil = now + 1500;
        b.retargetAt = now + 1600;
      } else if (b.mode === "flee") {
        b.mode = "wander";
        b.retargetAt = now;
      }
      return;
    }

    b.x += (dx / dist) * speed + (Math.random() - 0.5) * 0.5;
    b.y += (dy / dist) * speed * 0.8 + (Math.random() - 0.5) * 0.5;
    b.x = Math.max(1, Math.min(field.cols() - 2, b.x));
    b.y = Math.max(1, Math.min(field.rows() - 2, b.y));
  }

  // ---- train ----

  function runTrain() {
    if (train) return;
    train = {
      x: field.cols() + 2,
      row: Math.max(2, Math.round(field.rows() * 0.5) - 3),
      frame: 0,
      steam: [],
      lastTick: 0,
    };
    ensureLoop();
  }

  function tickTrain(now) {
    if (now - train.lastTick < 65) return;
    train.lastTick = now;
    train.frame += 1;
    train.x -= 1.6;

    if (train.frame % 2 === 0) {
      train.steam.push({ col: train.x + STACK_COL, row: train.row - 1, age: 0 });
    }
    for (const puff of train.steam) {
      puff.age += 1;
      puff.col += 0.9 + Math.random() * 0.5;
      puff.row -= Math.random() < 0.55 ? 1 : 0;
    }
    train.steam = train.steam.filter((p) => p.age < 5 && p.row > 0);

    if (train.x < -TRAIN_W - 4 && train.steam.length === 0) train = null;
  }

  // ---- gravity ----

  function dropRows(fromWorldRow, toWorldRow) {
    if (gravity) return;
    const camera = field.camera();
    const rows = field.rows();
    const all = field.committedCellsInWorldRows(fromWorldRow, toWorldRow);
    const particles = [];
    const maskCells = [];
    for (const cell of all) {
      const screenRow = cell.worldRow - camera;
      if (screenRow < 0 || screenRow >= rows - 1) continue;
      maskCells.push({ worldRow: cell.worldRow, col: cell.col });
      particles.push({
        ch: cell.ch,
        col: cell.col,
        y: screenRow,
        vy: 0,
        faint: cell.faint,
        delay: Math.random() * 900,
        settled: false,
        born: performance.now(),
      });
    }
    if (!particles.length) return;
    field.setMasks(maskCells);
    gravity = { particles, pile: new Map(), settledAt: 0, lastTick: 0 };
    ensureLoop();
  }

  function tickGravity(now) {
    const g = gravity;
    if (now - g.lastTick < 50) return;
    g.lastTick = now;
    const floorRow = field.rows() - 1;
    let moving = false;

    for (const p of g.particles) {
      if (p.settled || now - p.born < p.delay) {
        if (!p.settled) moving = true;
        continue;
      }
      p.vy = Math.min(p.vy + 0.5, 3.2);
      const pileH = g.pile.get(p.col) ?? 0;
      const floor = floorRow - pileH;
      p.y += p.vy;
      if (p.y >= floor) {
        p.y = floor;
        p.settled = true;
        g.pile.set(p.col, pileH + 1);
      } else {
        moving = true;
      }
    }

    if (!moving && !g.settledAt) g.settledAt = now;
    if (g.settledAt && now - g.settledAt > 2400) {
      gravity = null;
      field.setMasks(null, true);
    }
  }

  function abortGravity() {
    if (!gravity) return;
    gravity = null;
    field.setMasks(null, false);
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
    runTrain,
    dropRows,
    onCameraMove() {
      abortGravity();
    },
    pointer(col, row, fast) {
      cursor.col = col;
      cursor.row = row;
      cursor.at = performance.now();
      cursor.fast = fast ? 1 : 0;
    },
  };
}
