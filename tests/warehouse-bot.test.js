import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  authenticateStaffAccessToken,
  authenticateStaffAccount,
  approveTransaction,
  createStaffAccessLink,
  createStaffAccount,
  deleteCustomer,
  deleteStaffAccount,
  createPendingTransaction,
  extractNameAndAmount,
  getCustomerDetail,
  getWarehousePricing,
  groupCustomersByPaymentType,
  listApprovedTransactions,
  listCustomerSummaries,
  listDeletedCustomers,
  listStaffAccounts,
  loadWarehouseState,
  recalculateDebt,
  recordApprovedSale,
  recordCustomerPayment,
  restoreDeletedCustomer,
  revokeStaffAccessLink,
  saveWarehouseState,
  seedWarehouseStock,
  updateWarehousePricing,
  updateStaffAccountPermissions,
  upsertCustomer,
} from "../lib/warehouse-bot.mjs";

const tempPaths = [];

afterEach(() => {
  while (tempPaths.length) {
    fs.rmSync(tempPaths.pop(), { recursive: true, force: true });
  }
});

function makeStatePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "warehouse-bot-"));
  tempPaths.push(dir);
  return path.join(dir, "warehouse.json");
}

describe("warehouse bot helpers", () => {
  test("extracts cyrillic name and kg amount", () => {
    assert.deepEqual(extractNameAndAmount("Али акага 12 кг сыр"), {
      name: "Али ака",
      amountKg: 12,
    });
  });

  test("extracts latin name and latin kg", () => {
    assert.deepEqual(extractNameAndAmount("Ali aka 12 kg"), {
      name: "Ali aka",
      amountKg: 12,
    });
  });

  test("extracts latin name with cyrillic кг", () => {
    assert.deepEqual(extractNameAndAmount("Botir 5.5 кг"), {
      name: "Botir",
      amountKg: 5.5,
    });
  });

  test("creates persistent pending transaction", () => {
    const dbPath = makeStatePath();
    const state = loadWarehouseState(dbPath);
    const result = createPendingTransaction(state, {
      text: "Баҳром 5.5 кг",
      telegramId: 123,
    });

    saveWarehouseState(dbPath, state);
    const reloaded = loadWarehouseState(dbPath);

    assert.equal(result.transaction.totalPrice, 55000);
    assert.equal(reloaded.transactions.length, 1);
    assert.equal(reloaded.users[0].telegramId, 123);
  });

  test("approves transaction and recalculates debt", () => {
    const state = loadWarehouseState(makeStatePath());
    seedWarehouseStock(state, 100);
    const first = createPendingTransaction(state, { text: "Азиза 10 кг" });
    const second = createPendingTransaction(state, { text: "Азиза 5 кг" });

    approveTransaction(state, first.transaction.id, {
      cashPaidAmount: 20000,
      transferPaidAmount: 30000,
    });
    const final = approveTransaction(state, second.transaction.id, {
      cashPaidAmount: 0,
      transferPaidAmount: 0,
    });

    assert.equal(final.user.fullName, "Азиза");
    assert.equal(final.debt, 100000);
    assert.equal(state.warehouse.currentStockKg, 85);
    assert.equal(final.transaction.cashPaidAmount, 0);
    assert.equal(final.transaction.transferPaidAmount, 0);
    assert.equal(recalculateDebt(state, first.user.id), 100000);
  });

  test("keeps legacy paidAmount data compatible", () => {
    const dbPath = makeStatePath();
    saveWarehouseState(dbPath, {
      users: [{ id: 1, fullName: "Ali", telegramId: null, phone: null, createdAt: new Date().toISOString() }],
      transactions: [{
        id: 1,
        userId: 1,
        amountKg: 10,
        totalPrice: 100000,
        paidAmount: 40000,
        status: "approved",
        extractedText: "Ali 10 kg",
        createdAt: new Date().toISOString(),
        approvedAt: new Date().toISOString(),
      }],
      warehouse: { currentStockKg: 50 },
      lastIds: { user: 1, transaction: 1 },
    });

    const state = loadWarehouseState(dbPath);

    assert.equal(state.transactions[0].cashPaidAmount, 40000);
    assert.equal(state.transactions[0].transferPaidAmount, 0);
    assert.equal(recalculateDebt(state, 1), 60000);
  });

  test("filters approved transactions by payment type", () => {
    const state = loadWarehouseState(makeStatePath());
    seedWarehouseStock(state, 100);

    const cashTx = createPendingTransaction(state, { text: "Карим 3 кг" });
    const transferTx = createPendingTransaction(state, { text: "Саида 4 кг" });
    const mixedTx = createPendingTransaction(state, { text: "Олим 2 кг" });

    approveTransaction(state, cashTx.transaction.id, { cashPaidAmount: 30000, transferPaidAmount: 0 });
    approveTransaction(state, transferTx.transaction.id, { cashPaidAmount: 0, transferPaidAmount: 40000 });
    approveTransaction(state, mixedTx.transaction.id, { cashPaidAmount: 5000, transferPaidAmount: 15000 });

    assert.deepEqual(
      listApprovedTransactions(state, "cash").map((entry) => entry.user?.fullName),
      ["Олим", "Карим"]
    );
    assert.deepEqual(
      listApprovedTransactions(state, "transfer").map((entry) => entry.user?.fullName),
      ["Олим", "Саида"]
    );
  });

  test("updates cash and transfer prices globally", () => {
    const state = loadWarehouseState(makeStatePath());
    seedWarehouseStock(state, 100);

    const cashUser = upsertCustomer(state, { fullName: "Naqd mijoz", paymentCategories: ["cash"] });
    const transferUser = upsertCustomer(state, { fullName: "O'tkazma mijoz", paymentCategories: ["transfer"] });

    recordApprovedSale(state, {
      userId: cashUser.id,
      amountKg: 2,
      cashPaidAmount: 5000,
      note: "Naqd savdo",
    });
    recordApprovedSale(state, {
      userId: transferUser.id,
      amountKg: 3,
      transferPaidAmount: 10000,
      note: "O'tkazma savdo",
    });

    updateWarehousePricing(state, { cashPricePerKg: 15000 });
    assert.equal(getWarehousePricing(state).transferPricePerKg, 11200);

    updateWarehousePricing(state, { transferPricePerKg: 16800 });

    const approved = listApprovedTransactions(state);
    const summaries = listCustomerSummaries(state);
    const transferDetail = getCustomerDetail(state, transferUser.id);

    assert.deepEqual(getWarehousePricing(state), {
      cashPricePerKg: 15000,
      transferPricePerKg: 16800,
    });
    assert.equal(approved.find((entry) => entry.user?.id === cashUser.id)?.totalPrice, 30000);
    assert.equal(approved.find((entry) => entry.user?.id === transferUser.id)?.totalPrice, 50400);
    assert.equal(summaries.find((entry) => entry.id === cashUser.id)?.cashDebt, 25000);
    assert.equal(summaries.find((entry) => entry.id === cashUser.id)?.transferDebt, 0);
    assert.equal(summaries.find((entry) => entry.id === cashUser.id)?.currentDebt, 25000);
    assert.equal(summaries.find((entry) => entry.id === transferUser.id)?.cashDebt, 0);
    assert.equal(summaries.find((entry) => entry.id === transferUser.id)?.transferDebt, 40400);
    assert.equal(summaries.find((entry) => entry.id === transferUser.id)?.currentDebt, 40400);
    assert.equal(transferDetail.summary.transferDebt, 40400);
    assert.equal(transferDetail.history[0].totalPrice, 50400);
  });

  test("supports seller customer add, sale, payment, and debt view", () => {
    const state = loadWarehouseState(makeStatePath());
    seedWarehouseStock(state, 50);

    const user = upsertCustomer(state, { fullName: "Музаффар", phone: "+998901112233" });
    const sale = recordApprovedSale(state, {
      userId: user.id,
      amountKg: 8,
      cashPaidAmount: 30000,
      transferPaidAmount: 10000,
      transactionDate: "2026-04-15",
      note: "Sotuvchi orqali savdo",
    });
    const payment = recordCustomerPayment(state, {
      userId: user.id,
      transferPaidAmount: 15000,
      transactionDate: "2026-04-16",
      note: "Keyingi to'lov",
    });
    const summaries = listCustomerSummaries(state);

    assert.equal(sale.transaction.kind, "sale");
    assert.equal(payment.transaction.kind, "payment");
    assert.equal(state.warehouse.currentStockKg, 42);
    assert.equal(summaries[0].fullName, "Музаффар");
    assert.equal(summaries[0].cashDebt, 50000);
    assert.equal(summaries[0].transferDebt, 0);
    assert.equal(summaries[0].currentDebt, 25000);
    assert.equal(summaries[0].totalTakenKg, 8);
    assert.equal(summaries[0].totalPaid, 55000);
    assert.match(sale.transaction.createdAt, /^2026-04-15T12:00:00.000Z$/);
    assert.match(payment.transaction.createdAt, /^2026-04-16T12:00:00.000Z$/);
  });

  test("updates existing customer fields by userId", () => {
    const state = loadWarehouseState(makeStatePath());
    const user = upsertCustomer(state, {
      fullName: "Старое имя",
      phone: "+998900000000",
      telegramId: 123,
      paymentCategories: ["cash"],
    });

    const updated = upsertCustomer(state, {
      userId: user.id,
      fullName: "Янги исм",
      phone: "+998901234567",
      telegramId: 999,
      paymentCategories: ["cash", "transfer"],
    });

    assert.equal(updated.fullName, "Янги исм");
    assert.equal(updated.phone, "+998901234567");
    assert.equal(updated.telegramId, 999);
    assert.deepEqual(updated.paymentCategories, ["cash", "transfer"]);
  });

  test("deletes customer with related transactions and restores stock", () => {
    const state = loadWarehouseState(makeStatePath());
    seedWarehouseStock(state, 50);

    const user = upsertCustomer(state, { fullName: "Учириладиган мижоз", paymentCategories: ["cash"] });
    recordApprovedSale(state, {
      userId: user.id,
      amountKg: 5,
      cashPaidAmount: 20000,
      note: "Sinov savdo",
    });
    recordCustomerPayment(state, {
      userId: user.id,
      cashPaidAmount: 3000,
      note: "Sinov to'lov",
    });

    const result = deleteCustomer(state, user.id);

    assert.equal(result.customer.fullName, "Учириладиган мижоз");
    assert.equal(result.deletedTransactions, 2);
    assert.equal(result.restoredStockKg, 5);
    assert.equal(state.warehouse.currentStockKg, 50);
    assert.equal(state.users.length, 0);
    assert.equal(state.transactions.length, 0);
    assert.deepEqual(listDeletedCustomers(state).map((entry) => entry.fullName), ["Учириладиган мижоз"]);
  });

  test("restores deleted customer from archive", () => {
    const state = loadWarehouseState(makeStatePath());
    seedWarehouseStock(state, 50);

    const user = upsertCustomer(state, { fullName: "Тикланадиган мижоз", paymentCategories: ["cash"] });
    recordApprovedSale(state, {
      userId: user.id,
      amountKg: 5,
      cashPaidAmount: 20000,
      note: "Sinov savdo",
    });

    deleteCustomer(state, user.id);
    const result = restoreDeletedCustomer(state, user.id);

    assert.equal(result.customer.fullName, "Тикланадиган мижоз");
    assert.equal(result.restoredTransactions, 1);
    assert.equal(result.restoredStockKg, 5);
    assert.equal(state.warehouse.currentStockKg, 45);
    assert.equal(state.users.length, 1);
    assert.equal(state.transactions.length, 1);
    assert.equal(listDeletedCustomers(state).length, 0);
  });

  test("builds grouped customer catalog and detail history", () => {
    const state = loadWarehouseState(makeStatePath());
    seedWarehouseStock(state, 90);

    const cashCustomer = upsertCustomer(state, { fullName: "Нодир", paymentCategories: ["cash"] });
    const transferCustomer = upsertCustomer(state, { fullName: "Саида", phone: "+99890" });
    const dualCustomer = upsertCustomer(state, { fullName: "Зулайхо", paymentCategories: ["cash", "transfer"] });
    const otherCustomer = upsertCustomer(state, { fullName: "Бекзод" });

    recordApprovedSale(state, {
      userId: cashCustomer.id,
      amountKg: 4,
      cashPaidAmount: 10000,
      transferPaidAmount: 0,
      note: "Naqd savdo",
    });
    recordApprovedSale(state, {
      userId: transferCustomer.id,
      amountKg: 6,
      cashPaidAmount: 0,
      transferPaidAmount: 25000,
      note: "O'tkazma savdo",
    });
    recordCustomerPayment(state, {
      userId: transferCustomer.id,
      transferPaidAmount: 5000,
      note: "Qo'shimcha to'lov",
    });

    const grouped = groupCustomersByPaymentType(state);
    const detail = getCustomerDetail(state, transferCustomer.id);

    assert.deepEqual(grouped.cashCustomers.map((entry) => entry.fullName), ["Нодир", "Зулайхо"]);
    assert.deepEqual(grouped.transferCustomers.map((entry) => entry.fullName), ["Саида", "Зулайхо"]);
    assert.deepEqual(grouped.otherCustomers.map((entry) => entry.fullName), ["Бекзод"]);
    assert.equal(detail.customer.fullName, "Саида");
    assert.equal(detail.activity.hasTransferActivity, true);
    assert.equal(detail.history.length, 2);
    assert.equal(detail.history[0].kind, "payment");
    assert.equal(detail.history[1].kind, "sale");
    assert.deepEqual(getCustomerDetail(state, dualCustomer.id).customer.paymentCategories, ["cash", "transfer"]);
    assert.equal(otherCustomer.fullName, "Бекзод");
  });

  test("creates seller and accountant accounts that only admin can manage later", () => {
    const state = loadWarehouseState(makeStatePath());

    const seller = createStaffAccount(state, {
      fullName: "Sotuvchi 1",
      username: "seller01",
      password: "4321",
      role: "seller",
      permissions: ["seller"],
    });
    const accountant = createStaffAccount(state, {
      fullName: "Buxgalter 1",
      username: "account01",
      password: "8765",
      role: "accountant",
      permissions: ["cash"],
    });

    const updatedSeller = updateStaffAccountPermissions(state, seller.id, ["seller", "customers"]);

    assert.equal(listStaffAccounts(state).length, 2);
    assert.equal(seller.role, "seller");
    assert.equal(accountant.role, "accountant");
    assert.deepEqual(updatedSeller.permissions, ["seller", "customers"]);
    assert.equal(authenticateStaffAccount(state, "seller01", "4321", { roles: ["seller"], permission: "customers" })?.username, "seller01");
    assert.equal(authenticateStaffAccount(state, "account01", "8765", { roles: ["accountant"], permission: "cash" })?.username, "account01");
    assert.equal(authenticateStaffAccount(state, "account01", "8765", { roles: ["seller"] }), null);
    assert.equal(authenticateStaffAccount(state, "account01", "8765", { roles: ["accountant"], permission: "transfer" }), null);
    assert.throws(
      () => createStaffAccount(state, { fullName: "Yana", username: "seller01", password: "9999", role: "seller" }),
      /band/
    );

    const removed = deleteStaffAccount(state, seller.id);
    assert.equal(removed.username, "seller01");
    assert.equal(listStaffAccounts(state).length, 1);
  });

  test("creates revokable access links for staff", () => {
    const state = loadWarehouseState(makeStatePath());
    const seller = createStaffAccount(state, {
      fullName: "Linkli sotuvchi",
      username: "sellerlink",
      password: "1234",
      role: "seller",
      permissions: ["seller", "customers"],
    });

    const link = createStaffAccessLink(state, seller.id, "seller");
    const auth = authenticateStaffAccessToken(state, link.token, "seller");

    assert.equal(link.permission, "seller");
    assert.equal(auth?.username, "sellerlink");
    assert.equal(authenticateStaffAccessToken(state, link.token, "cash"), null);

    revokeStaffAccessLink(state, seller.id, link.id);
    assert.equal(authenticateStaffAccessToken(state, link.token, "seller"), null);
  });
});