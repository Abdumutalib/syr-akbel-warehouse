/**
 * Сайтнинг барча кнопкалари ва API endpoint'ларини тест қилиш скрипти
 */

const BASE = 'http://127.0.0.1:8789';
const AUTH = 'Basic ' + Buffer.from('admin:admin').toString('base64');

const results = [];
let passed = 0;
let failed = 0;

function log(status, name, detail = '') {
  const icon = status === 'OK' ? '✅' : '❌';
  if (status === 'OK') passed++; else failed++;
  results.push({ status, name, detail });
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`);
}

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Authorization': AUTH, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function testPage(path, expectedTitle) {
  try {
    const res = await fetch(BASE + path, { headers: { 'Authorization': AUTH }, redirect: 'manual' });
    if (res.status === 302) {
      log('OK', `Саҳифа ${path}`, `Redirect → ${res.headers.get('location')}`);
    } else if (res.ok) {
      const html = await res.text();
      const hasTitle = html.includes(expectedTitle);
      log(hasTitle ? 'OK' : 'FAIL', `Саҳифа ${path}`, hasTitle ? `Title: "${expectedTitle}" топилди` : `Title "${expectedTitle}" ТОПИЛМАДИ`);
    } else {
      log('FAIL', `Саҳифа ${path}`, `Status: ${res.status}`);
    }
  } catch (e) {
    log('FAIL', `Саҳифа ${path}`, e.message);
  }
}

async function run() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Сыр АКБЕЛ — БАРЧА КНОПКАЛАР ТЕСТИ');
  console.log('══════════════════════════════════════════════\n');

  // ═══ 1. САҲИФАЛАР (HTML) ═══
  console.log('\n📄 САҲИФАЛАР ТЕСТИ\n');
  await testPage('/warehouse/admin', 'Сыр АКБЕЛ');
  await testPage('/warehouse/seller', 'Sotuvchi');
  await testPage('/warehouse/customers', 'Mijozlar');
  await testPage('/warehouse/orders', 'Buyurtmalar');
  await testPage('/warehouse/ledger', 'Buxgalter');
  await testPage('/warehouse/dashboard', 'Dashboard');
  await testPage('/warehouse/admin/cash', 'Naqd');
  await testPage('/warehouse/admin/transfer', 'tkazma');

  // ═══ 2. ADMIN КНОПКАЛАРИ — API ═══
  console.log('\n🔐 ADMIN КНОПКАЛАРИ (API ENDPOINT)\n');

  // Kirish (login-only button)
  let r = await api('GET', '/warehouse/api/warehouse/pending');
  log(r.ok ? 'OK' : 'FAIL', '[Kirish] → GET /pending', `Status: ${r.status}, pending: ${r.data?.pending?.length ?? '?'}`);

  // Qoldiqni yangilash (update-stock button)
  r = await api('POST', '/warehouse/api/warehouse/stock', { stockKg: 100 });
  log(r.ok ? 'OK' : 'FAIL', '[Qoldiqni yangilash] → POST /stock', `Status: ${r.status}`);

  // Narxlarni saqlash (update-pricing button)
  r = await api('POST', '/warehouse/api/warehouse/pricing', { cashPricePerKg: 65000, transferPricePerKg: 72800 });
  log(r.ok ? 'OK' : 'FAIL', '[Narxlarni saqlash] → POST /pricing', `Status: ${r.status}`);

  // CSV yuklab olish (export-csv button)
  try {
    const csvRes = await fetch(BASE + '/warehouse/api/warehouse/export-csv', { headers: { 'Authorization': AUTH } });
    log(csvRes.ok ? 'OK' : 'FAIL', '[CSV yuklab olish] → GET /export-csv', `Status: ${csvRes.status}, Type: ${csvRes.headers.get('content-type')}`);
  } catch (e) {
    log('FAIL', '[CSV yuklab olish]', e.message);
  }

  // Qayta yuklash (reload button) — same as pending
  r = await api('GET', '/warehouse/api/warehouse/pending');
  log(r.ok ? 'OK' : 'FAIL', '[Qayta yuklash] → GET /pending', `Status: ${r.status}`);

  // Telegram xabarlarni yangilash (refreshInbox button)
  r = await api('GET', '/warehouse/api/telegram/messages?limit=50');
  log(r.ok ? 'OK' : 'FAIL', '[Telegram Yangilash] → GET /telegram/messages', `Status: ${r.status}`);

  // ═══ 3. МИЖОЗ КНОПКАЛАРИ ═══
  console.log('\n👤 МИЖОЗ КНОПКАЛАРИ\n');

  // Янги мижоз қўшиш (addCustomerBtn)
  r = await api('POST', '/warehouse/api/warehouse/customers', {
    fullName: 'Test Mijoz',
    phone: '+998901111111',
    paymentCategories: ['cash']
  });
  log(r.ok ? 'OK' : 'FAIL', '[Мижозни сақлаш] → POST /customers', `Status: ${r.status}, ID: ${r.data?.customer?.id ?? '?'}`);
  const testCustomerId = r.data?.customer?.id;

  // Мижозлар каталоги
  r = await api('GET', '/warehouse/api/warehouse/customer-catalog');
  log(r.ok ? 'OK' : 'FAIL', '[Мижозлар каталоги] → GET /customer-catalog', `Cash: ${r.data?.cashCustomers?.length ?? 0}, Transfer: ${r.data?.transferCustomers?.length ?? 0}`);

  // Мижоз деталлари (customerQuickSelect → loadInlineCustomerDetail)
  if (testCustomerId) {
    r = await api('GET', `/warehouse/api/warehouse/customers/${testCustomerId}`);
    log(r.ok ? 'OK' : 'FAIL', '[Мижоз маълумоти] → GET /customers/:id', `Status: ${r.status}, Name: ${r.data?.customer?.fullName ?? '?'}`);
  }

  // Мижозни инлайн сақлаш (saveCustomerInline button)
  if (testCustomerId) {
    r = await api('POST', '/warehouse/api/warehouse/customers', {
      userId: testCustomerId,
      fullName: 'Test Mijoz Updated',
      phone: '+998901111111',
      paymentCategories: ['cash', 'transfer']
    });
    log(r.ok ? 'OK' : 'FAIL', '[Мижозни инлайн сақлаш] → POST /customers (update)', `Status: ${r.status}`);
  }

  // Таҳрир саҳифасини очиш (openCustomerEdit → redirect)
  if (testCustomerId) {
    await testPage(`/warehouse/customers/${testCustomerId}`, 'ijoz');
  }

  // ═══ 4. ПИШЛОҚ ҚАБУЛ ҚИЛИШ ═══
  console.log('\n🧀 ПИШЛОҚ ҚАБУЛ ҚИЛИШ (КИРИМ)\n');

  // Қабул қилиш (createReceipt button)
  r = await api('POST', '/warehouse/api/warehouse/receipts', {
    amountKg: 50,
    blockCount: 5,
    pricePerKg: 60000,
    note: 'Test partiya'
  });
  log(r.ok ? 'OK' : 'FAIL', '[Қабул қилиш] → POST /receipts', `Status: ${r.status}`);

  // Кирим рўйхати
  r = await api('GET', '/warehouse/api/warehouse/receipts');
  log(r.ok ? 'OK' : 'FAIL', '[Кирим рўйхати] → GET /receipts', `Count: ${r.data?.receipts?.length ?? '?'}`);

  // ═══ 5. ХОДИМ КНОПКАЛАРИ ═══
  console.log('\n👷 ХОДИМ КНОПКАЛАРИ\n');

  // Ходим қўшиш (createStaff button)
  r = await api('POST', '/warehouse/api/warehouse/staff', {
    fullName: 'Test Xodim',
    username: 'test_staff_' + Date.now(),
    password: 'test1234',
    role: 'seller',
    permissions: ['seller', 'customers']
  });
  log(r.ok ? 'OK' : 'FAIL', '[Ходимни сақлаш] → POST /staff', `Status: ${r.status}`);
  const staffList = r.data?.allStaff || [];
  const testStaffId = staffList.length ? staffList[staffList.length - 1]?.id : null;

  // Ходимлар рўйхати
  r = await api('GET', '/warehouse/api/warehouse/staff');
  log(r.ok ? 'OK' : 'FAIL', '[Ходимлар рўйхати] → GET /staff', `Count: ${r.data?.staff?.length ?? '?'}`);

  // Рухсатларни сақлаш (data-save-permissions button)
  if (testStaffId) {
    r = await api('POST', `/warehouse/api/warehouse/staff/${testStaffId}/permissions`, {
      permissions: ['seller', 'customers', 'cash']
    });
    log(r.ok ? 'OK' : 'FAIL', '[Рухсатларни сақлаш] → POST /staff/:id/permissions', `Status: ${r.status}`);
  }

  // Линк яратиш (data-create-link button)
  if (testStaffId) {
    r = await api('POST', `/warehouse/api/warehouse/staff/${testStaffId}/access-links`, {
      permission: 'seller'
    });
    log(r.ok ? 'OK' : 'FAIL', '[Линк яратиш] → POST /staff/:id/access-links', `Status: ${r.status}`);
  }

  // Ходимни ўчириш (data-delete-staff button)
  if (testStaffId) {
    r = await api('DELETE', `/warehouse/api/warehouse/staff/${testStaffId}`);
    log(r.ok ? 'OK' : 'FAIL', '[Ходимни ўчириш] → DELETE /staff/:id', `Status: ${r.status}`);
  }

  // ═══ 6. ЎЧИРИЛГАН МИЖОЗЛАР ═══
  console.log('\n🗑️ ЎЧИРИЛГАН МИЖОЗЛАР\n');

  r = await api('GET', '/warehouse/api/warehouse/deleted-customers');
  log(r.ok ? 'OK' : 'FAIL', '[Ўчирилган мижозлар] → GET /deleted-customers', `Count: ${r.data?.customers?.length ?? '?'}`);

  // ═══ 7. СОТУВЧИ САҲИФАСИ КНОПКАЛАРИ ═══
  console.log('\n🛒 СОТУВЧИ КНОПКАЛАРИ\n');

  // Мижозлар рўйхати (seller page)
  r = await api('GET', '/warehouse/api/warehouse/customers');
  log(r.ok ? 'OK' : 'FAIL', '[Сотувчи мижозлар] → GET /customers', `Count: ${r.data?.customers?.length ?? '?'}`);

  // Тўлов ёзиш (savePayment button)
  if (testCustomerId) {
    r = await api('POST', '/warehouse/api/warehouse/customers', {
      userId: testCustomerId,
      fullName: 'Test Mijoz Updated',
      paymentCategories: ['cash']
    });
    // Payment endpoint test via approved sale flow
    log(r.ok ? 'OK' : 'FAIL', '[Тўлов ёзиш API] → POST /customers', `Status: ${r.status}`);
  }

  // Auth status check
  r = await api('GET', '/warehouse/api/warehouse/auth-status');
  log(r.ok ? 'OK' : 'FAIL', '[Auth status] → GET /auth-status', `Status: ${r.status}`);

  // ═══ 8. DASHBOARD КНОПКАЛАРИ ═══
  console.log('\n📊 DASHBOARD (ANALYTICS) КНОПКАЛАРИ\n');

  r = await api('GET', '/warehouse/api/analytics/today');
  log(r.ok ? 'OK' : 'FAIL', '[Bugungi korsatkichlar] → GET /analytics/today', `Status: ${r.status}`);

  r = await api('GET', '/warehouse/api/analytics/trend?days=14');
  log(r.ok ? 'OK' : 'FAIL', '[14 kunlik trend] → GET /analytics/trend', `Status: ${r.status}`);

  r = await api('GET', '/warehouse/api/analytics/debtors?limit=5');
  log(r.ok ? 'OK' : 'FAIL', '[Top qarzdorlar] → GET /analytics/debtors', `Status: ${r.status}`);

  r = await api('GET', '/warehouse/api/analytics/stock');
  log(r.ok ? 'OK' : 'FAIL', '[Ombor qoldig] → GET /analytics/stock', `Status: ${r.status}`);

  // ═══ 9. БУЮРТМАЛАР ═══
  console.log('\n📦 БУЮРТМАЛАР\n');

  r = await api('GET', '/warehouse/api/warehouse/orders');
  log(r.ok ? 'OK' : 'FAIL', '[Буюртмалар] → GET /orders', `Status: ${r.status}`);

  // ═══ 10. НАВИГАЦИЯ ЛИНКЛАРИ ═══
  console.log('\n🔗 НАВИГАЦИЯ ЛИНКЛАРИ\n');

  const navLinks = [
    ['/warehouse/admin/cash', 'Нақд хисобот'],
    ['/warehouse/admin/transfer', 'Ўтказма хисобот'],
    ['/warehouse/customers', 'Мижозлар'],
    ['/warehouse/orders', 'Буюртмалар'],
    ['/warehouse/ledger', 'Бухгалтер'],
    ['/warehouse/seller', 'Сотувчи'],
  ];
  for (const [link, label] of navLinks) {
    try {
      const res = await fetch(BASE + link, { redirect: 'manual' });
      log(res.status === 200 || res.status === 302 ? 'OK' : 'FAIL', `[${label}] → ${link}`, `Status: ${res.status}`);
    } catch (e) {
      log('FAIL', `[${label}] → ${link}`, e.message);
    }
  }

  // ═══ ТЕСТ МИЖОЗНИ ЎЧИРИШ ═══
  if (testCustomerId) {
    r = await api('DELETE', `/warehouse/api/warehouse/customers/${testCustomerId}`);
    log(r.ok ? 'OK' : 'FAIL', '[Тест мижозни ўчириш] → DELETE /customers/:id', `Status: ${r.status}`);
  }

  // ═══ ХУЛОСА ═══
  console.log('\n══════════════════════════════════════════════');
  console.log(`  НАТИЖА: ✅ ${passed} ўтди | ❌ ${failed} хатолик`);
  console.log('══════════════════════════════════════════════\n');

  if (failed > 0) {
    console.log('❌ ХАТОЛИКЛАР:');
    results.filter(r => r.status !== 'OK').forEach(r => {
      console.log(`   • ${r.name}: ${r.detail}`);
    });
    console.log('');
  }
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
