const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.SITE_URL || "http://127.0.0.1:4193";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    // a GPU backend gives headless Chromium WebGL2; without one the page
    // paints with Canvas 2D, which these checks also cover
    args: (process.env.BROWSER_ARGS ?? "--use-angle=metal").split(" ").filter(Boolean),
    ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}),
  });
  const errors = [];
  const watch = (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
  };
  const ready = (page) => page.waitForFunction(() => document.querySelector("#article.ready") && window.__glyph);
  const scrollToRow = (page, row) => page.evaluate((r) => {
    const s = document.getElementById("scroller");
    s.scrollTop = r * __glyph.view().cellH;
    s.dispatchEvent(new Event("scroll"));
  }, row);

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    watch(page);
    await page.goto(base);
    await ready(page);
    assert.equal(await page.locator("h1").innerText(), "Sardor Nodirov");
    console.log("renderer:", (await page.evaluate(() => __glyph.stats())).renderer);

    // Keyboard order follows the document; the first stop is the first link.
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), "Lapwing");

    // Text is selectable in document order, with the spaces a reader expects.
    const selected = await page.locator("#work li").nth(1).evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString().replace(/\s+/g, " ").trim();
    });
    assert.equal(selected, "Lapwing, founder 2025 - now Real-time AI companions.");

    // Halfway between two rows every flap the document touches is half
    // turned; once the page settles, every one is flat again.
    await page.waitForTimeout(1600);
    const hero = await page.evaluate(() => {
      const v = __glyph.view();
      for (let r = 0; r < v.rows; r++) {
        for (let c = 0; c < v.cols; c++) {
          if (__glyph.probe(r, c).x === "S") return { r, c };
        }
      }
      return null;
    });
    assert.ok(hero, "the name is on the grid");
    await scrollToRow(page, 0.5);
    await page.waitForTimeout(40);
    const mid = await page.evaluate(({ r, c }) => __glyph.probe(r, c), hero);
    assert.ok(mid.phase > 0.1 && mid.phase < 0.95, `half a row of scroll leaves a flap mid-turn (${mid.phase})`);
    await page.waitForTimeout(700);
    const settled = await page.evaluate(() => {
      const v = __glyph.view();
      return { rows: v.scrollTop / v.cellH };
    });
    assert.ok(Math.abs(settled.rows - Math.round(settled.rows)) < 0.05, "the page settles on a whole row");

    // The message box: typing lands in cells and flaps in, the caret follows,
    // the box refuses more lines than it has rows, and sending without
    // analytics keeps the text and opens the mail client.
    await page.evaluate(() => { location.hash = "message"; });
    await page.waitForTimeout(900);
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

    // The sound switch is a real button with a real state.
    await page.locator("#sound").click();
    assert.equal(await page.locator("#sound").getAttribute("aria-pressed"), "true");

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(base + "/#work");
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
    }

    // Reduced motion: no reveal, no flaps; the document is simply there.
    const calm = await browser.newPage({ viewport: { width: 1024, height: 768 }, reducedMotion: "reduce" });
    watch(calm);
    await calm.goto(base);
    await ready(calm);
    await calm.waitForTimeout(100);
    const still = await calm.evaluate(() => {
      const v = __glyph.view();
      for (let r = 0; r < v.rows; r++) {
        for (let c = 0; c < v.cols; c++) {
          const p = __glyph.probe(r, c);
          if (p.x === "S") return p;
        }
      }
      return null;
    });
    assert.ok(still && still.inkX > 0.9 && still.phase === 0, "the name is drawn at once");
    await calm.close();

    const plain = await browser.newPage({ javaScriptEnabled: false });
    await plain.goto(base);
    assert.equal(await plain.locator("h1").innerText(), "Sardor Nodirov");
    assert.equal(await plain.locator("#field").isVisible(), false);
    assert.ok(await plain.locator("#note").isVisible());
    await plain.close();

    await page.goto(base + "/lab.html");
    await page.waitForFunction(() => document.querySelector("#frame")?.contentWindow.__glyph);
    const labFrame = page.frames().find((frame) => frame.parentFrame());
    await labFrame.waitForFunction(() => window.__glyph);
    await page.locator('[data-key="restAlpha"] input').fill("0.3");
    await labFrame.waitForFunction(() => __glyph.get().restAlpha === 0.3);

    assert.deepEqual(errors, []);
    console.log("PASS: boot, keyboard order, selection, scroll flaps, message box, sound, layouts, reduced motion, no-JS, lab.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
