import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  getWarehousePricing,
  listCustomerSummaries,
  loadWarehouseState,
  recordApprovedSale,
  recordCustomerPayment,
  recordCustomerReturn,
  seedWarehouseStock,
  upsertCustomer,
} from "../lib/warehouse-bot.mjs";

function createState() {
  const statePath = path.join(os.tmpdir(), `warehouse-invariants-${process.pid}-${Date.now()}-${Math.random()}.json`);
  const state = loadWarehouseState(statePath);
  seedWarehouseStock(state, 100);
  return state;
}

test("sale, payment, and customer return preserve stock and debt invariants", () => {
  const state = createState();
  const customer = upsertCustomer(state, {
    fullName: "Invariant customer",
    paymentCategories: ["cash", "transfer"],
  });

  recordApprovedSale(state, {
    userId: customer.id,
    amountKg: 10,
    priceType: "cash",
    cashPaidAmount: 30000,
  });
  assert.equal(state.warehouse.currentStockKg, 90);

  recordCustomerPayment(state, {
    userId: customer.id,
    transferPaidAmount: 15000,
  });
  assert.equal(state.warehouse.currentStockKg, 90);

  recordCustomerReturn(state, {
    userId: customer.id,
    amountKg: 2,
    priceType: "cash",
  });
  assert.equal(state.warehouse.currentStockKg, 92);

  const summary = listCustomerSummaries(state).find((entry) => entry.id === customer.id);
  const cashPrice = getWarehousePricing(state).cashPricePerKg;
  assert.equal(summary.totalTakenKg, 8);
  assert.equal(summary.cashDebt, 8 * cashPrice - 30000);
  assert.equal(summary.transferDebt, -15000);
  assert.equal(summary.currentDebt, summary.cashDebt + summary.transferDebt);
});

test("cash and transfer payment effects remain separated", () => {
  const state = createState();
  const customer = upsertCustomer(state, {
    fullName: "Payment split customer",
    paymentCategories: ["cash", "transfer"],
  });

  recordApprovedSale(state, {
    userId: customer.id,
    amountKg: 1,
    priceType: "cash",
  });
  recordCustomerPayment(state, {
    userId: customer.id,
    cashPaidAmount: 2000,
    transferPaidAmount: 3000,
  });

  const summary = listCustomerSummaries(state).find((entry) => entry.id === customer.id);
  assert.equal(summary.cashDebt, getWarehousePricing(state).cashPricePerKg - 2000);
  assert.equal(summary.transferDebt, -3000);
  assert.equal(summary.currentDebt, summary.cashDebt + summary.transferDebt);
});