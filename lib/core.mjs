import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, '../data/warehouse.json');

let isWriting = false;

export function safeReadState() {
  try {
    const data = fs.readFileSync(STATE_PATH, 'utf-8');
    const state = JSON.parse(data);
    
    // Legacy compatibility: ensure state.stock is populated
    if (!state.stock) {
      state.stock = [
        { id: 'cheese', name: 'Pishloq', quantity: state.warehouse?.currentStockKg || 0 }
      ];
    }
    
    return state;
  } catch (e) {
    console.error('[CORE] Xatolik:', e);
    return { users: [], stock: [], transactions: [] };
  }
}

function safeWriteState(state) {
  if (isWriting) throw new Error('Tizim band');
  isWriting = true;
  try {
    // Legacy compatibility: synchronize state.warehouse.currentStockKg with the cheese stock quantity
    if (state.stock && state.warehouse) {
      const cheese = state.stock.find(p => p.id === 'cheese');
      if (cheese) {
        state.warehouse.currentStockKg = cheese.quantity;
      }
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } finally {
    isWriting = false;
  }
}

export function executeTransaction(txData) {
  const state = safeReadState();
  let totalAmount = 0;
  let totalKg = 0;

  txData.items.forEach(item => {
    let product = state.stock.find(p => p.id === item.productId);
    if (!product) {
      product = { id: item.productId, name: item.productId, quantity: 0 };
      state.stock.push(product);
    }
    
    const changeKg = Number(item.kg); 
    product.quantity = Number((product.quantity - changeKg).toFixed(3));
    
    const itemTotal = Math.abs(changeKg) * item.price;
    if (changeKg < 0) {
        totalAmount -= itemTotal;
        totalKg -= Math.abs(changeKg);
    } else {
        totalAmount += itemTotal;
        totalKg += changeKg;
    }
  });

  const customer = state.users.find(u => u.id === txData.customerId);
  if (!customer) throw new Error('Mijoz topilmadi');

  const cashPaid = Number(txData.payment.cash || 0);
  const transferPaid = Number(txData.payment.transfer || 0);
  const totalPaid = cashPaid + transferPaid;
  const debtChange = totalAmount - totalPaid;
  
  customer.currentDebt = Number((customer.currentDebt || 0) + debtChange);
  customer.totalSales = Number((customer.totalSales || 0) + totalAmount);
  customer.totalPaid = Number((customer.totalPaid || 0) + totalPaid);
  customer.totalTakenKg = Number((customer.totalTakenKg || 0) + totalKg);

  // Synchronize customer _debtCache for compatibility with existing queries
  if (!customer._debtCache) {
    customer._debtCache = { cashSales: 0, transferSales: 0, cashPaid: 0, transferPaid: 0, cashDebt: 0, transferDebt: 0, currentDebt: 0 };
  }
  const isTransfer = transferPaid > 0 && cashPaid <= 0;
  if (isTransfer) {
    customer._debtCache.transferSales += totalAmount;
    customer._debtCache.transferPaid += totalPaid;
    customer._debtCache.transferDebt += debtChange;
  } else {
    customer._debtCache.cashSales += totalAmount;
    customer._debtCache.cashPaid += totalPaid;
    customer._debtCache.cashDebt += debtChange;
  }
  customer._debtCache.currentDebt = customer.currentDebt;

  const transaction = {
    id: Date.now().toString(),
    userId: txData.customerId, // legacy compatibility
    customerId: txData.customerId,
    items: txData.items,
    amountKg: totalKg, // legacy compatibility
    totalPrice: totalAmount,
    cashPaidAmount: cashPaid,
    transferPaidAmount: transferPaid,
    paidAmount: totalPaid,
    status: 'approved',
    type: totalAmount < 0 ? 'return' : 'sale',
    kind: totalAmount < 0 ? 'return' : 'sale', // legacy compatibility
    priceType: isTransfer ? 'transfer' : 'cash', // legacy compatibility
    createdAt: new Date().toISOString(),
    approvedAt: new Date().toISOString()
  };
  
  state.transactions.push(transaction);
  safeWriteState(state);
  
  return { success: true, transaction, newDebt: customer.currentDebt };
}

export function executePayment(paymentData) {
  const state = safeReadState();
  const customer = state.users.find(u => u.id === paymentData.customerId);
  if (!customer) throw new Error('Mijoz topilmadi');
  
  const amount = Number(paymentData.amount);
  customer.totalPaid = Number((customer.totalPaid || 0) + amount);
  customer.currentDebt = Number((customer.currentDebt || 0) - amount);
  
  // Synchronize customer _debtCache
  if (!customer._debtCache) {
    customer._debtCache = { cashSales: 0, transferSales: 0, cashPaid: 0, transferPaid: 0, cashDebt: 0, transferDebt: 0, currentDebt: 0 };
  }
  const isTransfer = paymentData.method === 'transfer';
  if (isTransfer) {
    customer._debtCache.transferPaid += amount;
    customer._debtCache.transferDebt -= amount;
  } else {
    customer._debtCache.cashPaid += amount;
    customer._debtCache.cashDebt -= amount;
  }
  customer._debtCache.currentDebt = customer.currentDebt;

  const transaction = {
    id: Date.now().toString(),
    userId: paymentData.customerId, // legacy compatibility
    customerId: paymentData.customerId,
    type: 'payment',
    kind: 'payment', // legacy compatibility
    amount: amount,
    cashPaidAmount: isTransfer ? 0 : amount, // legacy compatibility
    transferPaidAmount: isTransfer ? amount : 0, // legacy compatibility
    paidAmount: amount,
    priceType: isTransfer ? 'transfer' : 'cash', // legacy compatibility
    method: paymentData.method,
    status: 'approved',
    createdAt: new Date().toISOString(),
    approvedAt: new Date().toISOString()
  };

  state.transactions.push(transaction);
  safeWriteState(state);
  return { success: true, newDebt: customer.currentDebt };
}
