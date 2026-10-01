"""Builds web/dl/GoldenStraddler-Guide.pdf from cover.html + guide.html (Chromium via Playwright)."""
import asyncio, io, os, sys
from playwright.async_api import async_playwright
from pypdf import PdfReader, PdfWriter
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, '..', '..', 'web', 'dl', 'GoldenStraddler-Guide.pdf')
VERSION = sys.argv[1] if len(sys.argv) > 1 else '3.00'
FOOT = '''<div style="width:100%;font:7.5pt 'JetBrains Mono',monospace;color:#8a93a0;padding:0 20mm;display:flex;justify-content:space-between">
<span>GoldenStraddler user guide</span><span><span class="pageNumber"></span></span></div>'''
async def main():
    cover = open(os.path.join(HERE, 'cover.html')).read().replace('VERSION', VERSION)
    chart = open(os.path.join(HERE, 'cover_chart.svg')).read().replace('width="600" height="470"', 'preserveAspectRatio="xMidYMid meet"')
    tmp = os.path.join(HERE, '_cover.html'); open(tmp, 'w').write(cover.replace('CHART', chart))
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--allow-file-access-from-files'])
        pg = await b.new_page(); await pg.goto('file://' + tmp); await pg.wait_for_timeout(600)
        c = await pg.pdf(format='A4', print_background=True, margin={'top': '0', 'right': '0', 'bottom': '0', 'left': '0'})
        pg = await b.new_page(); await pg.goto('file://' + os.path.join(HERE, 'guide.html')); await pg.wait_for_timeout(800)
        g = await pg.pdf(format='A4', print_background=True, display_header_footer=True, header_template='<span></span>', footer_template=FOOT,
                         margin={'top': '20mm', 'right': '20mm', 'bottom': '20mm', 'left': '20mm'})
        await b.close()
    os.remove(tmp)
    w = PdfWriter()
    for page in PdfReader(io.BytesIO(c)).pages[:1]: w.add_page(page)
    for page in PdfReader(io.BytesIO(g)).pages: w.add_page(page)
    w.add_metadata({'/Title': 'GoldenStraddler user guide', '/Author': 'GoldenStraddler', '/Subject': 'Install and run the GoldenStraddler EA on MetaTrader 5'})
    with open(OUT, 'wb') as f: w.write(f)
    print('wrote', OUT, len(w.pages), 'pages')
asyncio.run(main())
