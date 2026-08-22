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

One spec on every surface: the cut-out T3 at **62% of the visible icon area**,
sage `#8FCFA8` on sage-frost `#DFEFE3`. The live macOS icon is an opaque
superellipse plate (824px body inset 100px, soft contact shadow). iOS is the
same frost field full-bleed, since iOS applies the squircle mask itself.

| File                                  | Use                               |
| ------------------------------------- | --------------------------------- |
| `icon-macos-1024.png`                 | Live macOS (frost plate + shadow) |
| `icon-frost-macos-1024.png`           | Same as live macOS                |
| `icon-ios-1024.png`                   | Live iOS, 1024 full-bleed         |
| `icon-glass-macos-1024.png`           | Translucent glass variant         |
| `icon-glass-ios-1024.png`             | Glass variant, flattened for iOS  |
| `icon-forest-macos-1024.png`          | Forest plate variant              |
| `icon-{16,32,64,128,180,256,512}.png` | Square exports of the iOS art     |
| `icon.ico`                            | Windows (iOS art)                 |

Live copies used by the app live in `assets/pretty/t3-pretty-*`. Regenerate the
family with `vp run icons:pretty` (`scripts/generate-pretty-icons.py`; needs
Python 3 and Pillow from `scripts/requirements-pretty-icons.txt`).
