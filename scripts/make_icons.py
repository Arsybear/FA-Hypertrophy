"""Draws the app mark (an angular knight's helmet, black and white, with the
letters FAR cut across its visor and its right eye burning in mulberry) and
writes icons/icon.svg, icons/mark.svg and the PNG sizes the manifest and iOS
need. The PNGs are the SVG rendered by headless Chrome or Edge (the mark is
polygons, strokes and the flame's curves): python scripts/make_icons.py"""
import os
import pathlib
import shutil
import struct
import subprocess
import sys
import tempfile

BG, W, K = "#0b0d10", "#f1f3f6", "#0b0d10"
DARK, MAIN, SOFT, HOT, WHITE = "#7c2457", "#b93a80", "#e57ab4", "#ffd3ea", "#fff7fb"   # the flame, rim to centre


def sym(right):
    """A closed path symmetric about x=256 from its right half, top to bottom
    (the first and last points lie on the centre line)."""
    pts = right + [(512 - x, y) for x, y in reversed(right[1:-1])]
    return "M" + " L".join(f"{x:g},{y:g}" for x, y in pts) + " Z"


def poly(pts):
    return "M" + " L".join(f"{x:g},{y:g}" for x, y in pts) + " Z"


# ---- shell: straight facets only, a broad dome and a chin point ------------
# The skull is a broad dome of a few facets with a low crest point: a sharp
# crest over straight sides made the whole mark read as a gem, not a helmet.
# The visor, drawn over it, is one plate: from the brow, a V that dips toward
# the nose so the helmet frowns, past the temples (the widest part), in a
# little toward the jaw and down to the chin point, the lowest point of the
# mark. Nothing below the chin (the earlier mark's neck plates read as a
# collar).
SKULL = sym([(256, 30), (314, 56), (360, 102), (390, 160), (402, 200), (406, 246), (396, 330), (320, 420), (256, 420)])
VISOR = sym([(256, 222), (394, 174), (402, 200), (406, 246), (394, 368), (318, 432), (256, 482)])
KEEL = "M256,40 L261,218 L251,218 Z"
FACETS = ["M314,56 L350,188", "M198,56 L162,188"]           # the front planes of the dome
JAW = ["M130.5,386 L256,414 L381.5,386"]                     # the jaw plate's edge, a V like the brow's
RIVETS = [(391, 236), (121, 236)]                            # the visor's pivots: they say helmet, not mask
# The centre seam: from the brow's dip into the A's flat top, and from under
# the A to the chin point, so the seam runs through the A and splits it.
RIDGES = ["M252,224 L260,224 L261,272 L251,272 Z", "M256,478 L251,418 L261,418 Z"]

# ---- face: the sight and the letters F A R ---------------------------------
# The sight is one dark V under the brow, the gap between skull and visor:
# tall at the temples, lower at the nose, so the helmet glares. Two separate
# eye wedges read as a mask. The letters are 21 wide with square ends,
# 94 tall: F and the R's stem and bowl are strokes, the A (flat-topped, its
# counter cut out, on the seam) and the R's leg are filled so their feet sit
# flat on the line. The A's bar is low (without one it reads as a lambda); the
# R's bowl is open and its leg starts at the bowl.
EYES = [sym([(256, 224), (392, 177), (382, 211), (256, 243)])]
# The A is on the seam and the R is wider than the F, so the F stands a little
# further from the A: the word then sits evenly between the helmet's flanks.
LETTERS_AT = "translate(0 5)"
STROKES = ["M206,276.5 L156.5,276.5 L156.5,360", "M156.5,312.5 L196,312.5",                        # F
           "M320.5,360 L320.5,276.5 L345,276.5 L356,287.5 L356,303.5 L345,314.5 L320.5,314.5"]     # R, stem and bowl
FILLS = [poly([(251, 266), (261, 266), (298, 360), (275.43, 360), (270.32, 347), (241.68, 347), (236.57, 360), (214, 360)])
         + " " + poly([(256, 310.63), (263.23, 329), (248.77, 329)]),                              # A and its counter
         poly([(335, 314.5), (357, 314.5), (375, 360), (353, 360)])]                               # R, leg

# ---- the burning right eye: the flame of the earlier, rounded mark ---------
# The glow is so hot that it replaces the eye: a ragged flame that starts in
# the right half of the sight, follows its slant, trails outward and up and
# ends past the helmet's outline, with two ember slivers beyond the tip. It is
# the one curved thing in the mark, fire against hard steel. FLAME is the
# body's outline; the dark and the mulberry rim are FLAME stroked outward,
# CORE lies about 3.5 inside it, CENTRE is the near-white heart at the root.
# FLAME_AT places all of it at once: the root (275, 246.5) goes into the sight
# a little out from the seam, so dark shows inboard of it, and the rims scale
# with it.
FLAME = ("M275,246.5 C281,237 291,232 303,231.6 C313,231.3 322,230.5 329,227 C335,224 340,219 343,212.5 "
         "C343.6,219 346,223.5 351.5,225 C361,223.5 370,216 375,205 C375.6,211.5 378,215.5 383,216.5 "
         "C392,214.5 400,207 405,196 C403,207 396,218 386,225.5 C376,232.5 364,238.5 350,243 "
         "C340,251.5 325,257.6 308,257.8 C294,258 282,253.5 275,246.5 Z")
CORE = ("M284,246.4 C289,240.5 296,236 304,235.7 C314,235.4 323,234.4 329.5,231.2 C335,228.4 339,224.5 341.8,219.5 "
        "C343,224 346,227.5 351.5,228.8 C360,227.8 367.5,222 372.5,213.5 C373.8,217.6 377,220 382.5,220.3 "
        "C389,219.3 395,214.5 399.5,207.5 C397.5,213 392,219 385,223.5 C375,230.5 362,236.5 349,239.5 "
        "C339,247 324,253.8 308,254 C297,254.1 289.5,251.2 284,246.4 Z")
CENTRE = "M292,246.2 C297,241.6 304,239.3 313,239.4 C322,239.5 330,240 337,241.6 C330,247 319,250.4 308,250.5 C301,250.6 296,249 292,246.2 Z"
EMBERS = ["M410,190.5 C411.5,187.4 414.4,185.3 417.6,184.8 C416,187.9 413.6,190.5 410,190.5 Z",
          "M420.5,180.5 C421.4,178.8 423,177.7 424.8,177.5 C423.9,179.2 422.5,180.4 420.5,180.5 Z"]
FLAME_AT = "translate(308 220) rotate(4) scale(0.92) translate(-275 -246.5)"


def paths(ds, attrs):
    return f"<g {attrs}>" + "".join(f'<path d="{d}"/>' for d in ds) + "</g>"


def mark():
    plate = 'stroke-width="7.5" stroke-linejoin="miter" stroke-miterlimit="6"'
    rim = lambda colour, body, ember: (paths([FLAME], f'fill="{colour}" stroke="{colour}" stroke-width="{body}" stroke-linejoin="round"')
                                       + paths(EMBERS, f'fill="{colour}" stroke="{colour}" stroke-width="{ember}" stroke-linejoin="round"'))
    return '<g transform="translate(-4 0)">' + "".join([   # left a little, to balance the flame on the right
        paths([SKULL, VISOR], f'fill="{K}" stroke="{K}" stroke-width="16" stroke-linejoin="miter" stroke-miterlimit="3"'),   # the outer contour
        paths([SKULL], f'fill="{W}" stroke="{K}" {plate}'),
        paths([KEEL], f'fill="{K}"'),
        paths(FACETS, f'fill="none" stroke="{K}" stroke-width="7"'),
        paths([VISOR], f'fill="{W}" stroke="{K}" {plate}'),
        paths(JAW, f'fill="none" stroke="{K}" stroke-width="7"'),
        paths(RIDGES + EYES, f'fill="{K}"'),
        "".join(f'<circle cx="{x}" cy="{y}" r="7" fill="{K}"/>' for x, y in RIVETS),
        f'<g transform="{LETTERS_AT}">',
        paths(STROKES, f'fill="none" stroke="{K}" stroke-width="21" stroke-linejoin="miter" stroke-miterlimit="4"'),
        paths(FILLS, f'fill="{K}" fill-rule="evenodd"'),
        "</g>",
        f'<g transform="{FLAME_AT}">',
        rim(DARK, 10, 5), rim(MAIN, 5, 2.4),
        paths([FLAME] + EMBERS, f'fill="{SOFT}"'), paths([CORE], f'fill="{HOT}"'), paths([CENTRE], f'fill="{WHITE}"'),
        "</g>",
    ]) + "</g>"


def svg(background, scale=1.0):
    """scale < 1 shrinks the mark toward the centre (maskable icons crop the edges)."""
    body = mark() if scale == 1 else f'<g transform="translate(256 256) scale({scale}) translate(-256 -256)">{mark()}</g>'
    bg = f'<rect width="512" height="512" fill="{BG}"/>' if background else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{bg}{body}</svg>\n'


def browser():
    found = [os.environ.get("CHROME")] + [shutil.which(n) for n in ("chrome", "google-chrome", "chromium", "msedge")] + [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    for path in found:
        if path and os.path.exists(path):
            return path
    sys.exit("make_icons.py: no Chrome or Edge found; set CHROME to the browser's path")


def png(path, size, scale):
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as work:
        page = os.path.join(work, "icon.html")
        with open(page, "w", encoding="utf8") as f:
            f.write(f"<!doctype html><style>html,body{{margin:0;overflow:hidden;background:{BG}}}"
                    f"svg{{display:block;width:{size}px;height:{size}px}}</style>{svg(True, scale)}")
        subprocess.run([browser(), "--headless=new", f"--user-data-dir={os.path.join(work, 'profile')}", "--no-first-run",
                        "--hide-scrollbars", "--force-device-scale-factor=1", f"--window-size={size},{size}",
                        f"--screenshot={path}", pathlib.Path(page).as_uri()],
                       check=True, timeout=120, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n" or struct.unpack(">II", head[16:24]) != (size, size):
        sys.exit(f"make_icons.py: {path} is not a {size} x {size} PNG")


if __name__ == "__main__":
    out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "icons"))
    open(os.path.join(out, "icon.svg"), "w", newline="\n").write(svg(True))
    open(os.path.join(out, "mark.svg"), "w", newline="\n").write(svg(False))
    png(os.path.join(out, "icon-192.png"), 192, 0.82)
    png(os.path.join(out, "icon-512.png"), 512, 0.82)
    png(os.path.join(out, "apple-touch-icon.png"), 180, 0.82)
