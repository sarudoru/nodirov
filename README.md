# nodirov.com — the glyph field

A personal site with one law: **the character cell is the only visual
primitive**. The viewport is a fixed grid of glyphs; a longer document passes
through it the way tape passes a read head. Nothing scrolls — cells change.

Read [CONSTITUTION.md](CONSTITUTION.md) before changing anything visual.

## Run

Any static server from the repo root, e.g.:

```
python3 -m http.server 4173
```

then open <http://localhost:4173>. (ES modules require http; `file://` won't
work.)

## Architecture

```
index.html            the real, semantic document (SEO, no-JS, readers)
style.css             plain-document fallback + transparent grid-text layer
src/main.js           boot & wiring: scroll camera, resize, keys, experiments
src/field.js          the renderer: cell buffers, ambient, traces, draw
src/typesetter.js     semantic DOM -> {field lines, positioned DOM spans}
src/banner.js         5-row hero letters, each built from its own character
src/glyphs.js         ambient alphabet, ink ramp, cousin families
src/params.js         every tunable: schema, defaults, URL codec
lab.html              the workbench — live control of all of it (dev tool)
```

### The trick that makes it a website

The document lives in a real scroll container with the scrollbar hidden.
Native scrolling (momentum, keyboard, find-in-page, anchors, history) drives
the camera. The canvas paints every visible mark; a transparent,
grid-aligned copy of the text sits above it so selection, links, and focus
stay native. The HTML article is the single source of truth — the
typesetter compiles it into both layers at every column count.

### The trick that makes it feel like one substrate

The fractional scroll offset is the transition: each cell draws the glyph
of its world row and the glyph of the next row in a biased crossfade (the
leaving glyph yields faster than the arriving one rises), so ink visibly
pours row to row under the reader's finger — reversible, tied to the
gesture, never on a timer. Coarse mouse-wheel notches are routed through a
short ease so they pour instead of teleporting; fast flicks skip blending
entirely and stay crisp.

### The trick that keeps the substrate from looking like a JPEG

A background that swaps a few random cells per second reads as *static*:
with ~2,500 cells on screen, even generous churn leaves 99% of the field
frozen at any instant, and at 4% ink a glyph swap is nearly invisible
anyway. So identity churn is not the mechanism of life here — **opacity
is**. Every cell carries its own sine oscillation with a randomized period
(4–11s) and phase, so all 2,500 cells are always in motion while each moves
too slowly to notice; glyph cross-dissolves (~22/s, 1.5s smoothstep) ride on
top for texture. A tide sweeps the grid on a 26s cycle, the cursor carries a
lantern, corners fall away. Measured: ~21% total-ink swing across a tide
period, ~500 pixels changing per second. The loop runs at a capped 30fps and
suspends entirely when the tab is hidden or `prefers-reduced-motion` is set.

### The workbench

`lab.html` is the tuning surface. Every constant in the renderer is declared
once in `src/params.js`, and the workbench generates its controls from that
schema — sliders apply live to a real embedded field: substrate opacity and
density, twinkle depth and periods, churn, crossfade duration and shape,
tide, lantern, vignette, pour easing, hover and splash behavior, typeface,
measure, and palette. Hold **compare** to A/B against a snapshot, save named
presets, and copy a link that reproduces the exact tuning
(`index.html?alpha=0.06&churn=40&…`). Adding a knob to the schema makes it
appear in the UI, the URL, and the defaults at once.

### Content

Edit `index.html` only. Blocks the typesetter understands: `h1` (banner),
`h2` (section heading), `p`, `p.tagline`, `p.hint`, `p.interstitial`,
`ul > li`, inline `<a>`. Add a section, it typesets; add a `li`, it wraps.
`TODO(sardor)` comments mark placeholder copy.
