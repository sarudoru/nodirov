# The Field Constitution

The design law of this site. Every feature, effect, and future idea is tested
against these articles. If it violates one, it does not ship.

## I. The cell is the atom

The viewport is a fixed grid of character cells (`columns × rows`, derived
from the font's metrics and snapped to whole device pixels). Everything
visible is the state of a cell. There are no other visual primitives: no
images, no shapes, no pixels addressed directly. The lattice's dots and the
light box-drawing strokes are drawn as exact cell geometry so they join and
scale cleanly, but they are still glyphs in the atlas, held by cells. The one
tolerated decoration is the link underline, which belongs to the cell above it.

## II. Nothing moves; cells change

The page never scrolls. The real document scrolls invisibly underneath, and
each cell shows which character the scroll position puts in it. Between two
rows, every cell the document touches is a split-flap whose angle is the
scroll's fraction: half a row of scroll is every flap half turned, and
scrolling back turns them back. Nothing about a scroll is on a timer; the
reader's finger turns the flaps. A detent holds each row still for part of
the scroll, the way a picker wheel clicks into place, and the page settles
on whole rows.

Changes that happen while the page rests (a typed letter, a hovered link)
turn on a clock instead, one short flap per cell. No pixel ever leaves its
cell.

## III. What a cell can hold

1. **Lattice.** A cell the document does not use holds one small dot. The
   dots stay put; they are the reference that makes the rule visible. The
   lattice is alive but quiet: a slow weather darkens patches of dots in
   place, and never drifts.
2. **Warm.** Touch warms cells. A warm cell holds a larger dot, or a stroke
   leaning the way the pointer moved, and cools back to its resting dot. The
   document leaves warmth behind as it passes, so a scrolled line leaves a
   brief darkening of the dots it held.
3. **Turning.** A cell between two faces, mid-flap.
4. **Committed.** Content: the document's character at full ink, calm.
   Committed text never animates at rest. Reading is sacred.

## IV. The document is real

The content is one semantic HTML document, readable without JavaScript,
visible to crawlers, screen readers, and view-source. The field is a
renderer of that document, never a replacement. Selection, find-in-page,
links, focus, and history are the browser's own: a transparent text layer
sits in the real scroll container, aligned cell for cell with the grid. If a
browser power must be sacrificed for a visual idea, the visual idea loses.

## V. Motion is meaning

Animation communicates a change of state or answers the reader; it is never
texture. The lattice's weather is the only permanent motion, and it stays
below conscious notice. Everything else is caused by the reader or by first
contact, and it ends. `prefers-reduced-motion` silences all of it without
loss of content: the grid shows whole rows, and nothing turns.

## VI. Inhabitants obey the physics

The field has no mascots, no set pieces, and no buttons that perform tricks.
Whatever lives here must be a formation of cells obeying the same physics,
and must earn its place by making the field more itself, not by being a
demonstration. A personal site is not a toy chest.

## VII. One typeface, one ink

Geist Mono, regular, one size per breakpoint. Hierarchy comes from
composition: position, space, faint secondary ink, and rules made of `─`.
Never from weight, size, or colour changes, and never from small letter-spaced
capital labels. Ink is near-black (`#1a1a1a`) on warm white (`#fdfdfb`). The
one accent (`#c8401f`) marks what the reader is touching: a hovered link, a
selection, a notice. Every visual constant is a tuned default, not a magic
number: all of them live in `src/params.js` and are auditioned in `lab.html`
on the live field. Taste is decided with eyes and sliders, not argument.

## VIII. Interaction rewards, never obstructs

The pointer is a cell: the cell under it becomes the cursor mark, and the
dots around it swell as if the lattice were pressed. It never disturbs
committed text; over a letter it only colours that letter. A click sends a
round ring through the dots. A hovered link turns over to the accent, one
letter after another. None of this may ever make reading harder, and every
effect must be discoverable by accident.

## IX. The revelation is progressive

First contact: a ring leaves the name and switches the lattice on, and the
document turns in behind it. Then: scrolling shows the document is part of
the field. Then: touch shows the field is disturbable. The site says its rule
once, in one faint line, and never needs to be understood to be read.
