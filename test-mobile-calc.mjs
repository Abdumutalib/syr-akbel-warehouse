import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

// 1) Sahifani och
await page.goto('https://akbelim.com/warehouse/seller/sale/cash', { timeout: 30000, waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.screenshot({ path: 'C:/Users/Windows 11/Desktop/m1-initial.png' });
console.log('1: sahifa yuklandi');

// 2) Login
await page.fill('#username', '123456');
await page.fill('#password', '19750104');
await page.click('#save-auth');
await page.waitForTimeout(3500);
await page.screenshot({ path: 'C:/Users/Windows 11/Desktop/m2-after-login.png' });
console.log('2: login qilindi');

// 3) Kg maydoniga tap
await page.tap('#saleKgExpression');
await page.waitForTimeout(600);
await page.screenshot({ path: 'C:/Users/Windows 11/Desktop/m3-calc-open.png' });
console.log('3: kalkulyator ochildi');

// 4) Scroll pozitsiyasini oldindan saqla
const scrollBefore = await page.evaluate(() => window.scrollY);

// 5) Bir necha tugma bos
for (const key of ['1', '0', ',', '5', '+', '1', '2', ',', '3']) {
  await page.tap(`[data-calc-key="${key}"]`);
  await page.waitForTimeout(150);
}

const scrollAfter = await page.evaluate(() => window.scrollY);
const jump = scrollAfter - scrollBefore;
await page.screenshot({ path: 'C:/Users/Windows 11/Desktop/m4-after-typing.png' });
console.log(`4: scroll oldin=${scrollBefore} keyin=${scrollAfter} sakrash=${jump}px`);

if (jump === 0) {
  console.log('✅ SAKRASH YO\'Q - fix ishlayapti!');
} else if (Math.abs(jump) < 20) {
  console.log(`⚠️ Kichik sakrash (${jump}px) - maqbul`);
} else {
  console.log(`❌ KATTA SAKRASH (${jump}px) - fix ishlamadi`);
}

// 6) = tugmasi
await page.tap('[data-calc-action="apply"]');
await page.waitForTimeout(500);
const kgValue = await page.inputValue('#saleKgExpression');
await page.screenshot({ path: 'C:/Users/Windows 11/Desktop/m5-result.png' });
console.log(`5: natija kg = "${kgValue}"`);

if (kgValue && kgValue !== '') {
  console.log('✅ Kalkulyator to\'g\'ri ishladi');
} else {
  console.log('❌ Natija bo\'sh - muammo bor');
}

await browser.close();
console.log('\nScreenshotlar: C:/Users/Windows 11/Desktop/m1-m5.png');
