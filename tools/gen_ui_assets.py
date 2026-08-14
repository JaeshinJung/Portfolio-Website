#!/usr/bin/env python3
"""gen_ui_assets.py - procedurally draw the DS console-chrome UI sprites.

This is deliberately NOT part of spritify.py. spritify.py's whole job is
cleaning up AI-drafted pixel art (chroma-key background removal, fringe/
speck rejection, palette snapping) into game-ready sprites. The assets here
are not drafts of anything - they are small, hand-authored geometric shapes
(a D-pad cross, two button circles, speaker slits, cartridge silhouette
masks) drawn directly with Pillow's ImageDraw at exact hex values. Running
them through spritify.py's cleanup pipeline would be pointless (there is no
background to key out, no AI noise to reject) and risks moving the colors
away from the exact values specified for this UI.

Every output pixel's alpha is exactly 0 or 255 (no partial alpha), nothing
is upscaled, and the script is deterministic: re-running it regenerates
byte-identical PNGs.

Usage: python3 tools/gen_ui_assets.py
"""

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - environment problem, not a code path
    sys.exit("error: Pillow is not installed. Run: python3 -m pip install --user Pillow")

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "public" / "assets" / "sprites"

# Navy bevel tones shared by the D-pad / buttons / speaker sprites.
BASE = (0x1E, 0x3A, 0x5A)
HIGHLIGHT = (0x2C, 0x4F, 0x73)
SHADOW = (0x12, 0x2A, 0x42)

WHITE = (0xFF, 0xFF, 0xFF)


def bevel_fill(w, h, mask_fn, base, highlight, shadow=None):
    """Fill a mask with a 1px bevel: top/left-exposed edges get `highlight`,
    bottom/right-exposed edges get `shadow` (if given), everything else
    interior gets `base`. Hard alpha only (0 or 255)."""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()

    def inside(x, y):
        if x < 0 or y < 0 or x >= w or y >= h:
            return False
        return mask_fn(x, y)

    for y in range(h):
        for x in range(w):
            if not inside(x, y):
                continue
            top_exposed = not inside(x, y - 1)
            left_exposed = not inside(x - 1, y)
            bottom_exposed = not inside(x, y + 1)
            right_exposed = not inside(x + 1, y)
            if top_exposed or left_exposed:
                color = highlight
            elif shadow is not None and (bottom_exposed or right_exposed):
                color = shadow
            else:
                color = base
            px[x, y] = (*color, 255)
    return img


def gen_dpad():
    """16x16 D-pad cross, ~1-2px margin, arms ~6px wide, beveled navy fill."""
    w, h = 16, 16

    def mask(x, y):
        vertical = 5 <= x <= 10 and 1 <= y <= 14
        horizontal = 5 <= y <= 10 and 1 <= x <= 14
        return vertical or horizontal

    return bevel_fill(w, h, mask, BASE, HIGHLIGHT, SHADOW)


def gen_buttons():
    """16x8 two beveled circles (A/B buttons), ~6px diameter, small gap."""
    w, h = 16, 8
    c1, c2, cy, r = (4, 3), (11, 3), 3, 2.6

    def mask(x, y):
        d1 = (x - c1[0]) ** 2 + (y - cy) ** 2
        d2 = (x - c2[0]) ** 2 + (y - cy) ** 2
        return d1 <= r * r or d2 <= r * r

    return bevel_fill(w, h, mask, BASE, HIGHLIGHT, SHADOW)


def gen_speaker():
    """14x10 speaker grille: 3 stacked horizontal slits, base + highlight only."""
    w, h = 14, 10
    x0, x1 = 2, 11  # inclusive column range, 10px wide
    slit_rows = [(1, 2), (4, 5), (7, 8)]  # (top, bottom) inclusive, per slit

    def mask(x, y):
        if not (x0 <= x <= x1):
            return False
        return any(top <= y <= bottom for top, bottom in slit_rows)

    return bevel_fill(w, h, mask, BASE, HIGHLIGHT, shadow=None)


def _chamfered_rect(draw, left, top, right, bottom, chamfer, fill):
    """Fill a rectangle with a few pixels cut off each corner (rectilinear
    chamfer, not a smooth AA curve)."""
    points = [
        (left + chamfer, top),
        (right - chamfer, top),
        (right, top + chamfer),
        (right, bottom - chamfer),
        (right - chamfer, bottom),
        (left + chamfer, bottom),
        (left, bottom - chamfer),
        (left, top + chamfer),
    ]
    draw.polygon(points, fill=fill)


# Shared cartridge silhouette geometry, reused by both mask images.
CART_W, CART_H = 64, 80
CART_LEFT, CART_TOP, CART_RIGHT, CART_BOTTOM = 2, 2, 61, 77
CART_CHAMFER = 4
NOTCH_LEFT, NOTCH_RIGHT = 26, 37  # inclusive, 12px wide
NOTCH_TOP, NOTCH_BOTTOM = 2, 7  # inclusive, 6px deep


def gen_cartridge_body_mask():
    """64x80 cartridge silhouette mask: opaque white body, transparent notch
    cut out of the top-center edge. Alpha-only mask (color is irrelevant)."""
    img = Image.new("RGBA", (CART_W, CART_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    _chamfered_rect(
        draw, CART_LEFT, CART_TOP, CART_RIGHT, CART_BOTTOM, CART_CHAMFER, (*WHITE, 255)
    )
    # Cut the connector-tab notch back out to transparent.
    draw.rectangle(
        [NOTCH_LEFT, NOTCH_TOP, NOTCH_RIGHT, NOTCH_BOTTOM], fill=(0, 0, 0, 0)
    )
    return img


def gen_cartridge_trim_mask():
    """64x80 cartridge trim mask: opaque white label band + the same notch
    region as the body mask, transparent everywhere else."""
    img = Image.new("RGBA", (CART_W, CART_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    band_left, band_top, band_right, band_bottom = CART_LEFT + 6, 8, CART_RIGHT - 6, 24
    draw.rectangle([band_left, band_top, band_right, band_bottom], fill=(*WHITE, 255))
    draw.rectangle(
        [NOTCH_LEFT, NOTCH_TOP, NOTCH_RIGHT, NOTCH_BOTTOM], fill=(*WHITE, 255)
    )
    return img


ASSETS = {
    "console-dpad.png": gen_dpad,
    "console-buttons.png": gen_buttons,
    "console-speaker.png": gen_speaker,
    "cartridge-body-mask.png": gen_cartridge_body_mask,
    "cartridge-trim-mask.png": gen_cartridge_trim_mask,
}


def verify(path):
    """Check hard alpha (0 or 255 only) and report an opaque-pixel color histogram."""
    img = Image.open(path).convert("RGBA")
    histogram = {}
    bad_alpha = 0
    for r, g, b, a in img.getdata():
        if a not in (0, 255):
            bad_alpha += 1
        elif a == 255:
            histogram[(r, g, b)] = histogram.get((r, g, b), 0) + 1
    return img.size, bad_alpha, histogram


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, gen_fn in ASSETS.items():
        out_path = OUT_DIR / name
        img = gen_fn()
        img.save(out_path)
        print(f"wrote {out_path} ({img.size[0]}x{img.size[1]})")

    print()
    print("verification:")
    for name in ASSETS:
        out_path = OUT_DIR / name
        size, bad_alpha, histogram = verify(out_path)
        status = "OK" if bad_alpha == 0 else "FAIL"
        opaque_total = sum(histogram.values())
        colors = ", ".join(
            f"#{r:02X}{g:02X}{b:02X}={count}"
            for (r, g, b), count in sorted(histogram.items(), key=lambda kv: -kv[1])
        )
        print(f"  {name}: size={size} alpha-hard={status} opaque_px={opaque_total} colors=[{colors}]")


if __name__ == "__main__":
    main()
