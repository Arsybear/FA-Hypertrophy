"""Draws the app mark (a knight's helmet whose visor grill is the letters FAR,
black and white, its right eye burning in mulberry) and writes icons/icon.svg,
icons/mark.svg and the PNG sizes the manifest and iOS need. The PNGs are the
SVG rendered by headless Chrome or Edge (the mark is curves and strokes):
python scripts/make_icons.py"""
import os
import pathlib
import shutil
import struct
import subprocess
import sys
import tempfile

BG, W, K = "#0b0d10", "#f1f3f6", "#0b0d10"
DARK, MAIN, SOFT, HOT, WHITE = "#7c2457", "#b93a80", "#e57ab4", "#ffd3ea", "#fff7fb"   # the flame, rim to centre

# ---- shell: the skull and the visor, nothing below the chin ----------------
# The shapes are drawn in their own coordinates (outline y 37..436) and HELMET
# centres them in the box and enlarges them by 1.215, as far as a circle of
# radius 244 around the centre allows (the maskable icon's safe zone at the
# PNGs' scale 0.82): the crest and the chin point end at radius 243.
HELMET = "translate(256 256) scale(1.215) translate(-256 -236.5)"
SKULL = "M256,48 C246,58 216,70 186,82 C144,100 129,140 130,212 C132,262 136,320 150,356 C172,392 212,414 256,428 C300,414 340,392 362,356 C376,320 380,262 382,212 C383,140 368,100 326,82 C296,70 266,58 256,48 Z"
VISOR = "M256,168 C206,176 156,190 128,212 C122,220 116,230 116,242 C116,300 156,372 256,420 C356,372 396,300 396,242 C396,230 390,220 384,212 C356,190 306,176 256,168 Z"
KEEL = "M256,56 L261.5,172 L250.5,172 Z"
# centre ridge, outside the letter field only: from the visor's top into the
# slit's dip, and from under the grill to the chin point
RIDGES = ["M256,168 L259.5,239.6 L252.5,239.6 Z", "M256,418 L252,378 L260,378 Z"]
RIVETS = [(135, 244), (377, 244)]

# ---- face: the eye slit and the grill, whose slots are the letters F A R ---
# Drawn in its own coordinates and placed in the visor by FACE (slit 153..359,
# clear of the rivets; its top corners on y 232). The grill is cut in the
# first mark's manner: round-ended slots 12 wide that hang from one line
# (y 285) under the slit, on columns 21.6 apart mirrored about the centre
# seam, each foot on one curve 23 inside the visor's chin edge and none
# lower than y 376. Left to right: a short bar, the F's stem, the bar under
# the F's arms, a tall plain bar, the A (its point on the seam, its feet 19
# to either side), a tall plain bar, the R's stem, the R's leg under its
# bowl, a short bar. The letters are slots among plain slots, not a word set
# on the plate; the price is that a reader with no brief can take the tall
# plain bars for the letter I ("FIAIR"). In this helmet (HELMET enlarges it
# by 1.215) a pitch of 21.6 and a width of 12 are about the first mark's 26
# and 14 in pixels.
FACE = "translate(20.48 17.732) scale(0.92)"
SLIT = "M144,242.7 L178,232.9 L256,239 L334,232.9 L368,242.7 L334,257.9 L256,264 L178,257.9 Z"
SLOTS = ["M148,285 L148,315.9",                                                # a short bar, outside the F
         "M169.6,345.9 L169.6,285 L191.2,285", "M169.6,310 L188,310",          # F
         "M191.2,331.5 L191.2,367.7",                                          # the bar under the F's arms
         "M212.8,285 L212.8,376",                                              # a tall plain bar
         "M237,376 L256,285 L275,376",                                         # A, on the seam
         "M299.2,285 L299.2,376",                                              # a tall plain bar
         "M320.8,367.7 L320.8,285 L329.9,285 A12.5,12.5 0 0 1 329.9,310 L320.8,310",   # R: stem and bowl
         "M331.6,310 L345.4,342.3",                                            # R: the leg
         "M364,285 L364,315.9"]                                                # a short bar, outside the R
A_BAR = "M244.6,339.6 L267.4,339.6 L269.5,349.6 L242.5,349.6 Z"   # low, or the A reads as a lambda

# ---- the burning right eye (helmet coordinates, drawn over the face) -------
# Inside HELMET, so it moves and scales with the slit it sits in.
# The glow is so hot that it replaces the eye: a near-white centre in the
# slit, and a ragged flame that trails outward, clears the right rivet and
# ends past the helmet's outline. FLAME is the body's outline; the dark and
# the mulberry rim are FLAME stroked outward, CORE lies about 3.5 inside it.
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


def paths(ds, attrs):
    return f"<g {attrs}>" + "".join(f'<path d="{d}"/>' for d in ds) + "</g>"


def mark():
    plate = 'stroke-width="7.5" stroke-linejoin="miter" stroke-miterlimit="6"'
    rim = lambda colour, body, ember: (paths([FLAME], f'fill="{colour}" stroke="{colour}" stroke-width="{body}" stroke-linejoin="round"')
                                       + paths(EMBERS, f'fill="{colour}" stroke="{colour}" stroke-width="{ember}" stroke-linejoin="round"'))
    return "".join([
        f'<g transform="{HELMET}">',
        paths([SKULL, VISOR], f'fill="{K}" stroke="{K}" stroke-width="16" stroke-linejoin="miter" stroke-miterlimit="3"'),   # the outer contour
        paths([SKULL], f'fill="{W}" stroke="{K}" {plate}'),
        paths([KEEL], f'fill="{K}"'),
        paths([VISOR], f'fill="{W}" stroke="{K}" {plate}'),
        paths(RIDGES, f'fill="{K}"'),
        "".join(f'<circle cx="{x}" cy="{y}" r="7" fill="{K}"/>' for x, y in RIVETS),
        f'<g transform="{FACE}">',
        paths([SLIT, A_BAR], f'fill="{K}"'),
        paths(SLOTS, f'fill="none" stroke="{K}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"'),
        "</g>",
        rim(DARK, 10, 5), rim(MAIN, 5, 2.4),
        paths([FLAME] + EMBERS, f'fill="{SOFT}"'), paths([CORE], f'fill="{HOT}"'), paths([CENTRE], f'fill="{WHITE}"'),
        "</g>",
    ])


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
