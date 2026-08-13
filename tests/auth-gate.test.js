import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createStaffAccessLink,
  createStaffAccount,
  loadWarehouseState,
  saveWarehouseState,
  seedWarehouseStock,
  upsertCustomer,
} from "../lib/warehouse-bot.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const tempPaths = [];
const childProcesses = [];

afterEach(async () => {
  while (childProcesses.length) {
    const child = childProcesses.pop();
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  while (tempPaths.length) {
    fs.rmSync(tempPaths.pop(), { recursive: true, force: true });
  }
});

function makeTempDir(prefix = "warehouse-auth-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempPaths.push(dir);
  return dir;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready: ${url}`);
}

async function startServer(options = {}) {
  const port = await getFreePort();
  const dataDir = makeTempDir();
  const statePath = path.join(dataDir, "warehouse.json");
  const state = loadWarehouseState(statePath);
  if (typeof options.seedState === "function") {
    options.seedState(state);
    saveWarehouseState(statePath, state);
  }

  const env = {
    ...process.env,
    PORT: String(port),
    WAREHOUSE_STATE_FILE: statePath,
    WAREHOUSE_SITE_TOKEN: "test-site-token",
    WAREHOUSE_ALLOWED_ORIGIN: options.allowedOrigin || "",
    WAREHOUSE_ADMIN_USERNAME: options.adminUsername || "admin1",
    WAREHOUSE_ADMIN_PASSWORD: options.adminPassword || "adminpass1",
  };

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  childProcesses.push(child);

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  await waitForServer(`http://127.0.0.1:${port}/warehouse-register`);

  return {
    port,
    statePath,
    child,
    getStderr() {
      return stderr;
    },
  };
}

describe("warehouse auth gate", () => {
  test("renders admin login form and guidance text", async () => {
    const server = await startServer();
    const firstResponse = await fetch(`http://127.0.0.1:${server.port}/warehouse-register`, {
      redirect: "manual",
    });

    assert.equal(firstResponse.status, 302);
    const location = firstResponse.headers.get("location");
    assert.match(location || "", /^\/warehouse-register\?__v=/);

    const response = await fetch(`http://127.0.0.1:${server.port}${location}`, {
      redirect: "manual",
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Admin login va parolni kiriting/);
    assert.match(body, /Xodimlar admin bergan maxsus havola orqali PIN bilan kiradi/);
    assert.equal(server.getStderr(), "");
  });

  test("accepts valid admin login and rejects missing credentials", async () => {
    const server = await startServer();

    const successBody = new URLSearchParams({
      username: "admin1",
      password: "adminpass1",
    });
    const success = await fetch(`http://127.0.0.1:${server.port}/warehouse-register`, {
      method: "POST",
      body: successBody,
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    assert.equal(success.status, 302);
    assert.equal(success.headers.get("location"), "/warehouse/admin");
    assert.match(success.headers.get("set-cookie") || "", /warehouse-site=/);

    const failureBody = new URLSearchParams({ username: "admin1" });
    const failure = await fetch(`http://127.0.0.1:${server.port}/warehouse-register`, {
      method: "POST",
      body: failureBody,
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    assert.equal(failure.status, 302);
    assert.equal(failure.headers.get("location"), "/warehouse-register?error=missing_credentials");
    assert.equal(server.getStderr(), "");
  });

  test("allows same-host browser origin even when allowed origin is configured for another domain", async () => {
    const server = await startServer({
      allowedOrigin: "https://akbelim.com",
    });

    const sameHostOrigin = `http://127.0.0.1:${server.port}`;
    const sameHostResponse = await fetch(`http://127.0.0.1:${server.port}/warehouse/api/warehouse/staff`, {
      headers: {
        Origin: sameHostOrigin,
      },
    });

    assert.equal(sameHostResponse.status, 401);

    const foreignOriginResponse = await fetch(`http://127.0.0.1:${server.port}/warehouse/api/warehouse/staff`, {
      headers: {
        Origin: "http://evil.example",
      },
    });

    assert.equal(foreignOriginResponse.status, 403);
    assert.equal(server.getStderr(), "");
  });

  test("allows transfer access links to write transfer sales", async () => {
    let token = "";
    let customerId = 0;
    const server = await startServer({
      seedState(state) {
        seedWarehouseStock(state, 100);
        const customer = upsertCustomer(state, {
          fullName: "Transfer mijoz",
          paymentCategories: ["transfer"],
        });
        customerId = customer.id;
        const account = createStaffAccount(state, {
          username: "transfer1",
          password: "secret1",
          fullName: "Transfer One",
          role: "seller",
          permissions: ["seller", "transfer"],
        });
        const link = createStaffAccessLink(state, account.id, "transfer");
        token = link.token;
      },
    });

    const pageResponse = await fetch(`http://127.0.0.1:${server.port}/warehouse/seller/sale/transfer?access=${token}`, {
      redirect: "manual",
    });
    assert.equal(pageResponse.status, 200);
    const response = await fetch(`http://127.0.0.1:${server.port}/warehouse/api/warehouse/seller-sale`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "transfer-sale-test",
        "X-Warehouse-Access": token,
      },
      body: JSON.stringify({
        userId: customerId,
        amountKg: 1,
        blockCount: 1,
        priceType: "transfer",
        transferPaidAmount: 0,
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.transaction.priceType, "transfer");
    assert.equal(server.getStderr(), "");
  });

  test("rejects seller-only access links for transfer sales", async () => {
    let token = "";
    let customerId = 0;
    const server = await startServer({
      seedState(state) {
        seedWarehouseStock(state, 100);
        const customer = upsertCustomer(state, { fullName: "Naqd xodim mijozi" });
        customerId = customer.id;
        const account = createStaffAccount(state, {
          username: "seller-only",
          password: "secret1",
          fullName: "Seller Only",
          role: "seller",
          permissions: ["seller"],
        });
        const link = createStaffAccessLink(state, account.id, "seller");
        token = link.token;
      },
    });

    const pageResponse = await fetch(`http://127.0.0.1:${server.port}/warehouse/seller/sale/transfer?access=${token}`, {
      redirect: "manual",
    });
    assert.equal(pageResponse.status, 302);
    assert.equal(pageResponse.headers.get("location"), "/warehouse-register?error=link_revoked");
    const response = await fetch(`http://127.0.0.1:${server.port}/warehouse/api/warehouse/seller-sale`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "seller-transfer-denied-test",
        "X-Warehouse-Access": token,
      },
      body: JSON.stringify({
        userId: customerId,
        amountKg: 1,
        blockCount: 1,
        priceType: "transfer",
      }),
    });

    assert.equal(response.status, 401);
    assert.equal(server.getStderr(), "");
  });
  test("allows staff access links and sets the staff cookie", async () => {
    let token = "";
    const server = await startServer({
      seedState(state) {
        const account = createStaffAccount(state, {
          username: "seller1",
          password: "secret1",
          fullName: "Seller One",
          role: "seller",
          permissions: ["seller", "customers"],
        });
        const link = createStaffAccessLink(state, account.id, "seller");
        token = link.token;
      },
    });

    assert.ok(token);

    const response = await fetch(`http://127.0.0.1:${server.port}/warehouse/seller?access=${token}`, {
      redirect: "manual",
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie") || "", /warehouse-staff-link=/);
    assert.match(response.headers.get("content-type") || "", /text\/html/);
    assert.equal(server.getStderr(), "");
  });

  test("blocks route access until a staff PIN is verified", async () => {
    let token = "";
    const server = await startServer({
      seedState(state) {
        const account = createStaffAccount(state, {
          username: "pin-route-user",
          password: "secret1",
          fullName: "Pin Route User",
          role: "seller",
          permissions: ["seller"],
          pin: "1234",
        });
        const link = createStaffAccessLink(state, account.id, "seller");
        token = link.token;
      },
    });

    const pageResponse = await fetch(`http://127.0.0.1:${server.port}/warehouse/seller?access=${encodeURIComponent(token)}`, {
      redirect: "manual",
    });

    assert.equal(pageResponse.status, 302);
    const redirectLocation = pageResponse.headers.get("location") || "";
    assert.match(redirectLocation, /^\/warehouse-register\?/);
    const redirectUrl = new URL(`http://127.0.0.1:${server.port}${redirectLocation}`);
    assert.equal(redirectUrl.searchParams.get("error"), "pin_required");
    assert.equal(redirectUrl.searchParams.get("access"), token);
    assert.equal(server.getStderr(), "");
  });

  test("requires and unlocks a PIN for staff access links", async () => {
    let token = "";
    const server = await startServer({
      seedState(state) {
        const account = createStaffAccount(state, {
          username: "pin-user",
          password: "secret1",
          fullName: "Pin User",
          role: "seller",
          permissions: ["seller"],
          pin: "1234",
        });
        const link = createStaffAccessLink(state, account.id, "seller");
        token = link.token;
      },
    });

    assert.ok(token);

    const authStatus = await fetch(`http://127.0.0.1:${server.port}/warehouse/api/warehouse/auth-status?access=${encodeURIComponent(token)}`);
    const authJson = await authStatus.json();

    assert.equal(authStatus.status, 200);
    assert.equal(authJson.hasPin, true);
    assert.equal(authJson.isUnlocked, false);
    assert.equal(authJson.isWaitingForPin, true);

    const badPin = await fetch(`http://127.0.0.1:${server.port}/warehouse/api/warehouse/verify-pin?access=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "9999" }),
    });
    assert.equal(badPin.status, 401);

    const goodPin = await fetch(`http://127.0.0.1:${server.port}/warehouse/api/warehouse/verify-pin?access=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "1234" }),
    });
    const unlocked = await goodPin.json();

    assert.equal(goodPin.status, 200);
    assert.equal(unlocked.isUnlocked, true);
    assert.equal(unlocked.role, "seller");
    assert.equal(server.getStderr(), "");
  });

  test("opens seller link PIN form and redirects to seller after PIN login", async () => {
    let token = "";
    const server = await startServer({
      seedState(state) {
        const account = createStaffAccount(state, {
          username: "pin-form-user",
          password: "secret1",
          fullName: "Pin Form User",
          role: "seller",
          permissions: ["seller"],
          pin: "1234",
        });
        token = createStaffAccessLink(state, account.id, "seller").token;
      },
    });

    const entry = await fetch(`http://127.0.0.1:${server.port}/warehouse/seller?access=${encodeURIComponent(token)}`, {
      redirect: "manual",
    });
    const entryLocation = entry.headers.get("location") || "";
    const entryUrl = new URL(`http://127.0.0.1:${server.port}${entryLocation}`);
    const loginPage = await fetch(`http://127.0.0.1:${server.port}${entryLocation}`);
    const loginHtml = await loginPage.text();

    assert.equal(entry.status, 302);
    assert.equal(entryUrl.searchParams.get("error"), "pin_required");
    assert.match(loginHtml, /name="pin"/);
    assert.match(loginHtml, /name="access"/);

    const pinLogin = await fetch(`http://127.0.0.1:${server.port}/warehouse-register`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access: token,
        pin: "1234",
        next: "/warehouse/seller?access=" + encodeURIComponent(token),
      }),
    });

    assert.equal(pinLogin.status, 302);
    assert.equal(pinLogin.headers.get("location"), "/warehouse/seller?access=" + encodeURIComponent(token));
    assert.match(pinLogin.headers.get("set-cookie") || "", /warehouse-staff-link=/);

    const sellerPage = await fetch(`http://127.0.0.1:${server.port}${pinLogin.headers.get("location")}`, {
      redirect: "manual",
    });
    assert.equal(sellerPage.status, 200);
    assert.equal(server.getStderr(), "");
  });

  test("keeps legacy unassigned customers visible to sellers", async () => {
    let token = "";
    const server = await startServer({
      seedState(state) {
        upsertCustomer(state, { fullName: "Legacy unassigned customer" });
        const account = createStaffAccount(state, {
          username: "legacy-seller",
          password: "secret1",
          fullName: "Legacy Seller",
          role: "seller",
          permissions: ["seller", "customers"],
        });
        token = createStaffAccessLink(state, account.id, "seller").token;
      },
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/warehouse/api/warehouse/customers`, {
      headers: { "X-Warehouse-Access": token },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.customers.some((customer) => customer.fullName === "Legacy unassigned customer"), true);
    assert.equal(server.getStderr(), "");
  });

  test("opens PIN-protected transfer sale links for sellers with transfer permission", async () => {
    let token = "";
    const server = await startServer({
      seedState(state) {
        const account = createStaffAccount(state, {
          username: "transfer-pin-seller",
          password: "secret1",
          fullName: "Transfer PIN Seller",
          role: "seller",
          permissions: ["seller", "transfer"],
          pin: "1234",
        });
        token = createStaffAccessLink(state, account.id, "transfer").token;
      },
    });

    const entry = await fetch(`http://127.0.0.1:${server.port}/warehouse/seller/sale/transfer?access=${encodeURIComponent(token)}`, {
      redirect: "manual",
    });
    const entryLocation = entry.headers.get("location") || "";
    const entryUrl = new URL(`http://127.0.0.1:${server.port}${entryLocation}`);
    assert.equal(entry.status, 302);
    assert.equal(entryUrl.searchParams.get("error"), "pin_required");
    assert.equal(entryUrl.searchParams.get("access"), token);
    assert.equal(entryUrl.searchParams.get("next"), `/warehouse/seller/sale/transfer?access=${token}`);

    const pinLogin = await fetch(`http://127.0.0.1:${server.port}/warehouse-register`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access: token,
        pin: "1234",
        next: `/warehouse/seller/sale/transfer?access=${token}`,
      }),
    });
    assert.equal(pinLogin.status, 302);
    assert.equal(pinLogin.headers.get("location"), `/warehouse/seller/sale/transfer?access=${token}`);

    const transferPage = await fetch(`http://127.0.0.1:${server.port}${pinLogin.headers.get("location")}`, {
      redirect: "manual",
    });
    assert.equal(transferPage.status, 200);
    assert.match(await transferPage.text(), /Перечисление/);
    assert.equal(server.getStderr(), "");
  });

  test("accepts write_transfer_sale as transfer-sale access for legacy seller permissions", async () => {
    let token = "";
    let customerId = 0;
    const server = await startServer({
      seedState(state) {
        seedWarehouseStock(state, 100);
        customerId = upsertCustomer(state, { fullName: "Write transfer customer" }).id;
        const account = createStaffAccount(state, {
          username: "write-transfer-seller",
          password: "secret1",
          fullName: "Write Transfer Seller",
          role: "seller",
          permissions: ["seller", "write_transfer_sale"],
        });
        token = createStaffAccessLink(state, account.id, "transfer").token;
      },
    });

    const page = await fetch(`http://127.0.0.1:${server.port}/warehouse/seller/sale/transfer?access=${token}`);
    assert.equal(page.status, 200);
    const response = await fetch(`http://127.0.0.1:${server.port}/warehouse/api/warehouse/seller-sale`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "write-transfer-sale-test",
        "X-Warehouse-Access": token,
      },
      body: JSON.stringify({ userId: customerId, amountKg: 1, priceType: "transfer", transferPaidAmount: 0 }),
    });
    assert.equal(response.status, 201);
    assert.equal(server.getStderr(), "");
  });
});
