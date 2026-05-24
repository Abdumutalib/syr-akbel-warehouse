import asyncio
import os
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        
        # Site gate bypass
        await context.add_cookies([{
            'name': 'warehouse_site_gate',
            'value': 'akbel-open',
            'domain': '127.0.0.1',
            'path': '/'
        }])

        page = await context.new_page()
        page.on("console", lambda msg: print(f"CONSOLE [{msg.type}]: {msg.text}"))
        page.on("pageerror", lambda err: print(f"ERROR: {err}"))
        
        await page.goto('http://127.0.0.1:8787/warehouse/customers')
        
        # Inject admin login token / localstorage
        await page.evaluate("""() => {
            localStorage.setItem('warehouse-access-token', 'test-token');
            // Fake operator profile to bypass UI blocks
            window.getWarehouseOperatorProfile = () => ({ role: 'admin' });
        }""")
        
        await page.goto('http://127.0.0.1:8787/warehouse/customers')
        await page.wait_for_load_state("networkidle")
        
        # Map tugmasini izlaymiz
        print("Map tugmalari qidirilmoqda...")
        buttons = await page.locator('button[title="Xaritadan tanlash"]').all()
        print(f"Topildi: {len(buttons)} ta")
        
        score = 100
        errors = []
        
        if not buttons:
            score -= 40
            errors.append("Map tugmasi topilmadi!")
        else:
            await buttons[0].click()
            print("Map tugmasi bosildi!")
            
            try:
                # Modal ochilishini kutish
                await page.wait_for_selector('#locationMapModal.active', state='visible', timeout=3000)
                print("Modal muvaffaqiyatli ochildi!")
            except Exception as e:
                score -= 30
                errors.append("Modal oynasi ochilmadi yoki .active klassi qo'shilmadi.")
            
            try:
                # Xarita konteyneri yuklanishi
                await page.wait_for_selector('.leaflet-container', timeout=5000)
                print("Leaflet xaritasi yuklandi!")
            except Exception as e:
                score -= 30
                errors.append("Leaflet xaritasi yuklanmadi (CDN muammosi yoki JS xatosi).")
                
            try:
                # "Shu manzilni tasdiqlash" tugmasini bosish
                confirm_btn = page.locator('#confirmLocationMap')
                await confirm_btn.click()
                print("Manzil tasdiqlandi!")
                
                # Inputga to'g'ri yozilganini tekshirish
                val = await page.locator('#customerLocation').input_value()
                if "maps.google.com" in val:
                    print(f"Manzil inputga to'g'ri tushdi: {val}")
                else:
                    score -= 20
                    errors.append(f"Inputga kutilgan havola yozilmadi. Hozirgi qiymat: '{val}'")
            except Exception as e:
                score -= 20
                errors.append(f"Tasdiqlashda xatolik: {e}")

        print(f"\\n--- TEST NATIJASI ---")
        print(f"Ball: {score}/100")
        if errors:
            for err in errors:
                print(f"Xato: {err}")
        else:
            print("Hamma narsa ajoyib ishlayapti!")

        await browser.close()

asyncio.run(main())
