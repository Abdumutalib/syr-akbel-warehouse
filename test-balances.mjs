async function api(path, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Authorization': 'Basic YWRtaW46YWRtaW4=',
      'Content-Type': 'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`http://127.0.0.1:8789${path}`, options);
  const data = await res.json();
  if (!res.ok) throw new Error(`API Error [${path}]: ${data.error || res.status}`);
  return data;
}

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = Math.abs(Number(actual) - Number(expected)) < 1;
  if (ok) {
    console.log(`  ✅ ${label}: ${actual}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}: expected ${expected}, got ${actual}`);
    failed++;
  }
}

async function createCustomer(name) {
  const r = await api('/api/warehouse/customers', 'POST', {
    fullName: name,
    paymentCategories: ['cash', 'transfer']
  });
  return r.customer.id;
}

async function addSale(userId, kg, priceType, cashPaid = 0, transferPaid = 0) {
  return api('/api/warehouse/seller-sale', 'POST', {
    userId,
    amountKg: kg,
    priceType,
    cashPaidAmount: cashPaid,
    transferPaidAmount: transferPaid
  });
}

async function addPayment(userId, cashPaid = 0, transferPaid = 0) {
  return api('/api/warehouse/customer-payment', 'POST', {
    userId,
    cashPaidAmount: cashPaid,
    transferPaidAmount: transferPaid
  });
}

async function getBalance(userId) {
  const r = await api(`/api/warehouse/customers/${userId}`);
  return r.summary;
}

// --- Test 1: Cash sale + Cash payment ---
async function test1() {
  console.log('\n📌 Test 1: Naqd savdo + Naqd to\'lov');
  const id = await createCustomer('Test1 NaqdNaqd');
  await addSale(id, 10, 'cash'); // 6500 * 10 = 65,000 sum naqd
  let b = await getBalance(id);
  check('cashDebt before payment', b.cashDebt, 65000);
  check('transferDebt before payment', b.transferDebt, 0);
  await addPayment(id, 65000, 0); // to'la naqd to'lov
  b = await getBalance(id);
  check('cashDebt after full payment', b.cashDebt, 0);
  check('currentDebt after full payment', b.currentDebt, 0);
}

// --- Test 2: Transfer sale + Transfer payment ---
async function test2() {
  console.log('\n📌 Test 2: O\'tkazma savdo + O\'tkazma to\'lov');
  const id = await createCustomer('Test2 TransTrans');
  await addSale(id, 10, 'transfer'); // 7280 * 10 = 72,800 sum o'tkazma
  let b = await getBalance(id);
  check('transferDebt before payment', b.transferDebt, 72800);
  check('cashDebt before payment', b.cashDebt, 0);
  await addPayment(id, 0, 72800);
  b = await getBalance(id);
  check('transferDebt after full payment', b.transferDebt, 0);
  check('currentDebt after full payment', b.currentDebt, 0);
}

// --- Test 3: Cash sale + Transfer payment (cross-payment) ---
async function test3() {
  console.log('\n📌 Test 3: Naqd savdo + O\'tkazma to\'lov (cross-payment)');
  const id = await createCustomer('Test3 NaqdTrans');
  await addSale(id, 10, 'cash'); // 6500 * 10 = 65,000 cash debt
  let b = await getBalance(id);
  check('cashDebt before payment', b.cashDebt, 65000);
  await addPayment(id, 0, 65000); // transfer orqali to'landi
  b = await getBalance(id);
  check('cashDebt after cross-payment', b.cashDebt, 0);
  check('transferDebt after cross-payment', b.transferDebt, 0);
  check('currentDebt after cross-payment', b.currentDebt, 0);
}

// --- Test 4: Transfer sale + Cash payment (cross-payment reverse) ---
async function test4() {
  console.log('\n📌 Test 4: O\'tkazma savdo + Naqd to\'lov (cross-payment teskari)');
  const id = await createCustomer('Test4 TransNaqd');
  await addSale(id, 10, 'transfer'); // 7280 * 10 = 72,800 transfer debt
  let b = await getBalance(id);
  check('transferDebt before payment', b.transferDebt, 72800);
  await addPayment(id, 72800, 0); // naqd orqali to'landi
  b = await getBalance(id);
  check('transferDebt after cross-payment', b.transferDebt, 0);
  check('cashDebt after cross-payment', b.cashDebt, 0);
  check('currentDebt after cross-payment', b.currentDebt, 0);
}

// --- Test 5: Mixed sale paid partially ---
async function test5() {
  console.log('\n📌 Test 5: Aralash savdo, qisman to\'lov');
  const id = await createCustomer('Test5 Mixed');
  await addSale(id, 20, 'cash'); // 6500 * 20 = 130,000 cash
  await addSale(id, 10, 'transfer'); // 7280 * 10 = 72,800 transfer
  let b = await getBalance(id);
  check('cashDebt before payment', b.cashDebt, 130000);
  check('transferDebt before payment', b.transferDebt, 72800);
  check('currentDebt before payment', b.currentDebt, 202800);
  // Pay 50,000 cash
  await addPayment(id, 50000, 0);
  b = await getBalance(id);
  check('cashDebt after 50k cash payment', b.cashDebt, 80000);
  check('currentDebt after 50k cash payment', b.currentDebt, 152800);
}

// --- Test 6: Partial sale payment at time of sale ---
async function test6() {
  console.log('\n📌 Test 6: Savdo vaqtida qisman to\'lov');
  const id = await createCustomer('Test6 PartialSale');
  await addSale(id, 20, 'cash', 50000, 0); // 6500*20=130,000 - 50,000 = 80,000 qarz
  let b = await getBalance(id);
  check('cashDebt after partial payment at sale', b.cashDebt, 80000);
  check('currentDebt after partial payment at sale', b.currentDebt, 80000);
}

// --- Test 7: Overpayment in one category offsets other ---
async function test7() {
  console.log('\n📌 Test 7: Ortiqcha to\'lov ikkinchi kategoriyani yopadi');
  const id = await createCustomer('Test7 Overpay');
  await addSale(id, 10, 'cash'); // 6500 * 10 = 65,000 cash debt
  await addSale(id, 10, 'transfer'); // 7280 * 10 = 72,800 transfer debt
  // Pay 80,000 in transfer (covers 72,800 transfer + 7,200 extra covers cash)
  await addPayment(id, 0, 80000);
  let b = await getBalance(id);
  check('transferDebt after overpay', b.transferDebt, 0);
  check('cashDebt after overpay offset', b.cashDebt, 65000 - 7200); // 57,800
  check('currentDebt after overpay', b.currentDebt, 57800);
}

// Run all tests
async function main() {
  try {
    await test1();
    await test2();
    await test3();
    await test4();
    await test5();
    await test6();
    await test7();
    console.log(`\n=== Natija: ${passed} o'tdi ✅, ${failed} xato ❌ ===`);
  } catch (e) {
    console.error('Kritik xato:', e.message);
  }
}

main();
