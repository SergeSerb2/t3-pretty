#!/usr/bin/env python3
"""Regenerate the T3 Pretty icon family from the canonical sage mark.

One spec, every surface: the cut-out T3 sits at 62% of the visible icon area
(iOS canvas / macOS plate body), sage `#8FCFA8` on sage-frost `#DFEFE3`.

- macOS master: opaque 824px superellipse plate inset 100px, soft contact
  shadow, glyph 510px wide. Transparent corners so the Dock mask reads.
- iOS master: full-bleed frost, glyph 635px wide (62% of 1024).
- Android adaptive foreground: glyph at 62% of the inner 66/108 safe zone,
  on transparent (background `#DFEFE3` comes from app.config).
- Derived: icns/ico/favicons/apple-touch/kit squares/desktop resources,
  plus the in-app mark copies.

Requires Python 3 and Pillow. Install the pin, then run from the repo root:

    python3 -m pip install -r scripts/requirements-pretty-icons.txt
    python3 scripts/generate-pretty-icons.py
"""

import io
import math
import shutil
import struct
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    raise SystemExit(
        "Pillow is required to regenerate T3 Pretty icons. "
        "Install it with: python3 -m pip install -r scripts/requirements-pretty-icons.txt"
    )

REPO_ROOT = Path(__file__).resolve().parent.parent
PRETTY = REPO_ROOT / "assets" / "pretty"
KIT = PRETTY / "kit"
DESKTOP_RESOURCES = REPO_ROOT / "apps" / "desktop" / "resources"
MOBILE_ASSETS = REPO_ROOT / "apps" / "mobile" / "assets"
WEB_PUBLIC = REPO_ROOT / "apps" / "web" / "public"

# PNG-in-ICNS types used by modern macOS. Duplicate pixel sizes share one PNG
# (1x and @2x aliases). This is portable; iconutil is macOS-only.
ICNS_PNG_TYPES = (
    (b"ic11", 32),
    (b"ic12", 64),
    (b"ic07", 128),
    (b"ic08", 256),
    (b"ic13", 256),
    (b"ic09", 512),
    (b"ic14", 512),
    (b"ic10", 1024),
)

FROST = (223, 239, 227, 255)  # #DFEFE3 sage-frost plate / iOS background
CANVAS = 1024
MACOS_BODY = 824  # classic macOS safe area: opaque body inset 100px
# Adaptive icons are 108dp; the inner 66dp is never clipped by the OEM mask.
ANDROID_ADAPTIVE_SAFE_ZONE = 66 / 108
GLYPH_RATIO = 0.62  # glyph width as a fraction of the visible icon area


def load_glyph() -> Image.Image:
    """Canonical cut-out T3, trimmed to its ink bounds."""
    mark = Image.open(KIT / "mark-sage.png").convert("RGBA")
    bbox = mark.getchannel("A").getbbox()
    if bbox is None:
        raise SystemExit("mark-sage.png has no opaque pixels")
    return mark.crop(bbox)


def scaled_glyph(glyph: Image.Image, width: int) -> Image.Image:
    height = round(glyph.height * width / glyph.width)
    return glyph.resize((width, height), Image.LANCZOS)


def paste_centered(canvas: Image.Image, overlay: Image.Image, center_y: int) -> None:
    x = (canvas.width - overlay.width) // 2
    y = center_y - overlay.height // 2
    canvas.alpha_composite(overlay, (x, y))


def superellipse_mask(size: int, exponent: float = 5.0) -> Image.Image:
    """Apple-style continuous-corner mask, supersampled 4x for clean edges."""
    scale = 4
    s = size * scale
    mask = Image.new("L", (s, s), 0)
    draw = ImageDraw.Draw(mask)
    half = s / 2
    n = exponent
    # Trace the superellipse |x/a|^n + |y/b|^n = 1 as a polygon. Each mirrored
    # quadrant starts where the previous arc ended, so the outline is one
    # continuous winding with no chords across the plate.
    points = []
    steps = s // 2
    for i in range(steps + 1):
        t = (i / steps) * (math.pi / 2)
        x = half * math.cos(t) ** (2 / n)
        y = half * math.sin(t) ** (2 / n)
        points.append((half + x, half + y))
    polygon = (
        points
        + [(2 * half - x, y) for x, y in reversed(points)]
        + [(2 * half - x, 2 * half - y) for x, y in points]
        + [(x, 2 * half - y) for x, y in reversed(points)]
    )
    draw.polygon(polygon, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def render_macos_master(glyph: Image.Image) -> Image.Image:
    icon = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    inset = (CANVAS - MACOS_BODY) // 2
    body_mask = superellipse_mask(MACOS_BODY)

    # Soft contact shadow: the body silhouette dropped 10px, blurred, low alpha.
    shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    shadow_layer = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    shadow_layer.paste((38, 52, 44, 255), (inset, inset + 10), body_mask)
    shadow = shadow_layer.filter(ImageFilter.GaussianBlur(14))
    shadow_alpha = shadow.getchannel("A").point(lambda a: int(a * 0.22))
    shadow.putalpha(shadow_alpha)
    icon.alpha_composite(shadow)

    plate = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    plate.paste(FROST, (inset, inset), body_mask)
    icon.alpha_composite(plate)

    paste_centered(icon, scaled_glyph(glyph, round(MACOS_BODY * GLYPH_RATIO)), CANVAS // 2)
    return icon


def render_ios_master(glyph: Image.Image) -> Image.Image:
    icon = Image.new("RGBA", (CANVAS, CANVAS), FROST)
    paste_centered(icon, scaled_glyph(glyph, round(CANVAS * GLYPH_RATIO)), CANVAS // 2)
    return icon


def downscale(icon: Image.Image, size: int) -> Image.Image:
    return icon.resize((size, size), Image.LANCZOS)


def png_bytes(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def encode_icns(macos_master: Image.Image) -> bytes:
    pngs: dict[int, bytes] = {}
    for _ostype, size in ICNS_PNG_TYPES:
        if size not in pngs:
            pngs[size] = png_bytes(downscale(macos_master, size))
    chunks = []
    for ostype, size in ICNS_PNG_TYPES:
        data = pngs[size]
        chunks.append(ostype + struct.pack(">I", 8 + len(data)) + data)
    payload = b"".join(chunks)
    return b"icns" + struct.pack(">I", 8 + len(payload)) + payload


def write_icns(macos_master: Image.Image, targets: list[Path]) -> None:
    contents = encode_icns(macos_master)
    for target in targets:
        target.write_bytes(contents)


def write_ico(ios_master: Image.Image, targets: list[Path]) -> None:
    for target in targets:
        ios_master.save(
            target,
            format="ICO",
            sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
        )


def write_mark_copies() -> None:
    # Same cut-out T3 the plates use, no frost field. Keep the kit source's
    # 480x351 canvas (including transparent padding) so the mobile lockup's
    # 480/351 aspect ratio stays valid.
    source = KIT / "mark-sage.png"
    mark = PRETTY / "t3-pretty-mark.png"
    shutil.copyfile(source, mark)
    shutil.copyfile(mark, WEB_PUBLIC / "t3-pretty-mark.png")
    shutil.copyfile(mark, MOBILE_ASSETS / "t3-pretty-mark.png")


def write_web_public_icons() -> None:
    shutil.copyfile(PRETTY / "t3-pretty.ico", WEB_PUBLIC / "favicon.ico")
    shutil.copyfile(PRETTY / "t3-pretty-favicon-16x16.png", WEB_PUBLIC / "favicon-16x16.png")
    shutil.copyfile(PRETTY / "t3-pretty-favicon-32x32.png", WEB_PUBLIC / "favicon-32x32.png")
    shutil.copyfile(
        PRETTY / "t3-pretty-apple-touch-180.png",
        WEB_PUBLIC / "apple-touch-icon.png",
    )


def main() -> None:
    glyph = load_glyph()
    macos = render_macos_master(glyph)
    ios = render_ios_master(glyph)

    # Masters
    macos.save(PRETTY / "t3-pretty-1024.png")
    ios.save(PRETTY / "t3-pretty-ios-1024.png")

    # Web + touch icons derive from the iOS master (opaque, full bleed).
    downscale(ios, 16).save(PRETTY / "t3-pretty-favicon-16x16.png")
    downscale(ios, 32).save(PRETTY / "t3-pretty-favicon-32x32.png")
    downscale(ios, 180).save(PRETTY / "t3-pretty-apple-touch-180.png")

    # Android adaptive foreground: 62% of the 66/108 safe-zone diameter, not
    # 62% of the full 108dp layer, or the launcher mask crops the T3.
    foreground = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    android_visible = round(CANVAS * ANDROID_ADAPTIVE_SAFE_ZONE)
    paste_centered(foreground, scaled_glyph(glyph, round(android_visible * GLYPH_RATIO)), CANVAS // 2)
    foreground.save(MOBILE_ASSETS / "android-icon-mark.png")

    # Desktop resources + packaged icns/ico.
    downscale(macos, 512).save(DESKTOP_RESOURCES / "icon.png")
    write_icns(macos, [PRETTY / "t3-pretty.icns", DESKTOP_RESOURCES / "icon.icns"])
    write_ico(ios, [PRETTY / "t3-pretty.ico", DESKTOP_RESOURCES / "icon.ico"])

    # Kit copies: the frost look is the shipping design (glass stays a variant).
    macos.save(KIT / "icon-macos-1024.png")
    macos.save(KIT / "icon-frost-macos-1024.png")
    ios.save(KIT / "icon-ios-1024.png")
    for size in (16, 32, 64, 128, 180, 256, 512):
        downscale(ios, size).save(KIT / f"icon-{size}.png")
    write_ico(ios, [KIT / "icon.ico"])

    write_mark_copies()
    write_web_public_icons()

    print("Regenerated T3 Pretty icon family (glyph at 62% of the visible icon area).")


if __name__ == "__main__":
    main()
