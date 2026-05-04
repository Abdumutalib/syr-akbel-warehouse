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
      if (response.status > 0) {
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
    const response = await fetch(`http://127.0.0.1:${server.port}/warehouse-register`, {
      redirect: "manual",
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Admin login va parol bilan kiring/);
    assert.match(body, /Xodimlar admin bergan ruxsat havolasi bilan telefon yoki planshetda ilovani o'rnatib, keyin PIN bilan kirib ishlayveradi\./);
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
});