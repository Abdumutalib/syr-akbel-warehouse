import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleWarehouseApiRoute } from "../server/handle-api.mjs";
import {
  createPendingTransaction,
  listCustomerSummaries,
  loadWarehouseState,
  saveWarehouseState,
  seedWarehouseStock,
  upsertCustomer,
} from "../lib/warehouse-bot.mjs";

// --- Yordamchi funksiyalar ---

function makeTempState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-webhook-"));
  const dbPath = path.join(dir, "warehouse.json");
  const state = loadWarehouseState(dbPath);
  return { dbPath, state };
}

function makeReq(method, body) {
  return {
    method,
    headers: {},
    _body: body,
  };
}

function makeRes() {
  const res = { statusCode: null, body: null };
  res.writeHead = (code) => { res.statusCode = code; };
  res.end = (data) => { res.body = data ? JSON.parse(data) : null; };
  return res;
}

function makeDeps(state, dbPath, overrides = {}) {
  const sentToUser = [];
  const sentToAdmin = [];
  const sentToChannel = [];

  const deps = {
    assertWarehouseAdmin: () => true,
    assertWarehouseOperator: () => true,
    buildDebtReply: (name, debt) => `QARZI: ${name} ${debt}`,
    buildPendingReply: (r) => `KUTMOQDA: ${r.user.fullName} ${r.transaction.amountKg}kg`,
    buildAdminNewOrderMsg: (name, kg) => `ADMIN: ${name} ${kg}kg`,
    buildChannelNewOrderMsg: (name, kg) => `KANAL: ${name} ${kg}kg`,
    buildChannelSaleMsg: () => "",
    buildChannelPaymentMsg: () => "",
    buildChannelApprovalMsg: () => "",
    buildCustomerSaleMsg: () => "",
    buildCustomerPaymentMsg: () => "",
    createStaffAccessLink: () => {},
    createStaffAccount: () => {},
    createWarehouseOrder: () => {},
    currentWarehousePricing: (s) => ({ cashPricePerKg: s.warehouse?.cashPricePerKg ?? 10000, transferPricePerKg: s.warehouse?.transferPricePerKg ?? 10000 }),
    deleteCustomer: () => {},
    deleteStaffAccount: () => {},
    getCustomerDetail: () => null,
    groupCustomersByPaymentType: () => ({ cash: [], transfer: [] }),
    listApprovedTransactions: () => [],
    listCustomerSummaries: (s, pricing) => listCustomerSummaries(s, pricing),
    listDeletedCustomers: () => [],
    listPendingTransactions: () => [],
    listWarehouseOrders: () => [],
    listStaffAccounts: () => [],
    loadWarehouse: () => loadWarehouseState(dbPath),
    saveWarehouse: (s) => saveWarehouseState(dbPath, s),
    withWarehouseRead: (fn) => fn(loadWarehouseState(dbPath)),
    withWarehouseWrite: async (fn) => {
      const s = loadWarehouseState(dbPath);
      const result = await fn(s);
      saveWarehouseState(dbPath, s);
      return result;
    },
    normalizeApprovalPayment: (b) => ({
      cashPaidAmount: Number(b?.cashPaidAmount || 0),
      transferPaidAmount: Number(b?.transferPaidAmount || 0),
    }),
    readPostJson: async () => deps._postBody ?? null,
    recordApprovedSale: () => {},
    recordCustomerPayment: () => {},
    restoreDeletedCustomer: () => {},
    revokeStaffAccessLink: () => {},
    seedWarehouseStock: () => {},
    sendApiJson: (res, code, body) => {
      res.statusCode = code;
      res.body = body;
    },
    sendTelegramMessage: async (id, text) => { sentToUser.push({ id, text }); return true; },
    sendTelegramChannelMessage: async (text) => { sentToChannel.push(text); return true; },
    sendTelegramCashChannelMessage: async () => true,
    sendTelegramTransferChannelMessage: async () => true,
    sendTransactionPhotosToChannels: async () => true,
    sendTelegramAdminDm: async (text) => { sentToAdmin.push(text); return true; },
    summarizeApprovedTransactions: () => "",
    summarizeCustomers: () => "",
    approveTransaction: () => {},
    updateStaffAccountPermissions: () => {},
    updateWarehousePricing: () => {},
    upsertCustomer: (s, data) => upsertCustomer(s, data),
    extractTelegramMessage: (body) => {
      if (body?.business_connection) {
        const bc = body.business_connection;
        return {
          text: null,
          telegramId: bc.user?.id ?? null,
          type: "business_connection",
          isConnected: bc.is_enabled !== false,
          userName: bc.user?.first_name ?? null,
        };
      }
      const message = body?.business_message || body?.message;
      if (!message) return null;
      return {
        text: typeof message.text === "string" ? message.text.trim() : "",
        telegramId: message.chat?.id ?? message.from?.id ?? null,
        type: "message",
      };
    },
    createWarehouseTransaction: async (payload) => {
      const s = loadWarehouseState(dbPath);
      seedWarehouseStock(s, 1000);
      const result = createPendingTransaction(s, { text: payload.text, telegramId: payload.telegramId });
      saveWarehouseState(dbPath, s);
      return result;
    },
    _sentToUser: sentToUser,
    _sentToAdmin: sentToAdmin,
    _sentToChannel: sentToChannel,
    // Scheduler deps (testda boshqariladi)
    _schedulerState: { pendingDebtReminderApproval: false },
    get getSchedulerState() { return () => deps._schedulerState; },
    sendDebtRemindersToAll: async () => {
      // barcha qarzdorlarga xabar yuborish
      const s = loadWarehouseState(dbPath);
      const pricing = { cashPricePerKg: 10000, transferPricePerKg: 10000 };
      const debtors = listCustomerSummaries(s, pricing).filter(
        (c) => (c.currentDebt ?? 0) > 0 && c.telegramId != null
      );
      for (const c of debtors) {
        await deps.sendTelegramMessage(c.telegramId, `ESLATMA: ${c.fullName} ${c.currentDebt}`);
      }
      deps._schedulerState.pendingDebtReminderApproval = false;
      await deps.sendTelegramAdminDm(`✅ Qarz eslatmasi ${debtors.length}/${debtors.length} ta mijozga yuborildi.`);
    },
    sendDebtReminderApprovalRequest: async () => {
      const s = loadWarehouseState(dbPath);
      const pricing = { cashPricePerKg: 10000, transferPricePerKg: 10000 };
      const debtors = listCustomerSummaries(s, pricing).filter(
        (c) => (c.currentDebt ?? 0) > 0 && c.telegramId != null
      );
      if (debtors.length === 0) return;
      await deps.sendTelegramAdminDm(`RUXSAT: ${debtors.length} ta qarzdor. /ha`);
      deps._schedulerState.pendingDebtReminderApproval = true;
    },
    cancelPendingDebtReminder: () => {
      deps._schedulerState.pendingDebtReminderApproval = false;
    },
  };
  return deps;
}

// --- Testlar ---

describe("Telegram webhook handleri", () => {
  test("1. Business bot ulanganda admin DM oladi", async () => {
    const { dbPath, state } = makeTempState();
    const deps = makeDeps(state, dbPath);
    deps._postBody = {
      business_connection: {
        id: "bc123",
        is_enabled: true,
        user: { id: 555, first_name: "Botir" },
      },
    };

    const req = makeReq("POST", deps._postBody);
    const res = makeRes();

    await handleWarehouseApiRoute(req, res, null, "/api/telegram/webhook", deps);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.type, "business_connection");
    assert.equal(deps._sentToAdmin.length, 1);
    assert.ok(deps._sentToAdmin[0].includes("ulandi"), `DM matni: ${deps._sentToAdmin[0]}`);
    assert.ok(deps._sentToAdmin[0].includes("Botir"), `DM da ism yo'q: ${deps._sentToAdmin[0]}`);
  });

  test("2. Business bot uzilganda admin DM oladi", async () => {
    const { dbPath, state } = makeTempState();
    const deps = makeDeps(state, dbPath);
    deps._postBody = {
      business_connection: {
        id: "bc123",
        is_enabled: false,
        user: { id: 555, first_name: "Kamola" },
      },
    };

    const req = makeReq("POST", deps._postBody);
    const res = makeRes();

    await handleWarehouseApiRoute(req, res, null, "/api/telegram/webhook", deps);

    assert.equal(res.statusCode, 200);
    assert.equal(deps._sentToAdmin.length, 1);
    assert.ok(deps._sentToAdmin[0].includes("uzildi"), `DM matni: ${deps._sentToAdmin[0]}`);
    assert.ok(deps._sentToAdmin[0].includes("Kamola"), `DM da ism yo'q: ${deps._sentToAdmin[0]}`);
  });

  test("3. Buyurtma webhook: Ali aka 12 kg (lotin) — kutmoqda javob yuboriladi", async () => {
    const { dbPath, state } = makeTempState();
    const deps = makeDeps(state, dbPath);
    deps._postBody = {
      message: {
        text: "Ali aka 12 kg",
        chat: { id: 777 },
      },
    };

    const req = makeReq("POST", deps._postBody);
    const res = makeRes();

    await handleWarehouseApiRoute(req, res, null, "/api/telegram/webhook", deps);

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.ok);
    assert.ok(typeof res.body.transactionId === "number", "transactionId raqam emas");

    // Foydalanuvchiga javob yuborilgan
    assert.equal(deps._sentToUser.length, 1);
    assert.equal(deps._sentToUser[0].id, 777);
    assert.ok(deps._sentToUser[0].text.includes("KUTMOQDA"), `Javob: ${deps._sentToUser[0].text}`);

    // Adminga xabar yuborilgan
    assert.equal(deps._sentToAdmin.length, 1);
    assert.ok(deps._sentToAdmin[0].includes("Ali"), `Admin DM: ${deps._sentToAdmin[0]}`);

    // Kanalga xabar yuborilgan
    assert.equal(deps._sentToChannel.length, 1);
  });

  test("4. qarz so'rovi: mijoz o'z qarzini ko'radi", async () => {
    const { dbPath, state } = makeTempState();
    seedWarehouseStock(state, 200);
    upsertCustomer(state, { fullName: "Зулфия", telegramId: 888, phone: null });
    saveWarehouseState(dbPath, state);

    const deps = makeDeps(state, dbPath);
    deps._postBody = {
      message: {
        text: "qarz",
        chat: { id: 888 },
      },
    };

    const req = makeReq("POST", deps._postBody);
    const res = makeRes();

    await handleWarehouseApiRoute(req, res, null, "/api/telegram/webhook", deps);

    assert.equal(res.statusCode, 200);
    assert.equal(deps._sentToUser.length, 1);
    assert.equal(deps._sentToUser[0].id, 888);
    assert.ok(
      deps._sentToUser[0].text.includes("Зулфия"),
      `Javobda ism yo'q: ${deps._sentToUser[0].text}`
    );
  });
});

describe("Qarz eslatma scheduler (admin ruxsati)", () => {
  test("5. /eslatma — admin qarzdorlar ro'yxatini oladi", async () => {
    const { dbPath, state } = makeTempState();
    // 2 ta qarzdor mijoz qo'shamiz (approved transaction kerak)
    upsertCustomer(state, { fullName: "Alisher", telegramId: 100, phone: null });
    upsertCustomer(state, { fullName: "Barno", telegramId: 101, phone: null });
    saveWarehouseState(dbPath, state);
    // Direkt pending transaction qo'shamiz (test uchun)
    const s2 = loadWarehouseState(dbPath);
    seedWarehouseStock(s2, 500);
    const t1 = createPendingTransaction(s2, { text: "Alisher 5 кг", telegramId: 100 });
    const t2 = createPendingTransaction(s2, { text: "Barno 3 кг", telegramId: 101 });
    // Approve qilamiz
    const { approveTransaction } = await import("../lib/warehouse-bot.mjs");
    approveTransaction(s2, t1.transaction.id, { cashPaidAmount: 0, transferPaidAmount: 0 });
    approveTransaction(s2, t2.transaction.id, { cashPaidAmount: 0, transferPaidAmount: 0 });
    saveWarehouseState(dbPath, s2);

    const deps = makeDeps(s2, dbPath);
    deps._postBody = { message: { text: "/eslatma", chat: { id: 999 } } };

    const req = makeReq("POST", deps._postBody);
    const res = makeRes();
    await handleWarehouseApiRoute(req, res, null, "/api/telegram/webhook", deps);

    assert.equal(res.statusCode, 200);
    assert.equal(deps._sentToAdmin.length, 1, "Admin ga xabar yuborilmadi");
    assert.ok(deps._sentToAdmin[0].includes("RUXSAT"), `Admin DM: ${deps._sentToAdmin[0]}`);
    assert.ok(deps._schedulerState.pendingDebtReminderApproval, "Pending flag o'rnatilmadi");
  });

  test("6. /ha — admin tasdiqlasa eslatma yuboriladi", async () => {
    const { dbPath, state } = makeTempState();
    seedWarehouseStock(state, 500);
    const t = createPendingTransaction(state, { text: "Камила 4 кг", telegramId: 200 });
    const { approveTransaction } = await import("../lib/warehouse-bot.mjs");
    approveTransaction(state, t.transaction.id, { cashPaidAmount: 0, transferPaidAmount: 0 });
    saveWarehouseState(dbPath, state);

    const deps = makeDeps(state, dbPath);
    deps._schedulerState.pendingDebtReminderApproval = true;
    deps._postBody = { message: { text: "/ha", chat: { id: 999 } } };

    const req = makeReq("POST", deps._postBody);
    const res = makeRes();
    await handleWarehouseApiRoute(req, res, null, "/api/telegram/webhook", deps);

    assert.equal(res.statusCode, 200);
    assert.equal(deps._sentToUser.length, 1, "Mijozga xabar yuborilmadi");
    assert.equal(deps._sentToUser[0].id, 200);
    assert.ok(deps._sentToUser[0].text.includes("ESLATMA"), `Xabar: ${deps._sentToUser[0].text}`);
    assert.ok(!deps._schedulerState.pendingDebtReminderApproval, "Pending flag tozalanmadi");
  });

  test("7. /yoq — admin bekor qilsa flag tozalanadi", async () => {
    const { dbPath, state } = makeTempState();
    const deps = makeDeps(state, dbPath);
    deps._schedulerState.pendingDebtReminderApproval = true;
    deps._postBody = { message: { text: "/yoq", chat: { id: 999 } } };

    const req = makeReq("POST", deps._postBody);
    const res = makeRes();
    await handleWarehouseApiRoute(req, res, null, "/api/telegram/webhook", deps);

    assert.equal(res.statusCode, 200);
    assert.ok(!deps._schedulerState.pendingDebtReminderApproval, "Flag tozalanmadi");
    assert.ok(deps._sentToAdmin[0].includes("bekor"), `Admin DM: ${deps._sentToAdmin[0]}`);
    assert.equal(deps._sentToUser.length, 0, "Mijozga xabar yuborilmasligi kerak");
  });

  test("8. /ha — pending yo'q bo'lsa xato xabar", async () => {
    const { dbPath, state } = makeTempState();
    const deps = makeDeps(state, dbPath);
    deps._schedulerState.pendingDebtReminderApproval = false;
    deps._postBody = { message: { text: "/ha", chat: { id: 999 } } };

    const req = makeReq("POST", deps._postBody);
    const res = makeRes();
    await handleWarehouseApiRoute(req, res, null, "/api/telegram/webhook", deps);

    assert.equal(res.statusCode, 200);
    assert.equal(deps._sentToUser.length, 0, "Mijozga xabar yuborilmasligi kerak");
    assert.ok(deps._sentToAdmin[0].includes("yo'q"), `Admin DM: ${deps._sentToAdmin[0]}`);
  });
});
