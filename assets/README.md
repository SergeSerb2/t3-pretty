# Brand icons

## T3 Pretty fork icon

`pretty/t3-pretty-1024.png` is the master icon for the personal T3 Pretty fork. The smaller PNG,
ICO, and ICNS files beside it are derived exports. Desktop and web builds intentionally use this
same family in every release channel so upstream dev/nightly/prod artwork cannot replace the fork
identity during packaging. The checked-in `t3.json` also points to the master image, which makes the
logo appear for this repository in T3 Pretty project rows instead of the folder fallback.

The master application icon is the generated colorful T3 mark on a dark glass
squircle. `t3-pretty-1024.png` is the macOS asset (824px body inset 100px, with
a light contact shadow). `t3-pretty-ios-1024.png` is the full-bleed iOS asset.
The ICO, ICNS, favicon, and apple-touch files are derived from those masters.
Desktop packaging copies them into `apps/desktop/resources`.

`pretty/t3-pretty-mark.png` is the in-app lockup (web sidebar, mobile thread header). It is a
cropped, transparent copy of the generated T3 Pretty mark, not the squircle application icon. The
web and mobile copies (`apps/web/public/t3-pretty-mark.png`, `apps/mobile/assets/t3-pretty-mark.png`)
are produced by the same brand-asset copy step as the favicons.

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
