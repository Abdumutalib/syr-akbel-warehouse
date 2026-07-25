import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeWarehousePostgresStore,
  createWarehousePostgresStore,
  writeWarehouseStateToPostgres,
} from "../lib/warehouse-postgres.mjs";
import { normalizeWarehouseState } from "../lib/warehouse-bot.mjs";

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

async function main() {
  const connectionString =
    process.env.WAREHOUSE_DB_URL?.trim() ||
    process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("WAREHOUSE_DB_URL yoki DATABASE_URL env kiritilmagan");
  }

  const statePath = resolveStatePath();
  const state = normalizeWarehouseState(readStateJson(statePath));
  const store = await createWarehousePostgresStore({
    connectionString,
    recordId: process.env.WAREHOUSE_DB_RECORD_ID?.trim() || "primary",
    serverId: process.env.WAREHOUSE_SERVER_ID?.trim() || process.env.HOSTNAME?.trim() || "migration",
  });

  try {
    const result = await writeWarehouseStateToPostgres(store, state, {
      skipSyncEvent: process.env.WAREHOUSE_DB_SKIP_SYNC_EVENT === "1",
    });

    const usersCount = Array.isArray(state.users) ? state.users.length : 0;
    const txCount = Array.isArray(state.transactions) ? state.transactions.length : 0;
    console.log(`OK: JSON -> Postgres migratsiya bajarildi. id=${store.recordId}, users=${usersCount}, tx=${txCount}, event=${result.eventId ?? "skip"}`);
  } finally {
    await closeWarehousePostgresStore(store);
  }
}

main().catch((error) => {
  console.error("Migratsiya xatosi:", error.message || error);
  process.exitCode = 1;
});
