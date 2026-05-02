import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

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
  const state = readStateJson(statePath);
  const recordId = process.env.WAREHOUSE_DB_RECORD_ID?.trim() || "primary";

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS warehouse_state (
        id TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(
      `
      INSERT INTO warehouse_state (id, state, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        state = EXCLUDED.state,
        updated_at = NOW()
      `,
      [recordId, JSON.stringify(state)]
    );

    const usersCount = Array.isArray(state.users) ? state.users.length : 0;
    const txCount = Array.isArray(state.transactions) ? state.transactions.length : 0;
    console.log(`OK: JSON -> Postgres migratsiya bajarildi. id=${recordId}, users=${usersCount}, tx=${txCount}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Migratsiya xatosi:", error.message || error);
  process.exitCode = 1;
});
