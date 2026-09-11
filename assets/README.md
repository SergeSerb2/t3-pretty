# Brand icons

## T3 Pretty fork icon

`pretty/t3-pretty-1024.png` is the master icon for the personal T3 Pretty fork. The smaller PNG,
ICO, and ICNS files beside it are derived exports. Desktop and web builds intentionally use this
same family in every release channel so upstream dev/nightly/prod artwork cannot replace the fork
identity during packaging. The checked-in `t3.json` also points to the master image, which makes the
logo appear for this repository in T3 Pretty project rows instead of the folder fallback.

Earlier studies live in `pretty/logo-explorations/`. The shipping mark is the
cut-out T3 from that lockup, recast in World Scenery sage.

The master mark is the lockup T3 in pastel mint (`#8FCFA8`) on cream paper
(`#E4DFCC`). Extra sizes and colorways live in `pretty/kit/`.
The `| Pretty` wordmark (`pretty/t3-pretty-wordmark.png`) is for the README,
DMG installer, and other large lockups. The in-app mark is that T3 with
the paper knocked out.

`t3-pretty-1024.png` is the macOS asset — an opaque 824px superellipse plate in
sage frost (`#DFEFE3`), inset 100px, with a soft contact shadow.
`t3-pretty-ios-1024.png` is the full-bleed iOS asset — the same frost field edge
to edge, since iOS applies the mask itself. Every icon in the family follows one
spec: the cut-out T3 at 62% of the visible icon area, sage on frost, so the
glyph reads at the same scale on the Dock, home screen, and browser chrome.
The ICO, ICNS, favicon, apple-touch, and Android adaptive foreground files are
derived from those masters. Desktop packaging copies them into `apps/desktop/resources`.

Run `vp run icons:pretty` to regenerate the family from
`pretty/kit/mark-sage.png` via `scripts/generate-pretty-icons.py`. That command
needs Python 3 and Pillow (`python3 -m pip install -r scripts/requirements-pretty-icons.txt`).
It writes a portable ICNS (no macOS `iconutil`), the in-app mark copies, and the
web public favicons, so the tracked family cannot split across machines.

`pretty/t3-pretty-mark.png` is the in-app T3 (web sidebar, mobile thread header):
sage ink on a transparent ground, no plate. `icons:pretty` copies it to
`apps/web/public/t3-pretty-mark.png` and `apps/mobile/assets/t3-pretty-mark.png`.
Hosted and desktop packaging still copy those tracked files into dist via
`scripts/apply-web-brand-assets.ts`.

macOS disk-image artwork lives next to the vector templates in
`apps/desktop/resources/dmg/`: `dmg-background-*-art.jpg` is the generated T3 Pretty installer
graphic, and the `.svg` files keep the drag-and-drop chrome as a small vector fallback.

The three Icon Composer projects are the source of truth for full application icons:

- `dev/app-icon.icon`
- `nightly/app-icon.icon`
- `prod/app-icon.icon`

Each project uses `text.svg` for the T3 mark and `background.svg` when the background is a vector layer. Additional layers use semantic names that describe their role and placement.

Run `vp run icons:export` from the repository root to regenerate the tracked iOS, Linux, Windows, and web assets. The development web exports are also copied to `apps/web/public` for the browser favicon and splash screen. Run `vp run icons:check` to verify that the generated assets and public copies match their sources without changing files.

Exporting requires Icon Composer 2 or newer on macOS. The script selects the newest compatible exporter from Xcode or a standalone Icon Composer installation and pins design generation 26. Set `ICON_COMPOSER_TOOL` to the full path of `Icon Composer.app/Contents/Executables/ictool` to override automatic discovery.

## macOS exports

Icon Composer's command-line exporter does not expose the `macOS pre-Tahoe` preset. A plain command-line `macOS` export is full bleed and is not suitable for the desktop app, so the export script intentionally leaves the tracked macOS PNGs unchanged and prints a reminder after every run.

After changing an Icon Composer project, open it in Icon Composer and export the macOS PNG with exactly these settings:

- Platform: `macOS pre-Tahoe`
- Appearance: `Default`
- Size: `1024pt`
- Scale: `1×`

Save the three exports to:

- `dev/app-icon.icon` -> `dev/blueprint-macos-1024.png`
- `nightly/app-icon.icon` -> `nightly/nightly-macos-1024.png`
- `prod/app-icon.icon` -> `prod/black-macos-1024.png`

The result must be a 1024×1024 PNG with the classic macOS safe area: the opaque icon body is 824×824, inset 100 pixels on every side, with only the native Icon Composer shadow extending into the surrounding transparent canvas.

To have Codex perform the native exports, paste this prompt into a task opened at the repository root:

```text
Use [@Computer](plugin://computer-use@openai-bundled) and the Icon Composer app to export the three macOS app icons in this repository.

For each project below, use Platform: macOS pre-Tahoe, Appearance: Default, Size: 1024pt, and Scale: 1×, then save the PNG to the exact destination:

- assets/dev/app-icon.icon -> assets/dev/blueprint-macos-1024.png
- assets/nightly/app-icon.icon -> assets/nightly/nightly-macos-1024.png
- assets/prod/app-icon.icon -> assets/prod/black-macos-1024.png

Do not resize, composite, or otherwise post-process the exported PNGs.

Verify every result is 1024×1024 and has the classic macOS safe area: an 824×824 opaque body inset 100px on every side, with only Icon Composer's native shadow extending beyond it.
```

Do not edit the generated PNG or ICO files directly.

## Android adaptive foreground

`apps/mobile/assets/android-icon-foreground.svg` is the source of truth for the foreground used by
the normal Android adaptive launcher icon. Export its paired PNG after changing it:

```sh
rsvg-convert -w 432 -h 432 \
  -o apps/mobile/assets/android-icon-foreground.png \
  apps/mobile/assets/android-icon-foreground.svg
```

The foreground must remain transparent and keep the T3 mark inside Android's adaptive-icon safe
zone. `android-icon-mark.png` remains a flat silhouette for Android's monochrome themed icon.
