import { loadWarehouseState, getWarehousePricing, getCustomerDetail } from '../lib/warehouse-bot.mjs';

export function setupExtendedBot({ loadState = () => loadWarehouseState(), readJson, authorize = () => 503, sendMessage } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return null;
  const send = sendMessage || (async (chatId, text) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Telegram message failed');
  });
  return async (req, res) => {
    const auth = authorize(req);
    if (auth !== true) { res.writeHead(auth === 503 ? 503 : 401); res.end(); return; }
    try {
      let body;
      if (readJson) body = await readJson(req);
      else {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) { res.writeHead(413); res.end(); return; }
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      }
      if (!body) { res.writeHead(400); res.end(); return; }
      const message = body.message;
      if (!message?.text || !message.from?.id || !message.chat?.id) { res.writeHead(200); res.end(); return; }
      const chatId = message.chat.id;
      if (String(chatId) !== String(message.from.id)) { res.writeHead(200); res.end(); return; }
      const state = loadState();
      const customer = state.users.find(user => [user.telegramId, ...(user.telegramIds || [])].some(id => String(id) === String(message.from.id)));
      if (!customer) {
        await send(chatId, "Siz ro'yxatdan o'tmagansiz. Administratordan Telegram ID ni bog'lashni so'rang.");
      } else {
        const detail = getCustomerDetail(state, customer.id, getWarehousePricing(state));
        const summary = detail.summary;
        const text = message.text.trim();
        if (text === '/debt') {
          const debt = Number(summary.currentDebt || 0);
          await send(chatId, debt > 0 ? `Qarz: ${debt.toLocaleString('ru-RU')} so'm` : debt < 0 ? `Avans: ${Math.abs(debt).toLocaleString('ru-RU')} so'm` : "Qarz yo'q!");
        } else if (text === '/stats') {
          await send(chatId, `${customer.fullName}\nJami olingan: ${summary.totalTakenKg} kg\nTo'langan: ${summary.totalPaid} so'm\nQarz: ${summary.currentDebt} so'm`);
        } else if (text === '/myorders') {
          const recent = detail.history.filter(entry => entry.status === 'approved').slice(0, 5);
          await send(chatId, recent.map((entry, i) => `${i + 1}. ${entry.amountKg} kg — ${entry.totalPrice} so'm`).join('\n') || "Buyurtma yo'q.");
        } else if (text === '/products') {
          const pricing = getWarehousePricing(state);
          await send(chatId, `Syr AKBEL\nNaqd: ${pricing.cashPricePerKg} so'm/kg\nO'tkazma: ${pricing.transferPricePerKg} so'm/kg\nQoldiq: ${state.warehouse.currentStockKg} kg`);
        } else {
          await send(chatId, `Salom, ${customer.fullName}!\n/myorders — Buyurtmalarim\n/debt — Qarzim\n/stats — Statistika\n/products — Mahsulotlar`);
        }
      }
      res.writeHead(200); res.end();
    } catch (error) {
      console.error('[EXTENDED BOT]', error.message);
      res.writeHead(error.code === 'PAYLOAD_TOO_LARGE' ? 413 : error instanceof SyntaxError ? 400 : 502); res.end();
    }
  };
}
