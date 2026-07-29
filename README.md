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
src/glyphs.js         ambient/scramble alphabets, cousin families
src/entities.js       butterfly, train, gravity — sprites in cell space
morph.html/.css       typeface studies (linked from the colophon)
```

### The trick that makes it a website

The document lives in a real scroll container with the scrollbar hidden.
Native scrolling (momentum, keyboard, find-in-page, anchors, history) drives
a camera: `cameraRow = round(scrollTop / cellHeight)`. The canvas paints
every visible mark; a transparent, grid-aligned copy of the text sits above
it so selection, links, and focus stay native. The HTML article is the
single source of truth — the typesetter compiles it into both layers at
every column count.

### Content

Edit `index.html` only. Blocks the typesetter understands: `h1` (banner),
`h2` (section heading), `p`, `p.tagline`, `p.hint`, `p.interstitial`,
`ul > li`, inline `<a>`. Add a section, it typesets; add a `li`, it wraps.
`TODO(sardor)` comments mark placeholder copy.
