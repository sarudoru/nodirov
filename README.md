# nodirov.com, the glyph field

A personal site with one law: **the character cell is the only visual
primitive**. The viewport is a fixed grid of cells, each holding a faint
character of its own that now and then turns into another. The document
scrolls invisibly underneath, and each cell shows which character the scroll
puts in it: a resting character turns into the letter, and back. Between two
rows every cell is a split-flap turned by the scroll itself. Nothing moves;
cells change.

Read [CONSTITUTION.md](CONSTITUTION.md) before changing anything visual.

## Run

Any static server from the repo root:

```sh
python3 -m http.server 4193
```

then open <http://localhost:4193>. ES modules need http; `file://` will not
work. The workbench is at <http://localhost:4193/lab.html>.

## Files

```
index.html          the real, semantic document (SEO, no-JS, screen readers)
style.css           the no-JS document and the transparent grid-aligned text layer
src/main.js         boot and wiring: metrics, scroll, keys, pointer, sound switch
src/typesetter.js   semantic HTML -> grid lines + positioned transparent DOM spans
src/field.js        each frame: which glyph every cell shows, and how far it has turned
src/substrate.js    the resting field: restless characters (or dots), pointer lens, wake, ripples, reveal, weather
src/atlas.js        every glyph drawn once at device resolution; dots and box strokes as geometry
src/renderer.js     one WebGL2 pass; turn styles flap, roll, drum, fold, slide, fade; Canvas 2D fallback
src/inbox.js        the message box: a transparent textarea whose text lands in cells
src/tick.js         the sound: one synthesized thock per row
src/params.js       every tunable: schema, defaults, URL codec, workbench controls
src/analytics.js    PostHog, off until a key is set
lab.html            the workbench: every knob live on the real page
tests/browser.cjs   browser checks
```

### How a frame is made

1. The typesetter has already turned the HTML article into world rows of
   glyphs, and laid a transparent copy of the text over the grid so the
   browser keeps selection, links, focus, and find-in-page.
2. The scroll position is a real number of rows. Its whole part says which
   world row each grid row shows; its fraction says how far each flap has
   turned toward the next row (with a detent, and a small left-to-right
   sweep).
3. Cells the document does not use ask the substrate what they hold: a
   resting character, possibly mid-turn into another. Cells the pointer, a
   ripple, or the opening ring has warmed draw darker and turn sooner.
4. The field packs every cell into two small textures (glyphs and flags; ink
   and phase, and the cell's turn style). The renderer's fragment shader
   finds each device pixel's cell and copies that pixel from the glyph's
   atlas slot, so resting text is exactly as sharp as browser text. A
   turning cell is drawn in its style: a flap folding over its hinge, a roll
   up through the cell, a fold on its middle, and so on.

### The workbench

`lab.html` loads the page in a frame and generates a control for every entry
in `src/params.js`. Sliders apply live. Hold **compare** to A/B against a
snapshot, save named presets, and copy a link that reproduces the exact
tuning (`index.html?turn=roll&ambientTurn=fold&lattice=dots`).

### Content

Edit `index.html` only. Blocks the typesetter understands: `h1` (the name),
`p.tagline`, `p`, `p.hint`, `h2` (a ruled section heading), `ul > li` (an
entry: text on the left, a `<time>` at the right edge, an optional `<small>`
note below; the cells between them are left to the resting field), `form[data-inbox]` (the
message box), `p.actions`, `p.colophon`, and inline `<a>`.

## Analytics and messages

`src/analytics.js` loads PostHog only when `POSTHOG.key` is set: pageviews,
autocapture, heatmaps, web vitals, session replay with inputs masked, person
profiles, and GeoIP on the PostHog side. The page adds `section_reached`,
`sound_toggled`, and `message_sent`. Messages are delivered as PostHog
events; without a key the visitor's mail client opens with the text filled
in.

## Browser checks

`tests/browser.cjs` needs Playwright and a Chromium; there is no
`package.json` on purpose. Install Playwright anywhere and point at it:

```sh
npm install --prefix ~/.playwright playwright && npx --prefix ~/.playwright playwright install chromium
```

Start the local server on port 4193, then:

```sh
PLAYWRIGHT_MODULE=~/.playwright/node_modules/playwright node tests/browser.cjs
```

Headless Chromium needs a GPU backend for WebGL2; the checks pass
`--use-angle=metal` by default (macOS). `BROWSER_ARGS=" "` runs them on the
Canvas 2D fallback instead. `BROWSER_PATH` overrides the Chromium binary,
`SITE_URL` the server. The checks cover boot, keyboard order, selection, the
scroll flaps and settling, the message box, the sound switch, four viewport
widths, reduced motion, the no-JS document, and the workbench.
