import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        print("Navigating to register page to get cookie...")
        await page.goto("http://127.0.0.1:8787/warehouse-register")
        
        print("Attempting to login...")
        try:
            await page.wait_for_selector('input[name="username"]', timeout=3000)
            await page.fill('input[name="username"]', "admin")
            await page.fill('input[name="password"]', "admin")
            await page.click('button[type="submit"]')
            await page.wait_for_timeout(1500)
        except Exception as e:
            print("Login error or not needed:", e)

        print("Navigating to seller page...")
        await page.goto("http://127.0.0.1:8787/warehouse/seller")
        await page.wait_for_timeout(1500)
        
        # We might see the seller auth panel
        try:
            if await page.is_visible("#username"):
                print("Filling seller auth panel...")
                await page.fill("#username", "admin")
                await page.fill("#password", "admin")
                await page.click("#save-auth")
                await page.wait_for_timeout(1500)
        except Exception as e:
            pass

        print("Testing Cash Sale...")
        await page.goto("http://127.0.0.1:8787/warehouse/seller/sale/cash")
        await page.wait_for_timeout(1500)
        
        try:
            await page.wait_for_selector("#saleCustomer", timeout=3000)
        except Exception as e:
            print("Failed to find #saleCustomer!")
            content = await page.content()
            with open("page_output.html", "w", encoding="utf-8") as f:
                f.write(content)
            await browser.close()
            return

        options = await page.locator("#saleCustomer option").count()
        if options > 1:
            await page.select_option("#saleCustomer", index=1)
        else:
            print("No customer! Please add a customer first.")
            await browser.close()
            return
            
        await page.fill("#saleBlockCount", "1")
        await page.fill("#saleKgExpression", "5")
        await page.fill("#saleCash", "50000")
        
        await page.click("#saveSale")
        await page.wait_for_timeout(2000)
        
        val = await page.input_value("#saleKgExpression")
        status_text = await page.locator("#status").text_content()
        
        if val == "":
            print("Cash sale SUCCESS")
            print("Status msg:", status_text)
        else:
            print("Cash sale MIGHT HAVE FAILED, form not cleared")
            print("Status msg:", status_text)

        print("Testing Transfer Sale...")
        await page.goto("http://127.0.0.1:8787/warehouse/seller/sale/transfer")
        await page.wait_for_timeout(1500)
        await page.wait_for_selector("#saleCustomer")
        
        options = await page.locator("#saleCustomer option").count()
        if options > 1:
            await page.select_option("#saleCustomer", index=1)
            
        await page.fill("#saleBlockCount", "2")
        await page.fill("#saleKgExpression", "10")
        await page.fill("#saleTransfer", "100000")
        
        await page.click("#saveSale")
        await page.wait_for_timeout(2000)
        
        val = await page.input_value("#saleKgExpression")
        status_text = await page.locator("#status").text_content()
        
        if val == "":
            print("Transfer sale SUCCESS")
            print("Status msg:", status_text)
        else:
            print("Transfer sale MIGHT HAVE FAILED, form not cleared")
            print("Status msg:", status_text)

        await browser.close()

asyncio.run(main())
