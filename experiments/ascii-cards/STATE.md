# State — 2026-08-26

Replica of the ASCII-card effect from
`~/Desktop/Screen Recording 2026-08-25 at 17.49.48.mov`.

## Status: working, matches the reference closely

Run it:

    cd ~/Desktop/work/ascii-cards
    python3 -m http.server 8231     # index.html needs same-origin for getImageData
    open http://localhost:8231

`demo.html` is self-contained and opens straight from the filesystem.

## Where the tuning lives

`index.html`, the two `asciiPass(...)` calls at the bottom. Current values:

| knob | left | right | what it does |
|---|---|---|---|
| `cw` / `ch` | 11 / 15.5 | 9.2 / 10.8 | cell size in px |
| `floor` | 0.14 | 0.12 | luminance below which a cell is skipped |
| `dither` | 0.13 | 0.12 | randomness added to that threshold; makes the edge dissolve |
| `peak` | 0.98 | 0.98 | luminance mapped to full ink |
| `zoom` | 0.86 | 1.00 | crop into the source tile; < 1 enlarges the form |
| `drift` | 0.10 | 0.05 | downward pan over time |
| `settle` | 1.2 s | 3.5 s | accent to ink |

Shape geometry lives in `render_source.py`: `rock()` and `cloud()`, plus the two
`render(...)` calls at the bottom that set `fov` and `look` (framing).
Re-render is ~6 s for both.

`ATLAS` in `index.html` must match `N`, `AC`, `AR` in `render_source.py`.

## Verified

- Both cards render, no console errors.
- Chrome measured off the recording: card 616x910, 16 px padding, 27 px
  Instrument Serif, 10 px body, 27 px controls, crop marks at -5 px.
- Accents `#5c5a95` / `#78629b` and settle timings sampled from reference
  frames 0 and 185.

## Open items

1. The two 3D forms are *similar* to the reference, not identical — the
   original assets were not available. Reshaping either is one edit in
   `render_source.py` plus a re-render.
2. Left card's interior is flatter than the reference, which shows more
   tonal variation inside the silhouette. Raise the alpha gamma exponent
   (currently `Math.pow(lum, 0.55)`) toward 0.75 to bring it back.
3. `~/Desktop/work/.claude/launch.json` was added so the preview server could
   start. Delete it if unwanted.
4. Not a git repo. `git init` if this should be version-controlled.

## Gotcha

`requestAnimationFrame` does not run while the tab is backgrounded, so the
canvas is genuinely blank in headless screenshots until the tab is fronted.
That is correct behaviour, not a bug.
