import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadWarehouseState, saveWarehouseState } from '../lib/warehouse-bot.mjs';

test('saveWarehouseState writes a durable temp-file-plus-rename snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-state-'));
  const filePath = path.join(dir, 'warehouse.json');
  const state = { users: [], transactions: [], warehouse: { currentStockKg: 12 }, stock: [{ id: 'cheese', name: 'Pishloq', quantity: 12 }] };

  saveWarehouseState(filePath, state);
  const reloaded = loadWarehouseState(filePath);

  assert.equal(reloaded.warehouse.currentStockKg, 12);
  assert.equal(reloaded.stock[0].quantity, 12);
  assert.equal(fs.existsSync(filePath), true);
  assert.equal(fs.existsSync(`${filePath}.tmp-${process.pid}-`), false);
});

test('saveWarehouseState keeps warehouse stock authoritative over legacy stock snapshots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-state-'));
  const filePath = path.join(dir, 'warehouse.json');
  const state = {
    users: [],
    transactions: [],
    warehouse: { currentStockKg: 125 },
    stock: [{ id: 'cheese', name: 'Pishloq', quantity: 100 }],
  };

  saveWarehouseState(filePath, state);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const reloaded = loadWarehouseState(filePath);

  assert.equal(raw.warehouse.currentStockKg, 125);
  assert.equal(raw.stock.find((item) => item.id === 'cheese').quantity, 125);
  assert.equal(reloaded.warehouse.currentStockKg, 125);
  assert.equal(reloaded.stock.find((item) => item.id === 'cheese').quantity, 125);
});

test('loadWarehouseState falls back to legacy stock when warehouse stock is absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-state-'));
  const filePath = path.join(dir, 'warehouse.json');
  fs.writeFileSync(filePath, JSON.stringify({
    users: [],
    transactions: [],
    stock: [{ id: 'cheese', name: 'Pishloq', quantity: 77 }],
  }), 'utf8');

  const reloaded = loadWarehouseState(filePath);

  assert.equal(reloaded.warehouse.currentStockKg, 77);
  assert.equal(reloaded.stock.find((item) => item.id === 'cheese').quantity, 77);
});
