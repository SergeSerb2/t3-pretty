# T3 Pretty brand kit

Source letterform: `../t3-pretty-source-icon.jpg` (T3) and
`../t3-pretty-source-wordmark.jpg` (T3 | Pretty). The T3 is pastel mint
`#8FCFA8` on cream paper `#E4DFCC`. In the wordmark, "Pretty" stays the
original dark olive.

## Mark (T3 only)

Use for the app icon, in-app logo, favicon, and small chrome.

| File                                | Use                                       |
| ----------------------------------- | ----------------------------------------- |
| `mark-sage.png`                     | Transparent T3. Live in-app mark.         |
| `mark-white.png` / `mark-black.png` | Template glyphs (widgets, notifications). |
| `mark-on-cream.png`                 | T3 on lockup paper.                       |
| `mark-on-frost.png`                 | T3 on sage-frost plate.                   |
| `mark-on-forest.png`                | Cream T3 on forest plate.                 |

## Wordmark (T3 \| Pretty)

Use for the README, git project row, DMG, and other wide lockups.

| File                    | Use                    |
| ----------------------- | ---------------------- |
| `wordmark-sage.png`     | Transparent lockup.    |
| `wordmark-on-cream.png` | Lockup on cream paper. |

## App icon

Live macOS icon is a **translucent frosted-glass** squircle (sage frost, specular
highlight, real alpha so the Dock wallpaper shows through). iOS cannot ship a
see-through icon — Apple flattens alpha — so the iOS 1024 is the same glass
look, fully opaque.

| File                                  | Size                            |
| ------------------------------------- | ------------------------------- |
| `icon-macos-1024.png`                 | Glass, 824 body + shadow        |
| `icon-glass-macos-1024.png`           | Same as live macOS              |
| `icon-ios-1024.png`                   | Opaque glass, 1024 full-bleed   |
| `icon-glass-ios-1024.png`             | Same as live iOS                |
| `icon-frost-macos-1024.png`           | Opaque sage-frost plate variant |
| `icon-forest-macos-1024.png`          | Forest plate variant            |
| `icon-{16,32,64,128,180,256,512}.png` | Square exports                  |
| `icon.ico`                            | Windows (opaque glass)          |

Live copies used by the app live in `assets/pretty/t3-pretty-*`.
