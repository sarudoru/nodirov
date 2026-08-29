# ASCII snapshot cards

> **Not Constitution-compliant. Reference implementation only — do not ship as-is.**
>
> This is a standalone replica of an effect seen elsewhere, kept here for the
> technique. Measured against [CONSTITUTION.md](../../CONSTITUTION.md) it breaks:
>
> - **II** — the blend is tied to a clock (`performance.now()`), not scroll position.
> - **V** — the motion is permanent texture, not a state change that ends.
> - **VI** — a demo card pair is a set-piece; it reads as "look what this can do".
> - **VII** — Instrument Serif + Inter at several sizes, indigo and violet accents,
>   `#fafafa` ground. The field is IBM Plex Mono, one size, `#1a1a1a` on `#fdfdfb`,
>   accent in the selection highlight only.
>
> What *is* portable to the field: the luminance-to-glyph mapping and the
> dithered cut-off (see "How the effect works" below). Both operate purely on
> cell state and would satisfy Article I. Driving them from scroll position
> instead of a clock is the work that would make this shippable.

Two cards whose artwork is a monospace character grid driven by an animated
source. Same engine on both; only the glyph set and the tuning differ.

## How the effect works

    source frame  --drawImage--> cols x rows canvas   (the browser box-filters:
                                                       that IS the sampling)
                  --getImageData--> one luminance value per cell
                  --ramp lookup---> glyph + alpha
                  --fillText------> visible canvas

Everything else is tuning. The pass never inspects what its source is.

| | Left card | Right card |
|---|---|---|
| Glyph set | `0` `1` from 2D noise, brightness carried by **alpha** | ramp `" .,-^/+=1234567890"`, brightness picks the **glyph** |
| Motion | per-column scroll of the noise, over a moving silhouette | the form itself rotates; camera drifts and pushes in |
| Colour | indigo `#5c5a95` to `#222` over 1.2 s | violet `#78629b` to `#616166` over 3.5 s |

Two details do most of the visual work:

- **Dithered cut-off.** A cell is skipped when `lum < floor + hash(x,y)*dither`.
  A flat threshold gives a stencil edge; the dither makes the silhouette
  dissolve and scatters stray glyphs outside it.
- **Facing-based shading in the source.** Brightness follows how squarely the
  surface faces the camera, not just the light. That puts the dense glyphs in
  the middle of the form and thins them toward its outline.

## Files

| File | What it is |
|---|---|
| `index.html` | the page. Loads `src-a.png` / `src-b.png`. |
| `render_source.py` | bakes the two source animations. Writes an mp4 (to look at) and a sprite-sheet png (what the page loads). |
| `build.sh` | inlines both atlases as data URIs into a standalone `demo.html`. |
| `src-a.mp4`, `src-b.mp4` | the source clips, viewable on their own. |

## Running it

    python3 -m http.server 8231        # index.html needs same-origin for getImageData
    open http://localhost:8231

`demo.html` is self-contained and opens straight from the filesystem.

## Re-rendering the sources

    python3 -m venv .venv && ./.venv/bin/pip install numpy
    ./.venv/bin/python render_source.py        # both, ~6 s
    ./.venv/bin/python render_source.py b      # right card only
    ./build.sh

Frame count, tile size and atlas layout live at the top of `render_source.py`
and must match the `ATLAS` constant in `index.html`.

## Using a different source

The pass takes any `CanvasImageSource`. For a live video, replace the `<img>`
with `<video src="clip.mp4" muted loop autoplay playsinline>` and swap the two
`drawImage` source lines for `sctx.drawImage(video, 0, 0, cols, rows)`.
Nothing downstream changes.

Note that a `<video>` is subject to autoplay policy and background-tab
throttling. The sprite sheet exists to avoid both and to keep the loop
frame-exact.
