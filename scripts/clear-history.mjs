import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function resolveStatePath() {
  const configured = process.env.WAREHOUSE_STATE_FILE?.trim() || "data/warehouse.json";
  return path.isAbsolute(configured) ? configured : path.join(ROOT, configured);
}

function readStateJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`State file topilmadi: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    throw new Error("State file bo'sh");
  }
  return JSON.parse(raw);
}

function saveStateJson(filePath, state) {
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}

function main() {
  const statePath = resolveStatePath();
  console.log(`State fayli yuklanmoqda: ${statePath}`);
  
  let state;
  try {
    state = readStateJson(statePath);
  } catch (err) {
    console.error(`Xatolik: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  console.log("Ma'lumotlar tozalanmoqda (mijozlar va xodimlar saqlanadi)...");
  
  const originalTxCount = Array.isArray(state.transactions) ? state.transactions.length : 0;
  const originalOrderCount = Array.isArray(state.orders) ? state.orders.length : 0;
  const originalDeletedCount = Array.isArray(state.deletedCustomers) ? state.deletedCustomers.length : 0;
  const originalHandoffsCount = Array.isArray(state.sellerCashHandoffs) ? state.sellerCashHandoffs.length : 0;

  state.transactions = [];
  state.orders = [];
  state.deletedCustomers = [];
  state.sellerCashHandoffs = [];
  state.telegramMessages = [];
  state.idempotencyRequests = [];

  // Mijozlarning qarzlarini 0 ga tushirish
  if (Array.isArray(state.users)) {
    for (const user of state.users) {
      user._debtCache = {
        cashDebt: 0,
        transferDebt: 0,
        currentDebt: 0
      };
    }
  }

  try {
    saveStateJson(statePath, state);
    console.log("OK: Tarix muvaffaqiyatli tozalandi!");
    console.log(`- O'chirilgan savdolar/to'lovlar (transactions): ${originalTxCount}`);
    console.log(`- O'chirilgan buyurtmalar (orders): ${originalOrderCount}`);
    console.log(`- O'chirilgan arxiv mijozlar: ${originalDeletedCount}`);
    console.log(`- O'chirilgan topshirilgan naqd pullar: ${originalHandoffsCount}`);
  } catch (err) {
    console.error(`Saqlashda xatolik: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
