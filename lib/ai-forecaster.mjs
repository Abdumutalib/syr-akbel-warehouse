import { loadWarehouseState } from './warehouse-bot.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(ROOT, '../data/warehouse.json');

export class SalesForecaster {
  collectData() {
    const state = loadWarehouseState(STATE_PATH);
    const transactions = (state.transactions || []).filter(tx => tx.status === 'approved');
    const monthlySales = {};
    transactions.forEach(tx => {
      const date = new Date(tx.approvedAt || tx.createdAt || 0);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlySales[monthKey]) monthlySales[monthKey] = { totalKg: 0 };
      monthlySales[monthKey].totalKg += Number(tx.amountKg || 0);
    });
    return monthlySales;
  }

  async forecast(monthsAhead = 3) {
    const monthlySales = this.collectData();
    const monthAverages = {};
    for (let month = 1; month <= 12; month++) {
      const monthKey = String(month).padStart(2, '0');
      const values = Object.entries(monthlySales).filter(([key]) => key.endsWith(`-${monthKey}`)).map(([, data]) => data.totalKg);
      if (values.length > 0) monthAverages[month] = values.reduce((a, b) => a + b, 0) / values.length;
    }
    
    const sorted = Object.entries(monthlySales).sort(([a], [b]) => a.localeCompare(b));
    const trend = sorted.length >= 2 ? (sorted[sorted.length-1][1].totalKg - sorted[0][1].totalKg) / (sorted.length - 1) : 0;
    const currentMonth = new Date().getMonth() + 1;
    const monthNames = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
    const predictions = [];

    for (let i = 1; i <= monthsAhead; i++) {
      const targetMonth = ((currentMonth + i - 1) % 12) + 1;
      const predictedKg = Math.max(0, (monthAverages[targetMonth] || 0) + (trend * i));
      predictions.push({ month: targetMonth, monthName: monthNames[targetMonth - 1], predictedKg: Math.round(predictedKg * 10) / 10 });
    }
    return predictions;
  }

  async getReorderSuggestions() {
    const state = loadWarehouseState(STATE_PATH);
    const currentStock = Number(state.warehouse?.currentStockKg || 0);
    const minStock = 500; // default minimal low stock threshold for cheese
    const forecast = await this.forecast(1);
    const predictedMonthlyKg = forecast[0]?.predictedKg || 0;
    const suggestions = [];

    const twoWeekSales = predictedMonthlyKg / 2;

    // Suggest reorder if stock is below 2-week predicted sales or below absolute minimum
    if (currentStock < twoWeekSales || currentStock < minStock) {
      const reorderQty = Math.max(twoWeekSales - currentStock, minStock - currentStock);
      const ratio = currentStock / (twoWeekSales || 1);
      let priority = ratio < 0.3 ? 'critical' : ratio < 0.6 ? 'high' : ratio < 0.9 ? 'medium' : 'low';
      suggestions.push({
        productId: 'cheese',
        productName: 'Pishloq',
        currentStock,
        predictedSales: Math.round(twoWeekSales * 10) / 10,
        reorderQuantity: Math.round(reorderQty * 10) / 10,
        priority
      });
    }
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }
}
export const forecaster = new SalesForecaster();
