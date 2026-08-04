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
src/entities.js       the butterfly — the field's one inhabitant
morph.html/.css       typeface studies (linked from the colophon)
lab.html              side-by-side taste tests on the live field (dev tool)
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
gesture, never on a timer. The ambient murmur stays anchored to the screen,
whisper-quiet at ~4% ink and running uniformly under everything: its glyphs
dissolve one into another slowly and at random, it rides a 26-second
opacity tide, brightens in a lantern around the cursor, and falls away
slightly in the corners. Coarse mouse-wheel notches are routed through a
short ease so they pour instead of teleporting; fast flicks skip blending
entirely and stay crisp. Time-based animation exists only for
transformations (crystallizing, condensation along the `· : +` ramp,
random-glyph click splashes, unhurried cousin shimmer), never for
navigation.

### The lab

`lab.html` renders two live copies of the field side by side, driven by URL
params (`?font=fragment&size=19&paper=fdfdfb&ink=1a1a1a&accent=c8401f&stagger=1`).
Typeface, size, palette, and the experimental per-column "fabric stagger"
are auditioned on real scrolling text, not specimen cards.

### Content

Edit `index.html` only. Blocks the typesetter understands: `h1` (banner),
`h2` (section heading), `p`, `p.tagline`, `p.hint`, `p.interstitial`,
`ul > li`, inline `<a>`. Add a section, it typesets; add a `li`, it wraps.
`TODO(sardor)` comments mark placeholder copy.
