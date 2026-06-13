import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { safeReadState, executeTransaction, executePayment } from '../lib/core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, '../data/warehouse.json');

describe('Core Transaction Engine', () => {
  let backupContent = '';

  before(() => {
    if (fs.existsSync(STATE_PATH)) {
      backupContent = fs.readFileSync(STATE_PATH, 'utf-8');
    }
  });

  after(() => {
    if (backupContent) {
      fs.writeFileSync(STATE_PATH, backupContent, 'utf-8');
    }
  });

  test('safeReadState initializes state.stock if missing', () => {
    const mockState = {
      users: [],
      transactions: [],
      warehouse: { currentStockKg: 100 }
    };
    fs.writeFileSync(STATE_PATH, JSON.stringify(mockState, null, 2), 'utf-8');

    const state = safeReadState();
    assert.ok(Array.isArray(state.stock));
    assert.strictEqual(state.stock[0].id, 'cheese');
    assert.strictEqual(state.stock[0].quantity, 100);
  });

  test('executeTransaction records transaction and updates customer balance', () => {
    const mockState = {
      users: [{ id: 101, fullName: 'Test Client', currentDebt: 0, totalSales: 0, totalPaid: 0, totalTakenKg: 0 }],
      transactions: [],
      warehouse: { currentStockKg: 200 },
      stock: [{ id: 'cheese', name: 'Pishloq', quantity: 200 }]
    };
    fs.writeFileSync(STATE_PATH, JSON.stringify(mockState, null, 2), 'utf-8');

    const txData = {
      customerId: 101,
      items: [{ productId: 'cheese', kg: 10, price: 50000 }],
      payment: { cash: 200000, transfer: 0 }
    };

    const result = executeTransaction(txData);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.newDebt, 300000); // 10kg * 50k = 500k total. 500k - 200k paid = 300k debt.

    const state = safeReadState();
    const updatedClient = state.users.find(u => u.id === 101);
    assert.strictEqual(updatedClient.currentDebt, 300000);
    assert.strictEqual(updatedClient.totalSales, 500000);
    assert.strictEqual(updatedClient.totalPaid, 200000);
    assert.strictEqual(updatedClient.totalTakenKg, 10);

    // Verify stock was decremented (and is in sync)
    const cheeseStock = state.stock.find(p => p.id === 'cheese');
    assert.strictEqual(cheeseStock.quantity, 190);
    assert.strictEqual(state.warehouse.currentStockKg, 190);

    // Verify transaction fields
    const tx = state.transactions[0];
    assert.strictEqual(tx.customerId, 101);
    assert.strictEqual(tx.userId, 101); // legacy
    assert.strictEqual(tx.amountKg, 10); // legacy
    assert.strictEqual(tx.totalPrice, 500000);
    assert.strictEqual(tx.cashPaidAmount, 200000);
    assert.strictEqual(tx.status, 'approved');
  });

  test('executePayment processes client payment', () => {
    const mockState = {
      users: [{ id: 101, fullName: 'Test Client', currentDebt: 300000, totalSales: 500000, totalPaid: 200000, totalTakenKg: 10 }],
      transactions: [],
      warehouse: { currentStockKg: 190 },
      stock: [{ id: 'cheese', name: 'Pishloq', quantity: 190 }]
    };
    fs.writeFileSync(STATE_PATH, JSON.stringify(mockState, null, 2), 'utf-8');

    const paymentData = {
      customerId: 101,
      amount: 150000,
      method: 'cash'
    };

    const result = executePayment(paymentData);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.newDebt, 150000);

    const state = safeReadState();
    const client = state.users.find(u => u.id === 101);
    assert.strictEqual(client.currentDebt, 150000);
    assert.strictEqual(client.totalPaid, 350000);
  });
});
