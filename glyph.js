(() => {
  "use strict";

  const canvas = document.querySelector("#field");
  const context = canvas.getContext("2d", { alpha: false });

  const CELL_WIDTH = 17;
  const CELL_HEIGHT = 26;
  const FONT_SIZE = 22;
  const WORLD_ROWS = 150;
  const BACKGROUND_MUTATION_MS = 420;
  const TRACE_DURATION_MS = 116;
  const TRACE_STEP_MS = 29;
  const BACKGROUND = "#ffffff";
  const INK = "#111111";
  const AMBIENT_INK = "rgba(17, 17, 17, 0.022)";
  const POINTER_INK = "rgba(17, 17, 17, 0.25)";
  const TRACE_INK_MEDIUM = "rgba(17, 17, 17, 0.32)";
  const TRACE_INK_FAINT = "rgba(17, 17, 17, 0.085)";
  const FONT = '"IBM Plex Mono", monospace';

  const AMBIENT = "0123456789abcdefghijklmnopqrstuvwxyz";
  const POINTER = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const LINES = [
    [7, "THE GLYPH IS THE PIXEL"],
    [10, "THE FIELD IS THE PAGE"],
    [20, "SCROLL"],
    [42, "NOTHING HERE MOVES"],
    [45, "THE CELLS ONLY CHANGE"],
    [72, "ONE GRID"],
    [75, "EVERY MARK ADDRESSABLE"],
    [105, "CONTENT IS A STATE"],
    [108, "NOT A LAYER"],
    [137, "END / BEGIN AGAIN"]
  ];

  const palette = [" "];
  const paletteIndex = new Map([[" ", 0]]);

  function tokenIndex(token) {
    let index = paletteIndex.get(token);
    if (index !== undefined) return index;
    index = palette.length;
    palette.push(token);
    paletteIndex.set(token, index);
    return index;
  }

  const ambientIndices = Array.from(AMBIENT, tokenIndex);
  const pointerIndices = Array.from(POINTER, tokenIndex);
  for (const [, line] of LINES) {
    for (const token of line) tokenIndex(token);
  }

  const randomValues = new Uint32Array(256);
  let randomCursor = randomValues.length;

  function randomUint() {
    if (randomCursor >= randomValues.length) {
      crypto.getRandomValues(randomValues);
      randomCursor = 0;
    }
    return randomValues[randomCursor++];
  }

  function randomToken(indices) {
    return indices[randomUint() % indices.length];
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  let width = 0;
  let height = 0;
  let columns = 0;
  let visibleRows = 0;
  let cameraRow = 0;
  let worldContent = new Uint16Array();
  let backgroundTokens = new Uint16Array();
  let displayTokens = new Uint16Array();
  let displayKinds = new Uint8Array();
  let traceStarts = new Float64Array();
  let traceFromTokens = new Uint16Array();
  let traceFromKinds = new Uint8Array();
  let traceSeeds = new Uint32Array();
  let pointerMask = new Uint8Array();
  let pointerTokens = new Uint16Array();
  let pointerCells = [];
  let pointerTimer = 0;
  let lastPointerCell = -1;
  let wheelRemainder = 0;
  let touchY = null;
  let touchRemainder = 0;
  let animationFrame = 0;

  function buildWorld() {
    worldContent = new Uint16Array(columns * WORLD_ROWS);

    for (const [row, text] of LINES) {
      const start = Math.max(1, Math.floor((columns - text.length) / 2));
      for (let offset = 0; offset < text.length; offset += 1) {
        const token = text[offset];
        const column = start + offset;
        if (token === " " || column < 0 || column >= columns) continue;
        worldContent[row * columns + column] = tokenIndex(token);
      }
    }

    const viewCount = columns * visibleRows;
    backgroundTokens = new Uint16Array(viewCount);
    displayTokens = new Uint16Array(viewCount);
    displayKinds = new Uint8Array(viewCount);
    traceStarts = new Float64Array(viewCount);
    traceFromTokens = new Uint16Array(viewCount);
    traceFromKinds = new Uint8Array(viewCount);
    traceSeeds = new Uint32Array(viewCount);
    pointerMask = new Uint8Array(viewCount);
    pointerTokens = new Uint16Array(viewCount);
    pointerCells = [];
    lastPointerCell = -1;

    for (let index = 0; index < viewCount; index += 1) {
      backgroundTokens[index] = randomToken(ambientIndices);
    }

    cameraRow = clamp(cameraRow, 0, Math.max(0, WORLD_ROWS - visibleRows));
    composeView(false);
  }

  function composeView(animate) {
    const now = performance.now();
    for (let row = 0; row < visibleRows; row += 1) {
      const worldRow = cameraRow + row;
      for (let column = 0; column < columns; column += 1) {
        const viewIndex = row * columns + column;
        const previousToken = displayTokens[viewIndex];
        const previousKind = displayKinds[viewIndex];
        const contentToken = worldContent[worldRow * columns + column];
        const nextKind = contentToken === 0 ? 0 : 1;
        const nextToken = contentToken || backgroundTokens[viewIndex];

        if (animate && (previousKind === 1 || nextKind === 1) &&
            (previousKind !== nextKind || previousToken !== nextToken)) {
          traceStarts[viewIndex] = now;
          traceFromTokens[viewIndex] = previousToken;
          traceFromKinds[viewIndex] = previousKind;
          traceSeeds[viewIndex] = randomUint();
        } else if (!animate) {
          traceStarts[viewIndex] = 0;
        }

        displayKinds[viewIndex] = nextKind;
        displayTokens[viewIndex] = nextToken;
      }
    }
    clearPointer();
    scheduleDraw();
  }

  function setCamera(nextRow) {
    const maximum = Math.max(0, WORLD_ROWS - visibleRows);
    const next = clamp(nextRow, 0, maximum);
    if (next === cameraRow) return;
    cameraRow = next;
    composeView(true);
  }

  function draw() {
    animationFrame = 0;
    context.fillStyle = BACKGROUND;
    context.fillRect(0, 0, width, height);
    context.font = `${FONT_SIZE}px ${FONT}`;
    context.textAlign = "center";
    context.textBaseline = "middle";

    const xOffset = (width - columns * CELL_WIDTH) / 2;
    const yOffset = (height - visibleRows * CELL_HEIGHT) / 2;

    const now = performance.now();
    let traceActive = false;

    for (let row = 0; row < visibleRows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        let token = displayTokens[index];
        let ink = displayKinds[index] === 1 ? INK : AMBIENT_INK;

        if (pointerMask[index]) {
          token = pointerTokens[index];
          ink = POINTER_INK;
        } else if (traceStarts[index] !== 0) {
          const elapsed = now - traceStarts[index];
          if (elapsed < TRACE_DURATION_MS) {
            traceActive = true;
            const stage = Math.floor(elapsed / TRACE_STEP_MS);

            if (stage === 0) {
              token = traceFromTokens[index];
              ink = traceFromKinds[index] === 1 ? INK : TRACE_INK_FAINT;
            } else if (stage < 3) {
              token = pointerIndices[(traceSeeds[index] + stage * 17) % pointerIndices.length];
              if (displayKinds[index] === 1) {
                ink = TRACE_INK_MEDIUM;
              } else {
                ink = stage === 1 ? TRACE_INK_MEDIUM : TRACE_INK_FAINT;
              }
            }
          } else {
            traceStarts[index] = 0;
          }
        }

        context.fillStyle = ink;
        context.fillText(
          palette[token],
          xOffset + column * CELL_WIDTH + CELL_WIDTH / 2,
          yOffset + row * CELL_HEIGHT + CELL_HEIGHT / 2
        );
      }
    }

    if (traceActive) scheduleDraw();
  }

  function scheduleDraw() {
    if (animationFrame !== 0) return;
    animationFrame = requestAnimationFrame(draw);
  }

  function mutateBackground() {
    if (document.visibilityState !== "visible" || backgroundTokens.length === 0) return;
    const index = randomUint() % backgroundTokens.length;
    let next = randomToken(ambientIndices);
    if (next === backgroundTokens[index]) next = randomToken(ambientIndices);
    backgroundTokens[index] = next;
    if (displayKinds[index] === 0) displayTokens[index] = next;
    scheduleDraw();
  }

  function clearPointer() {
    window.clearTimeout(pointerTimer);
    pointerTimer = 0;
    for (const index of pointerCells) pointerMask[index] = 0;
    pointerCells = [];
    lastPointerCell = -1;
  }

  function pulseAt(x, y) {
    const xOffset = (width - columns * CELL_WIDTH) / 2;
    const yOffset = (height - visibleRows * CELL_HEIGHT) / 2;
    const centerColumn = Math.floor((x - xOffset) / CELL_WIDTH);
    const centerRow = Math.floor((y - yOffset) / CELL_HEIGHT);
    if (centerRow < 0 || centerRow >= visibleRows || centerColumn < 0 || centerColumn >= columns) return;

    const centerIndex = centerRow * columns + centerColumn;
    if (centerIndex === lastPointerCell) return;
    clearPointer();
    lastPointerCell = centerIndex;
    const directions = randomUint() % 2 === 0
      ? [[0, 0], [-1, 0], [1, 0]]
      : [[0, 0], [0, -1], [0, 1]];

    for (const [rowOffset, columnOffset] of directions) {
      const row = centerRow + rowOffset;
      const column = centerColumn + columnOffset;
      if (row < 0 || row >= visibleRows || column < 0 || column >= columns) continue;
      const index = row * columns + column;
      pointerMask[index] = 1;
      pointerTokens[index] = randomToken(pointerIndices);
      pointerCells.push(index);
    }

    pointerTimer = window.setTimeout(() => {
      clearPointer();
      scheduleDraw();
    }, 150);
    scheduleDraw();
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    columns = Math.max(12, Math.floor(width / CELL_WIDTH));
    visibleRows = Math.max(8, Math.ceil(height / CELL_HEIGHT));
    buildWorld();
  }

  window.addEventListener("resize", resize);
  window.addEventListener("wheel", (event) => {
    event.preventDefault();
    wheelRemainder += event.deltaY;
    const rows = Math.trunc(wheelRemainder / CELL_HEIGHT);
    if (rows === 0) return;
    wheelRemainder -= rows * CELL_HEIGHT;
    setCamera(cameraRow + clamp(rows, -12, 12));
  }, { passive: false });

  window.addEventListener("pointermove", (event) => {
    pulseAt(event.clientX, event.clientY);
  }, { passive: true });

  window.addEventListener("touchstart", (event) => {
    touchY = event.touches[0]?.clientY ?? null;
  }, { passive: true });

  window.addEventListener("touchmove", (event) => {
    if (touchY === null) return;
    event.preventDefault();
    const nextY = event.touches[0]?.clientY;
    if (nextY === undefined) return;
    touchRemainder += touchY - nextY;
    const rows = Math.trunc(touchRemainder / CELL_HEIGHT);
    if (rows !== 0) {
      touchRemainder -= rows * CELL_HEIGHT;
      setCamera(cameraRow + clamp(rows, -12, 12));
    }
    touchY = nextY;
  }, { passive: false });

  window.addEventListener("touchend", () => {
    touchY = null;
    touchRemainder = 0;
  }, { passive: true });

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") setCamera(cameraRow + 1);
    else if (event.key === "ArrowUp") setCamera(cameraRow - 1);
    else if (event.key === "PageDown" || event.key === " ") setCamera(cameraRow + visibleRows - 2);
    else if (event.key === "PageUp") setCamera(cameraRow - visibleRows + 2);
    else if (event.key === "Home") setCamera(0);
    else if (event.key === "End") setCamera(WORLD_ROWS - visibleRows);
    else return;
    event.preventDefault();
  });

  resize();
  document.fonts.load(`${FONT_SIZE}px ${FONT}`).then(scheduleDraw);
  setInterval(mutateBackground, BACKGROUND_MUTATION_MS);
})();
