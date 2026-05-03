import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DEFAULT_PRICE_PER_KG = Number(process.env.WAREHOUSE_PRICE_PER_KG) || 10000;
export const DEFAULT_TRANSFER_VAT_RATE = 0.12;
export const STAFF_PERMISSION_KEYS = ["seller", "customers", "cash", "transfer"];

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function defaultTransferPrice(cashPricePerKg) {
  return Math.round(Number(cashPricePerKg || DEFAULT_PRICE_PER_KG) * (1 + DEFAULT_TRANSFER_VAT_RATE));
}

function sanitizePricePerKg(value, message = "Narx noto'g'ri") {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(message);
  }
  return Math.round(amount);
}

function normalizeWarehousePricingInput(input, fallbackCashPricePerKg = DEFAULT_PRICE_PER_KG) {
  if (typeof input === "number") {
    const pricePerKg = sanitizePricePerKg(input);
    return {
      cashPricePerKg: pricePerKg,
      transferPricePerKg: pricePerKg,
    };
  }
  const source = input && typeof input === "object" ? input : {};
  const fallbackCash = sanitizePricePerKg(fallbackCashPricePerKg);
  const cashPricePerKg = source.cashPricePerKg == null
    ? fallbackCash
    : sanitizePricePerKg(source.cashPricePerKg, "Naqd narx noto'g'ri");
  const transferPricePerKg = source.transferPricePerKg == null
    ? defaultTransferPrice(cashPricePerKg)
    : sanitizePricePerKg(source.transferPricePerKg, "O'tkazma narx noto'g'ri");
  return {
    cashPricePerKg,
    transferPricePerKg,
  };
}

function resolveWarehousePricing(pricingInput, state = null) {
  if (pricingInput !== undefined) {
    return normalizeWarehousePricingInput(pricingInput);
  }
  const warehousePricing = state?.warehouse || {};
  return normalizeWarehousePricingInput(warehousePricing);
}

function normalizeTransactionPriceType(value) {
  const priceType = String(value || "").trim().toLocaleLowerCase("en-US");
  if (!priceType) {
    return null;
  }
  if (priceType !== "cash" && priceType !== "transfer") {
    throw new Error("Narx turi noto'g'ri");
  }
  return priceType;
}

function resolveTransactionPriceType(payload = {}, user = null) {
  const explicitType = normalizeTransactionPriceType(payload.priceType);
  if (explicitType) {
    return explicitType;
  }
  const cashPaidAmount = Number(payload.cashPaidAmount || 0);
  const transferPaidAmount = Number(payload.transferPaidAmount || 0);
  if (transferPaidAmount > 0 && cashPaidAmount <= 0) {
    return "transfer";
  }
  if (cashPaidAmount > 0 && transferPaidAmount <= 0) {
    return "cash";
  }
  const paymentCategories = normalizeCustomerPaymentCategories(
    user?.paymentCategories || payload.paymentCategories || []
  );
  if (paymentCategories.length === 1) {
    return paymentCategories[0];
  }
  return "cash";
}

function getTransactionPricePerKg(pricing, priceType) {
  return priceType === "transfer"
    ? pricing.transferPricePerKg
    : pricing.cashPricePerKg;
}

function calculateTransactionTotalPrice(entry, pricing, user = null) {
  if (Number(entry.amountKg || 0) <= 0) {
    return 0;
  }
  const effectivePricing = resolveCustomerPricing(user, pricing);
  const priceType = resolveTransactionPriceType(entry, user);
  return Math.round(Number(entry.amountKg || 0) * getTransactionPricePerKg(effectivePricing, priceType));
}


  function resolveSummaryDateKey(input) {
    if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
      return input.trim();
    }
    return new Date().toISOString().slice(0, 10);
  }

  function matchesSummaryDate(entry, dateKey) {
    const timestamp = String(entry?.approvedAt || entry?.createdAt || entry?.receivedAt || "").trim();
    return Boolean(timestamp) && timestamp.slice(0, 10) === dateKey;
  }

  function matchesOperatorActivity(entry, operator) {
    if (!operator || typeof operator !== "object") {
      return true;
    }
    if (operator.id != null && Number(entry?.operatorId) === Number(operator.id)) {
      return true;
    }
    const username = normalizeUsername(operator.username);
    return Boolean(username) && normalizeUsername(entry?.operatorUsername) === username;
  }

  export function summarizeOperatorDailyActivity(state, operator, options = {}) {
    const pricing = resolveWarehousePricing(options.pricing, state);
    const dateKey = resolveSummaryDateKey(options.dateKey);
    const approvedTransactions = (Array.isArray(state.transactions) ? state.transactions : [])
      .filter((entry) => entry.status === "approved")
      .filter((entry) => matchesSummaryDate(entry, dateKey))
      .filter((entry) => matchesOperatorActivity(entry, operator));

    const summary = approvedTransactions.reduce((result, entry) => {
      const user = state.users.find((candidate) => candidate.id === entry.userId) || null;
      const priceType = resolveTransactionPriceType(entry, user);
      const totalPrice = calculateTransactionTotalPrice(entry, pricing, user);
      const blocks = Number(entry.blockCount || 0);

      if ((entry.kind || "sale") === "sale" && Number(entry.amountKg || 0) > 0) {
        result.totalBlocks += blocks;
        result.totalSales += totalPrice;
        if (priceType === "transfer") {
          result.transferBlocks += blocks;
          result.transferSales += totalPrice;
        } else {
          result.cashBlocks += blocks;
          result.cashSales += totalPrice;
        }
      }
      return result;
    }, {
      dateKey,
      cashBlocks: 0,
      transferBlocks: 0,
      totalBlocks: 0,
      cashSales: 0,
      transferSales: 0,
      totalSales: 0,
      cashSubmitted: 0,
      transferSubmitted: 0,
      submittedTotal: 0,
      difference: 0,
    });

    const handoffs = (Array.isArray(state.sellerCashHandoffs) ? state.sellerCashHandoffs : [])
      .filter((entry) => matchesSummaryDate(entry, dateKey))
      .filter((entry) => matchesOperatorActivity(entry, operator));

    for (const handoff of handoffs) {
      const amount = Number(handoff.amount || 0);
      summary.cashSubmitted += amount;
      summary.submittedTotal += amount;
    }

    summary.difference = Math.round(summary.totalSales - summary.submittedTotal);
    return summary;
  }
function initialState() {
  return {
    users: [],
    deletedCustomers: [],
    staffAccounts: [],
    orders: [],
    transactions: [],
    telegramMessages: [],
    idempotencyRequests: [],
    sellerCashHandoffs: [],
    stockReceipts: [],
    warehouse: {
      currentStockKg: 0,
      cashPricePerKg: DEFAULT_PRICE_PER_KG,
      transferPricePerKg: defaultTransferPrice(DEFAULT_PRICE_PER_KG),
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

function normalizeStoredOrder(entry) {
  return {
    id: Number(entry?.id || 0),
    customerName: String(entry?.customerName || '').trim() || null,
    organizationName: String(entry?.organizationName || '').trim() || null,
    taxId: String(entry?.taxId || '').trim() || null,
    phone: String(entry?.phone || '').trim() || null,
    note: String(entry?.note || '').trim(),
    createdAt: entry?.createdAt || null,
    operatorId: entry?.operatorId == null ? null : Number(entry.operatorId),
    operatorUsername: String(entry?.operatorUsername || '').trim() || null,
    operatorFullName: String(entry?.operatorFullName || '').trim() || null,
    operatorRole: String(entry?.operatorRole || '').trim().toLocaleLowerCase('en-US') || null,
  };
}

function normalizeStoredReceipt(entry) {
  const amountKg = Number(entry?.amountKg || 0);
  const rawBlockCount = Number(entry?.blockCount);
  const rawPricePerKg = Number(entry?.pricePerKg);
  const pricePerKg = Number.isFinite(rawPricePerKg) && rawPricePerKg > 0
    ? Math.round(rawPricePerKg)
    : null;
  const rawTotalPrice = Number(entry?.totalPrice);
  return {
    id: Number(entry?.id || 0),
    amountKg,
    blockCount: Number.isFinite(rawBlockCount) && rawBlockCount > 0 ? Math.round(rawBlockCount) : 0,
    pricePerKg,
    totalPrice: pricePerKg == null
      ? null
      : (Number.isFinite(rawTotalPrice) && rawTotalPrice > 0
          ? Math.round(rawTotalPrice)
          : Math.round(amountKg * pricePerKg)),
    note: String(entry?.note || "").trim(),
    receivedAt: entry?.receivedAt || null,
  };
}

function normalizeStoredSellerCashHandoff(entry) {
  return {
    id: Number(entry?.id || 0),
    amount: Math.max(0, Math.round(Number(entry?.amount || 0))),
    note: String(entry?.note || "").trim(),
    receivedAt: entry?.receivedAt || null,
    ...normalizeTransactionOperator(entry),
  };
}

function normalizeStoredIdempotencyEntry(entry) {
  const key = String(entry?.key || "").trim();
  const fingerprint = String(entry?.fingerprint || "").trim();
  if (!key || !fingerprint) {
    return null;
  }
  const statusCode = Number(entry?.statusCode || 0);
  return {
    key,
    fingerprint,
    statusCode: Number.isFinite(statusCode) && statusCode > 0 ? Math.round(statusCode) : 200,
    responseBody:
      entry && typeof entry.responseBody === "object" && entry.responseBody !== null
        ? entry.responseBody
        : { ok: true },
    createdAt: entry?.createdAt || new Date().toISOString(),
  };
}

function normalizePaymentBreakdown(input) {
  if (input != null && typeof input === "object" && !Array.isArray(input)) {
    const cashPaidAmount = Number(input.cashPaidAmount || 0);
    const transferPaidAmount = Number(input.transferPaidAmount || 0);
    if (!Number.isFinite(cashPaidAmount) || cashPaidAmount < 0) {
      throw new Error("Naqd summa noto'g'ri");
    }
    if (!Number.isFinite(transferPaidAmount) || transferPaidAmount < 0) {
      throw new Error("O'tkazma summasi noto'g'ri");
    }
    return {
      cashPaidAmount: Math.round(cashPaidAmount),
      transferPaidAmount: Math.round(transferPaidAmount),
    };
  }

  const paidAmount = Number(input || 0);
  if (!Number.isFinite(paidAmount) || paidAmount < 0) {
    throw new Error("To'lov summasi noto'g'ri");
  }
  return {
    cashPaidAmount: Math.round(paidAmount),
    transferPaidAmount: 0,
  };
}

function sanitizeTransactionPhoto(photo) {
  if (!photo || typeof photo !== "object") {
    return null;
  }
  const id = String(photo.id || "").trim();
  const fileName = String(photo.fileName || "").trim();
  const mimeType = String(photo.mimeType || "").trim().toLocaleLowerCase("en-US");
  const url = String(photo.url || "").trim();
  if (!fileName || !mimeType || !url) {
    return null;
  }
  const sizeBytes = Number(photo.sizeBytes || 0);
  return {
    id: id || fileName,
    fileName,
    mimeType,
    originalName: String(photo.originalName || "").trim() || null,
    sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? Math.round(sizeBytes) : 0,
    capturedAt: photo.capturedAt || null,
    url,
  };
}

function sanitizeTransactionPhotos(input) {
  const source = Array.isArray(input) ? input : [input];
  return source
    .map((entry) => sanitizeTransactionPhoto(entry))
    .filter(Boolean);
}

function normalizeCustomerPaymentCategories(input) {
  const values = Array.isArray(input) ? input : [input];
  const categories = new Set();
  for (const value of values) {
    const normalized = String(value || "").trim().toLocaleLowerCase("en-US");
    if (!normalized) {
      continue;
    }
    if (normalized === "cash") {
      categories.add("cash");
      continue;
    }
    if (normalized === "transfer") {
      categories.add("transfer");
      continue;
    }
    if (normalized === "both") {
      categories.add("cash");
      categories.add("transfer");
      continue;
    }
    throw new Error("Mijoz toifasi noto'g'ri");
  }
  return Array.from(categories).sort();
}

function hasOwn(payload, key) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

export function extractNameAndAmount(text) {
  const input = String(text || "").trim();
  const kgMatch = input.match(/(\d+(?:[.,]\d+)?)\s*(?:kg|кг|кило)/i);
  if (!kgMatch) {
    throw new Error("Kg topilmadi");
  }
  const amountKg = Number(kgMatch[1].replace(",", "."));
  if (!Number.isFinite(amountKg) || amountKg <= 0) {
    throw new Error("Kg noto'g'ri");
  }

  const nameMatch = input.match(/^([\p{L}\s]+?)\s*(?:\d+(?:[.,]\d+)?\s*(?:kg|кг|кило))/iu);
  let name = "Номаълум";
  if (nameMatch?.[1]) {
    name = nameMatch[1].trim().replace(/(га|ка|нинг|дан)$/iu, "").trim();
  } else {
    const afterMatch = input.match(/(?:kg|кг|кило)\s+([\p{L}\s]+)/iu);
    if (afterMatch?.[1]) {
      name = afterMatch[1].trim();
    }
  }

  return {
    name,
    amountKg,
  };
}

function normalizeStoredTransaction(entry) {
  const amountKg = Number(entry?.amountKg || 0);
  const rawTotalPrice = Number(entry?.totalPrice);
  const totalPrice = Number.isFinite(rawTotalPrice) && rawTotalPrice >= 0
    ? Math.round(rawTotalPrice)
    : null;
  const rawPricePerKg = Number(entry?.pricePerKg);
  const pricePerKg = Number.isFinite(rawPricePerKg) && rawPricePerKg > 0
    ? Math.round(rawPricePerKg)
    : (amountKg > 0 && totalPrice != null
        ? Math.round(totalPrice / amountKg)
        : null);
  const legacyPaid = Number(entry?.paidAmount || 0);
  const cashPaidAmount = Number(entry?.cashPaidAmount ?? legacyPaid);
  const transferPaidAmount = Number(entry?.transferPaidAmount || 0);
  const rawBlockCount = Number(entry?.blockCount);
  return {
    ...entry,
    operatorId: entry?.operatorId == null ? null : Number(entry.operatorId),
    operatorUsername: String(entry?.operatorUsername || "").trim() || null,
    operatorFullName: String(entry?.operatorFullName || "").trim() || null,
    operatorRole: String(entry?.operatorRole || "").trim().toLocaleLowerCase("en-US") || null,
    photos: sanitizeTransactionPhotos(entry?.photos || entry?.photo || []),
    photo: sanitizeTransactionPhotos(entry?.photos || entry?.photo || [])[0] || null,
    pricePerKg,
    totalPrice: totalPrice != null
      ? totalPrice
      : (amountKg > 0 && pricePerKg != null ? Math.round(amountKg * pricePerKg) : 0),
    cashPaidAmount: Number.isFinite(cashPaidAmount) ? cashPaidAmount : 0,
    transferPaidAmount: Number.isFinite(transferPaidAmount)
      ? transferPaidAmount
      : 0,
    blockCount: Number.isFinite(rawBlockCount)
      ? Math.max(0, Math.round(rawBlockCount))
      : ((entry?.kind || "sale") === "sale" && Number(entry?.amountKg || 0) > 0 ? 1 : 0),
    paidAmount:
      (Number.isFinite(cashPaidAmount) ? cashPaidAmount : 0) +
      (Number.isFinite(transferPaidAmount) ? transferPaidAmount : 0),
  };
}

function normalizeTransactionOperator(actor) {
  if (!actor || typeof actor !== "object") {
    return {
      operatorId: null,
      operatorUsername: null,
      operatorFullName: null,
      operatorRole: null,
    };
  }

  const operatorId = actor.id == null ? null : Number(actor.id);
  return {
    operatorId: Number.isFinite(operatorId) ? operatorId : null,
    operatorUsername: String(actor.username || "").trim() || null,
    operatorFullName: String(actor.fullName || actor.username || "").trim() || null,
    operatorRole: String(actor.role || "").trim().toLocaleLowerCase("en-US") || null,
  };
}

function normalizeBlockCount(value, message = "Blok soni noto'g'ri") {
  const blockCount = Number(value);
  if (!Number.isFinite(blockCount) || blockCount <= 0) {
    throw new Error(message);
  }
  return Math.round(blockCount);
}

export function loadWarehouseState(dbPath) {
  if (!fs.existsSync(dbPath)) {
    ensureParentDir(dbPath);
    const seed = initialState();
    fs.writeFileSync(dbPath, JSON.stringify(seed, null, 2));
    return seed;
  }
  const raw = fs.readFileSync(dbPath, "utf8");
  if (!raw.trim()) {
    return initialState();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const backupPath = `${dbPath}.corrupt-${Date.now()}`;
    try { fs.renameSync(dbPath, backupPath); } catch {}
    console.error(`[FATAL] warehouse.json parse failed — backed up to ${backupPath}. Starting with empty state.`, err);
    return initialState();
  }
  const transactions = Array.isArray(parsed.transactions)
    ? parsed.transactions.map(normalizeStoredTransaction)
    : [];
  const inferredCustomerOwner = new Map();
  for (const entry of transactions) {
    if (entry?.operatorRole !== "seller") {
      continue;
    }
    const operatorId = Number(entry?.operatorId);
    if (!Number.isFinite(operatorId) || operatorId <= 0) {
      continue;
    }
    inferredCustomerOwner.set(Number(entry.userId), {
      ownerOperatorId: operatorId,
      ownerOperatorUsername: String(entry?.operatorUsername || "").trim() || null,
      ownerOperatorFullName: String(entry?.operatorFullName || "").trim() || null,
    });
  }
  const warehousePricing = normalizeWarehousePricingInput(parsed.warehouse || {});
  return {
    ...initialState(),
    ...parsed,
    users: Array.isArray(parsed.users)
      ? parsed.users.map((user) => {
          const normalizedUser = normalizeCustomerProfile(user);
          const inferredOwner = inferredCustomerOwner.get(Number(normalizedUser.id));
          if (normalizedUser.ownerOperatorId == null && inferredOwner) {
            normalizedUser.ownerOperatorId = inferredOwner.ownerOperatorId;
            normalizedUser.ownerOperatorUsername = inferredOwner.ownerOperatorUsername;
            normalizedUser.ownerOperatorFullName = inferredOwner.ownerOperatorFullName;
          }
          return {
            ...normalizedUser,
            paymentCategories: normalizeCustomerPaymentCategories(normalizedUser?.paymentCategories || []),
          };
        })
      : [],
    deletedCustomers: Array.isArray(parsed.deletedCustomers)
      ? parsed.deletedCustomers.map((entry) => ({
          ...entry,
          customer: {
            ...normalizeCustomerProfile(entry.customer || {}),
            paymentCategories: normalizeCustomerPaymentCategories(entry?.customer?.paymentCategories || []),
          },
          transactions: Array.isArray(entry.transactions)
            ? entry.transactions.map(normalizeStoredTransaction)
            : [],
          restoredStockKg: Number(entry?.restoredStockKg || 0),
          deletedAt: entry?.deletedAt || null,
        }))
      : [],
    stockReceipts: Array.isArray(parsed.stockReceipts)
      ? parsed.stockReceipts.map(normalizeStoredReceipt).filter((entry) => entry.id > 0)
      : [],
    sellerCashHandoffs: Array.isArray(parsed.sellerCashHandoffs)
      ? parsed.sellerCashHandoffs.map(normalizeStoredSellerCashHandoff).filter((entry) => entry.id > 0)
      : [],
    orders: Array.isArray(parsed.orders)
      ? parsed.orders.map(normalizeStoredOrder).filter((entry) => entry.id > 0)
      : [],
    telegramMessages: Array.isArray(parsed.telegramMessages)
      ? parsed.telegramMessages
      : [],
    transactions,
    idempotencyRequests: Array.isArray(parsed.idempotencyRequests)
      ? parsed.idempotencyRequests
          .map(normalizeStoredIdempotencyEntry)
          .filter(Boolean)
      : [],
    warehouse: {
      ...initialState().warehouse,
      ...(parsed.warehouse || {}),
      cashPricePerKg: warehousePricing.cashPricePerKg,
      transferPricePerKg: warehousePricing.transferPricePerKg,
    },
    lastIds: {
      ...initialState().lastIds,
      ...(parsed.lastIds || {}),
    },
  };
}

export function saveWarehouseState(dbPath, state) {
  ensureParentDir(dbPath);
  const tempPath = `${dbPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(state));
  fs.renameSync(tempPath, dbPath);
}

const TELEGRAM_MESSAGES_MAX = 200;

export function recordTelegramMessage(state, { telegramId, customerName, text, type, result }) {
  if (!Array.isArray(state.telegramMessages)) {
    state.telegramMessages = [];
  }
  if (!state.lastIds) state.lastIds = {};
  state.lastIds.telegramMsg = (Number(state.lastIds.telegramMsg) || 0) + 1;
  state.telegramMessages.unshift({
    id: state.lastIds.telegramMsg,
    telegramId: telegramId ?? null,
    customerName: customerName ?? null,
    text: String(text || ""),
    type: type || "unknown",
    result: result || "ok",
    receivedAt: new Date().toISOString(),
  });
  if (state.telegramMessages.length > TELEGRAM_MESSAGES_MAX) {
    state.telegramMessages = state.telegramMessages.slice(0, TELEGRAM_MESSAGES_MAX);
  }
}

export function listTelegramMessages(state, limit = 50) {
  if (!Array.isArray(state.telegramMessages)) return [];
  return state.telegramMessages.slice(0, limit);
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ru-RU");
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLocaleLowerCase("en-US");
}

function normalizeSellerBalanceVisibility(value) {
  return value === true;
}

function attachCustomerOwner(user, actor) {
  if (!user || !actor || typeof actor !== "object") {
    return;
  }
  if (String(actor.kind || "").trim().toLocaleLowerCase("en-US") === "admin") {
    return;
  }
  const role = String(actor.role || "").trim().toLocaleLowerCase("en-US");
  if (role !== "seller") {
    return;
  }
  const actorId = Number(actor.id);
  if (!Number.isFinite(actorId) || actorId <= 0) {
    throw new Error("Sotuvchi identifikatori topilmadi");
  }
  if (user.ownerOperatorId == null) {
    user.ownerOperatorId = actorId;
    user.ownerOperatorUsername = String(actor.username || "").trim() || null;
    user.ownerOperatorFullName = String(actor.fullName || actor.username || "").trim() || null;
    return;
  }
  if (Number(user.ownerOperatorId) !== actorId) {
    throw new Error("Bu mijoz boshqa sotuvchiga biriktirilgan");
  }
}

function normalizeCustomerTextList(input) {
  const source = Array.isArray(input) ? input : [input];
  const seen = new Set();
  const values = [];
  for (const entry of source) {
    const value = String(entry || "").trim();
    if (!value) {
      continue;
    }
    const key = value.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    values.push(value);
  }
  return values;
}

function normalizeCustomerTelegramIds(input) {
  const source = Array.isArray(input) ? input : [input];
  const seen = new Set();
  const values = [];
  for (const entry of source) {
    if (entry == null || entry === "") {
      continue;
    }
    const value = Number(entry);
    if (!Number.isFinite(value)) {
      throw new Error("Telegram ID noto'g'ri");
    }
    const normalized = Math.trunc(value);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    values.push(normalized);
  }
  return values;
}

function normalizeCustomerOrganizationName(value) {
  return String(value || "").trim() || null;
}

function normalizeCustomerTaxId(value) {
  return String(value || "").trim() || null;
}

function normalizeCustomerPricePerKg(value, message = "Mijoz narxi noto'g'ri") {
  if (value == null || value === "") {
    return null;
  }
  return sanitizePricePerKg(value, message);
}

function resolveCustomerPricing(user, pricingInput, state = null) {
  const pricing = resolveWarehousePricing(pricingInput, state);
  return {
    cashPricePerKg: user?.customCashPricePerKg ?? pricing.cashPricePerKg,
    transferPricePerKg: user?.customTransferPricePerKg ?? pricing.transferPricePerKg,
    customCashPricePerKg: user?.customCashPricePerKg ?? null,
    customTransferPricePerKg: user?.customTransferPricePerKg ?? null,
  };
}

function normalizeCustomerProfile(user = {}) {
  const fullNames = normalizeCustomerTextList(
    Array.isArray(user?.fullNames) && user.fullNames.length > 0
      ? user.fullNames
      : [user?.fullName]
  );
  const phones = normalizeCustomerTextList(
    Array.isArray(user?.phones) && user.phones.length > 0
      ? user.phones
      : [user?.phone]
  );
  const telegramIds = normalizeCustomerTelegramIds(
    Array.isArray(user?.telegramIds) && user.telegramIds.length > 0
      ? user.telegramIds
      : [user?.telegramId]
  );
  const ownerOperatorId =
    user?.ownerOperatorId == null
      ? null
      : Number(user.ownerOperatorId);
  return {
    ...user,
    organizationName: normalizeCustomerOrganizationName(user?.organizationName),
    taxId: normalizeCustomerTaxId(user?.taxId),
    customCashPricePerKg: normalizeCustomerPricePerKg(user?.customCashPricePerKg, "Mijozning naqd narxi noto'g'ri"),
    customTransferPricePerKg: normalizeCustomerPricePerKg(user?.customTransferPricePerKg, "Mijozning o'tkazma narxi noto'g'ri"),
    fullNames,
    phones,
    telegramIds,
    fullName: fullNames[0] || String(user?.fullName || "").trim() || "Номаълум",
    phone: phones[0] || null,
    telegramId: telegramIds[0] ?? null,
    ownerOperatorId: Number.isFinite(ownerOperatorId) ? ownerOperatorId : null,
    ownerOperatorUsername: String(user?.ownerOperatorUsername || "").trim() || null,
    ownerOperatorFullName: String(user?.ownerOperatorFullName || "").trim() || null,
    sellerCanViewBalance: normalizeSellerBalanceVisibility(user?.sellerCanViewBalance),
  };
}

function readCustomerFullNames(payload = {}) {
  const fullNames = normalizeCustomerTextList(
    hasOwn(payload, "fullNames") ? payload.fullNames : [payload.fullName]
  );
  if (!fullNames.length) {
    throw new Error("Mijoz ismini kiriting");
  }
  return fullNames;
}

function readCustomerPhones(payload = {}) {
  return normalizeCustomerTextList(
    hasOwn(payload, "phones") ? payload.phones : [payload.phone]
  );
}

function readCustomerTelegramIds(payload = {}) {
  return normalizeCustomerTelegramIds(
    hasOwn(payload, "telegramIds") ? payload.telegramIds : [payload.telegramId]
  );
}

function preferCustomerList(listValue, fallbackValue) {
  return Array.isArray(listValue) && listValue.length > 0
    ? listValue
    : [fallbackValue];
}

function userHasName(user, fullName) {
  const normalized = normalizeName(fullName);
  return normalizeCustomerTextList(user?.fullNames || [user?.fullName]).some(
    (entry) => normalizeName(entry) === normalized
  );
}

function nextId(state, kind) {
  state.lastIds[kind] += 1;
  return state.lastIds[kind];
}

function normalizeOptionalOrderText(value) {
  return String(value || '').trim() || null;
}

function normalizeOrderIdentity(payload = {}) {
  const customerName = normalizeOptionalOrderText(payload.customerName);
  const organizationName = normalizeOptionalOrderText(payload.organizationName);
  const taxId = normalizeOptionalOrderText(payload.taxId);
  if (!customerName && !organizationName && !taxId) {
    throw new Error("Mijoz nomi, tashkilot nomi yoki INN kiriting");
  }
  return {
    customerName,
    organizationName,
    taxId,
  };
}

function normalizeOrderPhone(value) {
  return String(value || '').trim() || null;
}

function normalizeOrderNote(value) {
  const note = String(value || '').trim();
  if (!note) {
    throw new Error("Zakaz matnini kiriting");
  }
  return note;
}

function sanitizeWarehouseOrder(entry) {
  return {
    id: entry.id,
    customerName: entry.customerName,
    organizationName: entry.organizationName || null,
    taxId: entry.taxId || null,
    phone: entry.phone,
    note: entry.note,
    createdAt: entry.createdAt,
    operatorId: entry.operatorId ?? null,
    operatorUsername: entry.operatorUsername || null,
    operatorFullName: entry.operatorFullName || null,
    operatorRole: entry.operatorRole || null,
  };
}

export function listWarehouseOrders(state) {
  return (Array.isArray(state.orders) ? state.orders : [])
    .map(sanitizeWarehouseOrder)
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt || 0).getTime();
      const rightTime = new Date(right.createdAt || 0).getTime();
      return rightTime - leftTime || right.id - left.id;
    });
}

export function createWarehouseOrder(state, payload = {}, actor = null) {
  const identity = normalizeOrderIdentity(payload);
  const order = {
    id: nextId(state, 'order'),
    customerName: identity.customerName,
    organizationName: identity.organizationName,
    taxId: identity.taxId,
    phone: normalizeOrderPhone(payload.phone),
    note: normalizeOrderNote(payload.note),
    createdAt: new Date().toISOString(),
    ...normalizeTransactionOperator(actor),
  };
  if (!Array.isArray(state.orders)) {
    state.orders = [];
  }
  state.orders.push(order);
  return sanitizeWarehouseOrder(order);
}

function findOrCreateUser(state, fullName, telegramId = null) {
  const normalized = normalizeName(fullName);
  let user = state.users.find((entry) => userHasName(entry, fullName));
  if (!user) {
    user = normalizeCustomerProfile({
      id: nextId(state, "user"),
      telegramId: telegramId ?? null,
      fullName,
      phone: null,
      location: null,
      paymentCategories: [],
      sellerCanViewBalance: false,
      createdAt: new Date().toISOString(),
    });
    state.users.push(user);
  } else if (telegramId && !user.telegramId) {
    user.telegramId = telegramId;
    user.telegramIds = normalizeCustomerTelegramIds([...(user.telegramIds || []), telegramId]);
  }
  return user;
}

function getUserById(state, userId) {
  return state.users.find((entry) => entry.id === Number(userId)) || null;
}

function normalizeStaffRole(value) {
  const role = String(value || "").trim().toLocaleLowerCase("en-US");
  if (role !== "seller" && role !== "accountant") {
    throw new Error("Rol faqat seller yoki accountant bo'lishi mumkin");
  }
  return role;
}

function defaultPermissionsForRole(role) {
  if (role === "seller") {
    return ["seller", "customers"];
  }
  if (role === "accountant") {
    return ["cash", "transfer", "customers"];
  }
  return [];
}

function normalizeStaffPermissions(input, role) {
  const source = Array.isArray(input) ? input : defaultPermissionsForRole(role);
  const deduped = [];
  for (const entry of source) {
    const permission = String(entry || "").trim().toLocaleLowerCase("en-US");
    if (!STAFF_PERMISSION_KEYS.includes(permission)) {
      throw new Error("Sahifa ruxsati noto'g'ri");
    }
    if (!deduped.includes(permission)) {
      deduped.push(permission);
    }
  }
  return deduped;
}

function getAccountPermissions(account) {
  return normalizeStaffPermissions(account?.permissions, account?.role);
}

function normalizeLinkPermission(value, role) {
  const permission = String(value || "").trim().toLocaleLowerCase("en-US");
  if (!permission) {
    throw new Error("Link uchun sahifa ruxsati kerak");
  }
  return normalizeStaffPermissions([permission], role)[0];
}

function sanitizeAccessLink(link) {
  return {
    id: link.id,
    permission: link.permission,
    token: link.token,
    createdAt: link.createdAt,
    revokedAt: link.revokedAt || null,
  };
}

function listAccountAccessLinks(account) {
  return (Array.isArray(account?.accessLinks) ? account.accessLinks : []).map(sanitizeAccessLink);
}

function sanitizeStaffAccount(account) {
  return {
    id: account.id,
    fullName: account.fullName,
    username: account.username,
    role: account.role,
    permissions: getAccountPermissions(account),
    accessLinks: listAccountAccessLinks(account),
    createdAt: account.createdAt,
    createdBy: account.createdBy || "admin",
  };
}

export function listStaffAccounts(state) {
  return (Array.isArray(state.staffAccounts) ? state.staffAccounts : [])
    .map(sanitizeStaffAccount)
    .sort((left, right) => {
      if (left.role !== right.role) {
        return left.role.localeCompare(right.role, "en");
      }
      return left.fullName.localeCompare(right.fullName, "ru");
    });
}

export function createStaffAccount(state, payload = {}) {
  const fullName = String(payload.fullName || "").trim();
  const username = normalizeUsername(payload.username);
  const password = String(payload.password || "").trim();
  const role = normalizeStaffRole(payload.role);
  const permissions = normalizeStaffPermissions(payload.permissions, role);

  if (!fullName) {
    throw new Error("Xodim ismini kiriting");
  }
  if (!username) {
    throw new Error("Login kiriting");
  }
  if (password.length < 4) {
    throw new Error("Parol kamida 4 ta belgidan iborat bo'lsin");
  }
  const existing = (Array.isArray(state.staffAccounts) ? state.staffAccounts : []).find(
    (entry) => normalizeUsername(entry.username) === username
  );
  if (existing) {
    throw new Error("Bu login band");
  }

  const account = {
    id: nextId(state, "staff"),
    fullName,
    username,
    password,
    role,
    permissions,
    accessLinks: [],
    createdAt: new Date().toISOString(),
    createdBy: String(payload.createdBy || "admin"),
  };
  state.staffAccounts.push(account);
  return sanitizeStaffAccount(account);
}

export function updateStaffAccountPermissions(state, staffId, permissions) {
  const account = (Array.isArray(state.staffAccounts) ? state.staffAccounts : []).find(
    (entry) => entry.id === Number(staffId)
  );
  if (!account) {
    throw new Error("Xodim topilmadi");
  }
  account.permissions = normalizeStaffPermissions(permissions, account.role);
  return sanitizeStaffAccount(account);
}

export function deleteStaffAccount(state, staffId) {
  const index = (Array.isArray(state.staffAccounts) ? state.staffAccounts : []).findIndex(
    (entry) => entry.id === Number(staffId)
  );
  if (index < 0) {
    throw new Error("Xodim topilmadi");
  }
  const [removed] = state.staffAccounts.splice(index, 1);
  return sanitizeStaffAccount(removed);
}

export function createStaffAccessLink(state, staffId, permission) {
  const account = (Array.isArray(state.staffAccounts) ? state.staffAccounts : []).find(
    (entry) => entry.id === Number(staffId)
  );
  if (!account) {
    throw new Error("Xodim topilmadi");
  }
  const normalizedPermission = normalizeLinkPermission(permission, account.role);
  if (!getAccountPermissions(account).includes(normalizedPermission)) {
    throw new Error("Xodimda bu sahifa uchun ruxsat yo'q");
  }
  const link = {
    id: crypto.randomUUID(),
    permission: normalizedPermission,
    token: crypto.randomBytes(24).toString("hex"),
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };
  if (!Array.isArray(account.accessLinks)) {
    account.accessLinks = [];
  }
  account.accessLinks.unshift(link);
  return sanitizeAccessLink(link);
}

export function revokeStaffAccessLink(state, staffId, linkId) {
  const account = (Array.isArray(state.staffAccounts) ? state.staffAccounts : []).find(
    (entry) => entry.id === Number(staffId)
  );
  if (!account) {
    throw new Error("Xodim topilmadi");
  }
  const link = (Array.isArray(account.accessLinks) ? account.accessLinks : []).find(
    (entry) => String(entry.id) === String(linkId)
  );
  if (!link) {
    throw new Error("Link topilmadi");
  }
  link.revokedAt = new Date().toISOString();
  return sanitizeAccessLink(link);
}

export function authenticateStaffAccessToken(state, token, permission) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return null;
  }
  const normalizedPermission = permission ? normalizeLinkPermission(permission) : null;
  for (const account of Array.isArray(state.staffAccounts) ? state.staffAccounts : []) {
    const link = (Array.isArray(account.accessLinks) ? account.accessLinks : []).find(
      (entry) => entry.token === normalizedToken && !entry.revokedAt
    );
    if (!link) {
      continue;
    }
    if (normalizedPermission && link.permission !== normalizedPermission) {
      return null;
    }
    if (!getAccountPermissions(account).includes(link.permission)) {
      return null;
    }
    return {
      ...sanitizeStaffAccount(account),
      authKind: "access-link",
      accessLink: sanitizeAccessLink(link),
    };
  }
  return null;
}

export function authenticateStaffAccount(state, username, password, options = {}) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedRoles = Array.isArray(options)
    ? options.map((role) => normalizeStaffRole(role))
    : Array.isArray(options.roles)
      ? options.roles.map((role) => normalizeStaffRole(role))
      : [];
  const requiredPermission =
    options && !Array.isArray(options) && options.permission
      ? String(options.permission).trim().toLocaleLowerCase("en-US")
      : null;
  const account = (Array.isArray(state.staffAccounts) ? state.staffAccounts : []).find(
    (entry) => normalizeUsername(entry.username) === normalizedUsername && String(entry.password || "") === String(password || "")
  );
  if (!account) {
    return null;
  }
  if (normalizedRoles.length > 0 && !normalizedRoles.includes(account.role)) {
    return null;
  }
  if (requiredPermission && !getAccountPermissions(account).includes(requiredPermission)) {
    return null;
  }
  return sanitizeStaffAccount(account);
}

function getOrCreateUserFromPayload(state, payload = {}, options = {}) {
  const actor = options.actor || null;
  const paymentCategories = normalizeCustomerPaymentCategories(payload.paymentCategories || []);
  if (payload.userId != null) {
    const user = getUserById(state, payload.userId);
    if (!user) {
      throw new Error("Mijoz topilmadi");
    }
    if (hasOwn(payload, "fullName") || hasOwn(payload, "fullNames")) {
      const fullNames = readCustomerFullNames(payload);
      const fullName = fullNames[0];
      const duplicate = state.users.find(
        (entry) => entry.id !== user.id && userHasName(entry, fullName)
      );
      if (duplicate) {
        throw new Error("Bu nomdagi mijoz allaqachon bor");
      }
      user.fullNames = fullNames;
      user.fullName = fullName;
    }
    if (hasOwn(payload, "telegramId") || hasOwn(payload, "telegramIds")) {
      const telegramIds = readCustomerTelegramIds(payload);
      user.telegramIds = telegramIds;
      user.telegramId = telegramIds[0] ?? null;
    }
    if (hasOwn(payload, "phone") || hasOwn(payload, "phones")) {
      const phones = readCustomerPhones(payload);
      user.phones = phones;
      user.phone = phones[0] || null;
    }
    if (hasOwn(payload, "location")) {
      user.location = String(payload.location || "").trim() || null;
    }
    if (hasOwn(payload, "organizationName")) {
      user.organizationName = normalizeCustomerOrganizationName(payload.organizationName);
    }
    if (hasOwn(payload, "taxId")) {
      user.taxId = normalizeCustomerTaxId(payload.taxId);
    }
    if (hasOwn(payload, "customCashPricePerKg")) {
      user.customCashPricePerKg = normalizeCustomerPricePerKg(payload.customCashPricePerKg, "Mijozning naqd narxi noto'g'ri");
    }
    if (hasOwn(payload, "customTransferPricePerKg")) {
      user.customTransferPricePerKg = normalizeCustomerPricePerKg(payload.customTransferPricePerKg, "Mijozning o'tkazma narxi noto'g'ri");
    }
    if (paymentCategories.length > 0) {
      user.paymentCategories = paymentCategories;
    }
    if (hasOwn(payload, "sellerCanViewBalance")) {
      user.sellerCanViewBalance = normalizeSellerBalanceVisibility(payload.sellerCanViewBalance);
    }
    attachCustomerOwner(user, actor);
    return user;
  }
  const fullNames = readCustomerFullNames(payload);
  const telegramIds = readCustomerTelegramIds(payload);
  const phones = readCustomerPhones(payload);
  const user = findOrCreateUser(state, fullNames[0], telegramIds[0] ?? null);
  user.fullNames = fullNames;
  user.fullName = fullNames[0];
  user.phones = phones;
  user.phone = phones[0] || null;
  user.telegramIds = telegramIds;
  user.telegramId = telegramIds[0] ?? null;
  if (hasOwn(payload, "location")) {
    user.location = String(payload.location || "").trim() || null;
  }
  if (hasOwn(payload, "organizationName")) {
    user.organizationName = normalizeCustomerOrganizationName(payload.organizationName);
  }
  if (hasOwn(payload, "taxId")) {
    user.taxId = normalizeCustomerTaxId(payload.taxId);
  }
  if (hasOwn(payload, "customCashPricePerKg")) {
    user.customCashPricePerKg = normalizeCustomerPricePerKg(payload.customCashPricePerKg, "Mijozning naqd narxi noto'g'ri");
  }
  if (hasOwn(payload, "customTransferPricePerKg")) {
    user.customTransferPricePerKg = normalizeCustomerPricePerKg(payload.customTransferPricePerKg, "Mijozning o'tkazma narxi noto'g'ri");
  }
  if (paymentCategories.length > 0) {
    user.paymentCategories = paymentCategories;
  }
  if (hasOwn(payload, "sellerCanViewBalance")) {
    user.sellerCanViewBalance = normalizeSellerBalanceVisibility(payload.sellerCanViewBalance);
  }
  attachCustomerOwner(user, actor);
  return user;
}

function normalizeTransactionTimestamp(input) {
  if (input == null || input === "") {
    return new Date().toISOString();
  }
  const value = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T12:00:00.000Z`;
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("Sana noto'g'ri");
  }
  return timestamp.toISOString();
}

function normalizeReceiptTimestamp(input) {
  if (input == null || input === "") {
    return new Date().toISOString();
  }
  const value = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    const [year, month, day] = value.split("-").map(Number);
    const localDateTime = new Date(
      year,
      month - 1,
      day,
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds()
    );
    return localDateTime.toISOString();
  }
  return normalizeTransactionTimestamp(value);
}

function createApprovedTransaction(state, payload, options = {}) {
  const user = getOrCreateUserFromPayload(state, payload, { actor: options.actor || null });
  const pricing = resolveWarehousePricing(options.pricing ?? options.pricePerKg, state);
  const breakdown = normalizePaymentBreakdown(payload);
  const amountKg = Number(payload.amountKg || 0);
  if (!Number.isFinite(amountKg) || amountKg < 0) {
    throw new Error("Kg miqdori noto'g'ri");
  }
  const priceType = resolveTransactionPriceType(
    {
      ...payload,
      cashPaidAmount: breakdown.cashPaidAmount,
      transferPaidAmount: breakdown.transferPaidAmount,
    },
    user
  );
  const effectivePricing = resolveCustomerPricing(user, pricing);
  const pricePerKg = getTransactionPricePerKg(effectivePricing, priceType);
  const totalPrice = Math.round(amountKg * pricePerKg);
  const note = String(payload.note || "").trim();
  const transactionTimestamp = normalizeTransactionTimestamp(payload.transactionDate);
  const tx = {
    id: nextId(state, "transaction"),
    userId: user.id,
    kind: payload.kind || "sale",
    amountKg,
    photos: sanitizeTransactionPhotos(payload.photos || payload.photo || []),
    photo: sanitizeTransactionPhotos(payload.photos || payload.photo || [])[0] || null,
    pricePerKg: amountKg > 0 ? pricePerKg : null,
    totalPrice,
    cashPaidAmount: breakdown.cashPaidAmount,
    transferPaidAmount: breakdown.transferPaidAmount,
    paidAmount: breakdown.cashPaidAmount + breakdown.transferPaidAmount,
    priceType,
    status: "approved",
    extractedText: note,
    createdAt: transactionTimestamp,
    approvedAt: transactionTimestamp,
    ...normalizeTransactionOperator(options.actor),
  };
  state.transactions.push(tx);
  return { transaction: tx, user };
}

export function recalculateDebt(state, userId, pricingInput) {
  return recalculateDebtBreakdown(state, userId, pricingInput).currentDebt;
}

function recalculateDebtBreakdown(state, userId, pricingInput) {
  const pricing = resolveWarehousePricing(pricingInput, state);
  const approved = state.transactions.filter(
    (entry) => entry.userId === userId && entry.status === "approved"
  );
  const totalPaid = approved.reduce(
    (sum, entry) => {
      const hasSplitAmounts =
        entry.cashPaidAmount != null || entry.transferPaidAmount != null;
      const paid = hasSplitAmounts
        ? Number(entry.cashPaidAmount || 0) + Number(entry.transferPaidAmount || 0)
        : Number(entry.paidAmount || 0);
      return sum + paid;
    },
    0
  );
  const totalPrice = approved.reduce((sum, entry) => {
    const user = state.users.find((candidate) => candidate.id === entry.userId) || null;
    return sum + calculateTransactionTotalPrice(entry, pricing, user);
  }, 0);
  const totals = approved.reduce((summary, entry) => {
    const user = state.users.find((candidate) => candidate.id === entry.userId) || null;
    const priceType = resolveTransactionPriceType(entry, user);
    const totalPrice = calculateTransactionTotalPrice(entry, pricing, user);
    if (Number(entry.amountKg || 0) > 0) {
      if (priceType === "transfer") {
        summary.transferSales += totalPrice;
      } else {
        summary.cashSales += totalPrice;
      }
    }
    const hasSplitAmounts =
      entry.cashPaidAmount != null || entry.transferPaidAmount != null;
    if (hasSplitAmounts) {
      summary.cashPaid += Number(entry.cashPaidAmount || 0);
      summary.transferPaid += Number(entry.transferPaidAmount || 0);
    } else {
      const legacyPaid = Number(entry.paidAmount || 0);
      if (priceType === "transfer") {
        summary.transferPaid += legacyPaid;
      } else {
        summary.cashPaid += legacyPaid;
      }
    }
    return summary;
  }, {
    cashSales: 0,
    transferSales: 0,
    cashPaid: 0,
    transferPaid: 0,
  });
  const cashDebt = Math.max(0, Math.round(totals.cashSales - totals.cashPaid));
  const transferDebt = Math.max(0, Math.round(totals.transferSales - totals.transferPaid));
  return {
    cashDebt,
    transferDebt,
    currentDebt: Math.round(totalPrice - totalPaid),
  };
}

export function createPendingTransaction(state, payload, options = {}) {
  const pricing = resolveWarehousePricing(options.pricing ?? options.pricePerKg, state);
  const parsed = extractNameAndAmount(payload.text);
  const user = findOrCreateUser(state, parsed.name, payload.telegramId ?? null);
  const priceType = resolveTransactionPriceType(payload, user);
  const tx = {
    id: nextId(state, "transaction"),
    userId: user.id,
    amountKg: parsed.amountKg,
    totalPrice: Math.round(parsed.amountKg * getTransactionPricePerKg(pricing, priceType)),
    cashPaidAmount: 0,
    transferPaidAmount: 0,
    paidAmount: 0,
    priceType,
    status: "pending",
    extractedText: String(payload.text || ""),
    createdAt: new Date().toISOString(),
    approvedAt: null,
  };
  state.transactions.push(tx);
  return {
    transaction: tx,
    user,
  };
}

export function listPendingTransactions(state, pricingInput) {
  const pricing = resolveWarehousePricing(pricingInput, state);
  return state.transactions
    .filter((entry) => entry.status === "pending")
    .sort((left, right) => right.id - left.id)
    .map((entry) => ({
      ...entry,
      totalPrice: calculateTransactionTotalPrice(
        entry,
        pricing,
        state.users.find((user) => user.id === entry.userId) || null
      ),
      user: state.users.find((user) => user.id === entry.userId) || null,
    }));
}

function matchesPaymentType(entry, paymentType) {
  if (paymentType === "cash") {
    return Number(entry.cashPaidAmount || 0) > 0;
  }
  if (paymentType === "transfer") {
    return Number(entry.transferPaidAmount || 0) > 0;
  }
  return true;
}

export function listApprovedTransactions(state, paymentType = "all", pricingInput) {
  const pricing = resolveWarehousePricing(pricingInput, state);
  return state.transactions
    .filter((entry) => entry.status === "approved")
    .filter((entry) => matchesPaymentType(entry, paymentType))
    .sort((left, right) => {
      const leftTime = new Date(left.approvedAt || left.createdAt || 0).getTime();
      const rightTime = new Date(right.approvedAt || right.createdAt || 0).getTime();
      return rightTime - leftTime || right.id - left.id;
    })
    .map((entry) => ({
      ...entry,
      totalPrice: calculateTransactionTotalPrice(
        entry,
        pricing,
        state.users.find((user) => user.id === entry.userId) || null
      ),
      user: state.users.find((user) => user.id === entry.userId) || null,
    }));
}

export function approveTransaction(state, txId, paidAmount, options = {}) {
  const pricing = resolveWarehousePricing(options.pricing ?? options.pricePerKg, state);
  const tx = state.transactions.find((entry) => entry.id === txId && entry.status === "pending");
  if (!tx) {
    throw new Error("Tranzaksiya topilmadi");
  }
  const breakdown = normalizePaymentBreakdown(paidAmount);
  tx.status = "approved";
  tx.cashPaidAmount = breakdown.cashPaidAmount;
  tx.transferPaidAmount = breakdown.transferPaidAmount;
  tx.paidAmount = breakdown.cashPaidAmount + breakdown.transferPaidAmount;
  const user = state.users.find((entry) => entry.id === tx.userId) || null;
  tx.priceType = resolveTransactionPriceType(
    {
      ...tx,
      cashPaidAmount: breakdown.cashPaidAmount,
      transferPaidAmount: breakdown.transferPaidAmount,
    },
    user
  );
  tx.totalPrice = calculateTransactionTotalPrice(tx, pricing, user);
  tx.approvedAt = new Date().toISOString();
  state.warehouse.currentStockKg = Number(state.warehouse.currentStockKg || 0) - Number(tx.amountKg || 0);
  const debt = recalculateDebt(state, tx.userId, pricing);
  return {
    transaction: tx,
    user,
    debt,
    totalPaid: tx.paidAmount,
  };
}

export function upsertCustomer(state, payload = {}, options = {}) {
  const user = getOrCreateUserFromPayload(state, payload, { actor: options.actor || null });
  return user;
}

export function deleteCustomer(state, userId) {
  const customer = getUserById(state, userId);
  if (!customer) {
    throw new Error("Mijoz topilmadi");
  }

  const relatedTransactions = state.transactions.filter((entry) => entry.userId === customer.id);
  const restoredStockKg = relatedTransactions.reduce((sum, entry) => {
    if (entry.status !== "approved") {
      return sum;
    }
    return sum + Number(entry.amountKg || 0);
  }, 0);

  state.deletedCustomers.push({
    customer: {
      ...customer,
      paymentCategories: normalizeCustomerPaymentCategories(customer.paymentCategories || []),
    },
    transactions: relatedTransactions.map((entry) => ({ ...entry })),
    restoredStockKg,
    deletedAt: new Date().toISOString(),
  });

  state.transactions = state.transactions.filter((entry) => entry.userId !== customer.id);
  state.users = state.users.filter((entry) => entry.id !== customer.id);
  state.warehouse.currentStockKg = Number(state.warehouse.currentStockKg || 0) + restoredStockKg;

  return {
    customer: {
      id: customer.id,
      fullName: customer.fullName,
    },
    deletedTransactions: relatedTransactions.length,
    restoredStockKg,
  };
}

export function listDeletedCustomers(state) {
  return (Array.isArray(state.deletedCustomers) ? state.deletedCustomers : [])
    .map((entry) => ({
      id: entry.customer?.id,
      fullName: entry.customer?.fullName || "Noma'lum",
      phone: entry.customer?.phone || null,
      telegramId: entry.customer?.telegramId ?? null,
      paymentCategories: normalizeCustomerPaymentCategories(entry.customer?.paymentCategories || []),
      deletedAt: entry.deletedAt || null,
      deletedTransactions: Array.isArray(entry.transactions) ? entry.transactions.length : 0,
      restoredStockKg: Number(entry.restoredStockKg || 0),
    }))
    .sort((left, right) => {
      const leftTime = new Date(left.deletedAt || 0).getTime();
      const rightTime = new Date(right.deletedAt || 0).getTime();
      return rightTime - leftTime || left.fullName.localeCompare(right.fullName, "ru");
    });
}

export function restoreDeletedCustomer(state, userId) {
  const index = (Array.isArray(state.deletedCustomers) ? state.deletedCustomers : []).findIndex(
    (entry) => Number(entry.customer?.id) === Number(userId)
  );
  if (index < 0) {
    throw new Error("Arxivdagi mijoz topilmadi");
  }
  const archive = state.deletedCustomers[index];
  const customer = archive.customer || null;
  if (!customer) {
    throw new Error("Arxivdagi mijoz ma'lumoti buzilgan");
  }
  if (state.users.some((entry) => entry.id === customer.id)) {
    throw new Error("Bu mijoz allaqachon tiklangan");
  }
  const duplicateName = state.users.find((entry) => normalizeName(entry.fullName) === normalizeName(customer.fullName));
  if (duplicateName) {
    throw new Error("Shu nomdagi mijoz allaqachon mavjud");
  }
  const archivedTransactions = Array.isArray(archive.transactions) ? archive.transactions : [];
  const conflictingTransaction = archivedTransactions.find((entry) => state.transactions.some((current) => current.id === entry.id));
  if (conflictingTransaction) {
    throw new Error("Arxivdagi tranzaksiya IDsi band");
  }

  state.users.push({
    ...customer,
    paymentCategories: normalizeCustomerPaymentCategories(customer.paymentCategories || []),
  });
  state.transactions.push(...archivedTransactions.map((entry) => ({ ...entry })));
  state.deletedCustomers.splice(index, 1);
  state.warehouse.currentStockKg = Number(state.warehouse.currentStockKg || 0) - Number(archive.restoredStockKg || 0);

  return {
    customer: {
      id: customer.id,
      fullName: customer.fullName,
    },
    restoredTransactions: archivedTransactions.length,
    restoredStockKg: Number(archive.restoredStockKg || 0),
  };
}

export function recordApprovedSale(state, payload = {}, options = {}) {
  const pricing = resolveWarehousePricing(options.pricing ?? options.pricePerKg, state);
  const amountKg = Number(payload.amountKg || 0);
  if (!Number.isFinite(amountKg) || amountKg <= 0) {
    throw new Error("Kg miqdori noto'g'ri");
  }
  const blockCount = payload.blockCount == null || payload.blockCount === ""
    ? 1
    : normalizeBlockCount(payload.blockCount, "Sotilgan blok soni noto'g'ri");
  const result = createApprovedTransaction(
    state,
    {
      ...payload,
      kind: "sale",
      amountKg,
      blockCount,
    },
    {
      pricing,
      actor: options.actor,
    }
  );
  result.transaction.blockCount = blockCount;
  state.warehouse.currentStockKg = Number(state.warehouse.currentStockKg || 0) - amountKg;
  const debt = recalculateDebt(state, result.user.id, pricing);
  return {
    ...result,
    debt,
    totalPaid: result.transaction.paidAmount,
  };
}

export function recordCustomerPayment(state, payload = {}, options = {}) {
  const pricing = resolveWarehousePricing(options.pricing ?? options.pricePerKg, state);
  const result = createApprovedTransaction(
    state,
    {
      ...payload,
      kind: "payment",
      amountKg: 0,
    },
    {
      pricing,
      actor: options.actor,
    }
  );
  if (result.transaction.paidAmount <= 0) {
    throw new Error("To'lov summasini kiriting");
  }
  const debt = recalculateDebt(state, result.user.id, pricing);
  return {
    ...result,
    debt,
    totalPaid: result.transaction.paidAmount,
  };
}

export function setCustomerSellerBalanceVisibility(state, userId, visible) {
  const user = getUserById(state, userId);
  if (!user) {
    throw new Error("Mijoz topilmadi");
  }
  user.sellerCanViewBalance = normalizeSellerBalanceVisibility(visible);
  return user;
}

export function listCustomerSummaries(state, pricingInput) {
  const pricing = resolveWarehousePricing(pricingInput, state);
  return state.users
    .map((user) => {
      const customerPricing = resolveCustomerPricing(user, pricing);
      const approved = state.transactions.filter(
        (entry) => entry.userId === user.id && entry.status === "approved"
      );
      const pending = state.transactions.filter(
        (entry) => entry.userId === user.id && entry.status === "pending"
      );
      const totalTakenKg = approved.reduce((sum, entry) => sum + Number(entry.amountKg || 0), 0);
      const totalPaid = approved.reduce((sum, entry) => sum + Number(entry.paidAmount || 0), 0);
      const totalSales = approved.reduce(
        (sum, entry) => sum + calculateTransactionTotalPrice(entry, pricing, user),
        0
      );
      const debtSummary = recalculateDebtBreakdown(state, user.id, pricing);
      return {
        id: user.id,
        ownerOperatorId: user.ownerOperatorId ?? null,
        ownerOperatorUsername: user.ownerOperatorUsername || null,
        ownerOperatorFullName: user.ownerOperatorFullName || null,
        organizationName: user.organizationName || null,
        taxId: user.taxId || null,
        customCashPricePerKg: user.customCashPricePerKg ?? null,
        customTransferPricePerKg: user.customTransferPricePerKg ?? null,
        cashPricePerKg: customerPricing.cashPricePerKg,
        transferPricePerKg: customerPricing.transferPricePerKg,
        fullName: user.fullName,
        fullNames: normalizeCustomerTextList(preferCustomerList(user.fullNames, user.fullName)),
        telegramId: user.telegramId,
        telegramIds: normalizeCustomerTelegramIds(preferCustomerList(user.telegramIds, user.telegramId)),
        phone: user.phone,
        phones: normalizeCustomerTextList(preferCustomerList(user.phones, user.phone)),
        location: user.location || null,
        paymentCategories: normalizeCustomerPaymentCategories(user.paymentCategories || []),
        sellerCanViewBalance: normalizeSellerBalanceVisibility(user.sellerCanViewBalance),
        totalTakenKg,
        totalSales,
        totalPaid,
        pendingCount: pending.length,
        cashDebt: debtSummary.cashDebt,
        transferDebt: debtSummary.transferDebt,
        currentDebt: debtSummary.currentDebt,
      };
    })
    .sort((left, right) => right.currentDebt - left.currentDebt || left.fullName.localeCompare(right.fullName, "ru"));
}

function hasCashActivity(entries) {
  return entries.some((entry) => Number(entry.cashPaidAmount || 0) > 0);
}

function hasTransferActivity(entries) {
  return entries.some((entry) => Number(entry.transferPaidAmount || 0) > 0);
}

function summarizeCustomerActivity(entries) {
  return {
    hasCashActivity: hasCashActivity(entries),
    hasTransferActivity: hasTransferActivity(entries),
  };
}

function buildCustomerHistoryEntry(entry, pricing, user) {
  const photos = sanitizeTransactionPhotos(entry.photos || entry.photo || []);
  return {
    id: entry.id,
    kind: entry.kind || (entry.status === "pending" ? "pending-sale" : "sale"),
    status: entry.status,
    photos,
    photo: photos[0] || null,
    amountKg: Number(entry.amountKg || 0),
    blockCount: Number(entry.blockCount || 0),
    pricePerKg: Number(entry.pricePerKg || 0) || null,
    totalPrice: calculateTransactionTotalPrice(entry, pricing, user),
    cashPaidAmount: Number(entry.cashPaidAmount || 0),
    transferPaidAmount: Number(entry.transferPaidAmount || 0),
    paidAmount: Number(entry.paidAmount || 0),
    priceType: resolveTransactionPriceType(entry, user),
    note: entry.extractedText || "",
    createdAt: entry.createdAt || null,
    approvedAt: entry.approvedAt || null,
  };
}

export function groupCustomersByPaymentType(state, pricingInput) {
  const summaries = listCustomerSummaries(state, pricingInput);
  const activityMap = new Map(
    state.users.map((user) => {
      const userEntries = state.transactions.filter((entry) => entry.userId === user.id);
      return [user.id, summarizeCustomerActivity(userEntries)];
    })
  );

  const cashCustomers = [];
  const transferCustomers = [];
  const otherCustomers = [];

  for (const summary of summaries) {
    const selectedCategories = normalizeCustomerPaymentCategories(summary.paymentCategories || []);
    const activity = activityMap.get(summary.id) || {
      hasCashActivity: false,
      hasTransferActivity: false,
    };
    const isCashCustomer = activity.hasCashActivity || selectedCategories.includes("cash");
    const isTransferCustomer = activity.hasTransferActivity || selectedCategories.includes("transfer");
    const enriched = {
      ...summary,
      hasCashActivity: isCashCustomer,
      hasTransferActivity: isTransferCustomer,
    };
    if (isCashCustomer) {
      cashCustomers.push(enriched);
    }
    if (isTransferCustomer) {
      transferCustomers.push(enriched);
    }
    if (!isCashCustomer && !isTransferCustomer) {
      otherCustomers.push(enriched);
    }
  }

  return {
    cashCustomers,
    transferCustomers,
    otherCustomers,
  };
}

export function getCustomerDetail(state, userId, pricingInput) {
  const pricing = resolveWarehousePricing(pricingInput, state);
  const user = getUserById(state, userId);
  if (!user) {
    throw new Error("Mijoz topilmadi");
  }

  const customerPricing = resolveCustomerPricing(user, pricing);

  const summary = listCustomerSummaries(state, pricing).find((entry) => entry.id === user.id);
  const entries = state.transactions
    .filter((entry) => entry.userId === user.id)
    .sort((left, right) => {
      const leftTime = new Date(left.approvedAt || left.createdAt || 0).getTime();
      const rightTime = new Date(right.approvedAt || right.createdAt || 0).getTime();
      return rightTime - leftTime || right.id - left.id;
    });

  return {
    customer: {
      id: user.id,
      ownerOperatorId: user.ownerOperatorId ?? null,
      ownerOperatorUsername: user.ownerOperatorUsername || null,
      ownerOperatorFullName: user.ownerOperatorFullName || null,
      organizationName: user.organizationName || null,
      taxId: user.taxId || null,
      customCashPricePerKg: user.customCashPricePerKg ?? null,
      customTransferPricePerKg: user.customTransferPricePerKg ?? null,
      cashPricePerKg: customerPricing.cashPricePerKg,
      transferPricePerKg: customerPricing.transferPricePerKg,
      fullName: user.fullName,
      fullNames: normalizeCustomerTextList(preferCustomerList(user.fullNames, user.fullName)),
      telegramId: user.telegramId,
      telegramIds: normalizeCustomerTelegramIds(preferCustomerList(user.telegramIds, user.telegramId)),
      phone: user.phone,
      phones: normalizeCustomerTextList(preferCustomerList(user.phones, user.phone)),
      location: user.location || null,
      paymentCategories: normalizeCustomerPaymentCategories(user.paymentCategories || []),
      sellerCanViewBalance: normalizeSellerBalanceVisibility(user.sellerCanViewBalance),
      createdAt: user.createdAt,
    },
    summary: summary || {
      id: user.id,
      ownerOperatorId: user.ownerOperatorId ?? null,
      ownerOperatorUsername: user.ownerOperatorUsername || null,
      ownerOperatorFullName: user.ownerOperatorFullName || null,
      organizationName: user.organizationName || null,
      taxId: user.taxId || null,
      customCashPricePerKg: user.customCashPricePerKg ?? null,
      customTransferPricePerKg: user.customTransferPricePerKg ?? null,
      cashPricePerKg: customerPricing.cashPricePerKg,
      transferPricePerKg: customerPricing.transferPricePerKg,
      fullName: user.fullName,
      fullNames: normalizeCustomerTextList(preferCustomerList(user.fullNames, user.fullName)),
      telegramId: user.telegramId,
      telegramIds: normalizeCustomerTelegramIds(preferCustomerList(user.telegramIds, user.telegramId)),
      phone: user.phone,
      phones: normalizeCustomerTextList(preferCustomerList(user.phones, user.phone)),
      location: user.location || null,
      paymentCategories: normalizeCustomerPaymentCategories(user.paymentCategories || []),
      sellerCanViewBalance: normalizeSellerBalanceVisibility(user.sellerCanViewBalance),
      totalTakenKg: 0,
      totalSales: 0,
      totalPaid: 0,
      pendingCount: 0,
      cashDebt: 0,
      transferDebt: 0,
      currentDebt: 0,
    },
    activity: summarizeCustomerActivity(entries),
    history: entries.map((entry) => buildCustomerHistoryEntry(entry, pricing, user)),
  };
}

export function seedWarehouseStock(state, amountKg) {
  const numericAmount = Number(amountKg || 0);
  if (!Number.isFinite(numericAmount)) {
    throw new Error("Invalid stock amount");
  }
  state.warehouse.currentStockKg = numericAmount;
  return state.warehouse.currentStockKg;
}

export function recordWarehouseReceipt(state, payload = {}) {
  const amountKg = Number(payload.amountKg || 0);
  if (!Number.isFinite(amountKg) || amountKg <= 0) {
    throw new Error("Qabul qilingan kg noto'g'ri");
  }
  const blockCount = payload.blockCount == null || payload.blockCount === ""
    ? 0
    : normalizeBlockCount(payload.blockCount, "Qabul blok soni noto'g'ri");
  const pricePerKg = payload.pricePerKg == null || payload.pricePerKg === ""
    ? null
    : sanitizePricePerKg(payload.pricePerKg, "Qabul narxi noto'g'ri");
  const receivedAt = payload.receivedAt == null || payload.receivedAt === ""
    ? new Date().toISOString()
    : normalizeReceiptTimestamp(payload.receivedAt);
  const roundedAmountKg = Math.round(amountKg * 1000) / 1000;
  const receipt = {
    id: nextId(state, "receipt"),
    amountKg: roundedAmountKg,
    blockCount,
    pricePerKg,
    totalPrice: pricePerKg == null ? null : Math.round(roundedAmountKg * pricePerKg),
    note: String(payload.note || "").trim(),
    receivedAt,
  };
  if (!Array.isArray(state.stockReceipts)) {
    state.stockReceipts = [];
  }
  state.stockReceipts.unshift(receipt);
  state.warehouse.currentStockKg = Number(state.warehouse.currentStockKg || 0) + receipt.amountKg;
  return receipt;
}

export function recordSellerCashHandoff(state, payload = {}, options = {}) {
  const amount = Math.round(Number(payload.amount || 0));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Topshirilgan pul summasi noto'g'ri");
  }
  const receivedAt = payload.receivedAt == null || payload.receivedAt === ""
    ? new Date().toISOString()
    : normalizeReceiptTimestamp(payload.receivedAt);
  const handoff = {
    id: nextId(state, "handoff"),
    amount,
    note: String(payload.note || "").trim(),
    receivedAt,
    ...normalizeTransactionOperator(options.actor),
  };
  if (!Array.isArray(state.sellerCashHandoffs)) {
    state.sellerCashHandoffs = [];
  }
  state.sellerCashHandoffs.unshift(handoff);
  return handoff;
}

export function listSellerCashHandoffs(state, options = {}) {
  const dateKey = options.dateKey ? resolveSummaryDateKey(options.dateKey) : null;
  const operator = options.operator || null;
  return (Array.isArray(state.sellerCashHandoffs) ? state.sellerCashHandoffs : [])
    .map(normalizeStoredSellerCashHandoff)
    .filter((entry) => !dateKey || matchesSummaryDate(entry, dateKey))
    .filter((entry) => !operator || matchesOperatorActivity(entry, operator))
    .sort((left, right) => {
      const leftTime = new Date(left.receivedAt || 0).getTime();
      const rightTime = new Date(right.receivedAt || 0).getTime();
      return rightTime - leftTime || right.id - left.id;
    });
}

export function listWarehouseReceipts(state) {
  return (Array.isArray(state.stockReceipts) ? state.stockReceipts : [])
    .map(normalizeStoredReceipt)
    .sort((left, right) => {
      const leftTime = new Date(left.receivedAt || 0).getTime();
      const rightTime = new Date(right.receivedAt || 0).getTime();
      return rightTime - leftTime || right.id - left.id;
    });
}

export function summarizeWarehouseReceipts(receipts = []) {
  return (Array.isArray(receipts) ? receipts : []).reduce(
    (summary, entry) => {
      summary.totalKg += Number(entry.amountKg || 0);
      summary.totalBlocks += Number(entry.blockCount || 0);
      summary.totalPrice += Number(entry.totalPrice || 0);
      return summary;
    },
    {
      totalKg: 0,
      totalBlocks: 0,
      totalPrice: 0,
    }
  );
}

export function getWarehousePricing(state) {
  return resolveWarehousePricing(undefined, state);
}

export function updateWarehousePricing(state, payload = {}) {
  const currentPricing = getWarehousePricing(state);
  if (!hasOwn(payload, "cashPricePerKg") && !hasOwn(payload, "transferPricePerKg")) {
    throw new Error("Kamida bitta narxni kiriting");
  }
  const nextPricing = normalizeWarehousePricingInput(
    {
      cashPricePerKg: hasOwn(payload, "cashPricePerKg")
        ? payload.cashPricePerKg
        : currentPricing.cashPricePerKg,
      transferPricePerKg: hasOwn(payload, "transferPricePerKg")
        ? payload.transferPricePerKg
        : currentPricing.transferPricePerKg,
    },
    currentPricing.cashPricePerKg
  );
  state.warehouse.cashPricePerKg = nextPricing.cashPricePerKg;
  state.warehouse.transferPricePerKg = nextPricing.transferPricePerKg;
  return nextPricing;
}