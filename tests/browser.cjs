const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.SITE_URL || "http://127.0.0.1:4192";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
  });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  try {
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector("#article.ready") && window.__glyph);
    assert.equal(await page.locator("h1").innerText(), "SARDOR NODIROV");
    assert.equal(await page.evaluate(() => __glyph.planeCount()), 1);

    // Controls sit in the native keyboard order and the nav keeps its spaces.
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "[ work ]");
    assert.match(
      (await page.locator("nav").innerText()).replace(/\s+/g, " "),
      /\[ work \] \[ education \]/,
    );

    // Text remains selectable in document order, including spaces around links.
    const selected = await page.locator("#work li").first().evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString().replace(/\s+/g, " ").trim();
    });
    assert.equal(selected, "Lapwing - founder · 2025 - now. Real-time AI companions.");

    // The video band is a plane with the frame's own aspect.
    const placed = await page.locator("#portraits").evaluate((el) => ({
      rows: Number(el.dataset.placedRow), cols: Number(el.dataset.placedCols),
    }));
    assert.ok(placed.cols > 40 && placed.rows > 0);

    // The message box: typing lands in cells, the caret follows, the box
    // refuses more lines than it has rows, and sending without analytics
    // keeps the text and opens the mail client.
    await page.evaluate(() => { location.hash = "message"; });
    await page.waitForTimeout(500);
    await page.locator("#note").click();
    await page.keyboard.type("hello there");
    let inbox = await page.evaluate(() => __glyph.inbox());
    assert.equal(inbox.typed, 11);
    assert.deepEqual(inbox.caret, { row: 0, col: 11 });
    assert.equal(inbox.focused, true);
    await page.keyboard.press("Enter");
    await page.keyboard.type("second line");
    inbox = await page.evaluate(() => __glyph.inbox());
    assert.deepEqual(inbox.caret, { row: 1, col: 11 });
    const rows = Number(await page.locator("form[data-inbox]").getAttribute("data-rows"));
    await page.keyboard.type("\n".repeat(rows + 2));
    assert.ok((await page.locator("#note").inputValue()).split("\n").length <= rows);
    await page.route("mailto:**", (route) => route.abort());
    const before = await page.locator("#note").inputValue();
    await page.keyboard.press("Meta+Enter");
    await page.waitForTimeout(200);
    assert.equal(await page.locator("#note").inputValue(), before);
    assert.match(
      await page.evaluate(() => document.querySelector("form[data-inbox] [aria-live]").textContent),
      /mail/,
    );

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(base + "/#hero");
      await page.waitForFunction(
        () => document.querySelector("#article.ready") &&
          parseFloat(document.querySelector("#field").style.width) === innerWidth,
      );
      assert.ok(await page.evaluate(() => document.querySelector("#scroller").scrollWidth <= innerWidth));
      const overflow = await page.locator(".gl").evaluateAll((spans) =>
        spans.filter((span) => {
          const rect = span.getBoundingClientRect();
          return rect.left < -1 || rect.right > innerWidth + 1;
        }).map((span) => span.textContent),
      );
      assert.deepEqual(overflow, [], `Text overflow at ${width}px`);
      if (width === 390) await page.screenshot({ path: "tmp/mobile-verified.png" });
      if (width === 1440) await page.screenshot({ path: "tmp/hero-verified.png", fullPage: false });
    }

    const plain = await browser.newPage({ javaScriptEnabled: false });
    await plain.goto(base);
    assert.equal(await plain.locator("h1").innerText(), "Sardor Nodirov");
    assert.equal(await plain.locator("#field").isVisible(), false);
    assert.ok(await plain.locator("#portraits video").isVisible());
    assert.ok(await plain.locator("#note").isVisible());
    await plain.close();

    await page.goto(base + "/lab.html");
    await page.waitForFunction(() => document.querySelector("#frame")?.contentWindow.__glyph);
    const labFrame = page.frames().find((frame) => frame.parentFrame());
    await labFrame.waitForFunction(() => window.__glyph);
    await page.locator('[data-key="alpha"] input').fill("0.08");
    await labFrame.waitForFunction(() => __glyph.get().alpha === 0.08);

    assert.deepEqual(errors, []);
    console.log("PASS: boot, keyboard order, selection, video band, message box, responsive layouts, no-JS, lab.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
