import asyncio
from playwright.async_api import async_playwright
import time

async def main():
    print("Starting E2E Audit...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            permissions=['geolocation'],
            geolocation={'latitude': 41.311081, 'longitude': 69.240562} # Toshkent markazi mock GPS
        )
        
        # Bypass site gate
        await context.add_cookies([{
            'name': 'warehouse_site_gate',
            'value': 'akbel-open',
            'domain': '127.0.0.1',
            'path': '/'
        }])

        page = await context.new_page()
        page.on("console", lambda msg: print(f"CONSOLE [{msg.type}]: {msg.text}"))
        
        await page.goto('http://127.0.0.1:8787/warehouse/customers')
        
        # Inject admin login token
        await page.evaluate("""() => {
            localStorage.setItem('warehouse-access-token', 'test-token');
            window.getWarehouseOperatorProfile = () => ({ role: 'admin' });
        }""")
        
        await page.goto('http://127.0.0.1:8787/warehouse/customers')
        await page.wait_for_load_state("networkidle")
        
        # 1. Open "Mijoz qo'shish" modal
        print("1. Opening Mijoz qo'shish modal...")
        await page.locator('#openAddCustomerModal').click()
        await page.wait_for_selector('#addCustomerModal.active', state='visible')
        
        # 2. Test Map Button in Add Customer Modal
        print("2. Testing Map button...")
        map_btn = page.locator('#addCustomerModal button[title="Xaritadan tanlash"]')
        await map_btn.click()
        
        # Kutish: Map modal ochilishi
        await page.wait_for_selector('#locationMapModal.active', state='visible')
        print("Map modal opened.")
        
        # Kutish: Leaflet yuklanishi
        await page.wait_for_selector('.leaflet-container', timeout=5000)
        print("Leaflet container loaded.")
        
        # Wait a bit for auto-gps
        await page.wait_for_timeout(2000)
        
        # Confirm map
        await page.locator('#confirmLocationMap').click()
        
        # Check if input has the value
        val = await page.locator('#modalCustomerLocation').input_value()
        print(f"Location input populated with: {val}")
        
        if "41.311081" in val or "69.240562" in val:
            print("Auto-GPS correctly applied the mocked location!")
        elif "41.2995" in val:
            print("Auto-GPS failed or took too long, fallback to Tashkent default was used.")
        else:
            print("Unexpected location value.")

        # Let's save a new customer
        print("3. Saving new customer...")
        await page.fill('#modalCustomerFullName', 'Test GPS Customer')
        await page.fill('#modalCustomerLocation', val)
        await page.locator('#saveCustomerBtn').click()
        
        await page.wait_for_timeout(2000)
        
        # 4. Check if the customer list has the Google and Yandex buttons
        print("4. Checking Customer List rendering...")
        html = await page.content()
        if "Yandex Maps" in html or "Yandex" in html:
            print("Yandex map link found in customer list HTML!")
        else:
            print("ERROR: Yandex map link missing in HTML.")
            
        await browser.close()
        print("E2E Audit Complete.")

asyncio.run(main())
