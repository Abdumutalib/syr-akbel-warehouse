import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        
        # Site gate cookie ni qo'shamiz
        await context.add_cookies([{
            'name': 'warehouse_site_gate',
            'value': 'akbel-open',
            'domain': '127.0.0.1',
            'path': '/'
        }])

        page = await context.new_page()
        
        page.on("console", lambda msg: print(f"Browser console: {msg.type}: {msg.text}"))
        page.on("pageerror", lambda err: print(f"Browser error: {err}"))

        await page.goto('http://127.0.0.1:8787/warehouse/customers')
        
        # LocalStorage ni o'rnatamiz (balki token keraksizdir, lekn auth-pin error bermasligi uchun)
        await page.evaluate("""() => {
            localStorage.setItem('warehouse-access-token', 'test-token');
        }""")
        
        # Endi to'g'ri sahifaga o'tamiz
        await page.goto('http://127.0.0.1:8787/warehouse/customers')
        await page.wait_for_timeout(2000)

        buttons = await page.locator('button[title="Xaritadan tanlash"]').all()
        if buttons:
            print(f"Tugmalar soni: {len(buttons)}")
            await buttons[0].click()
            print("Map tugmasi bosildi!")
            await page.wait_for_timeout(2000)
            await page.screenshot(path='map_screenshot.png')
        else:
            print("Map tugmasi topilmadi!")
            await page.screenshot(path='map_error_screenshot.png')

        await browser.close()

asyncio.run(main())
