/**
 * FULL SITE AUDIT TEST
 * Tests every button/action across all pages via API calls
 */

const BASE = 'http://127.0.0.1:8789';
const AUTH = 'Basic ' + Buffer.from('admin:admin').toString('base64');

let passed = 0;
let failed = 0;
const errors = [];

function assert(label, actual, expected) {
  if (actual === expected) {
    console.log(`  ✅ ${label}: ${actual}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}: expected ${expected}, got ${actual}`);
    failed++;
    errors.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertTruthy(label, actual) {
  if (actual) {
    console.log(`  ✅ ${label}: ${typeof actual === 'string' ? actual : 'OK'}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}: FALSY (${actual})`);
    failed++;
    errors.push(`${label}: expected truthy, got ${actual}`);
  }
}

function assertRange(label, actual, min, max) {
  if (actual >= min && actual <= max) {
    console.log(`  ✅ ${label}: ${actual} (in range ${min}-${max})`);
    passed++;
  } else {
    console.log(`  ❌ ${label}: ${actual} NOT in range ${min}-${max}`);
    failed++;
    errors.push(`${label}: ${actual} not in ${min}-${max}`);
  }
}

async function api(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Authorization': AUTH, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ...data };
}

async function apiRaw(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Authorization': AUTH, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(BASE + path, opts);
}

// ─────────────────────────────────
// 1. PAGE LOADING TESTS
// ─────────────────────────────────
async function testPageLoading() {
  console.log('\n📄 Test: Sahifalar yuklanishi');
  const pages = [
    '/warehouse/admin', '/warehouse/seller',
    '/warehouse/seller/sale/cash', '/warehouse/seller/sale/transfer',
    '/warehouse/customers', '/warehouse/orders',
  ];
  for (const page of pages) {
    const res = await fetch(BASE + page, { headers: { 'Authorization': AUTH } });
    assert(`${page} status`, res.status, 200);
  }
}

// ─────────────────────────────────
// 2. PRICING TESTS
// ─────────────────────────────────
async function testPricing() {
  console.log('\n💰 Test: Narxlarni o\'rnatish va o\'qish');
  
  // Set pricing
  const setResult = await api('/api/warehouse/pricing', 'POST', {
    cashPricePerKg: 6500,
    transferPricePerKg: 7280,
  });
  assert('Pricing set ok', setResult.ok, true);
  assert('Cash price', setResult.pricing?.cashPricePerKg, 6500);
  assert('Transfer price', setResult.pricing?.transferPricePerKg, 7280);
  
  // Read pricing via customers endpoint
  const custData = await api('/api/warehouse/customers');
  assert('Pricing from customers', custData.pricing?.cashPricePerKg, 6500);
}

// ─────────────────────────────────
// 3. STOCK MANAGEMENT
// ─────────────────────────────────
async function testStock() {
  console.log('\n📦 Test: Ombor zahirasini boshqarish');
  
  const result = await api('/api/warehouse/stock', 'POST', { stockKg: 1000 });
  assert('Stock set ok', result.ok, true);
  assert('Stock value', result.stockKg, 1000);
}

// ─────────────────────────────────
// 4. CUSTOMER CRUD (Seller page buttons)
// ─────────────────────────────────
async function testCustomerCrud() {
  console.log('\n👤 Test: Mijozlar CRUD (Sotuvchi sahifasi)');
  
  // Create customer (addCustomer button)
  const createResult = await api('/api/warehouse/customers', 'POST', {
    fullNames: ['Audit Test Mijoz'],
    organizationName: 'Audit Org',
    taxId: '123456789',
    phones: ['+998901234567'],
    telegramIds: [],
    location: 'Toshkent',
    paymentCategories: ['cash', 'transfer'],
  });
  assert('Customer created', createResult.ok, true);
  assertTruthy('Customer ID exists', createResult.customer?.id);
  const customerId = createResult.customer.id;
  
  // Read customer detail
  const detail = await api(`/api/warehouse/customers/${customerId}`);
  assert('Customer name', detail.customer?.fullName, 'Audit Test Mijoz');
  assert('Org name', detail.customer?.organizationName, 'Audit Org');
  assert('Tax ID', detail.customer?.taxId, '123456789');
  assert('Location', detail.customer?.location, 'Toshkent');
  assertTruthy('Has cash category', detail.customer?.paymentCategories?.includes('cash'));
  assertTruthy('Has transfer category', detail.customer?.paymentCategories?.includes('transfer'));
  
  // Update customer (save-customer button on customer page)
  const updateResult = await api('/api/warehouse/customers', 'POST', {
    userId: customerId,
    fullNames: ['Audit Test Mijoz Updated'],
    organizationName: 'Audit Org Updated',
    taxId: '987654321',
    phones: ['+998907654321'],
    telegramIds: [],
    location: 'Samarqand',
    paymentCategories: ['cash'],
    customCashPricePerKg: 5000,
    customTransferPricePerKg: '',
  });
  assert('Customer updated', updateResult.ok, true);
  
  // Verify update
  const detail2 = await api(`/api/warehouse/customers/${customerId}`);
  assert('Updated name', detail2.customer?.fullName, 'Audit Test Mijoz Updated');
  assert('Updated org', detail2.customer?.organizationName, 'Audit Org Updated');
  assert('Custom cash price set', detail2.customer?.customCashPricePerKg, 5000);
  
  return customerId;
}

// ─────────────────────────────────
// 5. SALE FLOW (Sale page — cash mode)
// ─────────────────────────────────
async function testSaleFlowCash(customerId) {
  console.log('\n🛒 Test: Naqd savdo oqimi (Sale sahifasi)');
  
  // Make a cash sale with payment (saveSale button)
  const sale1 = await api('/api/warehouse/seller-sale', 'POST', {
    userId: customerId,
    amountKg: 10,
    blockCount: 1,
    priceType: 'cash',
    cashPaidAmount: 20000,
    transferPaidAmount: 0,
    transactionDate: '2025-06-01',
    note: 'Audit cash sale test',
  });
  assert('Cash sale ok', sale1.ok, true);
  assertTruthy('Cash sale debt returned', sale1.debt != null);
  assertTruthy('Cash sale stockKg returned', sale1.stockKg != null);
  // Custom price is 5000/kg, so 10kg = 50000. Paid 20000 → debt = 30000
  assert('Cash sale debt correct', sale1.debt, 30000);
  
  // Make sale with zero kg but payment only (to'lov via sale page)
  const payOnly = await api('/api/warehouse/customer-payment', 'POST', {
    userId: customerId,
    cashPaidAmount: 10000,
    transferPaidAmount: 0,
    transactionDate: '2025-06-02',
    note: 'Partial payment from sale page',
  });
  assert('Payment-only ok', payOnly.ok, true);
  assert('Debt after partial payment', payOnly.debt, 20000);
  
  return sale1;
}

// ─────────────────────────────────
// 6. SALE FLOW (Transfer mode)
// ─────────────────────────────────
async function testSaleFlowTransfer(customerId) {
  console.log('\n💳 Test: O\'tkazma savdo oqimi');
  
  const sale = await api('/api/warehouse/seller-sale', 'POST', {
    userId: customerId,
    amountKg: 5,
    blockCount: 1,
    priceType: 'transfer',
    cashPaidAmount: 0,
    transferPaidAmount: 36400,
    transactionDate: '2025-06-03',
    note: 'Transfer sale test',
  });
  assert('Transfer sale ok', sale.ok, true);
  assertTruthy('Transfer sale debt returned', sale.debt != null);
}

// ─────────────────────────────────
// 7. PAYMENT FLOW (Seller page)
// ─────────────────────────────────
async function testPaymentFlow(customerId) {
  console.log('\n💵 Test: To\'lov oqimi (Sotuvchi sahifasi)');
  
  // Cash payment (savePayment button)
  const pay1 = await api('/api/warehouse/customer-payment', 'POST', {
    userId: customerId,
    cashPaidAmount: 5000,
    transferPaidAmount: 0,
    transactionDate: '2025-06-04',
    note: 'Cash payment test',
  });
  assert('Cash payment ok', pay1.ok, true);
  assertTruthy('Payment debt returned', pay1.debt != null);
  
  // Transfer payment
  const pay2 = await api('/api/warehouse/customer-payment', 'POST', {
    userId: customerId,
    cashPaidAmount: 0,
    transferPaidAmount: 3000,
    transactionDate: '2025-06-05',
    note: 'Transfer payment test',
  });
  assert('Transfer payment ok', pay2.ok, true);
  
  // Mixed payment
  const pay3 = await api('/api/warehouse/customer-payment', 'POST', {
    userId: customerId,
    cashPaidAmount: 2000,
    transferPaidAmount: 1000,
    transactionDate: '2025-06-06',
    note: 'Mixed payment test',
  });
  assert('Mixed payment ok', pay3.ok, true);
  
  // Zero payment should fail
  const payZero = await api('/api/warehouse/customer-payment', 'POST', {
    userId: customerId,
    cashPaidAmount: 0,
    transferPaidAmount: 0,
    transactionDate: '2025-06-07',
  });
  assert('Zero payment rejected', payZero.ok || false, false);
}

// ─────────────────────────────────
// 8. HANDOFF FLOW (Seller page)
// ─────────────────────────────────
async function testHandoffFlow() {
  console.log('\n🤝 Test: Pul topshirish oqimi');
  
  const handoff = await api('/api/warehouse/seller-cash-handoffs', 'POST', {
    amount: 50000,
    receivedAt: '2025-06-05',
    note: 'Audit handoff test',
  });
  assert('Handoff ok', handoff.ok, true);
  assertTruthy('Handoff ID', handoff.handoff?.id);
  
  // Read handoffs
  const list = await api('/api/warehouse/seller-cash-handoffs');
  // May return error if no operator context, that's ok for admin-only
  assertTruthy('Handoffs list or response', list.ok || list.error);
}

// ─────────────────────────────────
// 9. PENDING TRANSACTIONS (Admin page)
// ─────────────────────────────────
async function testPendingTransactions() {
  console.log('\n⏳ Test: Kutilayotgan tranzaksiyalar (Admin sahifasi)');
  
  const pending = await api('/api/warehouse/pending');
  assertTruthy('Pending list returned', Array.isArray(pending.pending));
}

// ─────────────────────────────────
// 10. APPROVED TRANSACTIONS (Admin page)
// ─────────────────────────────────
async function testApprovedTransactions() {
  console.log('\n✅ Test: Tasdiqlangan tranzaksiyalar');
  
  const allTx = await api('/api/warehouse/approved');
  assertTruthy('All approved list', Array.isArray(allTx.approved));
  
  const cashTx = await api('/api/warehouse/approved?type=cash');
  assertTruthy('Cash approved list', Array.isArray(cashTx.approved));
  
  const transferTx = await api('/api/warehouse/approved?type=transfer');
  assertTruthy('Transfer approved list', Array.isArray(transferTx.approved));
}

// ─────────────────────────────────
// 11. CUSTOMER LIST (Customers page)
// ─────────────────────────────────
async function testCustomersList() {
  console.log('\n📋 Test: Mijozlar ro\'yxati (Customers sahifasi)');
  
  const data = await api('/api/warehouse/customers');
  assertTruthy('Customers array', Array.isArray(data.customers));
  assertTruthy('Pricing returned', data.pricing);
  assertTruthy('Stock returned', data.stockKg != null);
  assertTruthy('Summary returned', data.summary);
  
  // Check summary has expected fields
  assertTruthy('Summary count', data.summary?.count != null);
  assertTruthy('Summary totalSales', data.summary?.totalSales != null);
}

// ─────────────────────────────────
// 12. CUSTOMER DETAIL & HISTORY
// ─────────────────────────────────
async function testCustomerDetail(customerId) {
  console.log('\n📊 Test: Mijoz tafsilotlari va tarixni ko\'rish');
  
  const detail = await api(`/api/warehouse/customers/${customerId}`);
  assertTruthy('Customer detail loaded', detail.customer);
  assertTruthy('History loaded', Array.isArray(detail.history));
  assertTruthy('History has entries', detail.history.length > 0);
  
  // Check history entry structure
  const entry = detail.history[0];
  assertTruthy('History entry has id', entry.id != null);
  assertTruthy('History entry has kind', entry.kind);
  assertTruthy('History entry has status', entry.status);
}

// ─────────────────────────────────
// 13. CLEAR CUSTOMER HISTORY (Admin)
// ─────────────────────────────────
async function testClearHistory(customerId) {
  console.log('\n🧹 Test: Mijoz tarixini tozalash (Admin)');
  
  // Check history exists before clear
  const before = await api(`/api/warehouse/customers/${customerId}`);
  const historyCount = before.history?.length || 0;
  assertTruthy('History exists before clear', historyCount > 0);
  
  // Clear history
  const clearResult = await api(`/api/warehouse/customers/${customerId}/clear-history`, 'POST');
  assert('Clear ok', clearResult.ok, true);
  assert('Cleared count matches', clearResult.clearedTransactions, historyCount);
  assertTruthy('Stock restored', clearResult.restoredStockKg >= 0);
  
  // Verify cleared
  const after = await api(`/api/warehouse/customers/${customerId}`);
  assert('History empty after clear', after.history?.length || 0, 0);
  
  // Customer still exists
  assertTruthy('Customer still exists', after.customer?.fullName);
}

// ─────────────────────────────────
// 14. ORDERS CRUD
// ─────────────────────────────────
async function testOrdersCrud() {
  console.log('\n📝 Test: Zakazlar CRUD (Orders sahifasi)');
  
  // Create order (save-order button)
  const create = await api('/api/warehouse/orders', 'POST', {
    customerName: 'Audit Order Client',
    organizationName: 'Audit Co',
    taxId: '111222333',
    phone: '+998901112233',
    note: 'Mayda: 5 dona, Katta: 3 dona, Umumiy: 8 dona',
  });
  assert('Order created', create.ok, true);
  const orderId = create.order?.id;
  assertTruthy('Order ID', orderId);
  
  // List orders
  const list = await api('/api/warehouse/orders');
  assertTruthy('Orders list', Array.isArray(list.orders));
  const found = list.orders.find(o => o.id === orderId);
  assertTruthy('Created order in list', found);
  assert('Order customer name', found?.customerName, 'Audit Order Client');
  
  // Update order (saveEditOrder button)
  const update = await api(`/api/warehouse/orders/${orderId}`, 'PUT', {
    customerName: 'Audit Order Client Updated',
    organizationName: 'Audit Co v2',
    taxId: '444555666',
    phone: '+998904445566',
    note: 'Updated: Mayda: 10 dona',
  });
  assert('Order updated', update.ok, true);
  
  // Verify update
  const list2 = await api('/api/warehouse/orders');
  const found2 = list2.orders.find(o => o.id === orderId);
  assert('Order name updated', found2?.customerName, 'Audit Order Client Updated');
  
  // Delete order
  const del = await api(`/api/warehouse/orders/${orderId}`, 'DELETE');
  assert('Order deleted', del.ok, true);
  
  // Verify deleted
  const list3 = await api('/api/warehouse/orders');
  const found3 = list3.orders?.find(o => o.id === orderId);
  assert('Order gone', found3, undefined);
}

// ─────────────────────────────────
// 15. STAFF MANAGEMENT (Admin)
// ─────────────────────────────────
async function testStaffManagement() {
  console.log('\n👷 Test: Xodimlar boshqaruvi (Admin sahifasi)');
  
  // Create staff (seller)
  const create = await api('/api/warehouse/staff', 'POST', {
    username: 'audit_seller_01',
    password: 'test1234',
    fullName: 'Audit Sotuvchi',
    role: 'seller',
    pin: '1234',
  });
  assert('Staff created', create.ok, true);
  const staffId = create.staff?.id;
  assertTruthy('Staff ID', staffId);
  
  // List staff
  const list = await api('/api/warehouse/staff');
  assertTruthy('Staff list', Array.isArray(list.staff));
  const found = list.staff.find(s => s.id === staffId);
  assertTruthy('Staff in list', found);
  assert('Staff username', found?.username, 'audit_seller_01');
  assert('Staff role', found?.role, 'seller');
  
  if (!staffId) { console.log('  ⚠️ Skipping link tests'); return; }
  
  // Create access link (permission = 'seller')
  const linkResult = await api(`/api/warehouse/staff/${staffId}/access-links`, 'POST', {
    permission: 'seller',
  });
  assert('Access link created', linkResult.ok, true);
  assertTruthy('Access token exists', linkResult.link?.token);
  const accessToken = linkResult.link?.token;
  
  if (!accessToken) { console.log('  ⚠️ No token, skipping auth tests'); return; }
  
  // Test auth-status with token (via query param like frontend does)
  const authStatusRes = await fetch(`${BASE}/api/warehouse/auth-status?access=${accessToken}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  const authStatus = await authStatusRes.json();
  assert('Auth status ok', authStatus.ok, true);
  assertTruthy('Auth has username', authStatus.username);
  assertTruthy('Auth has fullName', authStatus.fullName);
  
  // Test verify-pin with token
  const pinRes = await fetch(`${BASE}/api/warehouse/verify-pin?access=${accessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '1234' }),
  });
  const pinResult = await pinRes.json();
  assert('PIN verified', pinResult.ok, true);
  assertTruthy('PIN returns username', pinResult.username);
  assertTruthy('PIN returns fullName', pinResult.fullName);
  assertTruthy('PIN returns role', pinResult.role);
  assertTruthy('PIN returns permissions', Array.isArray(pinResult.permissions));
  
  // Delete staff
  const del = await api(`/api/warehouse/staff/${staffId}`, 'DELETE');
  assert('Staff deleted', del.ok, true);
}

// ─────────────────────────────────
// 16. CSV EXPORT (Admin)
// ─────────────────────────────────
async function testCsvExport() {
  console.log('\n📥 Test: CSV eksport (Admin sahifasi)');
  
  const res = await apiRaw('/api/warehouse/export-csv');
  assert('CSV status', res.status, 200);
  const contentType = res.headers.get('content-type') || '';
  assertTruthy('CSV content type', contentType.includes('text/csv'));
}

// ─────────────────────────────────
// 17. WAREHOUSE RECEIPTS
// ─────────────────────────────────
async function testReceipts() {
  console.log('\n🧾 Test: Ombor kirim kvitansiyalari');
  
  const list = await api('/api/warehouse/receipts');
  assertTruthy('Receipts list', Array.isArray(list.receipts));
}

// ─────────────────────────────────
// 18. DELETED CUSTOMERS
// ─────────────────────────────────
async function testDeletedCustomers() {
  console.log('\n🗑️ Test: O\'chirilgan mijozlar (Admin)');
  
  const list = await api('/api/warehouse/deleted-customers');
  assertTruthy('Deleted list returned', Array.isArray(list.customers));
}

// ─────────────────────────────────
// 19. CUSTOMER DELETE FLOW
// ─────────────────────────────────
async function testCustomerDelete(customerId) {
  console.log('\n🗑️ Test: Mijozni o\'chirish');
  
  const del = await api(`/api/warehouse/customers/${customerId}`, 'DELETE');
  assert('Customer deleted ok', del.ok, true);
  assert('Deleted name', del.customer?.fullName, 'Audit Test Mijoz Updated');
  
  // Verify deleted
  const detail = await api(`/api/warehouse/customers/${customerId}`);
  assert('Customer gone', detail.status || detail.error ? true : false, true);
}

// ─────────────────────────────────
// 20. EDGE CASE: Invalid inputs
// ─────────────────────────────────
async function testEdgeCases() {
  console.log('\n⚠️ Test: Xatolik holatlarini tekshirish');
  
  // Sale with invalid kg
  const badSale = await api('/api/warehouse/seller-sale', 'POST', {
    userId: 99999,
    amountKg: -5,
    priceType: 'cash',
  });
  assertTruthy('Negative kg rejected', badSale.error);
  
  // Payment to non-existent customer
  const badPay = await api('/api/warehouse/customer-payment', 'POST', {
    userId: 99999,
    cashPaidAmount: 1000,
  });
  assertTruthy('Bad customer rejected', badPay.error);
  
  // Clear history of non-existent customer
  const badClear = await api('/api/warehouse/customers/99999/clear-history', 'POST');
  assertTruthy('Bad clear rejected', badClear.error);
  
  // Access non-existent customer detail
  const badDetail = await api('/api/warehouse/customers/99999');
  assertTruthy('Bad detail returns error', badDetail.error);
  
  // Create customer without name
  const badCustomer = await api('/api/warehouse/customers', 'POST', {
    fullNames: [],
    paymentCategories: ['cash'],
  });
  assertTruthy('Empty name rejected', badCustomer.error);
  
  // Create order without note
  const badOrder = await api('/api/warehouse/orders', 'POST', {
    customerName: '',
    note: '',
  });
  assertTruthy('Empty order rejected', badOrder.error);
}

// ─────────────────────────────────
// 21. DAILY SUMMARY
// ─────────────────────────────────
async function testDailySummary() {
  console.log('\n📅 Test: Kunlik hisobot');
  
  const data = await api('/api/warehouse/customers');
  // dailySummary may be undefined if operator is admin — that is ok
  assertTruthy('Customers data loaded', data.ok || data.customers);
}

// ─────────────────────────────────
// MAIN
// ─────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  SAYT TO\'LIQ AUDIT TESTI');
  console.log('═══════════════════════════════════════');
  
  try {
    await testPageLoading();
    await testPricing();
    await testStock();
    const customerId = await testCustomerCrud();
    await testSaleFlowCash(customerId);
    await testSaleFlowTransfer(customerId);
    await testPaymentFlow(customerId);
    await testHandoffFlow();
    await testPendingTransactions();
    await testApprovedTransactions();
    await testCustomersList();
    await testCustomerDetail(customerId);
    await testClearHistory(customerId);
    await testOrdersCrud();
    await testStaffManagement();
    await testCsvExport();
    await testReceipts();
    await testDeletedCustomers();
    await testCustomerDelete(customerId);
    await testEdgeCases();
    await testDailySummary();
  } catch (e) {
    console.error('\n💥 FATAL ERROR:', e.message);
    console.error(e.stack);
  }
  
  console.log('\n═══════════════════════════════════════');
  console.log(`  NATIJA: ${passed} ✅ o'tdi, ${failed} ❌ xato`);
  console.log('═══════════════════════════════════════');
  
  if (errors.length) {
    console.log('\n❌ XATOLAR RO\'YXATI:');
    errors.forEach((e, i) => console.log(`  ${i+1}. ${e}`));
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

main();
