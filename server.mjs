#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { handleWarehouseApiRoute } from "./server/handle-api.mjs";
import {
  authenticateStaffAccessToken,
  authenticateStaffAccount,
  approveTransaction,
  createStaffAccessLink,
  createStaffAccount,
  createWarehouseOrder,
  createPendingTransaction,
  deleteCustomer,
  deleteStaffAccount,
  getCustomerDetail,
  getWarehousePricing,
  groupCustomersByPaymentType,
  listApprovedTransactions,
  listCustomerSummaries,
  listDeletedCustomers,
  listPendingTransactions,
  listSellerCashHandoffs,
  listWarehouseOrders,
  listWarehouseReceipts,
  listStaffAccounts,
  loadWarehouseState,
  recordWarehouseReceipt,
  recordApprovedSale,
  recordCustomerPayment,
  recordSellerCashHandoff,
  restoreDeletedCustomer,
  revokeStaffAccessLink,
  saveWarehouseState,
  setCustomerSellerBalanceVisibility,
  seedWarehouseStock,
  summarizeOperatorDailyActivity,
  summarizeWarehouseReceipts,
  updateStaffAccountPermissions,
  updateWarehousePricing,
  upsertCustomer,
} from "./lib/warehouse-bot.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const PORT = Number(process.env.PORT) || 8787;
const WAREHOUSE_COMPANY_NAME = process.env.WAREHOUSE_COMPANY_NAME?.trim() || "Сыр АКБЕЛ";
const WAREHOUSE_ALLOWED_ORIGIN =
  process.env.WAREHOUSE_ALLOWED_ORIGIN?.trim() || `http://127.0.0.1:${PORT}`;
const WAREHOUSE_MAX_REQUEST_BYTES = Math.max(
  256 * 1024,
  Number(process.env.WAREHOUSE_MAX_REQUEST_BYTES) || 6 * 1024 * 1024
);
const WAREHOUSE_STATE_PATH = resolveWarehouseStatePath();
const WAREHOUSE_TRANSACTION_PHOTO_DIR = path.join(path.dirname(WAREHOUSE_STATE_PATH), "transaction-photos");

function resolveWarehouseStatePath() {
  const configured = process.env.WAREHOUSE_STATE_FILE?.trim() || "data/warehouse.json";
  return path.isAbsolute(configured) ? configured : path.join(ROOT, configured);
}

function loadWarehouse() {
  return loadWarehouseState(WAREHOUSE_STATE_PATH);
}

function buildCsvContent(state, mode = "all") {
  const userMap = new Map(state.users.map((u) => [u.id, u.fullName]));
  const KIND_LABELS = { sale: "Savdo", payment: "To'lov", "pending-sale": "Kutilayotgan" };
  const STATUS_LABELS = { approved: "Tasdiqlangan", pending: "Kutilayotgan" };
  const SEP = ";";
  const csvEscape = (v) => {
    const s = String(v == null ? "" : v);
    return s.includes(SEP) || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Mijoz ismi", "Tur", "Holat", "Sana", "kg", "Summa (so'm)", "Naqd to'lov", "O'tkazma to'lov"].join(SEP);
  const rows = (state.transactions || [])
    .slice()
    .sort((a, b) => new Date(a.approvedAt || a.createdAt || 0) - new Date(b.approvedAt || b.createdAt || 0))
    .filter((tx) => {
      if (mode === "cash") return Number(tx.cashPaidAmount || 0) > 0;
      if (mode === "transfer") return Number(tx.transferPaidAmount || 0) > 0;
      return true;
    })
    .map((tx) => {
      const name = userMap.get(tx.userId) || "Noma'lum";
      const kind = KIND_LABELS[tx.kind || (tx.status === "pending" ? "pending-sale" : "sale")] || tx.kind || "";
      const status = STATUS_LABELS[tx.status] || tx.status || "";
      const date = tx.approvedAt || tx.createdAt || "";
      const dateStr = date ? new Date(date).toLocaleDateString("ru-RU") : "";
      const kg = Number(tx.amountKg || 0);
      const total = Number(tx.totalPrice || 0);
      const cash = Number(tx.cashPaidAmount || 0);
      const transfer = Number(tx.transferPaidAmount || 0);
      return [name, kind, status, dateStr, kg, total, cash, transfer].map(csvEscape).join(SEP);
    });
  return "\uFEFF" + [header, ...rows].join("\r\n");
}

async function uploadCsvToYandex(state) {
  const login = process.env.YANDEX_DISK_LOGIN?.trim();
  const password = process.env.YANDEX_DISK_PASSWORD?.trim();
  if (!login || !password) return;
  try {
    const auth = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
    const uploads = [
      { url: "https://webdav.yandex.ru/akbel-export.csv", csv: buildCsvContent(state, "all") },
      { url: "https://webdav.yandex.ru/akbel-naqd.csv", csv: buildCsvContent(state, "cash") },
      { url: "https://webdav.yandex.ru/akbel-otkazma.csv", csv: buildCsvContent(state, "transfer") },
    ];

    for (const item of uploads) {
      const resp = await fetch(item.url, {
        method: "PUT",
        headers: {
          Authorization: auth,
          "Content-Type": "text/csv; charset=utf-8",
        },
        body: item.csv,
      });
      if (!resp.ok) {
        console.error("[YandexDisk] Upload failed:", item.url, resp.status, await resp.text());
      }
    }
  } catch (e) {
    console.error("[YandexDisk] Upload error:", e.message);
  }
}

function saveWarehouse(state) {
  saveWarehouseState(WAREHOUSE_STATE_PATH, state);
  uploadCsvToYandex(state).catch(() => {});
}

function currentWarehousePricing(state) {
  return getWarehousePricing(state);
}

function formatMoney(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

function parseBasicAuthHeader(headerValue) {
  if (typeof headerValue !== "string" || !headerValue.startsWith("Basic ")) {
    return null;
  }
  const decoded = Buffer.from(headerValue.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

function extractWarehouseAccessToken(req) {
  const headerValue = req.headers["x-warehouse-access"] || req.headers["X-Warehouse-Access"];
  if (typeof headerValue === "string" && headerValue.trim()) {
    return headerValue.trim();
  }
  return "";
}

function baseApiJsonHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": WAREHOUSE_ALLOWED_ORIGIN,
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

function requestOriginAllowed(req) {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin.trim() : "";
  return !origin || origin === WAREHOUSE_ALLOWED_ORIGIN;
}

function requiredWarehouseRoutePermissions(pathname) {
  if (pathname === "/warehouse/seller" || pathname === "/warehouse/seller/sale/cash") {
    return ["seller"];
  }
  if (pathname === "/warehouse/seller/sale/transfer") {
    return ["seller", "transfer"];
  }
  if (pathname === "/warehouse/customers" || pathname === "/warehouse/orders") {
    return ["customers", "seller", "cash", "transfer"];
  }
  if (/^\/warehouse\/customers\/\d+$/.test(pathname)) {
    return ["customers", "seller", "cash", "transfer"];
  }
  if (pathname === "/warehouse/admin/cash") {
    return ["cash"];
  }
  if (pathname === "/warehouse/admin/transfer") {
    return ["transfer"];
  }
  return null;
}

function hasWarehouseRouteAccess(req, u) {
  const requiredPermissions = requiredWarehouseRoutePermissions(u.pathname);
  if (!requiredPermissions) {
    return true;
  }
  const accessToken = (u.searchParams.get("access") || extractWarehouseAccessToken(req) || "").trim();
  if (!accessToken) {
    return false;
  }
  const state = loadWarehouse();
  for (const permission of requiredPermissions) {
    if (authenticateStaffAccessToken(state, accessToken, permission)) {
      return true;
    }
  }
  return false;
}

function staticResponseHeaders(contentType, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

function sanitizeOriginalPhotoName(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized ? normalized.slice(0, 120) : null;
}

function storeWarehouseTransactionPhoto(photoInput = {}) {
  const dataUrl = String(photoInput?.dataUrl || "").trim();
  if (!dataUrl) {
    return null;
  }
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) {
    throw new Error("Rasm formati noto'g'ri");
  }
  const mimeType = match[1].toLocaleLowerCase("en-US");
  const extensionByMime = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/heic-sequence": ".heic",
    "image/heif-sequence": ".heif",
  };
  const extension = extensionByMime[mimeType];
  if (!extension) {
    throw new Error("Faqat JPG, PNG, WEBP, GIF yoki iPhone HEIC rasm saqlanadi");
  }
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length) {
    throw new Error("Rasm bo'sh");
  }
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error("Rasm hajmi 5 MB dan oshmasin");
  }
  fs.mkdirSync(WAREHOUSE_TRANSACTION_PHOTO_DIR, { recursive: true });
  const id = crypto.randomUUID();
  const fileName = `${id}${extension}`;
  fs.writeFileSync(path.join(WAREHOUSE_TRANSACTION_PHOTO_DIR, fileName), buffer);
  return {
    id,
    fileName,
    mimeType,
    originalName: sanitizeOriginalPhotoName(photoInput?.originalName),
    sizeBytes: buffer.length,
    capturedAt: new Date().toISOString(),
    url: `/warehouse/uploads/${fileName}`,
  };
}

function storeWarehouseTransactionPhotos(photoInput = []) {
  const source = Array.isArray(photoInput) ? photoInput : [photoInput];
  return source
    .map((entry) => storeWarehouseTransactionPhoto(entry))
    .filter(Boolean);
}

function sendApiJson(res, status, data) {
  res.writeHead(status, baseApiJsonHeaders());
  res.end(JSON.stringify(data));
}

async function readPostJson(req) {
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > WAREHOUSE_MAX_REQUEST_BYTES) {
    const error = new Error("So'rov hajmi juda katta");
    error.code = "PAYLOAD_TOO_LARGE";
    throw error;
  }
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > WAREHOUSE_MAX_REQUEST_BYTES) {
      const error = new Error("So'rov hajmi juda katta");
      error.code = "PAYLOAD_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return null;
  }
}

function assertWarehouseAdmin(req, res) {
  const expectedUser = process.env.WAREHOUSE_ADMIN_USERNAME?.trim();
  const expectedPassword = process.env.WAREHOUSE_ADMIN_PASSWORD?.trim();
  if (!expectedUser || !expectedPassword) {
    sendApiJson(res, 503, {
      error: "Admin login va paroli sozlanmagan. WAREHOUSE_ADMIN_USERNAME va WAREHOUSE_ADMIN_PASSWORD ni kiriting.",
    });
    return false;
  }
  const auth = parseBasicAuthHeader(req.headers.authorization);
  if (!auth || auth.username !== expectedUser || auth.password !== expectedPassword) {
    res.writeHead(401, {
      ...baseApiJsonHeaders(),
      "WWW-Authenticate": 'Basic realm="warehouse-admin"',
    });
    res.end(JSON.stringify({ error: "Admin so'rovi uchun ruxsat yo'q" }));
    return false;
  }
  return true;
}

function authenticateWarehouseOperator(req, options = {}) {
  const state = loadWarehouse();
  const accessToken = extractWarehouseAccessToken(req);
  const permissions = Array.isArray(options.permission)
    ? options.permission.map((entry) => String(entry || "").trim().toLocaleLowerCase("en-US")).filter(Boolean)
    : options.permission
      ? [String(options.permission).trim().toLocaleLowerCase("en-US")]
      : [];
  if (accessToken) {
    if (permissions.length) {
      for (const permission of permissions) {
        const byToken = authenticateStaffAccessToken(state, accessToken, permission);
        if (byToken) {
          return byToken;
        }
      }
    } else {
      const byToken = authenticateStaffAccessToken(state, accessToken, null);
      if (byToken) {
        return byToken;
      }
    }
  }
  const auth = parseBasicAuthHeader(req.headers.authorization);
  if (!auth) {
    return null;
  }
  const allowAdmin = options.allowAdmin !== false;
  const expectedUser = process.env.WAREHOUSE_ADMIN_USERNAME?.trim();
  const expectedPassword = process.env.WAREHOUSE_ADMIN_PASSWORD?.trim();
  if (
    allowAdmin &&
    expectedUser &&
    expectedPassword &&
    auth.username === expectedUser &&
    auth.password === expectedPassword
  ) {
    return {
      kind: "admin",
      role: "admin",
      username: expectedUser,
      fullName: "Admin",
    };
  }
  if (permissions.length) {
    for (const permission of permissions) {
      const byPermission = authenticateStaffAccount(state, auth.username, auth.password, {
        roles: Array.isArray(options.roles) ? options.roles : [],
        permission,
      });
      if (byPermission) {
        return byPermission;
      }
    }
  }
  return authenticateStaffAccount(state, auth.username, auth.password, {
    roles: Array.isArray(options.roles) ? options.roles : [],
    permission: permissions[0] || null,
  });
}

function assertWarehouseOperator(req, res, options = {}) {
  const allowAdmin = options.allowAdmin !== false;
  const realm = options.realm || "warehouse-user";
  const message = options.message || "So'rov uchun ruxsat yo'q";
  const operator = authenticateWarehouseOperator(req, {
    roles: Array.isArray(options.roles) ? options.roles : [],
    permission: options.permission || null,
    allowAdmin,
  });
  if (!operator) {
    res.writeHead(401, {
      ...baseApiJsonHeaders(),
      "WWW-Authenticate": `Basic realm="${realm}"`,
    });
    res.end(JSON.stringify({ error: message }));
    return null;
  }
  return operator;
}

function extractTelegramMessage(update) {
  const message = update?.business_message || update?.edited_business_message || update?.message;
  if (!message) return null;
  const text = typeof message.text === "string" ? message.text.trim() : "";
  return {
    text,
    telegramId: message.chat?.id ?? message.from?.id ?? null,
  };
}

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || chatId == null || !text) {
    return false;
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return response.ok;
}

async function sendTelegramChannelMessage(text) {
  const channelId = process.env.TELEGRAM_CHANNEL_ID?.trim();
  if (!channelId || !text) {
    return false;
  }
  return sendTelegramMessage(channelId, text);
}

async function sendTelegramAdminDm(text) {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();
  if (!adminChatId || !text) return false;
  return sendTelegramMessage(adminChatId, text);
}

function buildChannelSaleMsg(userName, amountKg, totalPrice, cashPaid, transferPaid, debt) {
  const lines = [
    `🧀 ${WAREHOUSE_COMPANY_NAME}`,
    `📦 Yangi savdo`,
    ``,
    `👤 Mijoz: ${userName}`,
    `⚖️ Hajm: ${amountKg} kg`,
    `💰 Narx: ${formatMoney(totalPrice)} so'm`,
  ];
  if (cashPaid > 0) lines.push(`💵 Naqd: ${formatMoney(cashPaid)} so'm`);
  if (transferPaid > 0) lines.push(`📲 O'tkazma: ${formatMoney(transferPaid)} so'm`);
  if (debt > 0) {
    lines.push(`🔴 Qarz: ${formatMoney(debt)} so'm`);
  } else {
    lines.push(`✅ To'liq to'landi`);
  }
  return lines.join("\n");
}

function buildChannelPaymentMsg(userName, cashPaid, transferPaid, debt) {
  const paidTotal = cashPaid + transferPaid;
  const lines = [
    `🧀 ${WAREHOUSE_COMPANY_NAME}`,
    `💳 To'lov qabul qilindi`,
    ``,
    `👤 Mijoz: ${userName}`,
  ];
  if (cashPaid > 0) lines.push(`💵 Naqd: ${formatMoney(cashPaid)} so'm`);
  if (transferPaid > 0) lines.push(`📲 O'tkazma: ${formatMoney(transferPaid)} so'm`);
  if (cashPaid <= 0 && transferPaid <= 0) lines.push(`✅ To'landi: ${formatMoney(paidTotal)} so'm`);
  if (debt > 0) {
    lines.push(`🔴 Qolgan qarz: ${formatMoney(debt)} so'm`);
  } else {
    lines.push(`✅ Qarz to'liq yopildi`);
  }
  return lines.join("\n");
}

function buildChannelApprovalMsg(userName, amountKg, totalPrice, cashPaid, transferPaid, debt) {
  const lines = [
    `🧀 ${WAREHOUSE_COMPANY_NAME}`,
    `✅ Tasdiqlandi`,
    ``,
    `👤 Mijoz: ${userName}`,
    `⚖️ Hajm: ${amountKg} kg`,
    `💰 Narx: ${formatMoney(totalPrice)} so'm`,
  ];
  if (cashPaid > 0) lines.push(`💵 Naqd: ${formatMoney(cashPaid)} so'm`);
  if (transferPaid > 0) lines.push(`📲 O'tkazma: ${formatMoney(transferPaid)} so'm`);
  if (debt > 0) {
    lines.push(`🔴 Qarz: ${formatMoney(debt)} so'm`);
  } else {
    lines.push(`✅ To'liq to'landi`);
  }
  return lines.join("\n");
}

function buildChannelNewOrderMsg(userName, amountKg, totalPrice) {
  return [
    `🧀 ${WAREHOUSE_COMPANY_NAME}`,
    `🆕 Yangi buyurtma (kutmoqda)`,
    ``,
    `👤 Mijoz: ${userName}`,
    `⚖️ Hajm: ${amountKg} kg`,
    `💰 Narx: ${formatMoney(totalPrice)} so'm`,
  ].join("\n");
}

function buildAdminNewOrderMsg(userName, amountKg, totalPrice) {
  return [
    `🧀 ${WAREHOUSE_COMPANY_NAME}`,
    `🔔 Yangi buyurtma!`,
    ``,
    `👤 Mijoz: ${userName}`,
    `⚖️ Hajm: ${amountKg} kg`,
    `💰 Narx: ${formatMoney(totalPrice)} so'm`,
    ``,
    `🔗 akbelim.com/warehouse/admin`,
  ].join("\n");
}

function buildCustomerSaleMsg(userName, amountKg, totalPrice, debt) {
  const lines = [
    `🧀 ${WAREHOUSE_COMPANY_NAME}`,
    ``,
    `Hurmatli ${userName}, xarid uchun rahmat!`,
    `⚖️ Hajm: ${amountKg} kg`,
    `💰 Narx: ${formatMoney(totalPrice)} so'm`,
  ];
  if (debt > 0) {
    lines.push(`🔴 Qolgan qarz: ${formatMoney(debt)} so'm`);
  } else {
    lines.push(`✅ To'liq to'landi. Rahmat!`);
  }
  return lines.join("\n");
}

function buildCustomerPaymentMsg(userName, cashPaid, transferPaid, debt) {
  const paidTotal = cashPaid + transferPaid;
  const lines = [
    `🧀 ${WAREHOUSE_COMPANY_NAME}`,
    ``,
    `Hurmatli ${userName}, to'lovingiz qabul qilindi.`,
  ];
  if (cashPaid > 0 && transferPaid > 0) {
    lines.push(`💵 Naqd: ${formatMoney(cashPaid)} + 📲 O'tkazma: ${formatMoney(transferPaid)} so'm`);
  } else {
    lines.push(`✅ To'landi: ${formatMoney(paidTotal)} so'm`);
  }
  if (debt > 0) {
    lines.push(`🔴 Qolgan qarz: ${formatMoney(debt)} so'm`);
  } else {
    lines.push(`✅ Qarz to'liq yopildi. Rahmat!`);
  }
  return lines.join("\n");
}

function buildPendingReply(result) {
  return [
    "Qabul qilindi.",
    `Mijoz: ${result.user.fullName}`,
    `Hajm: ${result.transaction.amountKg} kg`,
    `Narx: ${formatMoney(result.transaction.totalPrice)} so'm`,
    "Admin tasdiqlashini kutmoqda.",
  ].join("\n");
}

function buildDebtReply(userName, debt) {
  return [
    `🧀 ${WAREHOUSE_COMPANY_NAME}`,
    "",
    `Hurmatli ${userName}, sizning qolgan qarzingiz: ${formatMoney(debt)} so'm`,
  ].join("\n");
}

function normalizeApprovalPayment(body) {
  return {
    cashPaidAmount: Number(body?.cashPaidAmount || 0),
    transferPaidAmount: Number(body?.transferPaidAmount || 0),
  };
}

function createWarehouseTransaction(payload) {
  const state = loadWarehouse();
  const result = createPendingTransaction(
    state,
    {
      text: payload.text,
      telegramId: payload.telegramId ?? null,
    },
    { pricing: currentWarehousePricing(state) }
  );
  saveWarehouse(state);
  return result;
}

function summarizeApprovedTransactions(entries) {
  return entries.reduce(
    (summary, entry) => {
      summary.count += 1;
      summary.totalKg += Number(entry.amountKg || 0);
      if ((entry.kind || "sale") === "sale" && Number(entry.amountKg || 0) > 0) {
        summary.totalBlocks += Number(entry.blockCount || 0);
      }
      summary.totalPrice += Number(entry.totalPrice || 0);
      summary.totalPaid += Number(entry.paidAmount || 0);
      summary.cashPaidAmount += Number(entry.cashPaidAmount || 0);
      summary.transferPaidAmount += Number(entry.transferPaidAmount || 0);
      summary.remainingDebt += Math.max(0, Number(entry.totalPrice || 0) - Number(entry.paidAmount || 0));
      return summary;
    },
    {
      count: 0,
      totalKg: 0,
      totalBlocks: 0,
      totalPrice: 0,
      totalPaid: 0,
      cashPaidAmount: 0,
      transferPaidAmount: 0,
      remainingDebt: 0,
    }
  );
}

function summarizeCustomers(entries) {
  return entries.reduce(
    (summary, entry) => {
      summary.count += 1;
      summary.totalTakenKg += Number(entry.totalTakenKg || 0);
      summary.totalSales += Number(entry.totalSales || 0);
      summary.totalPaid += Number(entry.totalPaid || 0);
      summary.cashDebt += Number(entry.cashDebt || 0);
      summary.transferDebt += Number(entry.transferDebt || 0);
      summary.currentDebt += Number(entry.currentDebt || 0);
      summary.pendingCount += Number(entry.pendingCount || 0);
      return summary;
    },
    {
      count: 0,
      totalTakenKg: 0,
      totalSales: 0,
      totalPaid: 0,
      cashDebt: 0,
      transferDebt: 0,
      currentDebt: 0,
      pendingCount: 0,
    }
  );
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function serveStatic(urlPath, res) {
  const relative = (urlPath === "/" || urlPath === "" ? "public/warehouse-admin.html" : urlPath.replace(/^\//, ""));
  const resolvedFile = path.resolve(ROOT, relative);
  const relativeToRoot = path.relative(path.resolve(ROOT), resolvedFile);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(resolvedFile) || fs.statSync(resolvedFile).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const contentType = MIME[path.extname(resolvedFile)] || "application/octet-stream";
  res.writeHead(200, staticResponseHeaders(contentType, resolvedFile));
  fs.createReadStream(resolvedFile).pipe(res);
}

function serveWarehouseAdmin(res) {
  serveStatic("public/warehouse-admin.html", res);
}

function serveWarehouseLedger(res) {
  serveStatic("public/warehouse-ledger.html", res);
}

function serveWarehouseSeller(res) {
  serveStatic("public/warehouse-seller.html", res);
}

function serveWarehouseSale(res) {
  serveStatic("public/warehouse-sale.html", res);
}

function serveWarehouseCustomers(res) {
  serveStatic("public/warehouse-customers.html", res);
}

function serveWarehouseOrders(res) {
  serveStatic("public/warehouse-orders.html", res);
}

function serveWarehouseCustomerDetail(res) {
  serveStatic("public/warehouse-customer.html", res);
}

function serveWarehouseAsset(assetPath, res) {
  serveStatic(`public/${assetPath}`, res);
}

function serveWarehouseUpload(fileName, res) {
  serveStatic(`data/transaction-photos/${fileName}`, res);
}

function redirectTo(res, target) {
  res.writeHead(302, { Location: target });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", "http://127.0.0.1");

  if (req.method === "OPTIONS") {
    if (!requestOriginAllowed(req)) {
      sendApiJson(res, 403, { error: "Bu origin uchun ruxsat yo'q" });
      return;
    }
    res.writeHead(204, {
      ...baseApiJsonHeaders(),
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Warehouse-Access",
    });
    res.end();
    return;
  }

  const apiPath = u.pathname.startsWith("/warehouse/api/")
    ? `/api${u.pathname.slice("/warehouse/api".length)}`
    : u.pathname;

  if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/warehouse/api/")) {
    if (!requestOriginAllowed(req)) {
      sendApiJson(res, 403, { error: "Bu origin uchun ruxsat yo'q" });
      return;
    }
    try {
      if (await handleWarehouseApiRoute(req, res, u, apiPath, {
        approveTransaction,
        assertWarehouseAdmin,
        assertWarehouseOperator,
        buildDebtReply,
        buildPendingReply,
        createStaffAccessLink,
        createStaffAccount,
        createWarehouseOrder,
        createWarehouseTransaction,
        currentWarehousePricing,
        deleteCustomer,
        deleteStaffAccount,
        extractTelegramMessage,
        getCustomerDetail,
        groupCustomersByPaymentType,
        listApprovedTransactions,
        listCustomerSummaries,
        listDeletedCustomers,
        listPendingTransactions,
        listSellerCashHandoffs,
        listWarehouseOrders,
        listWarehouseReceipts,
        listStaffAccounts,
        loadWarehouse,
        normalizeApprovalPayment,
        readPostJson,
        recordApprovedSale,
        recordCustomerPayment,
        recordSellerCashHandoff,
        recordWarehouseReceipt,
        restoreDeletedCustomer,
        revokeStaffAccessLink,
        saveWarehouse,
        setCustomerSellerBalanceVisibility,
        seedWarehouseStock,
        sendApiJson,
        sendTelegramAdminDm,
        sendTelegramChannelMessage,
        sendTelegramMessage,
        buildChannelSaleMsg,
        buildChannelPaymentMsg,
        buildChannelApprovalMsg,
        buildChannelNewOrderMsg,
        buildAdminNewOrderMsg,
        buildCustomerSaleMsg,
        buildCustomerPaymentMsg,
        summarizeApprovedTransactions,
        summarizeOperatorDailyActivity,
        summarizeWarehouseReceipts,
        summarizeCustomers,
        storeWarehouseTransactionPhoto,
        storeWarehouseTransactionPhotos,
        updateStaffAccountPermissions,
        updateWarehousePricing,
        upsertCustomer,
      })) {
        return;
      }
    } catch (error) {
      if (error?.code === "PAYLOAD_TOO_LARGE") {
        sendApiJson(res, 413, {
          error: `So'rov hajmi ${Math.round(WAREHOUSE_MAX_REQUEST_BYTES / (1024 * 1024))} MB dan oshmasin`,
        });
        return;
      }
      console.error("Warehouse API error", error);
      sendApiJson(res, 500, { error: "Server xatoligi" });
      return;
    }
    sendApiJson(res, 404, { error: "API route not found" });
    return;
  }

  if ((u.pathname === "/" || u.pathname === "/warehouse" || u.pathname === "/warehouse/") && req.method === "GET") {
    redirectTo(res, `/warehouse/admin${u.search}`);
    return;
  }

  if (req.method === "GET" && !hasWarehouseRouteAccess(req, u)) {
    res.writeHead(403, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end("Kirish faqat admin bergan maxsus ruxsat havolasi orqali mumkin.");
    return;
  }

  if (u.pathname === "/favicon.svg" && req.method === "GET") {
    serveStatic("public/favicon.svg", res);
    return;
  }

  if (u.pathname === "/icon-192.png" && req.method === "GET") {
    serveStatic("public/icon-192.png", res);
    return;
  }

  if (u.pathname === "/icon-512.png" && req.method === "GET") {
    serveStatic("public/icon-512.png", res);
    return;
  }

  if (u.pathname === "/warehouse/sw.js" && req.method === "GET") {
    serveStatic("public/warehouse-sw.js", res);
    return;
  }

  if (u.pathname === "/warehouse/manifest.json" && req.method === "GET") {
    const access = u.searchParams.get("access") || "";
    const page = u.searchParams.get("page") || "seller";
    const pageMap = {
      seller: "/warehouse/seller",
      customers: "/warehouse/customers",
      sale: "/warehouse/seller/sale/cash",
      admin: "/warehouse/admin",
      ledger: "/warehouse/admin/cash",
      customer: "/warehouse/customers",
    };
    const startPath = pageMap[page] || "/warehouse/seller";
    const startUrl = access ? `${startPath}?access=${encodeURIComponent(access)}` : startPath;
    const manifest = {
      id: "/warehouse/app",
      name: "Сыр АКБЕЛ",
      short_name: "АКБЕЛ",
      start_url: startUrl,
      scope: "/warehouse/",
      display: "standalone",
      background_color: "#f8f3eb",
      theme_color: "#9f6b2f",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      ],
    };
    res.writeHead(200, { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(manifest));
    return;
  }

  if (u.pathname === "/warehouse/assets/warehouse-auth-pin.js" && req.method === "GET") {
    serveWarehouseAsset("warehouse-auth-pin.js", res);
    return;
  }

  if (u.pathname === "/warehouse-top-nav.js" && req.method === "GET") {
    serveWarehouseAsset("warehouse-top-nav.js", res);
    return;
  }

  const warehouseUploadMatch = u.pathname.match(/^\/warehouse\/uploads\/([a-f0-9-]+\.(?:jpg|jpeg|png|webp|gif))$/i);
  if (warehouseUploadMatch && req.method === "GET") {
    serveWarehouseUpload(warehouseUploadMatch[1], res);
    return;
  }

  const legacyWarehouseStaticRoutes = {
    "/public/warehouse-admin.html": "/warehouse/admin",
    "/public/warehouse-ledger.html": "/warehouse/admin/cash",
    "/public/warehouse-seller.html": "/warehouse/seller",
    "/public/warehouse-sale.html": "/warehouse/seller/sale/cash",
    "/public/warehouse-customers.html": "/warehouse/customers",
  };
  if (legacyWarehouseStaticRoutes[u.pathname] && req.method === "GET") {
    redirectTo(res, `${legacyWarehouseStaticRoutes[u.pathname]}${u.search}`);
    return;
  }
  if (u.pathname === "/public/warehouse-customer.html" && req.method === "GET") {
    redirectTo(res, `/warehouse/customers${u.search}`);
    return;
  }
  if (u.pathname === "/public/warehouse-auth-pin.js" && req.method === "GET") {
    redirectTo(res, "/warehouse/assets/warehouse-auth-pin.js");
    return;
  }
  if (u.pathname === "/public/warehouse-top-nav.js" && req.method === "GET") {
    redirectTo(res, "/warehouse-top-nav.js");
    return;
  }

  if (u.pathname === "/admin" && req.method === "GET") {
    redirectTo(res, `/warehouse/admin${u.search}`);
    return;
  }
  if (u.pathname === "/seller" && req.method === "GET") {
    redirectTo(res, `/warehouse/seller${u.search}`);
    return;
  }
  if (u.pathname === "/seller/sale" && req.method === "GET") {
    redirectTo(res, `/warehouse/seller/sale/cash${u.search}`);
    return;
  }
  if (u.pathname === "/seller/sale/cash" && req.method === "GET") {
    redirectTo(res, `/warehouse/seller/sale/cash${u.search}`);
    return;
  }
  if (u.pathname === "/seller/sale/transfer" && req.method === "GET") {
    redirectTo(res, `/warehouse/seller/sale/transfer${u.search}`);
    return;
  }
  if (u.pathname === "/customers" && req.method === "GET") {
    redirectTo(res, `/warehouse/customers${u.search}`);
    return;
  }
  if (u.pathname === "/orders" && req.method === "GET") {
    redirectTo(res, `/warehouse/orders${u.search}`);
    return;
  }
  if (/^\/customers\/\d+$/.test(u.pathname) && req.method === "GET") {
    const id = u.pathname.split("/").pop();
    redirectTo(res, `/warehouse/customers/${id}${u.search}`);
    return;
  }
  if (u.pathname === "/admin/cash" && req.method === "GET") {
    redirectTo(res, `/warehouse/admin/cash${u.search}`);
    return;
  }
  if (u.pathname === "/admin/transfer" && req.method === "GET") {
    redirectTo(res, `/warehouse/admin/transfer${u.search}`);
    return;
  }

  if (u.pathname === "/warehouse/admin" && req.method === "GET") {
    serveWarehouseAdmin(res);
    return;
  }
  if (u.pathname === "/warehouse/seller" && req.method === "GET") {
    serveWarehouseSeller(res);
    return;
  }
  if (u.pathname === "/warehouse/seller/sale" && req.method === "GET") {
    redirectTo(res, `/warehouse/seller/sale/cash${u.search}`);
    return;
  }
  if ((u.pathname === "/warehouse/seller/sale/cash" || u.pathname === "/warehouse/seller/sale/transfer") && req.method === "GET") {
    serveWarehouseSale(res);
    return;
  }
  if (u.pathname === "/warehouse/customers" && req.method === "GET") {
    serveWarehouseCustomers(res);
    return;
  }
  if (u.pathname === "/warehouse/orders" && req.method === "GET") {
    serveWarehouseOrders(res);
    return;
  }
  if (/^\/warehouse\/customers\/\d+$/.test(u.pathname) && req.method === "GET") {
    serveWarehouseCustomerDetail(res);
    return;
  }
  if ((u.pathname === "/warehouse/admin/cash" || u.pathname === "/warehouse/admin/transfer") && req.method === "GET") {
    serveWarehouseLedger(res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Syr AKBEL standalone → http://127.0.0.1:${PORT}/warehouse/admin`);
  console.log(`Seller page → http://127.0.0.1:${PORT}/warehouse/seller`);
});