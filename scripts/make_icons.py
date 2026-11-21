"""Draws the app mark (a great helm whose face plate is the letters F and A)
and writes icons/icon.svg plus the PNG sizes the manifest and iOS need.
Needs Pillow: python scripts/make_icons.py"""
import os
from PIL import Image, ImageDraw

BG, STEEL, SHADE, FACE, MULBERRY = "#0b0d10", "#eef1f5", "#aab2bd", "#0b0d10", "#d24a93"

def quad(p0, c, p1, n=24):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]) for t in (i / n for i in range(n + 1))]

def mirror(right):
    """Closed outline from its right half (top to bottom, x >= 256)."""
    return right + [(512 - x, y) for x, y in reversed(right) if x != 256]

# Angular helm: peaked skull, straight sides, cheek guards flaring out to a
# point before they cut in to the chin.
OUTER = mirror([(256, 44), (306, 84), (396, 124), (410, 262), (456, 306), (402, 384), (326, 446), (256, 490)])
# Face opening: a brow that peaks at the centre ridge, pointed chin.
FACE_PLATE = mirror([(256, 150), (378, 188), (388, 300), (360, 370), (256, 440)])
CREST = [(238, 78), (256, 10), (274, 78)]
# Letter strokes inside the face plate. The top strokes slope up to the centre
# ridge like a visor brow; the middle strokes line up as the eye slit.
F = [[(150, 216), (234, 190), (234, 216), (150, 242)],          # top arm
     [(150, 216), (176, 216), (176, 372), (150, 352)]]          # stem
A = [[(278, 190), (362, 216), (362, 242), (278, 216)],          # top bar
     [(278, 204), (304, 212), (304, 372), (278, 384)],          # left leg
     [(336, 226), (362, 234), (362, 352), (336, 372)]]          # right leg
# Eye slit: slopes down to the ridge (a scowl), doubling as F's arm and A's bar.
SLIT = [[(176, 262), (246, 278), (246, 302), (176, 286)],
        [(266, 278), (336, 262), (336, 286), (266, 302)]]
RIDGE = [(246, 52), (266, 52), (266, 480), (256, 490), (246, 480)]
SHADOW = [p for p in OUTER if p[0] >= 256]                        # right half, for a forged two-tone

def layers():
    yield OUTER, STEEL
    yield SHADOW, SHADE
    yield FACE_PLATE, FACE
    for poly in F + A:
        yield poly, STEEL
    for poly in SLIT:
        yield poly, MULBERRY
    yield RIDGE, STEEL
    yield CREST, MULBERRY

def svg(background):
    pts = lambda poly: " ".join(f"{x:.1f},{y:.1f}" for x, y in poly)
    body = "".join(f'<polygon points="{pts(p)}" fill="{c}"/>' for p, c in layers())
    bg = f'<rect width="512" height="512" fill="{BG}"/>' if background else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{bg}{body}</svg>\n'

def png(size, scale=1.0):
    """scale < 1 shrinks the mark toward the centre (maskable icons crop the edges)."""
    s = 4 * size / 512
    img = Image.new("RGB", (4 * size, 4 * size), BG)
    draw = ImageDraw.Draw(img)
    for poly, colour in layers():
        draw.polygon([((256 + (x - 256) * scale) * s, (256 + (y - 256) * scale) * s) for x, y in poly], fill=colour)
    return img.resize((size, size), Image.LANCZOS)

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "..", "icons")
    open(os.path.join(out, "icon.svg"), "w", newline="\n").write(svg(True))
    open(os.path.join(out, "mark.svg"), "w", newline="\n").write(svg(False))
    png(192, 0.82).save(os.path.join(out, "icon-192.png"))
    png(512, 0.82).save(os.path.join(out, "icon-512.png"))
    png(180, 0.82).save(os.path.join(out, "apple-touch-icon.png"))
