import { loadWarehouseState, getWarehousePricing, listCustomerSummaries } from '../lib/warehouse-bot.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(ROOT, '../data/warehouse.json');

export async function generateAndSendDailyReport() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();
  if (!token || !chatId) return;

  try {
    const state = loadWarehouseState(STATE_PATH);
    const pricing = getWarehousePricing(state);
    const today = new Date().toISOString().split('T')[0];
    
    const todayTx = (state.transactions || []).filter(tx => {
      const txDate = (tx.approvedAt || tx.createdAt || '').split('T')[0];
      return txDate === today && tx.status === 'approved';
    });
    
    const summary = todayTx.reduce((acc, tx) => {
      acc.totalSales += Number(tx.totalPrice || 0);
      acc.totalCash += Number(tx.cashPaidAmount || 0);
      acc.totalTransfer += Number(tx.transferPaidAmount || 0);
      acc.totalKg += Number(tx.amountKg || 0);
      return acc;
    }, { totalSales: 0, totalCash: 0, totalTransfer: 0, totalKg: 0 });
    
    const debtors = listCustomerSummaries(state, pricing)
      .filter(c => (c.currentDebt ?? 0) > 0)
      .sort((a, b) => (b.currentDebt ?? 0) - (a.currentDebt ?? 0))
      .slice(0, 10);
    
    const currentStock = Number(state.warehouse?.currentStockKg || 0);
    const lowStock = currentStock < 500
      ? [`• Pishloq: ${currentStock.toFixed(1)} kg`]
      : [];

    const message = `📊 *KUNLIK HISOBOT*\n📅 ${today}\n\n💰 *Savdolar:*\n📦 Bitimlar: ${todayTx.length}\n⚖️ Jami kg: ${summary.totalKg.toFixed(1)}\n💵 Jami: ${summary.totalSales.toLocaleString('ru-RU')} so'm\n\n👥 *Top qarzdorlar:*\n${debtors.map((d, i) => `${i + 1}. ${d.fullName}: ${d.currentDebt.toLocaleString('ru-RU')} so'm`).join('\n') || '✅ Qarz yo\'q'}\n\n⚠️ *Kam qolgan zaxira (Min: 500 kg):*\n${lowStock.join('\n') || '✅ Barchasi yetarli'}`;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
    });
    console.log('[REPORTS] ✅ Kunlik hisobot yuborildi');
  } catch (error) {
    console.error('[REPORTS] Xatolik:', error.message);
  }
}

export function startAutoReports() {
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 23 && now.getMinutes() === 59) {
      await generateAndSendDailyReport();
    }
  }, 60000);
  console.log('[REPORTS] ✅ Avtomatik hisobotlar scheduler ishga tushdi');
}
