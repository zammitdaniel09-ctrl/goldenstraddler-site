"""Builds web/og.png (the link preview image) from og.html with Chromium via Playwright."""
import asyncio, os
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--allow-file-access-from-files'])
        pg = await b.new_page(viewport={'width': 1200, 'height': 630})
        await pg.goto('file://' + os.path.join(HERE, 'og.html')); await pg.wait_for_timeout(800)
        await pg.screenshot(path=os.path.join(HERE, '..', '..', 'web', 'og.png'), clip={'x': 0, 'y': 0, 'width': 1200, 'height': 630})
        await b.close()
    print('wrote web/og.png')
asyncio.run(main())
