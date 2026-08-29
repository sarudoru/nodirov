# Creation of Adam rig — state

Michelangelo, *The Creation of Adam*, Sistine Chapel ceiling, c. 1512. Public domain.
Files: `hands.html` (rig), `vendor/` (three r180 + @pixiv/three-vrm), `model.vrm` (symlink).

Run:

    cd ~/Desktop/Projects/nodirov-glyph-tv
    python3 -m http.server 4182 --bind 127.0.0.1
    open http://127.0.0.1:4182/experiments/ascii-cards/hands.html

## Verified working

| | evidence |
|---|---|
| VRM loads, humanoid rig intact | 53 humanoid bones, 30 finger bones resolve |
| Bone aiming | fingertips land on target: gap 0.0550 m vs target 0.055 |
| Fresco arrangement | bone world positions confirm Adam's forearm horizontal from the left, God's descending from upper right |
| Spherical fragment clip | radius 0.235→0.020 drops ink 40.2%→7.9% |
| Camera-mounted key light | gives the N·V facing falloff without a custom shader |
| No downloads needed | three + three-vrm copied from ~/Desktop/three-vrm/node_modules |

## The open bug

Rendered content sits in the **right ~half** of the framebuffer and one hand is
hugely magnified, even though the camera looks at the fingertip midpoint and
both fingertips are confirmed at ±0.0275 m of centre.

Ruled out, each by direct test — do not re-test these:

- Not a stale screenshot. `gl.readPixels` agrees with the screenshots.
- Not the far plane. Torsos sit at the *same depth* as the hands (z≈0.40).
- Not axis-aligned clipping. The plane box was wider than the frustum, so it
  removed nothing; the sphere clip replaced it and does work.
- Not the idle T-pose arm. Tucking it changed nothing.
- Not `renderer.setSize`. Adding it produced byte-identical output.

RESOLVED by finally looking at a saved capture (`shots/hands-current.png`):
the mass is the model's **hips and legs**, not the hands. The fingertip snap
translates the whole instance, and the body lands across the camera's view at
roughly the meeting-point height. The clip sphere does not remove it because
the legs fall inside a 0.30 m radius of MEET.

Fix: give each instance its own clip sphere centred on **its own wrist**, with
a radius of ~0.16 m, instead of one shared sphere on the meeting point.

## Honest read on the subject matter

At ~56x46 cells the constraint is silhouette, not detail, so two hands nearly
touching remains a good subject.

Note: an earlier version of this file claimed the VRM's hands render as
"smooth rounded blobs". That was wrong — it was written from a misread of the
capture, before the geometry was identified as the model's legs. The hands
have not actually been seen at a usable framing yet, so their quality at
card resolution is still unknown.

## License — binding

VN3 license, プラチナ3D by 有坂みと (@Mito_Arisaka, arisakamito.com).
Rendering and publishing **pixels** is permitted. Redistributing **model data**
is prohibited, modified or not. `model.vrm` is a symlink and is gitignored;
it must never be committed. Credit is preferred, not required.
