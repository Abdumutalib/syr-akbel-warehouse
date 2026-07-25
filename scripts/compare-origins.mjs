#!/usr/bin/env node

import crypto from "node:crypto";

const publicBase = (process.env.COMPARE_PUBLIC_BASE || "https://akbelim.com").replace(/\/$/, "");
const vdsBase = (process.env.COMPARE_VDS_BASE || "http://178.218.207.161").replace(/\/$/, "");
const username = process.env.COMPARE_WAREHOUSE_USER || process.env.SMOKE_WAREHOUSE_USER || "";
const password = process.env.COMPARE_WAREHOUSE_PASS || process.env.SMOKE_WAREHOUSE_PASS || "";

const comparePaths = [
  "/warehouse/api/warehouse/staff-directory",
  "/warehouse/api/warehouse/orders",
  "/warehouse/api/warehouse/customers",
  "/warehouse/api/warehouse/order-customer-directory",
];

function buildAuthHeaders() {
  if (!username || !password) {
    return {};
  }
  const encoded = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  const auth = `Basic ${encoded}`;
  return {
    Authorization: auth,
    "X-Warehouse-Authorization": auth,
  };
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeValue(item))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b, "en"))) {
      out[key] = normalizeValue(value[key]);
    }
    return out;
  }
  return value;
}

function stripDynamicFields(pathname, payload) {
  if (pathname === "/warehouse/api/warehouse/orders") {
    // These fields can differ by runtime formatting and are not business identity.
    const root = { ...payload };
    if (Array.isArray(root.orders)) {
      root.orders = root.orders.map((order) => {
        const clone = { ...order };
        delete clone.createdAtText;
        delete clone.approvedAtText;
        return clone;
      });
    }
    return root;
  }
  if (pathname === "/warehouse/api/warehouse/customers" || pathname === "/warehouse/api/warehouse/order-customer-directory") {
    const list = Array.isArray(payload?.customers) ? payload.customers : [];
    const normalizedCustomers = list.map((customer) => ({
      fullName: customer?.fullName ?? null,
      fullNames: Array.isArray(customer?.fullNames) ? customer.fullNames : [],
      phone: customer?.phone ?? null,
      phones: Array.isArray(customer?.phones) ? customer.phones : [],
      telegramId: customer?.telegramId ?? null,
      telegramIds: Array.isArray(customer?.telegramIds) ? customer.telegramIds : [],
      location: customer?.location ?? null,
      organizationName: customer?.organizationName ?? null,
      taxId: customer?.taxId ?? null,
      paymentCategories: Array.isArray(customer?.paymentCategories) ? customer.paymentCategories : [],
      customCashPricePerKg: customer?.customCashPricePerKg ?? null,
      customTransferPricePerKg: customer?.customTransferPricePerKg ?? null,
      sellerCanViewBalance: customer?.sellerCanViewBalance ?? null,
    }));
    return { customers: normalizedCustomers };
  }
  return payload;
}

async function fetchJson(base, pathname, headers) {
  const url = `${base}${pathname}?compare=${Date.now()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      ...headers,
    },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return {
    status: response.status,
    ok: response.ok,
    text,
    data,
  };
}

function hashText(text) {
  return crypto.createHash("sha256").update(text || "", "utf8").digest("hex");
}

function payloadCount(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  for (const key of ["customers", "orders", "accounts", "staff"]) {
    if (Array.isArray(payload[key])) {
      return payload[key].length;
    }
  }
  return null;
}

async function main() {
  const headers = buildAuthHeaders();
  const failures = [];

  if (!username || !password) {
    console.log("[WARN] Compare auth env topilmadi. COMPARE_WAREHOUSE_USER/PASS yoki SMOKE_WAREHOUSE_USER/PASS bering.");
  }

  for (const pathname of comparePaths) {
    const pub = await fetchJson(publicBase, pathname, headers);
    const vds = await fetchJson(vdsBase, pathname, headers);

    const statusSame = pub.status === vds.status;
    const rawSame = hashText(pub.text) === hashText(vds.text);

    let semanticSame = false;
    if (pub.data !== null && vds.data !== null) {
      const pubCanon = normalizeValue(stripDynamicFields(pathname, pub.data));
      const vdsCanon = normalizeValue(stripDynamicFields(pathname, vds.data));
      semanticSame = JSON.stringify(pubCanon) === JSON.stringify(vdsCanon);
    }

    const pubCount = payloadCount(pub.data);
    const vdsCount = payloadCount(vds.data);
    const countText = pubCount === null && vdsCount === null ? "" : ` count(public=${pubCount ?? "n/a"}, vds=${vdsCount ?? "n/a"})`;

    const mark = statusSame && semanticSame ? "OK" : "DIFF";
    console.log(
      `[${mark}] ${pathname} status(public=${pub.status}, vds=${vds.status}) semanticSame=${semanticSame} rawSame=${rawSame}${countText}`
    );

    if (!(statusSame && semanticSame)) {
      failures.push({ pathname, statusSame, semanticSame, pubStatus: pub.status, vdsStatus: vds.status });
    }
  }

  if (failures.length > 0) {
    console.log(`\nCompare finished with ${failures.length} difference(s).`);
    process.exitCode = 1;
    return;
  }

  console.log("\nCompare passed: public va VDS ma'lumotlari semantik bir xil.");
}

main().catch((error) => {
  console.error("Compare runner crashed:", error);
  process.exit(1);
});
