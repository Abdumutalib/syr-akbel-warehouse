import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const topNavSource = fs.readFileSync(
  new URL("../public/warehouse-top-nav.js", import.meta.url),
  "utf8",
);

async function renderTopNav(profile, pathname) {
  const renderedNavs = [];

  function createElement(tagName) {
    return {
      tagName,
      children: [],
      classList: {
        add() {},
      },
      appendChild(child) {
        this.children.push(child);
      },
      addEventListener() {},
      setAttribute() {},
      remove() {},
    };
  }

  const shell = {
    querySelector() {
      return {};
    },
    insertBefore(nav) {
      renderedNavs.push(nav);
    },
    prepend(nav) {
      renderedNavs.push(nav);
    },
  };
  const document = {
    readyState: "complete",
    head: { appendChild() {} },
    createElement,
    getElementById() {
      return null;
    },
    querySelector(selector) {
      return selector === ".shell" ? shell : null;
    },
  };
  const window = {
    location: { pathname, href: pathname },
    localStorage: { getItem: () => null },
    sessionStorage: { getItem: () => null },
    getWarehouseOperatorProfile: () => profile,
    addEventListener() {},
    removeEventListener() {},
    fetch: async () => ({
      ok: true,
      json: async () => ({ customers: [] }),
    }),
  };

  vm.runInNewContext(topNavSource, { document, window, fetch: window.fetch, btoa: () => "" });
  await new Promise((resolve) => setImmediate(resolve));

  const nav = renderedNavs.at(-1);
  const list = nav.children[0].children[0];
  return list.children.map((link) => ({ href: link.href, label: link.textContent }));
}

test("seller sees only permitted cash and cashless sale links on sale pages", async () => {
  const links = await renderTopNav({
    role: "seller",
    permissions: ["seller", "customers", "orders", "cash", "transfer", "write_cash_sale", "write_transfer_sale"],
  }, "/warehouse/seller/sale/cash");

  assert.deepEqual(links.map((link) => link.href), [
    "/warehouse/seller/sale/cash",
    "/warehouse/seller/sale/transfer",
  ]);
});

test("admin sees all navigation links on sale pages", async () => {
  const links = await renderTopNav({ role: "admin", permissions: [] }, "/warehouse/seller/sale/transfer");

  assert.equal(links.length, 9);
  assert.ok(links.some((link) => link.href === "/warehouse/admin"));
  assert.ok(links.some((link) => link.href === "/warehouse/seller/sale/cash"));
  assert.ok(links.some((link) => link.href === "/warehouse/seller/sale/transfer"));
});
