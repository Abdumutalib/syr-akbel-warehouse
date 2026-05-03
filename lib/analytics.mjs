// Analytics endpointlari — АКБЕЛ state strukturasiga moslashtirilgan
// state.users (array), state.transactions (array)

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

export async function handleAnalyticsRoute(req, res, pathname, deps) {
  const {
    assertWarehouseAdmin,
    loadWarehouse,
    sendApiJson,
    listCustomerSummaries,
    currentWarehousePricing,
  } = deps;

  const url = new URL(req.url, `http://x`);

  // Bu endpointlar ochiq (admin tekshiruvisiz)
  const publicEndpoints = ['/api/analytics/today', '/api/analytics/trend'];
  if (!publicEndpoints.includes(pathname)) {
    if (!assertWarehouseAdmin(req, res)) return true;
  }

  // --- Bugungi savdo ---
  if (pathname === '/api/analytics/today') {
    const state = loadWarehouse();
    const todayStr = getTodayStr();
    const todayTx = (state?.transactions || []).filter(
      (tx) => tx.status === 'approved' && (tx.approvedAt || '').startsWith(todayStr)
    );
    const total_sales = todayTx.reduce((s, tx) => s + Number(tx.totalPrice || 0), 0);
    const cash = todayTx.reduce((s, tx) => s + Number(tx.cashPaidAmount || 0), 0);
    const transfer = todayTx.reduce((s, tx) => s + Number(tx.transferPaidAmount || 0), 0);
    sendApiJson(res, 200, {
      total_sales,
      transaction_count: todayTx.length,
      cash,
      transfer,
      profit: 0,
    });
    return true;
  }

  // --- Top qarzdorlar ---
  if (pathname === '/api/analytics/debtors') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 10), 100);
    const state = loadWarehouse();
    const pricing = currentWarehousePricing(state);
    const summaries = listCustomerSummaries(state, pricing);
    const debtors = summaries
      .filter((c) => (c.currentDebt ?? 0) > 0)
      .sort((a, b) => (b.currentDebt ?? 0) - (a.currentDebt ?? 0))
      .slice(0, limit)
      .map((c) => ({ id: c.id, name: c.fullName, debt: c.currentDebt ?? 0 }));
    sendApiJson(res, 200, debtors);
    return true;
  }

  // --- 14 kunlik tendensiya ---
  if (pathname === '/api/analytics/trend') {
    const days = Math.min(Number(url.searchParams.get('days') || 14), 90);
    const state = loadWarehouse();
    const now = new Date();
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayTx = (state?.transactions || []).filter(
        (tx) => tx.status === 'approved' && (tx.approvedAt || '').startsWith(dateStr)
      );
      result.push({
        date: dateStr,
        total_sales: dayTx.reduce((s, tx) => s + Number(tx.totalPrice || 0), 0),
      });
    }
    sendApiJson(res, 200, result);
    return true;
  }

  // --- Ombor holati ---
  if (pathname === '/api/analytics/stock') {
    const state = loadWarehouse();
    const lowStockThreshold = Number(process.env.WAREHOUSE_LOW_STOCK_KG || 500);
    const currentKg = Number(state?.currentStockKg || 0);
    sendApiJson(res, 200, {
      currentKg,
      lowThreshold: lowStockThreshold,
      isLow: currentKg < lowStockThreshold,
      lastUpdated: state?.lastStockUpdate || null,
    });
    return true;
  }

  // --- Kunlik hisobot (oxirgi N kun) ---
  if (pathname === '/api/analytics/daily') {
    const days = Math.min(Number(url.searchParams.get('days') || 30), 365);
    const state = loadWarehouse();
    const now = new Date();
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayTx = (state?.transactions || []).filter(
        (tx) => tx.status === 'approved' && (tx.approvedAt || '').startsWith(dateStr)
      );
      result.push({
        date: dateStr,
        total_sales: dayTx.reduce((s, tx) => s + Number(tx.totalPrice || 0), 0),
        cash: dayTx.reduce((s, tx) => s + Number(tx.cashPaidAmount || 0), 0),
        transfer: dayTx.reduce((s, tx) => s + Number(tx.transferPaidAmount || 0), 0),
        count: dayTx.length,
      });
    }
    sendApiJson(res, 200, result);
    return true;
  }

  return false; // bu analytics endpointi emas
}
