# World Scenery 2.5D parallax

World Scenery photos can render as a layered depth image (LDI) when **3D effects**
is on in Settings → Appearance. The pipeline is the usual single-image depth
stack — estimate depth, group regions, peel RGBA cards, inpaint holes, sit the
cards at Z, move a virtual camera — implemented on-device so we do not ship a
depth network or bake hundreds of layer PNGs.

## Shape

Each displayed wallpaper becomes:

- a dense 0–1 depth field (near → far)
- 4–10 RGBA cards with overlap fringes
- a back-to-front painter list

The JS builder (`apps/web/src/scenery/parallax`) fills that shape with a
landscape prior, connected-component grouping, and morphological inpaint. A
baker that ran Depth Anything 3 + SAM 2 + FLUX.1 Fill could emit the same
cards; the renderer does not care who authored them.

## Renderer

Web (and desktop, which wraps it) draws the cards in CSS 3D. The pointer is the
camera. The rAF loop stops once the pose has caught up, so a still pointer does
not keep the GPU busy. System reduce-motion and Thread motion off both park it.

Mobile uses the same setting. It does not have a canvas pixel path, so it tilts
the single photo from the device rotation sensor instead of peeling cards.

## Cost

The setting defaults off. Cards are built at 384px and composited with
`transform` only. `will-change` is limited to the rig while it is moving.
