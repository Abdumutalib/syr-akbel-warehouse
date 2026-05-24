import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        await page.goto("http://127.0.0.1:8787/warehouse/seller/sale/cash")
        
        # Wait a bit for JS to load
        await asyncio.sleep(2)
        
        # Print status to understand if we need PIN
        auth_title = await page.locator("#authTitle").inner_text() if await page.locator("#authTitle").is_visible() else "None"
        print("Auth Title:", auth_title)
        
        if await page.locator("#username").is_visible():
            await page.fill("#username", "admin")
            await page.fill("#password", "admin")
            await page.click("#save-auth")
            await asyncio.sleep(2)
        elif await page.locator("#pinCode").is_visible():
            print("Pin Code required!")
            await page.fill("#pinCode", "1234") # Guessing pin
            await page.click("#unlock-pin")
            await asyncio.sleep(2)
            
        print("Status text:", await page.locator("#status").inner_text() if await page.locator("#status").is_visible() else "No status")
        
        # Now let's try finding the elements
        try:
            await page.wait_for_selector("#saleBlockCount", timeout=5000)
            print("SUCCESS: found #saleBlockCount")
            
            block_count_box = await page.locator("#saleBlockCount").bounding_box()
            kg_expr_box = await page.locator("#saleKgExpression").bounding_box()
            
            if block_count_box['y'] < kg_expr_box['y']:
                print("SUCCESS: 'Blok soni' is above 'Kg miqdori'.")
            else:
                print("ERROR: 'Blok soni' is NOT above 'Kg miqdori'!")
                
            await page.click("#saleKgExpression")
            await asyncio.sleep(1)
            
            calc_box = await page.locator("#kgCalculator").bounding_box()
            if block_count_box['y'] + block_count_box['height'] <= calc_box['y']:
                print("SUCCESS: Calculator opens below 'Blok soni'.")
            else:
                print("WARNING: Calculator overlapping.")
        except Exception as e:
            print("Failed.")
            
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
