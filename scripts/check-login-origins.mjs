#!/usr/bin/env node

const publicBase = (process.env.COMPARE_PUBLIC_BASE || "https://akbelim.com").replace(/\/$/, "");
const vdsBase = (process.env.COMPARE_VDS_BASE || "http://178.218.207.161").replace(/\/$/, "");
const username = process.env.COMPARE_WAREHOUSE_USER || process.env.SMOKE_WAREHOUSE_USER || "";
const password = process.env.COMPARE_WAREHOUSE_PASS || process.env.SMOKE_WAREHOUSE_PASS || "";

if (!username || !password) {
  console.error("COMPARE_WAREHOUSE_USER/PASS (yoki SMOKE_WAREHOUSE_USER/PASS) berilmagan.");
  process.exit(1);
}

function hasWarehouseCookie(headers) {
  const many = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  if (Array.isArray(many) && many.some((entry) => String(entry).includes("warehouse-site="))) {
    return true;
  }
  const single = headers.get("set-cookie") || "";
  return single.includes("warehouse-site=");
}

async function checkLogin(base) {
  const form = new URLSearchParams({ username, password }).toString();
  const response = await fetch(`${base}/warehouse-register`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    body: form,
  });

  const status = response.status;
  const location = response.headers.get("location") || "";
  const cookieOk = hasWarehouseCookie(response.headers);
  const ok = status === 302 && location.startsWith("/warehouse/") && cookieOk;

  return {
    base,
    ok,
    status,
    location,
    cookieOk,
  };
}

async function main() {
  const targets = [vdsBase, publicBase];
  const results = [];

  for (const base of targets) {
    try {
      const result = await checkLogin(base);
      results.push(result);
      console.log(
        `[${result.ok ? "OK" : "FAIL"}] ${base} status=${result.status} location=${result.location || "(none)"} cookie=${result.cookieOk}`
      );
    } catch (error) {
      console.log(`[FAIL] ${base} error=${error.message}`);
      results.push({ base, ok: false, status: -1, location: "", cookieOk: false });
    }
  }

  const failed = results.filter((entry) => !entry.ok);
  if (failed.length > 0) {
    console.log(`\nLogin check failed on ${failed.length} target(s).`);
    process.exitCode = 1;
    return;
  }

  console.log("\nLogin check passed: ikkalasida ham bir xil credential ishlayapti.");
}

main().catch((error) => {
  console.error("Login checker crashed:", error);
  process.exit(1);
});
