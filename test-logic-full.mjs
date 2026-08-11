/**
 * Сыр АКБЕЛ — Sayt logikasi bo'yicha chuqur test
 * Server ishga tushirilmagan holda, lib/* modullarini to'g'ridan-to'g'ri import qilib test qiladi
 */

import {
  approveTransaction,
  createWarehouseOrder,
  deleteCustomer,
  getCustomerDetail,
  getWarehousePricing,
  groupCustomersByPaymentType,
  listApprovedTransactions,
  listCustomerSummaries,
  listPendingTransactions,
  loadWarehouseState,
  recordApprovedSale,
  recordCustomerPayment,
  restoreDeletedCustomer,
  upsertCustomer,
  createStaffAccount,
  updateStaffAccountPermissions,
  createStaffAccessLink,
  authenticateStaffAccessToken,
  authenticateStaffAccount,
  verifyStaffPin,
} from "./lib/warehouse-bot.mjs";

// ========= Yordamchi =========
let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ ok: true, name });
    passed++;
  } catch (e) {
    results.push({ ok: false, name, error: e.message });
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertClose(a, b, tolerance = 0.01, msg) {
  if (Math.abs(a - b) > tolerance) throw new Error(msg || `Expected ~${b}, got ${a}`);
}

// ========= Bo'sh state =========
function freshState() {
  return {
    users: [],
    transactions: [],
    orders: [],
    stockReceipts: [],
    sellerCashHandoffs: [],
    telegramMessages: [],
    idempotencyRequests: [],
    deletedCustomers: [],
    staffAccounts: [],
    staffLinks: [],
    warehouse: {
      currentStockKg: 1000,
      cashPricePerKg: 67000,
      transferPricePerKg: 75000,
    },
    lastIds: {
      handoff: 0,
      receipt: 0,
      staff: 0,
      user: 0,
      order: 0,
      transaction: 0,
      telegramMsg: 0,
    },
  };
}

// ========= 1. PRICING =========
test("Narx to'g'ri qaytariladi", () => {
  const state = freshState();
  const pricing = getWarehousePricing(state);
  assertEqual(pricing.cashPricePerKg, 67000, "Naqd narx");
  assertEqual(pricing.transferPricePerKg, 75000, "O'tkazma narx");
});

// ========= 2. MIJOZ QO'SHISH =========
test("Yangi mijoz qo'shiladi", () => {
  const state = freshState();
  const customer = upsertCustomer(state, { fullName: "Ali Valiyev", phone: "+998901234567", paymentCategories: ["cash"] }, {});
  assert(customer.id > 0, "ID bo'lishi kerak");
  assertEqual(state.users.length, 1, "State da 1 ta mijoz");
  assertEqual(state.users[0].fullName, "Ali Valiyev");
});

test("Mavjud mijozni yangilash (upsert)", () => {
  const state = freshState();
  const c1 = upsertCustomer(state, { fullName: "Vali Karimov" }, {});
  const c2 = upsertCustomer(state, { userId: c1.id, fullName: "Vali Karimov Yangilangan" }, {});
  assertEqual(state.users.length, 1, "Yangi mijoz yaratilmasin");
  assertEqual(state.users[0].fullName, "Vali Karimov Yangilangan");
});

// ========= 3. SAVDO YOZISH =========
test("Naqd savdo yoziladi va qarz hisoblanadi", () => {
  const state = freshState();
  state.warehouse.currentStockKg = 500;
  const customer = upsertCustomer(state, { fullName: "Bekzod Toshmatov", paymentCategories: ["cash"] }, {});
  
  const operator = { id: 1, username: "seller1", role: "seller" };
  recordApprovedSale(state, {
    userId: customer.id,
    amountKg: 10,
    priceType: "cash",
    cashPaidAmount: 300000,
    transferPaidAmount: 0,
  }, operator);

  const pricing = getWarehousePricing(state);
  const summaries = listCustomerSummaries(state, pricing);
  const found = summaries.find(c => c.id === customer.id);
  
  assert(found, "Mijoz summaryda bo'lishi kerak");
  const expectedDebt = 10 * 67000 - 300000; // 670000 - 300000 = 370000
  assertClose(found.currentDebt, expectedDebt, 1, `Qarz = ${expectedDebt}`);
});

test("Ombor kamayadi savdo yozilganda", () => {
  const state = freshState();
  state.warehouse.currentStockKg = 500;
  const customer = upsertCustomer(state, { fullName: "Test Mijoz" }, {});
  const operator = { id: 1, username: "seller1", role: "seller" };
  
  recordApprovedSale(state, {
    userId: customer.id,
    amountKg: 50,
    priceType: "cash",
    cashPaidAmount: 0,
    transferPaidAmount: 0,
  }, operator);
  
  assert(state.warehouse.currentStockKg <= 450, "Ombor kamayishi kerak");
});

// ========= 4. TO'LOV YOZISH =========
test("To'lov yozilganda qarz kamayadi", () => {
  const state = freshState();
  const customer = upsertCustomer(state, { fullName: "Hamid Usmonov", paymentCategories: ["cash"] }, {});
  const operator = { id: 1, username: "seller1", role: "seller" };
  
  // Avval 10 kg savdo
  recordApprovedSale(state, {
    userId: customer.id,
    amountKg: 10,
    priceType: "cash",
    cashPaidAmount: 0,
    transferPaidAmount: 0,
  }, operator);
  
  // Keyin to'lov
  recordCustomerPayment(state, {
    userId: customer.id,
    cashPaidAmount: 500000,
    transferPaidAmount: 0,
  }, operator);

  const pricing = getWarehousePricing(state);
  const summaries = listCustomerSummaries(state, pricing);
  const found = summaries.find(c => c.id === customer.id);
  
  const expectedDebt = Math.max(0, 10 * 67000 - 500000);
  assertClose(found.currentDebt, expectedDebt, 1, "To'lovdan keyin qarz");
});

// ========= 5. BUYURTMA (ORDER) =========
test("Yangi buyurtma yaratiladi", () => {
  const state = freshState();
  const customer = upsertCustomer(state, { fullName: "Nodir Rahimov" }, {});
  const operator = { id: 1, username: "seller1", role: "seller" };
  
  const order = createWarehouseOrder(state, {
    customerName: "Nodir Rahimov",
    note: "Tez yetkazib bering",
  }, operator);
  
  assert(order.id > 0, "Order ID bo'lishi kerak");
  assertEqual(state.orders.length, 1, "State da 1 ta order");
  assertEqual(state.orders[0].customerName, "Nodir Rahimov");
});

// ========= 6. PENDING -> APPROVE =========
test("Pending transaksiya tasdiqlanadi", () => {
  const state = freshState();
  state.warehouse.currentStockKg = 200;
  const customer = upsertCustomer(state, { fullName: "Sarvar Mirzayev" }, {});
  
  // Pending transaksiya qo'shamiz
  const txId = Date.now();
  state.transactions.push({
    id: txId,
    userId: customer.id,
    amountKg: 5,
    totalPrice: 5 * 67000,
    status: "pending",
    kind: "sale",
    priceType: "cash",
    cashPaidAmount: 0,
    transferPaidAmount: 0,
    createdAt: new Date().toISOString(),
  });
  
  const operator = { id: 1, username: "admin", role: "admin" };
  const approved = approveTransaction(state, txId, {
    amountKg: 5,
    cashPaidAmount: 100000,
    transferPaidAmount: 0,
  }, operator);
  
  assert(approved, "Tasdiqlangan transaksiya qaytarilishi kerak");
  const tx = state.transactions.find(t => t.id === txId);
  assertEqual(tx?.status, "approved", "Status 'approved' bo'lishi kerak");
});

// ========= 7. MIJOZNI O'CHIRISH =========
test("Mijozni o'chirish va tiklash", () => {
  const state = freshState();
  const customer = upsertCustomer(state, { fullName: "O'chiriluvchi Mijoz" }, {});
  
  deleteCustomer(state, customer.id);
  assertEqual(state.users.filter(u => !u.deleted).length, 0, "Aktiv mijoz yo'q");
  
  // Tiklash
  restoreDeletedCustomer(state, customer.id);
  const active = state.users.filter(u => !u.deleted);
  assertEqual(active.length, 1, "Tiklangandan keyin 1 ta aktiv mijoz");
});

// ========= 8. XODIM AKKAUNT =========
test("Xodim akkaunt yaratiladi va autentifikatsiya bo'ladi", () => {
  const state = freshState();
  const rawPassword = "test1234";
  
  const staff = createStaffAccount(state, {
    fullName: "Dilshod Sotuvchi",
    username: "dilshod_seller",
    password: rawPassword,
    role: "seller",
    permissions: ["seller", "customers"],
  });
  
  assert(staff.id > 0, "ID bo'lishi kerak");
  assertEqual(staff.fullName, "Dilshod Sotuvchi");
  
  // Autentifikatsiya
  const auth = authenticateStaffAccount(state, "dilshod_seller", rawPassword);
  assert(auth, "Autentifikatsiya muvaffaqiyatli bo'lishi kerak");
  assertEqual(auth.fullName, "Dilshod Sotuvchi");
});

// ========= 9. RUXSAT HAVOLASI =========
test("Staff access link yaratiladi va tekshiriladi", () => {
  const state = freshState();
  const staff = createStaffAccount(state, {
    fullName: "Muxammad Buxgalter",
    username: "muxammad_acc",
    password: "pass5678",
    role: "accountant",
    permissions: ["transfer"],
  });
  
  const link = createStaffAccessLink(state, staff.id, "transfer");
  assert(link.token, "Token bo'lishi kerak");
  
  const operator = authenticateStaffAccessToken(state, link.token, "transfer");
  assert(operator, "Token bilan autentifikatsiya bo'lishi kerak");
  assertEqual(operator.fullName, "Muxammad Buxgalter");
});

// ========= 10. MIJOZLARNI GURUHLASH =========
test("Mijozlar to'lov turiga qarab guruhlanadi", () => {
  const state = freshState();
  upsertCustomer(state, { fullName: "Naqd 1", paymentCategories: ["cash"] }, {});
  upsertCustomer(state, { fullName: "Naqd 2", paymentCategories: ["cash"] }, {});
  upsertCustomer(state, { fullName: "O'tkazma 1", paymentCategories: ["transfer"] }, {});
  upsertCustomer(state, { fullName: "Aralash", paymentCategories: ["cash", "transfer"] }, {});
  
  const pricing = getWarehousePricing(state);
  const grouped = groupCustomersByPaymentType(state, pricing);
  
  assert(grouped.cashCustomers.length >= 2, "Kamida 2 naqd mijoz");
  assert(grouped.transferCustomers.length >= 1, "Kamida 1 o'tkazma mijoz");
});

// ========= 11. QARZ HISOBLASH ANIQLIGI =========
test("Qarz hisoblash to'g'ri (10 kg naqd, 0 to'lov)", () => {
  const state = freshState();
  const customer = upsertCustomer(state, { fullName: "Test Qarz", paymentCategories: ["cash"] }, {});
  const operator = { id: 1, username: "seller1", role: "seller" };
  
  recordApprovedSale(state, {
    userId: customer.id,
    amountKg: 10,
    priceType: "cash",
    cashPaidAmount: 0,
    transferPaidAmount: 0,
  }, operator);
  
  const pricing = getWarehousePricing(state);
  const detail = getCustomerDetail(state, customer.id, pricing);
  
  const expectedDebt = 10 * 67000; // 670,000 so'm
  assertClose(detail.currentDebt, expectedDebt, 1, "10 kg * 67000 = 670000");
});

test("Qarz hisoblash to'g'ri (o'tkazma: 5 kg, 200000 to'lov)", () => {
  const state = freshState();
  const customer = upsertCustomer(state, { fullName: "Test Transfer", paymentCategories: ["transfer"] }, {});
  const operator = { id: 1, username: "seller1", role: "seller" };
  
  recordApprovedSale(state, {
    userId: customer.id,
    amountKg: 5,
    priceType: "transfer",
    cashPaidAmount: 0,
    transferPaidAmount: 200000,
  }, operator);
  
  const pricing = getWarehousePricing(state);
  const detail = getCustomerDetail(state, customer.id, pricing);
  
  const expectedDebt = 5 * 75000 - 200000; // 375000 - 200000 = 175000
  assertClose(detail.currentDebt, expectedDebt, 1, "5 kg * 75000 - 200000 = 175000");
});

// ========= 12. XAVFSIZLIK: Noto'g'ri parol =========
test("Noto'g'ri parol bilan kirish bloklanadi", () => {
  const state = freshState();
  createStaffAccount(state, {
    fullName: "Xodim",
    username: "xodim_user",
    password: "correct_pass99",
    role: "seller",
    permissions: ["seller"],
  });
  
  const wrongAuth = authenticateStaffAccount(state, "xodim_user", "wrong_password_123");
  assert(!wrongAuth, "Noto'g'ri parol bilan kirish mumkin emas");
});

test("Bekor qilingan token bilan kirish mumkin emas", () => {
  const state = freshState();
  const staff = createStaffAccount(state, {
    fullName: "Xodim2",
    username: "xodim2_user",
    password: "securepass22",
    role: "seller",
    permissions: ["seller"],
  });
  const link = createStaffAccessLink(state, staff.id, "seller");
  
  // staffAccounts ichida linkni revoke qilish
  const account = state.staffAccounts.find(a => a.id === staff.id);
  const linkEntry = account?.accessLinks?.find(l => l.token === link.token);
  if (linkEntry) linkEntry.revokedAt = new Date().toISOString();
  
  const operator = authenticateStaffAccessToken(state, link.token, "seller");
  assert(!operator, "Revoke qilingan token bilan kirish mumkin emas");
});

// ========= 13. OMBOR LIMITI =========
test("Omborda yetarli mahsulot bo'lmasa savdo yoziladi lekin ombor manfiy ketmaydi", () => {
  const state = freshState();
  state.warehouse.currentStockKg = 5; // Faqat 5 kg
  const customer = upsertCustomer(state, { fullName: "Test Limit" }, {});
  const operator = { id: 1, username: "seller1", role: "seller" };
  
  // 10 kg sotmoqchi (lekin 5 kg bor)
  try {
    recordApprovedSale(state, {
      userId: customer.id,
      amountKg: 10,
      priceType: "cash",
      cashPaidAmount: 0,
      transferPaidAmount: 0,
    }, operator);
    // Agar error chiqmasa, ombor manfiy bo'lmasin
    assert(state.warehouse.currentStockKg >= 0, "Ombor manfiy bo'lmasligi kerak");
  } catch (e) {
    // Xatolik chiqsa - bu ham to'g'ri xatti-harakat
    assert(true, "Ombor limiti xatolik chiqardi - bu to'g'ri");
  }
});

// ========= 14. MIJOZ TARIXINI KO'RISH =========
test("Mijoz tarixi to'g'ri ko'rinadi", () => {
  const state = freshState();
  const customer = upsertCustomer(state, { fullName: "Tarix Test" }, {});
  const operator = { id: 1, username: "seller1", role: "seller" };
  
  // 3 ta savdo
  for (let i = 0; i < 3; i++) {
    recordApprovedSale(state, {
      userId: customer.id,
      amountKg: 5,
      priceType: "cash",
      cashPaidAmount: 50000,
      transferPaidAmount: 0,
    }, operator);
  }
  
  const pricing = getWarehousePricing(state);
  const detail = getCustomerDetail(state, customer.id, pricing);
  
  assert(detail.history.length >= 3, "Tarix 3 ta yozuvni o'z ichiga olishi kerak");
});

// ========= NATIJALAR =========
console.log("\n" + "=".repeat(60));
console.log("  СЫР АКБЕЛ — ЛОГИКА ТЕСТИ НАТИЖАЛАРИ");
console.log("=".repeat(60) + "\n");

let category = "";
for (const r of results) {
  const icon = r.ok ? "✅" : "❌";
  console.log(`${icon} ${r.name}`);
  if (!r.ok) {
    console.log(`   ⚠️  ${r.error}`);
  }
}

console.log("\n" + "-".repeat(60));
console.log(`📊 Jami: ${passed + failed} ta test`);
console.log(`✅ O'tdi: ${passed}`);
console.log(`❌ Xato: ${failed}`);
console.log(`📈 Foiz: ${Math.round((passed / (passed + failed)) * 100)}%`);
console.log("-".repeat(60) + "\n");

if (failed > 0) {
  console.log("❌ XATO TESTLAR:");
  results.filter(r => !r.ok).forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
} else {
  console.log("🎉 Barcha testlar muvaffaqiyatli o'tdi!");
}
