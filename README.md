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
404.html            the not-found page, on the same engine
style.css           the no-JS document and the transparent grid-aligned text layer
src/main.js         boot and wiring: metrics, scroll, keys, pointer, sound switch
src/typesetter.js   semantic HTML -> grid lines + positioned transparent DOM spans
src/field.js        each frame: which glyph every cell shows, and how far it has turned
src/substrate.js    the resting field: restless characters (or dots), pointer lens, wake, ripples, reveal, weather
src/atlas.js        every glyph drawn once at device resolution; dots and box strokes as geometry
src/renderer.js     one WebGL2 pass; turn styles flap, roll, drum, fold, slide, fade; Canvas 2D fallback
src/inbox.js        the message box: a transparent textarea whose text lands in cells
src/cousins.js      each letter's cousins, for the hovered word
src/tick.js         the sound: one synthesized thock per row
src/params.js       every tunable: schema, defaults, URL codec, workbench controls
src/analytics.js    PostHog, off until a key is set
src/messages.js     the message box's delivery through Web3Forms, off until a key is set
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

Every turn on the page is a split-flap by default; `turn`, `clockTurn`,
and `ambientTurn` can audition the other styles. A moving page does not
turn: its characters shift a row at a time.

### The settle scroll

This is the scroll the page uses. A scroll longer than a couple of rows
turns every letter into a character that travels with the page and keeps
changing (or, with `moving=dots`, into a dot), so a moving screen is
restless characters sliding by in the shape of the words. When
the page rests, each cell's flap turns over to its letter, slowly enough to
watch, the way a departure board does; each cell at its own moment, many
early, a few late. The workbench's Scroll group tunes it (`dotsAfter`,
`scrambleMs` for how often a moving character changes, 0 to hold it,
`restWait`, `searchMs` for one flap, `resolveMs` for the whole screen,
`resolveGrain` for how much each cell keeps its own time, `resolveFlips`
for letters passed on the way, and the moving ink).

`?scroll=flap` is the other scroll: the text itself turns with the finger,
and a fast scroll flips the board to where the page is, in a cascade.

### The wake, and a finger

A cell the document has just left stays warm for a moment: its resting
character draws darker and is likelier to turn over (`wakeInk`, `wakeRate`,
`wakeMs`), so the text and the field read as one surface.

On a touch screen the page follows the finger itself rather than the
browser's scroll, and carries on only briefly once the finger lifts
(`glideMs`: the distance is that long at the finger's speed), landing on a
whole row.

### The hovered word

While the page rests, the word under the pointer turns through its letters'
cousins: the same letters as other languages write them (`src/cousins.js`).
`cousinMs` sets the beat; `cousinMs=0` leaves words alone.

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
`sound_toggled`, `theme_toggled`, and `message_sent`.

The message box sends from the page itself, never through the visitor's
mail client. `src/messages.js` posts each message to Web3Forms, which
forwards it to the inbox its access key belongs to; an address in the text
becomes the reply-to. Create a key at web3forms.com with the inbox's
address and set `MESSAGES.key`. The key is public by design. Until it is
set, nothing is sent: the box keeps the text and says it was not sent.

## Theme

Light and dark. The page follows the system until the visitor uses the
switch above the sound switch; the choice is kept for later visits.
`?theme=dark` or `?theme=light` forces one. The dark colours are
`paperDark`, `inkDark`, and `accentDark` in `src/params.js`, mirrored in
`style.css` for the first paint.

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
`--use-angle=metal` by default (macOS). `BROWSER_ARGS="--disable-webgl2"`
runs them on the Canvas 2D fallback instead (`?canvas2d` forces it in any
browser). `BROWSER_PATH` overrides the Chromium binary, `SITE_URL` the
server. The checks cover boot, keyboard order, selection, the scroll flaps
and settling, the message box, the sound and theme switches, four viewport
widths, the hovered word, reduced motion, the no-JS document, the 404 page,
one render loop after the page is hidden and shown, and the workbench.
