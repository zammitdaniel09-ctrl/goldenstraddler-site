"""Writes web/favicon.svg: the GS mark with the letters as outlines, so it renders without web fonts."""
import sys, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
F = sys.argv[1]
def glyph(path, ch):
    f = TTFont(path); gs = f.getGlyphSet(); name = f.getBestCmap()[ord(ch)]
    pen = SVGPathPen(gs); gs[name].draw(pen); bp = BoundsPen(gs); gs[name].draw(bp)
    return pen.getCommands(), bp.bounds, f['head'].unitsPerEm, gs[name].width
def place(cmd, bounds, upm, size, cx, baseline):
    s = size / upm; x0, y0, x1, y1 = bounds; w = (x1 - x0) * s
    tx = cx - w / 2 - x0 * s
    return f'<path transform="translate({tx:.2f} {baseline:.2f}) scale({s:.5f} {-s:.5f})" d="{cmd}"/>'
g = glyph(F + '/fontsource-unbounded-5.3.0/package/files/unbounded-latin-800-normal.woff', 'G')
sg = glyph(F + '/fontsource-sedgwick-ave-5.3.0/package/files/sedgwick-ave-latin-400-normal.woff', 'S')
def svg(bg=True, r=16):
    box = f'<rect x="1" y="1" width="62" height="62" rx="{r}" fill="#0E1116" stroke="#2e3644" stroke-width="2"/>' if bg else ''
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' + box +
            f'<g fill="#fff">{place(*g[:3], 30, 25, 44)}</g><g fill="#3FC4FC">{place(*sg[:3], 36, 42, 49)}</g></svg>')
open(sys.argv[2], 'w').write(svg())
print('ok', len(svg()))
