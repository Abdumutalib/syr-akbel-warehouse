import { loadWarehouseState } from './warehouse-bot.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(ROOT, '../data/warehouse.json');

export class SalesForecaster {
  async forecast(monthsAhead = 3) {
    const state = loadWarehouseState(STATE_PATH);
    const transactions = (state.transactions || []).filter(tx => tx.status === 'approved');
    const monthlySales = {};
    
    transactions.forEach(tx => {
      const date = new Date(tx.approvedAt || tx.createdAt || 0);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlySales[monthKey]) monthlySales[monthKey] = { totalKg: 0 };
      monthlySales[monthKey].totalKg += Number(tx.amountKg || 0);
    });

    const sorted = Object.entries(monthlySales).sort(([a], [b]) => a.localeCompare(b));
    const trend = sorted.length >= 2 ? (sorted[sorted.length-1][1].totalKg - sorted[0][1].totalKg) / (sorted.length - 1) : 0;
    const currentMonth = new Date().getMonth() + 1;
    const predictions = [];
    const names = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];

    for (let i = 1; i <= monthsAhead; i++) {
      const targetMonth = ((currentMonth + i - 1) % 12) + 1;
      const avg = monthlySales[`${new Date().getFullYear()}-${String(targetMonth).padStart(2,'0')}`]?.totalKg || 0;
      predictions.push({ month: targetMonth, monthName: names[targetMonth-1], predictedKg: Math.round((avg + trend*i)*10)/10 });
    }
    return predictions;
  }

  async getReorderSuggestions() {
    const state = loadWarehouseState(STATE_PATH);
    const forecast = await this.forecast(1);
    const predictedMonthlyKg = forecast[0]?.predictedKg || 0;
    return (state.stock || []).map(item => ({
      productId: item.id,
      productName: item.name,
      currentStock: item.quantity,
      reorderQuantity: Math.max(0, (predictedMonthlyKg/2) - item.quantity)
    })).filter(i => i.reorderQuantity > 0);
  }
}
export const forecaster = new SalesForecaster();
