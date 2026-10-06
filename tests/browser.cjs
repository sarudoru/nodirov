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
          const p = __glyph.probe(r, c);
          if (p.x === "S" && !p.lattice && p.inkX > 0.5) return { r, c };
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
    // the box refuses more lines than it has rows, and the page sends the
    // message itself; without an access key nothing is sent.
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
    const notice = () => page.evaluate(() => document.querySelector("form[data-inbox] [aria-live]").textContent);
    const posts = [];
    await page.route("https://api.web3forms.com/**", (route) => {
      posts.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"success":true}' });
    });
    const before = await page.locator("#note").inputValue();
    await page.keyboard.press("Meta+Enter");
    await page.waitForTimeout(200);
    assert.equal(posts.length, 0);
    assert.equal(await page.locator("#note").inputValue(), before);
    assert.match(await notice(), /not sent/);
    await page.evaluate(async () => { (await import("/src/messages.js")).MESSAGES.key = "test-key"; });
    await page.keyboard.press("Meta+Enter");
    await page.waitForFunction(() => document.getElementById("note").value === "");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].access_key, "test-key");
    assert.equal(posts[0].message, before.trim());
    assert.match(await notice(), /^sent/);

    // Reviewer regressions.
    // 1. Scrolling during the opening does not show text the ring has not
    //    reached yet.
    await page.goto(base);
    await ready(page);
    await page.evaluate(() => { sessionStorage.clear(); __glyph.reveal(); });
    await scrollToRow(page, 0.5);
    await page.waitForTimeout(30);
    const early = await page.evaluate(() => {
      const v = __glyph.view();
      let letters = 0;
      for (let r = Math.floor(v.rows / 2); r < v.rows - 3; r++) {
        for (let c = 0; c < v.cols; c++) {
          const p = __glyph.probe(r, c);
          if (!p.lattice && /[A-Za-z]/.test(p.x) && p.inkX > 0.3 && p.phase < 0.5) letters++;
        }
      }
      return letters;
    });
    assert.equal(early, 0, "no letters appear ahead of the opening ring");
    await scrollToRow(page, 0);
    await page.waitForTimeout(2600);

    // 2. A quick pass over a link leaves no letter in the accent.
    const link = await page.locator("#hero a").boundingBox();
    await page.mouse.move(link.x + 4, link.y + link.height / 2);
    await page.mouse.move(link.x + 4, link.y - 60);
    await page.waitForTimeout(60);
    const stray = await page.evaluate(() => {
      const v = __glyph.view();
      let n = 0;
      for (let r = 0; r < v.rows - 3; r++) for (let c = 0; c < v.cols; c++) if (__glyph.probe(r, c).accent) n++;
      return n;
    });
    assert.ok(stray <= 1, `a quick pass leaves the link as it was (${stray} accented cells)`);

    // 3. A lost GPU context shows the real text, and recovers.
    const lost = await page.evaluate(async () => {
      const gl = document.getElementById("field").getContext("webgl2");
      const ext = gl && gl.getExtension("WEBGL_lose_context");
      if (!ext) return "no-extension";
      ext.loseContext();
      await new Promise((r) => setTimeout(r, 100));
      const during = document.documentElement.classList.contains("field-lost");
      ext.restoreContext();
      await new Promise((r) => setTimeout(r, 300));
      return { during, after: document.documentElement.classList.contains("field-lost") };
    });
    if (lost !== "no-extension") assert.deepEqual(lost, { during: true, after: false });

    // 4. The end of the page rests on a whole row and names the last section.
    await page.evaluate(() => {
      const s = document.getElementById("scroller");
      s.scrollTop = 1e6;
      s.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(1500);
    const end = await page.evaluate(() => {
      const v = __glyph.view();
      let turning = 0;
      for (let r = 0; r < v.rows; r++) {
        for (let c = 0; c < v.cols; c++) {
          const p = __glyph.probe(r, c);
          if (!p.lattice && p.phase > 0 && p.phase < 1 && /[A-Za-z]/.test(p.x + p.y)) turning++;
        }
      }
      return { rows: v.scrollTop / v.cellH, turning, hash: location.hash };
    });
    assert.ok(Math.abs(end.rows - Math.round(end.rows)) < 0.05, `the last screen rests on a row (${end.rows})`);
    assert.equal(end.turning, 0, "nothing is left mid-turn at the end of the page");
    assert.equal(end.hash, "#contact");

    // 5. A malformed hash is harmless.
    await page.goto(base + "/#%E0%A4%A");
    await ready(page);

    // The sound switch is a real button with a real state: on until the
    // visitor turns it off, and the choice is kept.
    assert.equal(await page.locator("#sound").getAttribute("aria-pressed"), "true");
    await page.locator("#sound").click();
    assert.equal(await page.locator("#sound").getAttribute("aria-pressed"), "false");
    assert.equal(await page.evaluate(() => localStorage.getItem("glyph-sound")), "off");
    await page.locator("#sound").click();
    assert.equal(await page.locator("#sound").getAttribute("aria-pressed"), "true");

    // The theme switch turns the page dark and back, and the choice is kept.
    const themeOf = () => page.evaluate(() => document.documentElement.dataset.theme);
    assert.equal(await themeOf(), "light");
    await page.locator("#theme").click();
    assert.equal(await themeOf(), "dark");
    assert.equal(await page.evaluate(() => localStorage.getItem("glyph-theme")), "dark");
    await page.locator("#theme").click();
    assert.equal(await themeOf(), "light");

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
      // the sound switch is on every screen, inside it; the theme switch
      // needs a margin to live in
      const sound = await page.locator("#sound").boundingBox();
      assert.ok(sound && sound.x >= 0 && sound.x + sound.width <= width && sound.y + sound.height <= 844, `sound switch at ${width}px`);
      assert.equal(await page.locator("#theme").isHidden(), width < 1440, `theme switch at ${width}px`);
    }

    // The settle scroll: a nudge keeps the text; a real scroll turns the
    // letters into fainter characters that keep changing, and once the page
    // rests they settle back into text.
    const settle = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    watch(settle);
    await settle.addInitScript(() => sessionStorage.setItem("glyph-seen", "1"));
    await settle.goto(base + "/?scroll=settle");
    await ready(settle);
    await settle.waitForTimeout(1500);
    const screen = (p) => p.evaluate(() => {
      const v = __glyph.view();
      let dots = 0;
      let letters = 0;
      for (let r = 0; r < v.rows - 3; r++) {
        for (let c = 0; c < v.cols; c++) {
          const q = __glyph.probe(r, c);
          if (q.lattice) continue;
          if (q.phase !== 0 || /^\s$/.test(q.x)) continue;
          // body text rests at full ink and moves at the moving ink (0.7)
          if (q.inkX > 0.9) letters++;
          else if (q.inkX > 0.6 && q.inkX < 0.8) dots++;
        }
      }
      return { dots, letters, state: __glyph.stats().settle };
    });
    await scrollToRow(settle, 1);
    await settle.waitForTimeout(80);
    assert.equal((await screen(settle)).state, "text", "a nudge keeps the text");
    await settle.waitForTimeout(600);
    await settle.evaluate(() => __glyph.set({ restWait: 700 }));
    await scrollToRow(settle, 20);
    await settle.waitForTimeout(450);
    const moving = await screen(settle);
    assert.equal(moving.state, "dots");
    assert.ok(moving.dots > 50 && moving.letters === 0, `a real scroll shows moving marks only (${moving.dots} marks, ${moving.letters} letters)`);
    await settle.waitForTimeout(700 + 1200 + 400);
    const rested = await screen(settle);
    assert.equal(rested.state, "text");
    assert.ok(rested.letters > 50 && rested.dots === 0, `at rest the text has settled (${rested.letters} letters, ${rested.dots} marks)`);

    // A hovered word turns through its letters' cousins, and turns back
    // when the pointer leaves.
    const nameRow = () => settle.evaluate(() => {
      const v = __glyph.view();
      let text = "";
      for (let r = 0; r < v.rows - 3; r++) {
        for (let c = 0; c < v.cols; c++) {
          const q = __glyph.probe(r, c);
          if (!q.lattice && q.inkX > 0.9 && q.phase === 0) text += q.x;
        }
      }
      return text;
    });
    await settle.mouse.move(2, 2);
    await scrollToRow(settle, 0);
    await settle.waitForTimeout(2500);
    const unhovered = await nameRow();
    await settle.locator("h1 span").first().hover();
    await settle.waitForFunction(() => {
      const v = __glyph.view();
      for (let r = 0; r < v.rows - 3; r++) {
        for (let c = 0; c < v.cols; c++) {
          const q = __glyph.probe(r, c);
          if (!q.lattice && /[\u00c0-\u024f]/.test(q.x)) return true;
        }
      }
      return false;
    });
    await settle.mouse.move(2, 2);
    await settle.waitForTimeout(600);
    assert.equal(await nameRow(), unhovered, "the word is itself again once the pointer leaves");
    await settle.close();

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
          if (p.x === "S" && !p.lattice) return p;
        }
      }
      return null;
    });
    assert.ok(still && still.inkX > 0.9 && still.phase === 0, "the name is drawn at once");
    // the caret shows steadily in the focused box
    await calm.evaluate(() => { location.hash = "message"; });
    await calm.waitForTimeout(300);
    await calm.locator("#note").click();
    await calm.waitForTimeout(100);
    const caretSeen = await calm.evaluate(() => {
      const v = __glyph.view();
      for (let r = 0; r < v.rows; r++) for (let c = 0; c < v.cols; c++) if (__glyph.probe(r, c).caret) return true;
      return false;
    });
    assert.ok(caretSeen, "the caret is visible with reduced motion");
    await calm.close();

    const plain = await browser.newPage({ javaScriptEnabled: false });
    await plain.goto(base);
    assert.equal(await plain.locator("h1").innerText(), "Sardor Nodirov");
    assert.equal(await plain.locator("#field").isVisible(), false);
    assert.ok(await plain.locator("#note").isVisible());
    await plain.close();

    // The 404 page runs on the same engine.
    const missing = await browser.newPage();
    watch(missing);
    await missing.goto(base + "/404.html");
    await ready(missing);
    assert.equal(await missing.locator("h1").innerText(), "404");
    await missing.close();

    // Hiding the page, moving it, and showing it again leaves one render loop.
    const loops = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    watch(loops);
    await loops.addInitScript(() => {
      sessionStorage.setItem("glyph-seen", "1");
      const raf = window.requestAnimationFrame.bind(window);
      window.__count = { frames: 0, ticks: 0 };
      const frame = () => { window.__count.frames++; raf(frame); };
      raf(frame);
      window.requestAnimationFrame = (callback) => raf((now) => {
        if (callback.name === "tick") window.__count.ticks++;
        callback(now);
      });
    });
    await loops.goto(base);
    await ready(loops);
    await loops.waitForTimeout(1500);
    await loops.evaluate(() => {
      const visibility = (state) => {
        Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      };
      visibility("hidden");
      const s = document.getElementById("scroller");
      s.scrollTop = 10 * __glyph.view().cellH;
      s.dispatchEvent(new Event("scroll"));
      visibility("visible");
    });
    await loops.waitForTimeout(300);
    await loops.evaluate(() => { window.__count = { frames: 0, ticks: 0 }; });
    for (let k = 0; k < 30; k++) {
      await loops.mouse.move(100 + k * 3, 700);
      await loops.waitForTimeout(30);
    }
    const count = await loops.evaluate(() => window.__count);
    assert.ok(count.ticks <= count.frames * 1.2, `one render loop (${count.ticks} ticks in ${count.frames} frames)`);
    await loops.close();

    await page.goto(base + "/lab.html");
    await page.waitForFunction(() => document.querySelector("#frame")?.contentWindow.__glyph);
    const labFrame = page.frames().find((frame) => frame.parentFrame());
    await labFrame.waitForFunction(() => window.__glyph);
    await page.locator('[data-key="restAlpha"] input').fill("0.3");
    await labFrame.waitForFunction(() => __glyph.get().restAlpha === 0.3);

    assert.deepEqual(errors, []);
    console.log("PASS: boot, keyboard order, selection, scroll flaps, message box, sound, theme, layouts, settle scroll, hovered word, reduced motion, no-JS, 404, one render loop, lab.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
