# The Field Constitution

The design law of this site. Every feature, effect, and future idea is tested
against these articles. If it violates one, it does not ship.

## I. The cell is the atom

The viewport is a fixed grid of character cells (`columns × rows`, derived
from font metrics). Everything visible — content, ornament, animation,
inhabitants — is the state of cells. There are no other visual primitives.
No images, no shapes, no pixels addressed directly. The single tolerated
exception is the one-pixel link underline, a cell *decoration* that belongs
to the cell it sits under.

## II. Nothing moves; cells change

The page never scrolls. The murmur is **still** — ambient glyphs belong to
the screen, like grain in the glass of the aperture. The document pours
through them: during navigation each committed glyph blends between the row
it holds and the row arriving beneath, and the blend phase is tied
**directly to scroll position**, never to a clock. Ink pours from row to
row under the reader's finger, reverses when they reverse, and settles onto
whole rows when they stop. Passing content displaces the murmur cell by
cell; the murmur seeps back when it has gone. No pixel ever moves; no
transition plays on its own schedule.

## III. Cells have four states

1. **Ambient** — uncommitted murmur, anchored to the screen. Lowercase and
   digits at ~4.5% ink, running uniformly everywhere: content sits *in* the
   murmur, never on a cleared panel above it. **It is never still.** Every
   cell owns a slow opacity oscillation with its own period (4–11s) and
   phase, so the entire surface breathes at once while no single cell draws
   the eye; on top of that, cells cross-dissolve into new glyphs at ~22 per
   second. A tide passes across the grid, a lantern follows the cursor, the
   corners fall away in a whisper of vignette. A substrate that holds still
   is a photograph, and a photograph is a failure.
2. **Transitional** — matter forming or dissolving climbs an ink-density
   ramp (`·` `:` `+` → glyph); typographic shimmer uses a glyph's own
   cousins, unhurried. A click splashes outward through random glyphs —
   the one permitted burst of chaos, because the reader caused it and it
   dies within a second.
3. **Committed** — content. Full ink, calm, and *settled*: committed text
   never animates at rest. Reading is sacred.
4. **Hole** — a committed cell whose glyph has been taken (e.g. by gravity).
   Renders truly empty until restored.

## IV. The document is real

The content is one semantic HTML document, readable without JavaScript,
visible to crawlers, screen readers, and view-source. The field is a
*renderer* of that document, never a replacement. Selection, find-in-page,
links, focus, and history are the browser's native ones — the transparent
text layer sits in a real scroll container, aligned cell-for-cell with the
canvas. If a browser power must be sacrificed for a visual idea, the visual
idea loses.

## V. Motion is meaning

Animation communicates a state change or a discovered rule; it is never
texture. The ambient murmur is the only permanent motion, and it must stay
below conscious notice. Effects are triggered — by arrival, interaction, or
explicit invitation — and they end. `prefers-reduced-motion` silences all
of it without loss of content.

## VI. Inhabitants obey the physics

The field has no mascots, no set-pieces, and no buttons that perform
tricks. Whatever lives here must be a formation of cells obeying the same
physics, and must earn its place by making the field more itself — not by
being a demonstration. A personal site is not a toy chest: anything that
reads as "look what this can do" is cut. (A cursor-chasing butterfly lived
here briefly; it was removed for exactly this reason.)

## VII. One typeface, one ink

IBM Plex Mono, regular, one size per breakpoint. Hierarchy comes from
composition — banner letters built from their own character, wide-tracked
headings, rules made of `─`, buttons boxed in `┌─┐│└┘` — never from weight,
size, or color changes. Ink is near-black (`#1a1a1a`) on warm white
(`#fdfdfb`); the accent appears only in the selection highlight. Every
visual constant in this document is a *tuned default*, not a magic number:
all of them live in `src/params.js` and are auditioned in `lab.html` on the
live field. Taste decisions are made with eyes and sliders, never from
specimen cards or argument.

## VIII. Interaction rewards, never obstructs

The cursor disturbs ambient cells only; committed text does not flinch under
the pointer — unless invited. Hovering any word loops it through its
typographic cousins, the same letters as other languages write them, for as
long as the reader stays; it is still the same readable word. Links and
button labels do the same, with their chrome lighting up. A click splashes
outward through random glyphs and dies. One glyph per section is unstable
until repaired. None of this may ever make reading harder, and every effect
must be discoverable by accident.

## IX. The revelation is progressive

First contact: a quiet field crystallizes into a name. Then: scrolling
reveals the document is part of the field. Then: interaction reveals the
field is disturbable. Then: the experiments reveal the law can bend. The
site never explains all of itself at once, and it never needs to be
understood to be read.
