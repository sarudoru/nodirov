# nodirov.com

A personal website made from one fixed grid of characters. Text, pictures, and controls share the same cells.

## Run locally

Run this command from the project root:

```sh
python3 -m http.server 4190 --bind 127.0.0.1
```

Open [the site](http://127.0.0.1:4190/). Open [the lab](http://127.0.0.1:4190/lab.html) to adjust the renderer.

This is a static site. It needs no application server, package install, or build step.

## How it works

`index.html` contains the semantic document. Without JavaScript, the browser shows that document with the original media.

The typesetter assigns a world row and column to each character. It also positions transparent text spans for selection, links, and keyboard focus.

Native scrolling determines which world rows reach the viewport. Each screen cell blends between adjacent world rows at a fixed origin. After input stops, the scroll position settles to a whole row for clear text. New wheel input cancels that settlement.

Media regions use the same coordinates and font. The sampler accounts for the physical aspect ratio of each cell. Media never covers committed text.

The ambient field runs at up to 60 frames per second. Media sampling runs at up to 24 frames per second. The renderer caches glyphs for the main text colors. Videos load near the viewport and pause outside it. Hidden tabs stop the renderer and video playback.

The motion button pauses the entire field. Reduced motion also stops ambient animation and video playback. Each video retains a still frame.

## Files

| File | Responsibility |
| --- | --- |
| `index.html` | Content, navigation, and media declarations |
| `style.css` | Plain document, native focus, and transparent text spans |
| `src/main.js` | Startup, native scroll, resize, navigation, and motion controls |
| `src/typesetter.js` | Responsive placement of text, the hero, and study cards |
| `src/field.js` | Fixed cell coordinates, glyph cache, drawing, and frame scheduling |
| `src/plane.js` | Media loading, sampling, playback, and source reuse |
| `src/media.js` | Color and luminance conversion into glyphs |
| `src/substrate.js` | Ambient character changes and pointer response |
| `src/glyphspace.js` | Font measurement and transitions between related glyphs |
| `src/params.js` | Defaults, lab controls, and URL settings |
| `lab.html` | Live tuning, comparisons, presets, and frame timing |
| `screen.html` | Detailed inspection of the original motion studies |
| `tests/browser.cjs` | Browser regression checks |

## Add a study

Add a figure inside `.gallery` in `index.html`:

```html
<figure id="new-study" data-glyph="video"
        data-src="assets/screen/new-study.mp4"
        data-fit="contain" data-color="source" data-gamma="0.8">
  <video muted loop playsinline preload="none" controls
         aria-label="Describe the source">
    <source src="assets/screen/new-study.mp4" type="video/mp4">
  </video>
  <figcaption>004 / NEW STUDY</figcaption>
  <p>A short caption.</p>
</figure>
```

Use a same-origin media file. For images, use `data-glyph="image"` and an `img` element with alt text.

Set `data-invert="true"` for a light subject on black. The default maps dark subjects on white into ink.

The available color modes are `source`, `mono`, `duo`, and `blue`. `data-ramp` specifies the characters from sparse to dense.

The gazania uses the prototype's existing source image. Its digits change while its silhouette stays still. The portrait and abstract form use video.

## Browser checks

The checks need Playwright and a Chromium installation. Start the local server first.

```sh
node tests/browser.cjs
```

For an existing Playwright installation, set `PLAYWRIGHT_MODULE` to its package path. For an existing Chromium binary, set `BROWSER_PATH`.

The checks cover fixed glyph origins, row settlement, keyboard controls, selection, video lifecycle, responsive widths, reduced motion, plain HTML, and lab controls.

## Prototype history

The integrated renderer comes from `glyph-v4-tv` at `1216fd2`. The earlier homepage remains in Git history at `b52a705`.

The separate card implementations remain on the prototype branch. This site includes their required media without their unrelated interface shells or missing Three.js dependencies.

The gazania source comes from the prototype's Poly Haven flower study. The portrait clip is the existing found-footage source. Its original creator is not recorded in this repository.

Local font licenses are in `assets/fonts`. The normal site loads its font locally. Optional comparison fonts in the lab use Google Fonts.
