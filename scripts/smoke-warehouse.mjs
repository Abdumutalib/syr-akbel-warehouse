#!/usr/bin/env node

const baseUrl = (process.env.SMOKE_BASE_URL || "https://akbelim.com").replace(/\/$/, "");
const username = process.env.SMOKE_WAREHOUSE_USER || "";
const password = process.env.SMOKE_WAREHOUSE_PASS || "";

const pagePaths = [
  "/warehouse/admin",
  "/warehouse/seller",
  "/warehouse/seller/sale/cash",
  "/warehouse/seller/sale/transfer",
  "/warehouse/customers",
  "/warehouse/orders",
  "/warehouse/admin/cash",
  "/warehouse/admin/transfer",
  "/warehouse/ledger",
];

const publicApiPaths = [
  "/healthz",
  "/warehouse/api/warehouse/staff-directory",
];

const authApiPaths = [
  "/warehouse/api/warehouse/customers",
  "/warehouse/api/warehouse/orders",
  "/warehouse/api/warehouse/order-customer-directory",
];

function authHeader() {
  if (!username || !password) return {};
  const encoded = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return { Authorization: `Basic ${encoded}` };
}

async function checkPath(pathname, options = {}) {
  const started = Date.now();
  const url = `${baseUrl}${pathname}?smoke=${Date.now()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      ...(options.headers || {}),
    },
  });
  const elapsedMs = Date.now() - started;
  return {
    path: pathname,
    url,
    ok: response.ok,
    status: response.status,
    elapsedMs,
    contentType: response.headers.get("content-type") || "",
    appVersion: response.headers.get("x-app-version") || "",
  };
}

function printResult(prefix, result) {
  const mark = result.ok ? "OK" : "FAIL";
  const versionText = result.appVersion ? ` version=${result.appVersion}` : "";
  console.log(`[${mark}] ${prefix} ${result.path} status=${result.status} time=${result.elapsedMs}ms${versionText}`);
}

async function main() {
  const failures = [];

  for (const path of pagePaths) {
    try {
      const result = await checkPath(path);
      printResult("PAGE", result);
      if (!result.ok) failures.push(result);
    } catch (error) {
      console.log(`[FAIL] PAGE ${path} error=${error.message}`);
      failures.push({ path, status: "ERR", error: error.message });
    }
  }

  for (const path of publicApiPaths) {
    try {
      const result = await checkPath(path);
      printResult("API", result);
      if (!result.ok) failures.push(result);
    } catch (error) {
      console.log(`[FAIL] API ${path} error=${error.message}`);
      failures.push({ path, status: "ERR", error: error.message });
    }
  }

  if (username && password) {
    for (const path of authApiPaths) {
      try {
        const result = await checkPath(path, { headers: authHeader() });
        printResult("AUTH_API", result);
        if (!result.ok) failures.push(result);
      } catch (error) {
        console.log(`[FAIL] AUTH_API ${path} error=${error.message}`);
        failures.push({ path, status: "ERR", error: error.message });
      }
    }
  } else {
    console.log("[INFO] AUTH_API checks skipped. Set SMOKE_WAREHOUSE_USER and SMOKE_WAREHOUSE_PASS.");
  }

  if (failures.length) {
    console.log(`\nSmoke failed: ${failures.length} check(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log("\nSmoke passed: all checks are green.");
}

main().catch((error) => {
  console.error("Smoke runner crashed:", error);
  process.exit(1);
});
