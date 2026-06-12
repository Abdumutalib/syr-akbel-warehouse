import { loadWarehouseState, getWarehousePricing, getCustomerDetail } from '../lib/warehouse-bot.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(ROOT, '../data/warehouse.json');

async function sendTgMessage(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

export function setupExtendedBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return null;

  return async (req, res) => {
    try {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        const message = body.message;
        if (!message || !message.text) { res.writeHead(200); res.end(); return; }

        const chatId = message.chat.id;
        const text = message.text.trim();
        const telegramId = message.from.id;
        const state = loadWarehouseState(STATE_PATH);
        const customer = state.users.find(u => String(u.telegramId) === String(telegramId));

        if (!customer) {
          await sendTgMessage(token, chatId, '❌ Siz tizimda ro\'yxatdan o\'tmagansiz. Administratordan telegram ID ingizni bog\'lashni so\'rang.');
          res.writeHead(200); res.end(); return;
        }

        const pricing = getWarehousePricing(state);
        const detail = getCustomerDetail(state, customer.id, pricing);

        if (text === '/start' || text === '/help') {
          await sendTgMessage(token, chatId, `👋 Salom, ${customer.fullName}!\n\n📋 /myorders - Buyurtmalarim\n💰 /debt - Qarzdorligim\n📊 /stats - Statistikam\n📦 /products - Mahsulotlar`);
        } else if (text === '/myorders') {
          const recent = (detail.history || []).filter(h => h.status === 'approved').slice(-5).reverse();
          const msg = recent.length === 0 ? '📭 Buyurtma yo\'q.' : recent.map((o, i) => `${i+1}. 📦 ${o.amountKg} kg - ${Number(o.totalPrice||0).toLocaleString('ru-RU')} so'm`).join('\n');
          await sendTgMessage(token, chatId, `📋 *Oxirgi buyurtmalar:*\n\n${msg}`);
        } else if (text === '/debt') {
          const debt = detail.currentDebt ?? 0;
          await sendTgMessage(token, chatId, debt > 0 ? `💰 *Qarz:* 🔴 ${debt.toLocaleString('ru-RU')} so'm` : '✅ Qarz yo\'q!');
        } else if (text === '/stats') {
          await sendTgMessage(token, chatId, `📊 *Statistika:*\n👤 ${customer.fullName}\n📦 Jami olingan: ${detail.totalTakenKg?.toFixed(1) || 0} kg\n💳 To\'langan: ${(detail.totalPaid || 0).toLocaleString('ru-RU')} so'm\n🔴 Qarz: ${(detail.currentDebt || 0).toLocaleString('ru-RU')} so'm`);
        } else if (text === '/products') {
          const msg = `🧀 *Syr AKBEL (Pishloq)*\n💵 Naqd narxi: ${Number(pricing.cashPricePerKg || 0).toLocaleString('ru-RU')} so'm/kg\n💳 O'tkazma narxi (NDS bilan): ${Number(pricing.transferPricePerKg || 0).toLocaleString('ru-RU')} so'm/kg\n📦 Joriy qoldiq: ${Number(state.warehouse?.currentStockKg || 0).toFixed(1)} kg`;
          await sendTgMessage(token, chatId, msg);
        } else {
          await sendTgMessage(token, chatId, '❓ Noma\'lum komanda. /help bosing.');
        }
        res.writeHead(200); res.end();
      });
    } catch (error) {
      console.error('[EXTENDED BOT] Xatolik:', error);
      res.writeHead(500); res.end();
    }
  };
}
