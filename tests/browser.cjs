const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.SITE_URL || "http://127.0.0.1:4190";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_PATH
      ? { executablePath: process.env.BROWSER_PATH }
      : {}),
  });
  const errors = [];
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__glyph?.media()[0].ready);
    assert.equal(await page.locator("h1").getAttribute("aria-label"), null);
    assert.equal(
      await page.locator("h1 .sr-only").innerText(),
      "Sardor Nodirov",
    );
    assert.equal(await page.evaluate(() => __glyph.planeCount()), 3);
    assert.ok(
      await page.evaluate(() =>
        __glyph
          .media()
          .filter((p) => p.id !== "flower")
          .every((p) => !p.ready && p.paused),
      ),
    );

    // Every control must be reachable through the native keyboard order.
    for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.tagName),
      "BUTTON",
    );
    await page.keyboard.press("Space");
    assert.equal(
      await page.locator("[data-motion]").getAttribute("aria-pressed"),
      "true",
    );
    await page.waitForTimeout(100);
    const pausedFrames = await page.evaluate(
      () => __glyph.stats().renderedFrames,
    );
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => __glyph.stats().renderedFrames),
      pausedFrames,
    );
    await page.keyboard.press("Space");
    assert.equal(
      await page.locator("[data-motion]").getAttribute("aria-pressed"),
      "false",
    );

    // Record destination coordinates of glyph blits across fractional scroll.
    const origins = await page.evaluate(async () => {
      __glyph.set({ settleMs: 0 });
      const canvas = document.querySelector("#field"),
        ctx = canvas.getContext("2d");
      const original = ctx.drawImage;
      let calls = [];
      ctx.drawImage = function (...args) {
        if (args.length === 9) calls.push([args[5], args[6]]);
        return original.apply(this, args);
      };
      const frame = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      await frame();
      const a = calls;
      calls = [];
      document.querySelector("#scroller").scrollTop = 7;
      await frame();
      const b = calls;
      ctx.drawImage = original;
      return { a, b, phase: __glyph.stats().phase };
    });
    assert.ok(origins.phase > 0 && origins.phase < 1);
    const xOrigins = new Set(origins.a.map(([x]) => x));
    const yOrigins = new Set(origins.a.map(([, y]) => y));
    assert.ok(
      origins.b.every(([x, y]) => xOrigins.has(x) && yOrigins.has(y)),
      "Glyph destinations must stay on the fixed lattice",
    );
    await page.evaluate(() => __glyph.set({ settleMs: 110 }));
    await page.mouse.wheel(0, 280);
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(() => __glyph.stats().phase),
      0,
      "Reading must settle on one row",
    );

    await page.goto(base + "/#studies");
    await page.waitForFunction(() =>
      window.__glyph
        ?.media()
        .filter((p) => p.id !== "flower")
        .every((p) => p.ready && !p.paused && p.time > 0.1),
    );
    await page.screenshot({ path: "tmp/studies-verified.png" });
    const videoTime = await page
      .locator("#portrait video")
      .evaluate((video) => {
        video.dataset.identity = "same-source";
        return video.currentTime;
      });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(350);
    assert.equal(
      await page.locator("#portrait video").getAttribute("data-identity"),
      "same-source",
    );
    assert.ok(
      await page
        .locator("#portrait video")
        .evaluate((video, t) => video.currentTime >= t, videoTime),
    );
    await page.evaluate(() => {
      location.hash = "contact";
    });
    await page.waitForTimeout(350);
    assert.ok(
      await page.evaluate(() =>
        __glyph
          .media()
          .filter((p) => p.id !== "flower")
          .every((p) => p.paused),
      ),
    );

    // Text remains selectable in document order, including spaces around links.
    const selected = await page
      .locator("#work > p")
      .first()
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString().replace(/\s+/g, " ").trim();
      });
    assert.equal(
      selected,
      "I care about systems with clear internal rules, interfaces that explain themselves, and products that respect the person on the other side of the screen.",
    );

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(base + "/#hero");
      await page.waitForFunction(
        () =>
          window.__glyph?.media()[0].ready &&
          parseFloat(document.querySelector("#field").style.width) ===
            innerWidth,
      );
      assert.ok(
        await page.evaluate(
          () => document.querySelector("#scroller").scrollWidth <= innerWidth,
        ),
      );
      const overflow = await page.locator(".gl").evaluateAll((spans) =>
        spans
          .filter((span) => {
            const rect = span.getBoundingClientRect();
            return rect.left < -1 || rect.right > innerWidth + 1;
          })
          .map((span) => span.textContent),
      );
      assert.deepEqual(overflow, [], `Text overflow at ${width}px`);
      if (width === 390)
        await page.screenshot({ path: "tmp/mobile-verified.png" });
      if (width === 1440)
        await page.screenshot({ path: "tmp/hero-verified.png" });
    }

    const reduced = await browser.newPage({
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 900 },
    });
    reduced.on("pageerror", (e) => errors.push(e.message));
    await reduced.goto(base + "/#studies");
    await reduced.waitForFunction(() =>
      window.__glyph
        ?.media()
        .filter((p) => p.id !== "flower")
        .every((p) => p.ready),
    );
    await reduced.waitForTimeout(100);
    assert.ok(
      await reduced.evaluate(() =>
        __glyph
          .media()
          .filter((p) => p.id !== "flower")
          .every((p) => p.paused),
      ),
    );
    const stillFrames = await reduced.evaluate(
      () => __glyph.stats().renderedFrames,
    );
    await reduced.waitForTimeout(250);
    assert.equal(
      await reduced.evaluate(() => __glyph.stats().renderedFrames),
      stillFrames,
    );
    await reduced.close();

    const plain = await browser.newPage({ javaScriptEnabled: false });
    await plain.goto(base);
    assert.equal(await plain.locator("h1").innerText(), "Sardor Nodirov");
    assert.equal(await plain.locator("#field").isVisible(), false);
    assert.ok(await plain.locator("#flower img").isVisible());
    await plain.close();

    await page.goto(base + "/lab.html");
    await page.waitForFunction(
      () => document.querySelector("#frame")?.contentWindow.__glyph,
    );
    const labFrame = page.frames().find((frame) => frame.parentFrame());
    await labFrame.waitForFunction(() => window.__glyph);
    await page.locator('[data-key="alpha"] input').fill("0.08");
    await labFrame.waitForFunction(() => __glyph.get().alpha === 0.08);
    await page.locator('[data-key="size"] input').fill("17");
    await labFrame.waitForFunction(() => __glyph.stats().cellH === 22);
    await page.locator("#reset").click();
    await labFrame.waitForFunction(() => __glyph.get().size === 14);
    await page.screenshot({ path: "tmp/lab-verified.png" });

    await page.goto(base + "/screen.html?source=girl");
    await page.waitForTimeout(700);
    await page.locator("#tune").click();
    assert.equal(
      await page.locator("#tune").getAttribute("aria-expanded"),
      "true",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: fixed glyph origins, scroll settlement, keyboard controls, selection, media lifecycle, responsive layouts, reduced motion, no-JS, lab, screen.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
