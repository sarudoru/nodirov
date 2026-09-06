# nodirov.com

A personal website made from one fixed grid of characters. The text, the
moving portrait, and the message box share the same cells.

## Run locally

From the project root:

```sh
python3 -m http.server 4190 --bind 127.0.0.1
```

Open [the site](http://127.0.0.1:4190/). Open [the lab](http://127.0.0.1:4190/lab.html)
to tune the renderer live.

This is a static site: no build step, no package install, no server code.
GitHub Pages serves it at the domain in `CNAME`.

## How it works

`index.html` is the semantic document. Without JavaScript the browser shows
it as plain HTML with the real video and a normal textarea.

The typesetter assigns a world row and column to every character and lays
transparent, grid-aligned spans over the canvas, so selection, links,
find-in-page, and keyboard focus stay native.

Native scrolling decides which world rows are in view. Each screen cell
blends between two adjacent world rows at a fixed origin; nothing translates
by pixels. When input stops, the scroll position settles on a whole row.

Media regions declared with `data-glyph` are sampled at character
resolution into the same cells. The video loads when it nears the viewport
and pauses when it leaves. The ambient field is at rest by default; the
video is the page's only animation. The knobs in `src/params.js` bring the
field back to life from `lab.html`.

The message box is a real `<textarea>` placed invisibly over its cells. A
hidden mirror with the same metrics reports the browser's own line breaks,
so the drawn text, the caret, and click-to-place agree. Untyped cells hold
faint resting glyphs; typed characters replace them; a line blinks at the
caret.

## Analytics and messages

`src/analytics.js` starts PostHog when `POSTHOG.key` is set. Empty key,
nothing loads. With a key: pageviews, autocapture, heatmaps, web vitals,
session replay, person profiles, referrer and UTM, device, locale, timezone,
and PostHog's server-side GeoIP for country and city. The page adds
`section_reached`, `motion_toggled`, and `message_sent`.

Messages are `message_sent` events. An address in the text identifies the
sender as a person in PostHog. Without analytics, sending opens the mail
client with the text filled in.

## Files

| File | Responsibility |
| --- | --- |
| `index.html` | Content, media declaration, the message form |
| `style.css` | Plain document, transparent spans, the invisible textarea |
| `src/main.js` | Boot, native scroll, resize, navigation, motion toggle, message delivery |
| `src/typesetter.js` | Placement of text, the hero, media, and the message box |
| `src/field.js` | Fixed cell coordinates, glyph cache, drawing, frame scheduling |
| `src/plane.js` | Media loading, sampling cadence, playback lifecycle |
| `src/media.js` | Luminance and colour into glyphs, ordered dither |
| `src/inbox.js` | The message box |
| `src/analytics.js` | PostHog |
| `src/substrate.js` | Ambient cell changes and pointer response (at rest by default) |
| `src/glyphspace.js` | Font measurement and transitions between related glyphs |
| `src/params.js` | Defaults, lab controls, URL settings |
| `lab.html` | Live tuning, comparisons, presets, frame timing |
| `tests/browser.cjs` | Browser regression checks |

## Declare media

```html
<figure data-glyph="video" data-src="assets/screen/clip.mp4"
        data-fit="cover" data-invert="true" data-gamma="1.4"
        data-dither="0.3" data-color="mono" data-ramp=" .,:;=+*#%@">
  <video muted loop playsinline preload="none" aria-label="What it shows">
    <source src="assets/screen/clip.mp4" type="video/mp4">
  </video>
  <figcaption>001 / TITLE</figcaption>
</figure>
```

Use a same-origin file. For a still, use `data-glyph="image"` with an `img`
and alt text. `data-invert="true"` is for a light subject on black. `color`
is `mono` or `source`. `ramp` runs from sparse to dense. `dither` spreads
flat tones across neighbouring glyphs.

## Browser checks

The checks need Playwright and a Chromium. Start the local server first.

```sh
node tests/browser.cjs
```

`PLAYWRIGHT_MODULE` points at an existing Playwright package, `BROWSER_PATH`
at a Chromium binary, `SITE_URL` at a server other than port 4190.

## Credits

The portrait clip is found footage; its creator is not recorded here. Font
licences are in `assets/fonts`.
