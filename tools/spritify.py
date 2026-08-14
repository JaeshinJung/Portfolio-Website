#!/usr/bin/env python3
"""spritify.py - turn AI-generated pixel-art drafts into palette-exact game sprites.

Dev-time tool only (see tools/README.md). Requires Pillow.

Pipeline: load RGBA -> optional --crop -> background key-out -> hard alpha cut
-> fringe reject -> outlier row-band reject -> speck component reject
-> slice (sheet mode) -> trim -> nearest-neighbor downscale -> optional --pad
-> palette remap -> save PNG.

`cells` mode replaces the middle of that pipeline: it splits the sheet by
ARITHMETIC (--cell / --grid), never trims, uses ONE scale factor for the whole
sheet, and can --extrude the tile edges instead of --pad-ing them.

The generation prompt must ask for a solid #FF00FF magenta background (see
tools/README.md): a dark background is genuinely inseparable from a dark
creature, because the palette itself contains near-identical darks.

DELIBERATE DECISION: the output is NOT upscaled. We ship small files (64x64 etc.)
and let CSS `image-rendering: pixelated` do the scaling in the browser. Shipping
8x-upscaled PNGs would waste bytes for exactly zero visual gain. Please do not
"fix" this by adding an upscale step.
"""

import argparse
import re
import sys
from collections import deque
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - environment problem, not a code path
    sys.exit("error: Pillow is not installed. Run: python3 -m pip install --user Pillow")

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PALETTE = Path(__file__).resolve().parent / "palette.txt"
DEFAULT_OUT_DIR = REPO_ROOT / "public" / "assets" / "sprites"

# Perceptual-ish weights for RGB distance (luma weights). Plain Euclidean sRGB
# picks visibly wrong palette entries for greens/blues.
W_R, W_G, W_B = 0.30, 0.59, 0.11

HEX_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")

# The generation prompt asks for this chroma-key background, so it is the default.
DEFAULT_BG = "FF00FF"
# A background this close (weighted RGB distance) to a palette color is unsafe.
BG_PALETTE_MIN_DIST = 40.0
# An explicit background must cover at least this fraction of the image.
BG_MIN_COVERAGE = 0.05
# Group widths/heights outside this band around the median are suspicious.
VAR_LOW, VAR_HIGH = 0.60, 1.65

# Painted-checkerboard detection (see detect_painted_checkerboard).
CHECKER_ALPHA_SLACK = 0.001   # "effectively no transparency" tolerance
CHECKER_CLUSTER_R = 30.0      # weighted RGB radius that defines one color cluster
CHECKER_MIN_SHARE = 0.25      # the two grey clusters must cover at least this much
CHECKER_GREY_RG, CHECKER_GREY_RB = 8, 20   # neutral-grey test on a cluster centroid
CHECKER_RUN_MIN, CHECKER_RUN_MAX = 4, 200  # plausible checker square size, px
CHECKER_RUN_TOL, CHECKER_RUN_FRAC = 0.25, 0.70  # run lengths must cluster this tightly
CHECKER_MIN_RUNS = 6          # fewer alternations than this is not a pattern
CHECKER_ROW_MIN_BG = 0.90     # only scan rows that are this background-heavy


def fail(message):
    sys.exit("error: " + message)


def warn(message):
    sys.stdout.flush()  # keep warnings in order with the normal log when piped
    sys.stderr.write("warning: " + message + "\n")


def wdist2(a, b):
    """Squared weighted RGB distance."""
    dr = a[0] - b[0]
    dg = a[1] - b[1]
    db = a[2] - b[2]
    return W_R * dr * dr + W_G * dg * dg + W_B * db * db


def read_palette(path):
    if not path.is_file():
        fail("palette file not found: %s" % path)
    colors = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith(";") or line.startswith("//"):
            continue
        m = HEX_RE.match(line)
        if not m:
            if line.startswith("#"):
                continue  # '#'-style comment line
            fail("cannot parse palette line in %s: %r" % (path, raw))
        h = m.group(1)
        colors.append((int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)))
    if not colors:
        fail("palette file %s contains no colors" % path)
    return colors


def parse_size(text, what="--size"):
    t = text.lower().strip()
    try:
        if "x" in t:
            w, h = t.split("x", 1)
            size = (int(w), int(h))
        else:
            v = int(t)
            size = (v, v)
    except ValueError:
        fail("bad %s %r (expected 64 or 128x72)" % (what, text))
    if size[0] < 1 or size[1] < 1:
        fail("bad %s %r (must be positive)" % (what, text))
    return size


def parse_crop(text):
    """Parse --crop L,T,R,B into a box. Bounds are checked later, against the image."""
    parts = [p.strip() for p in text.split(",")]
    if len(parts) != 4:
        fail("bad --crop %r (expected 4 numbers: L,T,R,B)" % text)
    try:
        return tuple(int(p) for p in parts)
    except ValueError:
        fail("bad --crop %r (L,T,R,B must be integers)" % text)


def apply_crop(img, box):
    """Cut the input down to a pixel box. Right/bottom are exclusive (PIL convention)."""
    left, top, right, bottom = box
    w, h = img.size
    if not (0 <= left < right <= w and 0 <= top < bottom <= h):
        fail("bad --crop %d,%d,%d,%d for a %dx%d image.\n"
             "  need 0 <= L < R <= %d and 0 <= T < B <= %d (right/bottom are exclusive)."
             % (left, top, right, bottom, w, h, w, h))
    return img.crop(box)


def parse_bg(text):
    """Return "auto", "none", or an (r, g, b) tuple."""
    t = text.strip().lower()
    if t in ("auto", "none"):
        return t
    m = HEX_RE.match(t)
    if not m:
        fail("bad --bg %r (expected a hex color like FF00FF, or 'auto', or 'none')" % text)
    h = m.group(1)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def fmt_rgb(c):
    return "#%02X%02X%02X" % (c[0], c[1], c[2])


def fmt_min_area(v):
    """--min-area is relative to the main component below 1, an absolute px count above."""
    if v < 1.0:
        return "%g = %g%% of the main component" % (v, v * 100.0)
    return "%d px" % int(v)


def corner_colors(px, w, h):
    n = w * h
    return [px[0], px[w - 1], px[(h - 1) * w], px[n - 1]]


def check_bg_vs_palette(bg, palette):
    """Warn if the chroma-key color is close to a palette color (unsafe combo)."""
    idx = min(range(len(palette)), key=lambda i: wdist2(bg, palette[i]))
    dist = wdist2(bg, palette[idx]) ** 0.5
    if dist < BG_PALETTE_MIN_DIST:
        warn("background %s is only %.1f (weighted RGB) from palette color %s.\n"
             "  That is below the safe distance %.0f: the key-out may eat part of the\n"
             "  subject. Pick a background far from every palette color (%s is the default)."
             % (fmt_rgb(bg), dist, fmt_rgb(palette[idx]), BG_PALETTE_MIN_DIST,
                "#" + DEFAULT_BG))


def is_neutral_grey(c):
    return abs(c[0] - c[1]) <= CHECKER_GREY_RG and abs(c[2] - c[0]) <= CHECKER_GREY_RB


def detect_painted_checkerboard(px, w, h, src_has_alpha):
    """Detect a background where the model PAINTED the editor transparency checkerboard.

    Observed on a real Gemini sheet: mode RGBA but 100% alpha 255, background two
    alternating neutral greys ~46px apart. That input is not salvageable (creature
    greys are nearer the background greys than the two background greys are to each
    other), so it deserves its own error instead of the generic "bg not found".
    Returns an error message, or None if this is some other image.
    """
    n = w * h
    if not src_has_alpha:
        return None

    # (A) an alpha channel that carries no actual transparency.
    a0 = sum(1 for p in px if p[3] == 0)
    partial = sum(1 for p in px if 0 < p[3] < 255)
    if a0 > CHECKER_ALPHA_SLACK * n or partial > CHECKER_ALPHA_SLACK * n:
        return None

    # (B) the two dominant color clusters are both neutral grey and cover a lot.
    # Cluster, not exact color: the painted checkerboard has per-square noise.
    hist = {}
    for p in px:
        k = p[:3]
        hist[k] = hist.get(k, 0) + 1
    r2 = CHECKER_CLUSTER_R * CHECKER_CLUSTER_R
    seeds = []
    for col in sorted(hist, key=lambda k: -hist[k]):
        if all(wdist2(col, s) > r2 for s in seeds):
            seeds.append(col)
            if len(seeds) == 2:
                break
    if len(seeds) < 2:
        return None
    # The seeds are the modal color of their own cluster, so they describe the two
    # tones better than a centroid would (a centroid is dragged around by the
    # blended 1px seams between squares).
    cls = {}
    counts = [0, 0]
    for col, c in hist.items():
        d0, d1 = wdist2(col, seeds[0]), wdist2(col, seeds[1])
        i = 0 if d0 <= d1 else 1
        near = min(d0, d1) <= r2
        cls[col] = (i, near)
        if near:
            counts[i] += c
    if not (is_neutral_grey(seeds[0]) and is_neutral_grey(seeds[1])):
        return None
    share = (counts[0] + counts[1]) / n
    if share < CHECKER_MIN_SHARE:
        return None

    # (C) the two greys alternate with a regular period along a horizontal scanline.
    # Use the emptiest row that actually alternates: the very emptiest row can be a
    # single flat run (a seam row, or a plain margin), which proves nothing.
    near_per_row = [sum(1 for p in px[y * w:(y + 1) * w] if cls[p[:3]][1]) for y in range(h)]
    runs, scan_y = None, None
    for y in sorted(range(h), key=lambda y: -near_per_row[y]):
        if near_per_row[y] < CHECKER_ROW_MIN_BG * w:
            break  # rows are sorted, so no mostly-background row is left
        line = [cls[p[:3]][0] for p in px[y * w:(y + 1) * w]]
        lengths = []
        length = 1
        for a, b in zip(line, line[1:]):
            if a == b:
                length += 1
            else:
                lengths.append(length)
                length = 1
        lengths.append(length)
        if len(lengths) >= CHECKER_MIN_RUNS:
            runs, scan_y = lengths[1:-1], y  # first/last run is cut by the image edge
            break
    if not runs:
        return None
    median = sorted(runs)[len(runs) // 2]
    if not CHECKER_RUN_MIN <= median <= CHECKER_RUN_MAX:
        return None
    tight = sum(1 for r in runs if abs(r - median) <= CHECKER_RUN_TOL * median)
    if tight < CHECKER_RUN_FRAC * len(runs):
        return None

    return ("this image has a PAINTED transparency checkerboard, not real transparency.\n"
            "  alpha channel is present but %.1f%% opaque (%d transparent px, %d partial).\n"
            "  background is two greys RGB(%d,%d,%d) / RGB(%d,%d,%d) covering %.1f%% of the\n"
            "  image, alternating with a period of ~%dpx (measured on row y=%d).\n"
            "  The model drew the checkerboard *pattern* that editors use to show transparency\n"
            "  instead of leaving the background transparent. This cannot be keyed out reliably:\n"
            "  grey creature pixels are closer to the background greys than the two greys are to\n"
            "  each other, and edges are anti-aliased against grey with no alpha to recover from.\n"
            "  Fix: regenerate the image asking for a SOLID #FF00FF magenta background, and\n"
            "  explicitly tell the model NOT to draw a checkerboard."
            % (100.0 * (n - a0 - partial) / n, a0, partial,
               seeds[0][0], seeds[0][1], seeds[0][2], seeds[1][0], seeds[1][1], seeds[1][2],
               100.0 * share, median, scan_y))


def key_out_background(img, fuzz, bg, src_has_alpha):
    """Remove an opaque background by flood-filling inward from the border.

    Connected-region fill (not a global color match) so that an interior pixel
    which happens to match the background - a dark eye on a dark creature -
    survives. `bg` is "auto" (sample the corners) or an explicit (r, g, b).
    Returns (image, note).
    """
    w, h = img.size
    px = list(img.getdata())
    n = w * h
    tol = fuzz * 255.0
    tol2 = tol * tol

    if bg == "auto":
        clear = sum(1 for p in px if p[3] == 0)
        if clear >= 0.25 * n:
            return img, "input already %.1f%% transparent - kept existing alpha" % (
                100.0 * clear / n)

        corners = corner_colors(px, w, h)
        for c in corners[1:]:
            if wdist2(corners[0], c) > tol2:
                return img, ("corners disagree (%s) - skipped key-out, relying on existing alpha"
                             % (", ".join("(%d,%d,%d)" % c[:3] for c in corners)))
        bg = tuple(round(sum(c[i] for c in corners) / 4.0) for i in range(3))
    else:
        # Explicit background: it must actually be there. Falling back to corner
        # sampling here is how the original dark-background failure went unnoticed.
        match = sum(1 for p in px if p[3] != 0 and wdist2(p, bg) <= tol2)
        if match < BG_MIN_COVERAGE * n:
            painted = detect_painted_checkerboard(px, w, h, src_has_alpha)
            if painted:
                fail(painted)
            corners = corner_colors(px, w, h)
            fail("expected background %s not found in this image.\n"
                 "  only %d px (%.2f%%) are within weighted distance %.1f of it, need >= %.0f%%.\n"
                 "  sampled corner colors: %s\n"
                 "  Re-generate the image with a solid %s background, or pass\n"
                 "  --bg auto (sample the corners, the old behavior), --bg <hex> for a\n"
                 "  different background color, or --bg none to trust the existing alpha."
                 % (fmt_rgb(bg), match, 100.0 * match / n, tol, 100.0 * BG_MIN_COVERAGE,
                    ", ".join("(%d,%d,%d)" % c[:3] for c in corners), "#" + DEFAULT_BG))

    inside = bytearray(n)  # 1 = flood-filled background
    q = deque()

    def seed(i):
        if not inside[i] and px[i][3] != 0 and wdist2(px[i], bg) <= tol2:
            inside[i] = 1
            q.append(i)

    for x in range(w):
        seed(x)
        seed((h - 1) * w + x)
    for y in range(h):
        seed(y * w)
        seed(y * w + w - 1)

    while q:
        i = q.popleft()
        x = i % w
        if x > 0:
            seed(i - 1)
        if x < w - 1:
            seed(i + 1)
        if i >= w:
            seed(i - w)
        if i < n - w:
            seed(i + w)

    removed = 0
    for i in range(n):
        if inside[i]:
            r, g, b, _ = px[i]
            px[i] = (r, g, b, 0)
            removed += 1

    out = Image.new("RGBA", (w, h))
    out.putdata(px)
    return out, "keyed out bg #%02X%02X%02X (fuzz %.2f): %d px (%.1f%%) removed" % (
        bg[0], bg[1], bg[2], fuzz, removed, 100.0 * removed / n)


def harden_alpha(img, alpha_cut):
    """Binarize alpha: kills anti-aliased halos and faint drop shadows.

    After this there is no partial alpha anywhere in the pipeline.
    """
    px = list(img.getdata())
    out = []
    for r, g, b, a in px:
        if a < alpha_cut:
            out.append((0, 0, 0, 0))
        else:
            out.append((r, g, b, 255))
    res = Image.new("RGBA", img.size)
    res.putdata(out)
    return res


def reject_fringe(img, bg, palette):
    """Drop opaque pixels that are closer to the background than to any palette color.

    A chroma-key background leaves a blended fringe - pixels that are part
    background, part subject - which would otherwise snap to some palette color
    and show up as a halo. Runs before the palette snap. Returns (image, count).
    """
    px = list(img.getdata())
    cache = {}
    out = []
    dropped = 0
    for p in px:
        if p[3] == 0:
            out.append(p)
            continue
        key = p[:3]
        is_fringe = cache.get(key)
        if is_fringe is None:
            best = min(wdist2(key, c) for c in palette)
            is_fringe = wdist2(key, bg) < best
            cache[key] = is_fringe
        if is_fringe:
            out.append((0, 0, 0, 0))
            dropped += 1
        else:
            out.append(p)
    res = Image.new("RGBA", img.size)
    res.putdata(out)
    return res, dropped


def variance_warnings(items):
    """Warn about groups whose size is far from the median. items: (label, w, h)."""
    if len(items) < 3:
        return []
    out = []
    for what, i_dim in (("wide", 1), ("tall", 2)):
        vals = sorted(it[i_dim] for it in items)
        median = vals[len(vals) // 2]
        if median <= 0:
            continue
        for idx, it in enumerate(items):
            v = it[i_dim]
            ratio = v / median
            if VAR_LOW <= ratio <= VAR_HIGH:
                continue
            if ratio < 1.0:
                delta = "%.0f%% %s than" % ((1.0 - ratio) * 100.0,
                                            "narrower" if what == "wide" else "shorter")
            else:
                delta = "%.0f%% %s than" % ((ratio - 1.0) * 100.0,
                                            "wider" if what == "wide" else "taller")
            out.append("group [%d] %r is %dpx %s, %s the median %dpx - the key-out may have\n"
                       "  eaten part of it, or two creatures may have merged."
                       % (idx, it[0], v, what, delta, median))
    return out


def row_bands(img, min_gap):
    """Split into bands of contiguous non-empty rows. Returns [[y0, y1, opaque_px], ...].

    Same gap logic as column_groups, but on rows and with its own threshold: the
    watermark gap on the real sheet was ~340 empty rows.
    """
    w, h = img.size
    alpha = img.getchannel("A").tobytes()
    counts = [w - alpha[y * w:(y + 1) * w].count(0) for y in range(h)]

    raw = []
    start = None
    for y in range(h):
        if counts[y]:
            if start is None:
                start = y
        elif start is not None:
            raw.append([start, y - 1])
            start = None
    if start is not None:
        raw.append([start, h - 1])

    merged = []
    for band in raw:
        if merged and band[0] - merged[-1][1] - 1 < min_gap:
            merged[-1][1] = band[1]
        else:
            merged.append(list(band))
    return [[b[0], b[1], sum(counts[b[0]:b[1] + 1])] for b in merged]


def reject_outlier_rows(img, min_gap, max_share):
    """Blank row bands far too small to be real content - generator watermarks.

    Measured on a real Gemini sheet: a 52x53 sparkle watermark at the bottom right
    sat INSIDE the 6th creature's x-range, so it created no 7th column group. It
    just inflated that group's bbox from h=299 to h=711, which the group-count check
    cannot catch. Returns (image, notes, warnings).
    """
    bands = row_bands(img, min_gap)
    notes, warnings = [], []
    if len(bands) < 2:
        return img, notes, warnings

    main = max(bands, key=lambda b: b[2])
    drop = [b for b in bands if b is not main and b[2] < max_share * main[2]]
    keep = [b for b in bands if b is not main and b not in drop]

    for y0, y1, count in drop:
        notes.append("dropped outlier row band y %d-%d (%d rows, %d px, %.1f%% of main band)"
                     " - likely a generator watermark"
                     % (y0, y1, y1 - y0 + 1, count, 100.0 * count / main[2]))
    if drop:
        img = img.copy()
        w = img.size[0]
        for y0, y1, _ in drop:
            img.paste((0, 0, 0, 0), (0, y0, w, y1 + 1))
    if keep:
        warnings.append(
            "found %d content row band(s) besides the main one (y %d-%d, %d px), each too\n"
            "  large to be noise: %s.\n"
            "  The slicer only splits COLUMNS, i.e. it assumes ONE horizontal row of sprites,\n"
            "  so a grid will be sliced wrong. Re-crop the input to a single row (--crop\n"
            "  L,T,R,B), or raise --outlier-max-share (now %.3f) if these really are noise."
            % (len(keep), main[0], main[1], main[2],
               ", ".join("y %d-%d (%d px, %.1f%% of main)"
                         % (b[0], b[1], b[2], 100.0 * b[2] / main[2]) for b in keep),
               max_share))
    return img, notes, warnings


def opaque_components(img):
    """Label 8-connected components of opaque pixels.

    Returns [(area, (x0, y0, x1, y1), [pixel indices]), ...]. 8-connected, not 4:
    in pixel art a diagonal staircase (a tail, a thin antenna) is one visual mass,
    and 4-connectivity would cut it into a pile of "specks".
    """
    w, h = img.size
    alpha = img.getchannel("A").tobytes()
    n = w * h
    seen = bytearray(n)
    comps = []
    for start in range(n):
        if not alpha[start] or seen[start]:
            continue
        seen[start] = 1
        stack = [start]
        members = []
        x0 = x1 = start % w
        y0 = y1 = start // w
        while stack:
            i = stack.pop()
            members.append(i)
            x, y = i % w, i // w
            if x < x0:
                x0 = x
            elif x > x1:
                x1 = x
            if y < y0:
                y0 = y
            elif y > y1:
                y1 = y
            for ny in range(max(0, y - 1), min(h, y + 2)):
                base = ny * w
                for nx in range(max(0, x - 1), min(w, x + 2)):
                    j = base + nx
                    if alpha[j] and not seen[j]:
                        seen[j] = 1
                        stack.append(j)
        comps.append((len(members), (x0, y0, x1, y1), members))
    return comps


def reject_specks(img, min_area):
    """Blank connected components far too small to be real content.

    Measured on a real portal.png: a 2px #FF4D6D watermark remnant sat 22px to the
    right of the sprite, snapped onto a palette color, and survived every other
    filter - it only inflated the alpha bbox, so the sprite was scaled down to make
    room for empty space. `min_area` is a fraction of the main (largest) component
    when < 1, an absolute pixel count when >= 1. Runs before the trim/bbox step.
    Returns (image, kept_component_count, notes).
    """
    comps = opaque_components(img)
    notes = []
    if len(comps) < 2:
        return img, len(comps), notes

    main = max(comps, key=lambda c: c[0])
    limit = min_area * main[0] if min_area < 1.0 else float(int(min_area))
    drop = [c for c in comps if c is not main and c[0] < limit]

    for area, box, _ in drop:
        notes.append("dropped speck component: %d px at bbox (%d,%d)-(%d,%d), %.2f%% of main"
                     " (%d px)" % (area, box[0], box[1], box[2], box[3],
                                   100.0 * area / main[0], main[0]))
    if drop:
        img = img.copy()
        px = list(img.getdata())
        for _, _, members in drop:
            for i in members:
                px[i] = (0, 0, 0, 0)
        img.putdata(px)
    return img, len(comps) - len(drop), notes


def column_groups(img, min_gap, min_width):
    """Split a sheet into groups of contiguous non-empty columns.

    Returns (groups, dropped, gaps) where groups/dropped are [x0, x1] inclusive
    ranges and gaps are (start, end) inclusive ranges of empty columns.
    """
    w, h = img.size
    alpha = img.getchannel("A").tobytes()
    counts = [0] * w
    for y in range(h):
        row = y * w
        for x in range(w):
            if alpha[row + x]:
                counts[x] += 1

    raw = []
    start = None
    for x in range(w):
        if counts[x]:
            if start is None:
                start = x
        elif start is not None:
            raw.append([start, x - 1])
            start = None
    if start is not None:
        raw.append([start, w - 1])

    # Merge groups separated by a gap smaller than min_gap (accidental splits).
    merged = []
    for grp in raw:
        if merged and grp[0] - merged[-1][1] - 1 < min_gap:
            merged[-1][1] = grp[1]
        else:
            merged.append(list(grp))

    groups, dropped = [], []
    for grp in merged:
        (groups if grp[1] - grp[0] + 1 >= min_width else dropped).append(grp)

    gaps = []
    for a, b in zip(groups, groups[1:]):
        gaps.append((a[1] + 1, b[0] - 1))
    return groups, dropped, gaps


def fit_nearest(img, target, pad=0):
    """Trim to the alpha bbox, nearest-neighbor downscale to fit, then center.

    Never upscales: a sprite smaller than the target is left at native size.
    `pad` only grows the canvas AFTER the fit, so it never changes the scale:
    --size 64x64 --pad 2 fits the sprite in 64x64 and saves a 68x68 file.
    """
    bbox = img.getbbox()
    if bbox is None:
        return None, None, None
    cropped = img.crop(bbox)
    tw, th = target
    cw, ch = cropped.size
    scale = min(tw / cw, th / ch, 1.0)
    nw = max(1, int(round(cw * scale)))
    nh = max(1, int(round(ch * scale)))
    if (nw, nh) != (cw, ch):
        cropped = cropped.resize((nw, nh), Image.NEAREST)
    canvas = Image.new("RGBA", (tw + 2 * pad, th + 2 * pad), (0, 0, 0, 0))
    canvas.paste(cropped, (pad + (tw - nw) // 2, pad + (th - nh) // 2))
    return canvas, (cw, ch), (nw, nh)


def cell_grid(size, cell, grid):
    """Split a sheet ARITHMETICALLY. Returns (cols, rows, cell_w, cell_h).

    Deliberately NOT column_groups(): that projects alpha and cuts where the ink
    happens to stop, so a frame whose sprite is narrower comes out a different
    width than its neighbours. For tiles and animation frames the CELL is the
    authority, not the ink. A sheet that does not divide evenly is an error, not
    something to trim away.
    """
    w, h = size
    if (cell is None) == (grid is None):
        fail("cells mode needs exactly one of --cell WxH (cell size in px) or\n"
             "  --grid COLSxROWS (how many cells). Got %s."
             % ("both" if cell else "neither"))

    if grid is not None:
        cols, rows = grid
        if w % cols or h % rows:
            fail("sheet is %dx%d, which does not divide into a %dx%d grid"
                 " (remainder %dx%d px).\n"
                 "  Refusing to silently drop the leftover strip. Re-crop the input"
                 " (--crop L,T,R,B)\n  or pick a grid that divides the sheet."
                 % (w, h, cols, rows, w % cols, h % rows))
        return cols, rows, w // cols, h // rows

    cw, ch = cell
    if w % cw or h % ch:
        fail("sheet is %dx%d, which is not a whole number of --cell %dx%d cells"
             " (remainder %dx%d px).\n"
             "  Refusing to silently drop the leftover strip. Re-crop the input"
             " (--crop L,T,R,B)\n  or pick a cell size that divides the sheet."
             % (w, h, cw, ch, w % cw, h % ch))
    return w // cw, h // ch, cw, ch


def extrude_edges(img, n):
    """Duplicate the outermost pixel row/column N px outward (tile edge bleed).

    The opposite of --pad: --pad surrounds the frame with TRANSPARENT margin,
    --extrude surrounds it with copies of its own border pixels. Sampling by
    clamping, so the corners get the corner pixel. Copies pixels verbatim, so
    alpha stays 0-or-255 and no new colors enter the palette.
    """
    w, h = img.size
    src = list(img.getdata())
    out = []
    for y in range(h + 2 * n):
        row = src[min(max(y - n, 0), h - 1) * w:][:w]
        out.extend([row[0]] * n)
        out.extend(row)
        out.extend([row[-1]] * n)
    res = Image.new("RGBA", (w + 2 * n, h + 2 * n))
    res.putdata(out)
    return res


def remap_palette(img, palette):
    """Snap every opaque pixel to the nearest palette color. Returns (img, hist)."""
    px = list(img.getdata())
    cache = {}
    hist = [0] * len(palette)
    out = []
    clear = 0
    for p in px:
        if p[3] == 0:
            out.append((0, 0, 0, 0))
            clear += 1
            continue
        key = p[:3]
        idx = cache.get(key)
        if idx is None:
            idx = min(range(len(palette)), key=lambda i: wdist2(key, palette[i]))
            cache[key] = idx
        hist[idx] += 1
        r, g, b = palette[idx]
        out.append((r, g, b, 255))
    res = Image.new("RGBA", img.size)
    res.putdata(out)
    return res, hist, clear


def format_hist(palette, hist, clear):
    total = sum(hist)
    lines = ["      transparent: %d px" % clear]
    order = sorted(range(len(palette)), key=lambda i: -hist[i])
    for i in order:
        if not hist[i]:
            continue
        r, g, b = palette[i]
        lines.append("      #%02X%02X%02X: %d px (%.1f%% of opaque)"
                     % (r, g, b, hist[i], 100.0 * hist[i] / total))
    unused = sum(1 for c in hist if c == 0)
    if unused:
        lines.append("      (%d palette colors unused)" % unused)
    return "\n".join(lines)


def load_prepared(args, palette):
    """Load the input and run key-out + alpha hardening + fringe rejection."""
    path = Path(args.input)
    if not path.is_file():
        fail("input image not found: %s" % path)
    try:
        src = Image.open(path)
        src_has_alpha = "A" in src.getbands()
        img = src.convert("RGBA")
    except Exception as exc:  # noqa: BLE001 - surface any decode failure
        fail("cannot read %s: %s" % (path, exc))
    print("input: %s (%dx%d)" % (path, img.size[0], img.size[1]))
    if args.crop:
        img = apply_crop(img, args.crop)
        print("  crop: %d,%d,%d,%d (right/bottom exclusive) -> %dx%d"
              % (args.crop + img.size))
    if args.bg == "none":
        print("  key-out: skipped (--bg none) - relying on existing alpha")
    else:
        img, note = key_out_background(img, args.fuzz, args.bg, src_has_alpha)
        print("  key-out: %s" % note)
    img = harden_alpha(img, args.alpha_cut)
    print("  alpha cut at %d: output alpha is 0 or 255 only" % args.alpha_cut)
    if isinstance(args.bg, tuple):
        img, dropped = reject_fringe(img, args.bg, palette)
        print("  fringe reject: %d px closer to %s than to any palette color removed"
              % (dropped, fmt_rgb(args.bg)))
    if args.mode == "cells":
        # The cell grid is the authority here, so the content-based rejectors are
        # not run at all: blanking a "too small" row band or component would
        # silently eat a small tile. There is no flag to turn them back on.
        print("  content-based rejectors (outlier row bands, speck components):"
              " not run in cells mode")
        return img
    if args.keep_outliers:
        print("  outlier row bands: kept (--keep-outliers)")
    else:
        img, notes, warnings = reject_outlier_rows(img, args.row_min_gap, args.outlier_max_share)
        for note in notes:
            print("  %s" % note)
        for msg in warnings:
            warn(msg)
    if args.keep_specks:
        print("  speck components: kept (--keep-specks)")
    else:
        img, kept, notes = reject_specks(img, args.min_area)
        for note in notes:
            print("  %s" % note)
        print("  speck filter: %d opaque component(s) kept (--min-area %s)"
              % (kept, fmt_min_area(args.min_area)))
        if args.mode == "single" and kept > 1:
            warn("%d opaque components remain above --min-area - 'single' mode expects"
                 " one sprite; check the input." % kept)
    return img


def resolve_targets(names, out_dir, force):
    """Map output names to paths, refusing existing files unless --force."""
    paths = []
    for name in names:
        p = out_dir / (name + ".png")
        if p.exists() and not force:
            fail("%s already exists (pass --force to overwrite)" % p)
        paths.append(p)
    return paths


def process(pieces, targets, args, palette):
    """Render every piece in memory first, then write - never a partial file set."""
    rendered = []
    for (label, xrange_, piece), target in zip(pieces, targets):
        fitted, trimmed, final = fit_nearest(piece, args.size, args.pad)
        if fitted is None:
            fail("%s: no opaque pixels left after key-out/alpha-cut" % label)
        fitted, hist, clear = remap_palette(fitted, palette)
        rendered.append((label, xrange_, trimmed, final, fitted, hist, clear, target))
    if args.pad:
        print("  pad: +%dpx transparent on all sides -> %dx%d"
              % (args.pad, args.size[0] + 2 * args.pad, args.size[1] + 2 * args.pad))

    # A matching group COUNT does not prove the slice is right: one eaten or
    # merged creature still counts as one group. Compare sizes to the median.
    warnings = variance_warnings([(r[0], r[1][1] - r[1][0] + 1, r[2][1]) for r in rendered])
    for msg in warnings:
        warn(msg)
    if warnings and args.strict:
        fail("%d size warning(s) with --strict - nothing written." % len(warnings))

    for label, xrange_, trimmed, final, fitted, hist, clear, target in rendered:
        print("  %s -> %s" % (label, target))
        print("      source x-range: %d-%d (%d px wide)"
              % (xrange_[0], xrange_[1], xrange_[1] - xrange_[0] + 1))
        print("      trimmed: %dx%d   final: %dx%d (canvas %dx%d)"
              % (trimmed[0], trimmed[1], final[0], final[1], args.size[0], args.size[1]))
        print(format_hist(palette, hist, clear))
        if args.dry_run:
            print("      DRY RUN - not written")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        fitted.save(target, "PNG", optimize=True)
        print("      written (%d bytes)" % target.stat().st_size)


def cmd_sheet(args, palette):
    names = [n.strip() for n in args.names.split(",") if n.strip()]
    if not names:
        fail("--names is empty")
    img = load_prepared(args, palette)
    groups, dropped, gaps = column_groups(img, args.min_gap, args.min_width)
    for grp in dropped:
        print("  ignored speck at x %d-%d (%d px < --min-width %d)"
              % (grp[0], grp[1], grp[1] - grp[0] + 1, args.min_width))
    print("  detected %d sprite group(s)" % len(groups))
    if len(groups) != len(names):
        sys.stderr.write(
            "error: slice detection found %d sprite group(s) but %d --names were given.\n"
            % (len(groups), len(names)))
        sys.stderr.write("  groups (x-range / width):\n")
        for i, grp in enumerate(groups):
            sys.stderr.write("    [%d] %d-%d  w=%d\n" % (i, grp[0], grp[1], grp[1] - grp[0] + 1))
        sys.stderr.write("  gaps between groups (x-range / width):\n")
        for a, b in gaps:
            sys.stderr.write("    %d-%d  w=%d\n" % (a, b, b - a + 1))
        sys.stderr.write("  names: %s\n" % ", ".join(names))
        sys.stderr.write(
            "  Not guessing an equal-width split. Raise --min-gap (now %d) to merge\n"
            "  accidental gaps inside one creature, raise --min-width (now %d) to drop\n"
            "  noise, or re-crop the input so the 6 creatures have clear empty columns.\n"
            % (args.min_gap, args.min_width))
        sys.exit(2)

    targets = resolve_targets(["entity-" + n for n in names], args.out_dir, args.force)
    h = img.size[1]
    pieces = [(names[i], (grp[0], grp[1]), img.crop((grp[0], 0, grp[1] + 1, h)))
              for i, grp in enumerate(groups)]
    process(pieces, targets, args, palette)


def cmd_single(args, palette):
    img = load_prepared(args, palette)
    targets = resolve_targets([args.name], args.out_dir, args.force)
    pieces = [(args.name, (0, img.size[0] - 1), img)]
    process(pieces, targets, args, palette)


def process_cells(pieces, targets, args, palette, out_size):
    """Render every cell in memory first, then write - never a partial file set.

    The cell IS the frame: no alpha trim, no per-piece bbox, no re-centering, and
    `out_size` is computed ONCE by the caller so every cell gets the identical
    scale factor. That is the whole point of this path - fit_nearest deliberately
    does the opposite (per-piece trim + per-piece scale), which is right for a row
    of loose creatures and wrong for a tile grid.
    """
    rendered = []
    for (label, rc, cell), target in zip(pieces, targets):
        piece = cell if cell.size == out_size else cell.resize(out_size, Image.NEAREST)
        if args.extrude:
            piece = extrude_edges(piece, args.extrude)
        elif args.pad:
            canvas = Image.new("RGBA", (out_size[0] + 2 * args.pad, out_size[1] + 2 * args.pad),
                               (0, 0, 0, 0))
            canvas.paste(piece, (args.pad, args.pad))
            piece = canvas
        piece, hist, clear = remap_palette(piece, palette)
        rendered.append((label, rc, piece, hist, clear, target))

    fw, fh = rendered[0][2].size
    if args.extrude:
        print("  extrude: +%dpx edge bleed on all sides -> %dx%d (outermost row/column"
              " duplicated outward)" % (args.extrude, fw, fh))
    elif args.pad:
        print("  pad: +%dpx transparent on all sides -> %dx%d" % (args.pad, fw, fh))

    blank = [r[0] for r in rendered if r[4] == fw * fh]
    if blank:
        warn("%d of %d cell(s) are fully transparent: %s.\n"
             "  Either the grid does not line up with the sheet, or the sheet really has\n"
             "  blank cells. The cell grid is arithmetic, so nothing here re-aligns it."
             % (len(blank), len(rendered), ", ".join(blank)))
        if args.strict:
            fail("%d blank cell(s) with --strict - nothing written." % len(blank))

    for label, rc, piece, hist, clear, target in rendered:
        print("  %s -> %s" % (label, target))
        print("      cell row %d col %d: %dx%d -> %dx%d (file %dx%d)"
              % (rc[0], rc[1], rc[2], rc[3], out_size[0], out_size[1], fw, fh))
        print(format_hist(palette, hist, clear))
        if args.dry_run:
            print("      DRY RUN - not written")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        piece.save(target, "PNG", optimize=True)
        print("      written (%d bytes)" % target.stat().st_size)


def cmd_cells(args, palette):
    img = load_prepared(args, palette)
    cols, rows, cw, ch = cell_grid(img.size, args.cell, args.grid)
    print("  grid: %d col(s) x %d row(s) of %dx%d px - arithmetic split, no alpha projection"
          % (cols, rows, cw, ch))

    # ONE scale for the whole sheet. Every cell is the same size by construction,
    # so this is the same number for all of them - stated here rather than left
    # to coincidence. Still never upscales (the min(..., 1.0)).
    if args.size:
        scale = min(args.size[0] / cw, args.size[1] / ch, 1.0)
    else:
        scale = 1.0
    out_size = (max(1, int(round(cw * scale))), max(1, int(round(ch * scale))))
    print("  scale: x%g for EVERY cell -> %dx%d (one factor for the whole sheet, never upscaled)"
          % (scale, out_size[0], out_size[1]))

    n = cols * rows
    digits = max(2, len(str(n - 1)))
    names = ["%s-%0*d" % (args.name, digits, i) for i in range(n)]
    targets = resolve_targets(names, args.out_dir, args.force)
    pieces = []
    for i, name in enumerate(names):
        r, c = divmod(i, cols)
        pieces.append((name, (r, c, cw, ch),
                       img.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))))
    process_cells(pieces, targets, args, palette, out_size)


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="spritify.py",
        description="Convert AI-generated pixel-art drafts into palette-exact sprites.")
    sub = parser.add_subparsers(dest="mode", required=True)

    def common(p, default_size, rejectors=True):
        p.add_argument("input")
        if default_size is None:  # cells mode: the cell decides, --size only caps it
            p.add_argument("--size", default=None,
                           help="64 or 128x72: an upper bound on ONE cell. Omit it to keep the "
                                "cells at native size (1:1)")
        else:
            p.add_argument("--size", default=default_size,
                           help="64 or 128x72 (default %s)" % default_size)
        p.add_argument("--palette", default=str(DEFAULT_PALETTE))
        p.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
        p.add_argument("--bg", default=DEFAULT_BG,
                       help="expected background: a hex color (default %s, the chroma key the "
                            "generation prompt asks for), 'auto' to sample the corners, or "
                            "'none' to keep the existing alpha" % DEFAULT_BG)
        p.add_argument("--fuzz", type=float, default=0.12,
                       help="background match tolerance, fraction of the RGB distance range")
        p.add_argument("--alpha-cut", type=int, default=128,
                       help="alpha below this becomes transparent, the rest becomes 255")
        p.add_argument("--crop", help="cut the input to L,T,R,B (pixel box, right/bottom "
                                      "exclusive) before anything else - the escape hatch "
                                      "for a watermark the heuristics miss")
        if rejectors:  # off for cells mode, which never runs the content-based rejectors
            p.add_argument("--row-min-gap", type=int, default=16,
                           help="empty-row runs narrower than this do not split a row band")
            p.add_argument("--outlier-max-share", type=float, default=0.02,
                           help="row bands holding less than this fraction of the main band's "
                                "opaque pixels are dropped as generator noise")
            p.add_argument("--keep-outliers", action="store_true",
                           help="never drop outlier row bands (keeps generator watermarks in)")
            p.add_argument("--min-area", type=float, default=0.01,
                           help="drop 8-connected opaque components smaller than this, before "
                                "the trim/bbox step. Below 1 it is a fraction of the largest "
                                "component (default 0.01 = 1%%); 1 or more is an absolute pixel "
                                "count")
            p.add_argument("--keep-specks", action="store_true",
                           help="never drop small components (keeps watermark remnants in)")
        p.add_argument("--pad", type=int, default=0,
                       help="add N fully transparent pixels on all four sides AFTER the fit; "
                            "does not change the scale, so --size 64x64 --pad 2 writes a "
                            "68x68 file. Bleed room for CSS image-rendering: pixelated")
        p.add_argument("--strict", action="store_true",
                       help="treat sprite-size variance warnings as an error (exit non-zero)")
        p.add_argument("--dry-run", action="store_true")
        p.add_argument("--force", action="store_true")

    p_sheet = sub.add_parser("sheet", help="one horizontal row of sprites")
    common(p_sheet, "64")
    p_sheet.add_argument("--names", required=True,
                         help="comma-separated names, written as entity-<name>.png")
    p_sheet.add_argument("--min-gap", type=int, default=4,
                         help="empty-column runs narrower than this do not split a sprite")
    p_sheet.add_argument("--min-width", type=int, default=8,
                         help="groups narrower than this are dropped as noise")

    p_single = sub.add_parser("single", help="one centered subject")
    common(p_single, "64")
    p_single.add_argument("--name", required=True, help="written as <name>.png")

    p_cells = sub.add_parser("cells", help="a fixed grid of equal cells (tiles, animation frames)")
    # rejectors=False: the cell grid is the authority here, so the content-based
    # rejectors never run and their five options are not offered at all (rather
    # than accepted and ignored).
    common(p_cells, None, rejectors=False)
    p_cells.add_argument("--name", required=True,
                         help="written as <name>-00.png, <name>-01.png, ... row-major")
    p_cells.add_argument("--cell", help="cell size in px, e.g. 32x32. The sheet must divide "
                                        "evenly by it or the run fails")
    p_cells.add_argument("--grid", help="how many cells, e.g. 4x2 (COLSxROWS). The sheet must "
                                        "divide evenly by it or the run fails")
    p_cells.add_argument("--extrude", type=int, default=0,
                         help="duplicate the outermost pixel row/column N px outward (tile "
                              "edge bleed). Mutually exclusive with --pad, which adds "
                              "TRANSPARENT margin instead")

    args = parser.parse_args(argv)
    if args.size is not None:
        args.size = parse_size(args.size)
    args.out_dir = Path(args.out_dir)
    args.bg = parse_bg(args.bg)
    if not 0.0 <= args.fuzz <= 1.0:
        fail("--fuzz must be between 0 and 1")
    if not 1 <= args.alpha_cut <= 255:
        fail("--alpha-cut must be between 1 and 255")
    if args.mode != "cells":  # cells mode does not have the rejector options
        if not 0.0 <= args.outlier_max_share <= 1.0:
            fail("--outlier-max-share must be between 0 and 1")
        if args.min_area < 0.0:
            fail("--min-area must not be negative")
    if args.pad < 0:
        fail("--pad must not be negative")
    if args.mode == "cells":
        if args.extrude < 0:
            fail("--extrude must not be negative")
        if args.pad and args.extrude:
            fail("--pad and --extrude are mutually exclusive.\n"
                 "  --pad %d adds TRANSPARENT margin (bleed room for a lone sprite);\n"
                 "  --extrude %d copies the border pixels outward (bleed for a tile that\n"
                 "  sits flush against its neighbours). Doing both is never what you want."
                 % (args.pad, args.extrude))
        args.cell = parse_size(args.cell, "--cell") if args.cell else None
        args.grid = parse_size(args.grid, "--grid") if args.grid else None
    if args.crop:
        args.crop = parse_crop(args.crop)
    palette = read_palette(Path(args.palette))
    print("palette: %s (%d colors)" % (args.palette, len(palette)))
    if isinstance(args.bg, tuple):
        check_bg_vs_palette(args.bg, palette)

    if args.mode == "sheet":
        cmd_sheet(args, palette)
    elif args.mode == "cells":
        cmd_cells(args, palette)
    else:
        cmd_single(args, palette)
    return 0


if __name__ == "__main__":
    sys.exit(main())
