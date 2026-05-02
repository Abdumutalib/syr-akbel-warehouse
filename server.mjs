#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
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
let warehouseStateCache = loadWarehouseState(WAREHOUSE_STATE_PATH);
let warehouseWriteQueue = Promise.resolve();
let yandexUploadTimer = null;
let yandexUploadInFlight = false;
let yandexUploadRequested = false;

function resolveWarehouseStatePath() {
  const configured = process.env.WAREHOUSE_STATE_FILE?.trim() || "data/warehouse.json";
  return path.isAbsolute(configured) ? configured : path.join(ROOT, configured);
}

function loadWarehouse() {
  return warehouseStateCache;
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

function buildDailySummaryCsv(state) {
  const SEP = ";";
  const csvEscape = (v) => {
    const s = String(v == null ? "" : v);
    return s.includes(SEP) || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmtMoney = (n) => Math.round(n).toLocaleString("ru-RU");

  // Approved transactions only
  const approved = (state.transactions || []).filter((tx) => tx.status === "approved");

  // Group by date
  const byDate = new Map();
  for (const tx of approved) {
    const dateStr = tx.approvedAt || tx.createdAt || "";
    const day = dateStr ? new Date(dateStr).toLocaleDateString("ru-RU") : "Noma'lum";
    if (!byDate.has(day)) byDate.set(day, { savdo: 0, naqd: 0, otkazma: 0, topshirilgan: 0 });
    const d = byDate.get(day);
    if (tx.kind === "sale" || !tx.kind || tx.kind === "pending-sale") {
      d.savdo += Number(tx.totalPrice || 0);
    }
    d.naqd += Number(tx.cashPaidAmount || 0);
    d.otkazma += Number(tx.transferPaidAmount || 0);
    if (tx.kind === "payment") {
      d.topshirilgan += Number((tx.cashPaidAmount || 0)) + Number((tx.transferPaidAmount || 0));
    }
  }

  // Sort by date
  const sortedDays = [...byDate.entries()].sort((a, b) => {
    const parse = (s) => { const [d, m, y] = s.split("."); return new Date(+y, +m - 1, +d); };
    try { return parse(a[0]) - parse(b[0]); } catch { return 0; }
  });

  // Overall totals
  let totalSavdo = 0, totalNaqd = 0, totalOtkazma = 0, totalTopshirilgan = 0;
  for (const [, d] of sortedDays) {
    totalSavdo += d.savdo;
    totalNaqd += d.naqd;
    totalOtkazma += d.otkazma;
    totalTopshirilgan += d.topshirilgan;
  }
  const totalPaid = totalNaqd + totalOtkazma;
  const umumiyQarzdorlik = Math.max(0, totalSavdo - totalPaid);

  const header = ["Sana", "Kunlik savdo", "Naqd to'lov", "O'tkazma to'lov", "Jami to'langan", "Sotuvchi topshirgan", "Kunlik qarz"].join(SEP);
  const rows = sortedDays.map(([day, d]) => {
    const jami = d.naqd + d.otkazma;
    const qarz = Math.max(0, d.savdo - jami);
    return [day, fmtMoney(d.savdo), fmtMoney(d.naqd), fmtMoney(d.otkazma), fmtMoney(jami), fmtMoney(d.topshirilgan), fmtMoney(qarz)].map(csvEscape).join(SEP);
  });

  const jamiRow = ["JAMI", fmtMoney(totalSavdo), fmtMoney(totalNaqd), fmtMoney(totalOtkazma), fmtMoney(totalPaid), fmtMoney(totalTopshirilgan), fmtMoney(umumiyQarzdorlik)].map(csvEscape).join(SEP);
  const debtRow = ["Umumiy qarzdorlik", fmtMoney(umumiyQarzdorlik), "", "", "", "", ""].map(csvEscape).join(SEP);

  return "\uFEFF" + [header, ...rows, "", jamiRow, debtRow].join("\r\n");
}

function formatWorksheetDate(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString("ru-RU");
}

function getModePaymentAmount(entry, mode) {
  const splitValue = Number(mode === "cash" ? entry.cashPaidAmount || 0 : entry.transferPaidAmount || 0);
  if (splitValue > 0) return splitValue;
  if (entry.cashPaidAmount == null && entry.transferPaidAmount == null && entry.priceType === mode) {
    return Number(entry.paidAmount || 0);
  }
  return 0;
}

function getModeTitle(customer, index) {
  const suffix = customer.taxId ? ` | INN: ${customer.taxId}` : "";
  return `${index + 1}- ${customer.fullName}${suffix}`;
}

function buildCustomerModeRows(detail, mode) {
  const entries = (detail.history || [])
    .filter((entry) => entry.status === "approved")
    .sort((left, right) => {
      const leftTime = new Date(left.approvedAt || left.createdAt || 0).getTime();
      const rightTime = new Date(right.approvedAt || right.createdAt || 0).getTime();
      return leftTime - rightTime || left.id - right.id;
    });

  let runningSales = 0;
  let runningPaid = 0;
  const rows = [];

  for (const entry of entries) {
    const totalPaidForEntry =
      entry.cashPaidAmount != null || entry.transferPaidAmount != null
        ? Number(entry.cashPaidAmount || 0) + Number(entry.transferPaidAmount || 0)
        : Number(entry.paidAmount || 0);
    if (entry.kind === "sale") {
      runningSales += Number(entry.totalPrice || 0);
    }
    runningPaid += totalPaidForEntry;

    const paymentAmount = getModePaymentAmount(entry, mode);
    const isModeSale = entry.kind === "sale" && (entry.priceType === mode || paymentAmount > 0);
    const isModePayment = entry.kind === "payment" && paymentAmount > 0;
    if (!isModeSale && !isModePayment) continue;

    const dateText = formatWorksheetDate(entry.approvedAt || entry.createdAt);
    const kg = isModeSale ? Number(entry.amountKg || 0) : 0;
    const total = isModeSale ? Number(entry.totalPrice || 0) : 0;

    rows.push([
      dateText,
      kg || "",
      total || "",
      paymentAmount || "",
      paymentAmount > 0 ? dateText : "",
      Math.max(0, Math.round(runningSales - runningPaid)) || "",
    ]);
  }

  return rows;
}

function styleWorksheetBlock(worksheet, startColumn, rowCount) {
  const titleCell = worksheet.getCell(1, startColumn);
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  titleCell.font = { bold: true, size: 12 };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9EAF7" },
  };

  for (let column = startColumn; column < startColumn + 6; column += 1) {
    const header = worksheet.getCell(2, column);
    header.font = { bold: true };
    header.alignment = { horizontal: "center", vertical: "middle" };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF3F4F6" },
    };
    worksheet.getColumn(column).width = [14, 10, 14, 14, 16, 14][column - startColumn];
  }

  for (let row = 1; row <= rowCount; row += 1) {
    for (let column = startColumn; column < startColumn + 6; column += 1) {
      const cell = worksheet.getCell(row, column);
      cell.border = {
        top: { style: "thin", color: { argb: "FFBFC7D5" } },
        left: { style: "thin", color: { argb: "FFBFC7D5" } },
        bottom: { style: "thin", color: { argb: "FFBFC7D5" } },
        right: { style: "thin", color: { argb: "FFBFC7D5" } },
      };
      if (row >= 3 && column !== startColumn) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    }
  }
}

async function buildCustomerWorkbookBuffer(state, mode) {
  const { default: ExcelJS } = await import("exceljs");
  const pricing = getWarehousePricing(state);
  const grouped = groupCustomersByPaymentType(state, pricing);
  const selected = mode === "cash" ? grouped.cashCustomers : grouped.transferCustomers;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GitHub Copilot";
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet(mode === "cash" ? "Naqd" : "Perechislenie", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  const headers = ["Sana", "kg", "Summa", "To'lov", "To'lov sanasi", "Qarz"];
  const customers = [];

  for (const customer of selected) {
    const detail = getCustomerDetail(state, customer.id, pricing);
    const rows = buildCustomerModeRows(detail, mode);
    if (rows.length > 0) {
      customers.push({ customer: detail.customer, rows });
    }
  }

  if (customers.length === 0) {
    worksheet.mergeCells(1, 1, 1, 6);
    worksheet.getCell(1, 1).value = mode === "cash" ? "Naqd mijozlar topilmadi" : "Perechislenie mijozlar topilmadi";
    headers.forEach((header, index) => {
      worksheet.getCell(2, index + 1).value = header;
    });
    styleWorksheetBlock(worksheet, 1, 2);
    return workbook.xlsx.writeBuffer();
  }

  customers.forEach(({ customer, rows }, customerIndex) => {
    const startColumn = customerIndex * 6 + 1;
    worksheet.mergeCells(1, startColumn, 1, startColumn + 5);
    worksheet.getCell(1, startColumn).value = getModeTitle(customer, customerIndex);
    headers.forEach((header, index) => {
      worksheet.getCell(2, startColumn + index).value = header;
    });
    rows.forEach((rowValues, rowIndex) => {
      rowValues.forEach((value, valueIndex) => {
        worksheet.getCell(3 + rowIndex, startColumn + valueIndex).value = value;
      });
    });
    styleWorksheetBlock(worksheet, startColumn, Math.max(2, rows.length + 2));
  });

  return workbook.xlsx.writeBuffer();
}

async function uploadCsvToYandex(state) {
  const login = process.env.YANDEX_DISK_LOGIN?.trim();
  const password = process.env.YANDEX_DISK_PASSWORD?.trim();
  if (!login || !password) return;
  try {
    const auth = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
    const cashWorkbook = await buildCustomerWorkbookBuffer(state, "cash");
    const transferWorkbook = await buildCustomerWorkbookBuffer(state, "transfer");
    const uploads = [
      { url: "https://webdav.yandex.ru/akbel-export.csv", csv: buildCsvContent(state, "all") },
      { url: "https://webdav.yandex.ru/akbel-naqd.csv", csv: buildCsvContent(state, "cash") },
      { url: "https://webdav.yandex.ru/akbel-otkazma.csv", csv: buildCsvContent(state, "transfer") },
      { url: "https://webdav.yandex.ru/akbel-hisobot.csv", csv: buildDailySummaryCsv(state) },
      {
        url: "https://webdav.yandex.ru/akbel-naqd.xlsx",
        body: cashWorkbook,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      {
        url: "https://webdav.yandex.ru/akbel-otkazma.xlsx",
        body: transferWorkbook,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ];

    for (const item of uploads) {
      const resp = await fetch(item.url, {
        method: "PUT",
        headers: {
          Authorization: auth,
          "Content-Type": item.contentType || "text/csv; charset=utf-8",
        },
        body: item.body || item.csv,
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
  warehouseStateCache = state;
  saveWarehouseState(WAREHOUSE_STATE_PATH, state);
  scheduleYandexCsvUpload();
}

function withWarehouseRead(handler) {
  return handler(warehouseStateCache);
}

function withWarehouseWrite(handler) {
  const task = warehouseWriteQueue.then(async () => {
    const result = await handler(warehouseStateCache);
    saveWarehouse(warehouseStateCache);
    return result;
  });
  warehouseWriteQueue = task.catch(() => {});
  return task;
}

function scheduleYandexCsvUpload() {
  yandexUploadRequested = true;
  if (yandexUploadTimer) {
    clearTimeout(yandexUploadTimer);
  }
  yandexUploadTimer = setTimeout(() => {
    yandexUploadTimer = null;
    flushYandexCsvUpload();
  }, 1200);
}

async function flushYandexCsvUpload() {
  if (yandexUploadInFlight) {
    return;
  }
  if (!yandexUploadRequested) {
    return;
  }
  yandexUploadRequested = false;
  yandexUploadInFlight = true;
  try {
    await uploadCsvToYandex(warehouseStateCache);
  } catch {
    // Swallow errors to keep API writes resilient.
  } finally {
    yandexUploadInFlight = false;
    if (yandexUploadRequested) {
      flushYandexCsvUpload().catch(() => {});
    }
  }
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

function staticResponseHeaders(contentType, filePath, etag = null) {
  const extension = path.extname(filePath).toLowerCase();
  const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico"].includes(extension);
  const isScript = extension === ".js";
  const isCss = extension === ".css";
  const isHtml = extension === ".html";
  let cacheControl;
  if (isImage) {
    // Images change rarely — cache 7 days
    cacheControl = "public, max-age=604800, immutable";
  } else if (isScript || isCss) {
    // JS/CSS — cache 1 hour, revalidate with ETag
    cacheControl = "public, max-age=3600, must-revalidate";
  } else if (isHtml) {
    // HTML — always revalidate (ETag), but can serve from cache if unchanged
    cacheControl = "no-cache";
  } else {
    cacheControl = "no-store";
  }
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "Vary": "Accept-Encoding",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (etag) headers["ETag"] = etag;
  if (isHtml) {
    headers["Pragma"] = "no-cache";
  }
  return headers;
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

function acceptsGzip(req) {
  const ae = String(req?.headers?.["accept-encoding"] || "");
  return ae.includes("gzip");
}

function isCompressibleMime(contentType) {
  return (
    contentType.startsWith("text/") ||
    contentType.startsWith("application/json") ||
    contentType.startsWith("application/javascript") ||
    contentType.startsWith("image/svg")
  );
}

function sendApiJson(res, status, data, req = null) {
  const json = JSON.stringify(data);
  const headers = baseApiJsonHeaders();
  if (req && acceptsGzip(req)) {
    const compressed = zlib.gzipSync(Buffer.from(json, "utf8"), { level: 6 });
    headers["Content-Encoding"] = "gzip";
    headers["Content-Length"] = String(compressed.length);
    headers["Vary"] = "Accept-Encoding";
    res.writeHead(status, headers);
    res.end(compressed);
  } else {
    headers["Content-Length"] = String(Buffer.byteLength(json, "utf8"));
    res.writeHead(status, headers);
    res.end(json);
  }
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

async function sendTelegramCashChannelMessage(text) {
  const channelId = process.env.TELEGRAM_CHANNEL_CASH_ID?.trim();
  if (!channelId || !text) return false;
  return sendTelegramMessage(channelId, text);
}

async function sendTelegramTransferChannelMessage(text) {
  const channelId = process.env.TELEGRAM_CHANNEL_TRANSFER_ID?.trim();
  if (!channelId || !text) return false;
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

async function createWarehouseTransaction(payload) {
  return withWarehouseWrite((state) =>
    createPendingTransaction(
      state,
      {
        text: payload.text,
        telegramId: payload.telegramId ?? null,
      },
      { pricing: currentWarehousePricing(state) }
    )
  );
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

function serveStatic(urlPath, req, res) {
  const relative = (urlPath === "/" || urlPath === "" ? "public/warehouse-admin.html" : urlPath.replace(/^\//, ""));
  const resolvedFile = path.resolve(ROOT, relative);
  const relativeToRoot = path.relative(path.resolve(ROOT), resolvedFile);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  let stat;
  try {
    stat = fs.statSync(resolvedFile);
  } catch {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  if (stat.isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const contentType = MIME[path.extname(resolvedFile)] || "application/octet-stream";
  const etag = `W/"${stat.size.toString(36)}-${stat.mtimeMs.toString(36)}"`;
  if (req?.headers?.["if-none-match"] === etag) {
    res.writeHead(304, { ETag: etag, "Cache-Control": staticResponseHeaders(contentType, resolvedFile, etag)["Cache-Control"] });
    res.end();
    return;
  }
  const headers = staticResponseHeaders(contentType, resolvedFile, etag);
  const useGzip = req && acceptsGzip(req) && isCompressibleMime(contentType);
  if (useGzip) {
    headers["Content-Encoding"] = "gzip";
  }
  res.writeHead(200, headers);
  if (req?.method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(resolvedFile);
  if (useGzip) {
    stream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
  } else {
    stream.pipe(res);
  }
}

function serveWarehouseAdmin(req, res) {
  serveStatic("public/warehouse-admin.html", req, res);
}

function serveWarehouseLedger(req, res) {
  serveStatic("public/warehouse-ledger.html", req, res);
}

function serveWarehouseSeller(req, res) {
  serveStatic("public/warehouse-seller.html", req, res);
}

function serveWarehouseSale(req, res) {
  serveStatic("public/warehouse-sale.html", req, res);
}

function serveWarehouseCustomers(req, res) {
  serveStatic("public/warehouse-customers.html", req, res);
}

function serveWarehouseOrders(req, res) {
  serveStatic("public/warehouse-orders.html", req, res);
}

function serveWarehouseCustomerDetail(req, res) {
  serveStatic("public/warehouse-customer.html", req, res);
}

function serveWarehouseAsset(assetPath, req, res) {
  serveStatic(`public/${assetPath}`, req, res);
}

function serveWarehouseUpload(fileName, req, res) {
  serveStatic(`data/transaction-photos/${fileName}`, req, res);
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
        withWarehouseRead,
        withWarehouseWrite,
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
        sendApiJson: (res, status, data) => sendApiJson(res, status, data, req),
        sendTelegramAdminDm:
        sendTelegramChannelMessage,
        sendTelegramCashChannelMessage,
        sendTelegramTransferChannelMessage,
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
    serveStatic("public/favicon.svg", req, res);
    return;
  }

  if (u.pathname === "/icon-192.png" && req.method === "GET") {
    serveStatic("public/icon-192.png", req, res);
    return;
  }

  if (u.pathname === "/icon-512.png" && req.method === "GET") {
    serveStatic("public/icon-512.png", req, res);
    return;
  }

  if (u.pathname === "/warehouse/sw.js" && req.method === "GET") {
    serveStatic("public/warehouse-sw.js", req, res);
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
    serveWarehouseAsset("warehouse-auth-pin.js", req, res);
    return;
  }

  if (u.pathname === "/warehouse-top-nav.js" && req.method === "GET") {
    serveWarehouseAsset("warehouse-top-nav.js", req, res);
    return;
  }

  const warehouseUploadMatch = u.pathname.match(/^\/warehouse\/uploads\/([a-f0-9-]+\.(?:jpg|jpeg|png|webp|gif))$/i);
  if (warehouseUploadMatch && req.method === "GET") {
    serveWarehouseUpload(warehouseUploadMatch[1], req, res);
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
    serveWarehouseAdmin(req, res);
    return;
  }
  if (u.pathname === "/warehouse/seller" && req.method === "GET") {
    serveWarehouseSeller(req, res);
    return;
  }
  if (u.pathname === "/warehouse/seller/sale" && req.method === "GET") {
    redirectTo(res, `/warehouse/seller/sale/cash${u.search}`);
    return;
  }
  if ((u.pathname === "/warehouse/seller/sale/cash" || u.pathname === "/warehouse/seller/sale/transfer") && req.method === "GET") {
    serveWarehouseSale(req, res);
    return;
  }
  if (u.pathname === "/warehouse/customers" && req.method === "GET") {
    serveWarehouseCustomers(req, res);
    return;
  }
  if (u.pathname === "/warehouse/orders" && req.method === "GET") {
    serveWarehouseOrders(req, res);
    return;
  }
  if (/^\/warehouse\/customers\/\d+$/.test(u.pathname) && req.method === "GET") {
    serveWarehouseCustomerDetail(req, res);
    return;
  }
  if ((u.pathname === "/warehouse/admin/cash" || u.pathname === "/warehouse/admin/transfer") && req.method === "GET") {
    serveWarehouseLedger(req, res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// Keep connections alive longer than Northflank's LB (60s default) to avoid mid-request drops
server.keepAliveTimeout = 65000;
server.headersTimeout = 70000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Syr AKBEL standalone → http://127.0.0.1:${PORT}/warehouse/admin`);
  console.log(`Seller page → http://127.0.0.1:${PORT}/warehouse/seller`);
});