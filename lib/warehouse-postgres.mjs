import crypto from "node:crypto";
import { Client } from "pg";
import { normalizeWarehouseState } from "./warehouse-bot.mjs";

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function resolveWarehousePostgresConfig(env = process.env) {
  const connectionString =
    String(env.WAREHOUSE_DB_URL || "").trim() ||
    String(env.DATABASE_URL || "").trim();
  const recordId = String(env.WAREHOUSE_DB_RECORD_ID || "primary").trim() || "primary";
  const serverId =
    String(env.WAREHOUSE_SERVER_ID || "").trim() ||
    String(env.NF_OBJECT_ID || "").trim() ||
    String(env.HOSTNAME || "").trim() ||
    `warehouse-${String(env.PORT || "8787").trim()}`;
  return {
    connectionString,
    recordId,
    serverId,
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashWarehouseState(state) {
  return crypto.createHash("sha256").update(stableStringify(normalizeWarehouseState(state)), "utf8").digest("hex");
}

export async function initWarehousePostgresSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS warehouse_state (
      id TEXT PRIMARY KEY,
      state JSONB NOT NULL,
      state_hash TEXT NOT NULL,
      version BIGINT NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      server_id TEXT,
      source_event_id BIGINT
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS warehouse_sync_events (
      event_id BIGSERIAL PRIMARY KEY,
      record_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      state_snapshot JSONB NOT NULL,
      state_hash TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS warehouse_sync_events_record_event_idx
    ON warehouse_sync_events (record_id, event_id)
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS warehouse_sync_applied (
      source_server_id TEXT NOT NULL,
      source_event_id BIGINT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      outcome TEXT NOT NULL DEFAULT 'applied',
      PRIMARY KEY (source_server_id, source_event_id)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS warehouse_sync_peers (
      peer_base_url TEXT PRIMARY KEY,
      last_event_id BIGINT NOT NULL DEFAULT 0,
      last_sync_at TIMESTAMPTZ,
      last_error TEXT
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS warehouse_sync_conflicts (
      source_server_id TEXT NOT NULL,
      source_event_id BIGINT NOT NULL,
      local_state_hash TEXT NOT NULL,
      remote_state_hash TEXT NOT NULL,
      local_updated_at TIMESTAMPTZ NOT NULL,
      remote_occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (source_server_id, source_event_id)
    )
  `);
}

export async function createWarehousePostgresStore(config = resolveWarehousePostgresConfig()) {
  if (!config.connectionString) {
    return null;
  }
  const client = new Client({ connectionString: config.connectionString });
  await client.connect();
  await initWarehousePostgresSchema(client);
  return {
    client,
    recordId: config.recordId,
    serverId: config.serverId,
  };
}

export async function closeWarehousePostgresStore(store) {
  if (store?.client) {
    await store.client.end();
  }
}

async function readWarehouseStateRow(store) {
  const result = await store.client.query(
    `
      SELECT id, state, state_hash, version, updated_at, server_id, source_event_id
      FROM warehouse_state
      WHERE id = $1
    `,
    [store.recordId]
  );
  return result.rows[0] || null;
}

export async function loadWarehouseStateFromPostgres(store, fallbackState) {
  const row = await readWarehouseStateRow(store);
  if (!row) {
    const seed = normalizeWarehouseState(fallbackState || {});
    await writeWarehouseStateToPostgres(store, seed, { skipSyncEvent: true });
    return seed;
  }
  return normalizeWarehouseState(row.state || {});
}

export async function writeWarehouseStateToPostgres(store, state, options = {}) {
  const normalizedState = normalizeWarehouseState(state || {});
  const stateHash = hashWarehouseState(normalizedState);
  const occurredAt = options.occurredAt || new Date().toISOString();
  const sourceEventId = options.sourceEventId == null ? null : Number(options.sourceEventId);
  const writeResult = await store.client.query(
    `
      INSERT INTO warehouse_state (id, state, state_hash, version, updated_at, server_id, source_event_id)
      VALUES ($1, $2::jsonb, $3, 1, $4::timestamptz, $5, $6)
      ON CONFLICT (id)
      DO UPDATE SET
        state = EXCLUDED.state,
        state_hash = EXCLUDED.state_hash,
        version = warehouse_state.version + 1,
        updated_at = EXCLUDED.updated_at,
        server_id = EXCLUDED.server_id,
        source_event_id = EXCLUDED.source_event_id
      RETURNING version, updated_at
    `,
    [store.recordId, JSON.stringify(normalizedState), stateHash, occurredAt, store.serverId, sourceEventId]
  );

  let eventId = null;
  if (!options.skipSyncEvent) {
    const eventResult = await store.client.query(
      `
        INSERT INTO warehouse_sync_events (record_id, server_id, state_snapshot, state_hash, occurred_at)
        VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz)
        RETURNING event_id
      `,
      [store.recordId, store.serverId, JSON.stringify(normalizedState), stateHash, occurredAt]
    );
    eventId = Number(eventResult.rows[0]?.event_id || 0) || null;
  }

  return {
    state: normalizedState,
    stateHash,
    eventId,
    version: Number(writeResult.rows[0]?.version || 1),
    updatedAt: writeResult.rows[0]?.updated_at || occurredAt,
  };
}

export async function listWarehouseSyncEvents(store, options = {}) {
  const afterEventId = Math.max(0, Number(options.afterEventId || 0));
  const limit = Math.min(200, Math.max(1, Number(options.limit || 50)));
  const result = await store.client.query(
    `
      SELECT event_id, record_id, server_id, state_snapshot, state_hash, occurred_at
      FROM warehouse_sync_events
      WHERE record_id = $1 AND event_id > $2
      ORDER BY event_id ASC
      LIMIT $3
    `,
    [store.recordId, afterEventId, limit]
  );
  return result.rows.map((row) => ({
    eventId: Number(row.event_id),
    recordId: row.record_id,
    serverId: row.server_id,
    stateSnapshot: normalizeWarehouseState(row.state_snapshot || {}),
    stateHash: row.state_hash,
    occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
  }));
}

export async function getWarehouseSyncPeerState(store, peerBaseUrl) {
  const baseUrl = normalizeBaseUrl(peerBaseUrl);
  const result = await store.client.query(
    `
      SELECT peer_base_url, last_event_id, last_sync_at, last_error
      FROM warehouse_sync_peers
      WHERE peer_base_url = $1
    `,
    [baseUrl]
  );
  const row = result.rows[0] || null;
  if (!row) {
    return {
      peerBaseUrl: baseUrl,
      lastEventId: 0,
      lastSyncAt: null,
      lastError: null,
    };
  }
  return {
    peerBaseUrl: row.peer_base_url,
    lastEventId: Number(row.last_event_id || 0),
    lastSyncAt: row.last_sync_at instanceof Date ? row.last_sync_at.toISOString() : row.last_sync_at,
    lastError: row.last_error || null,
  };
}

export async function updateWarehouseSyncPeerState(store, peerBaseUrl, fields = {}) {
  const baseUrl = normalizeBaseUrl(peerBaseUrl);
  const lastEventId = Math.max(0, Number(fields.lastEventId || 0));
  const lastSyncAt = fields.lastSyncAt || null;
  const lastError = fields.lastError == null ? null : String(fields.lastError);
  await store.client.query(
    `
      INSERT INTO warehouse_sync_peers (peer_base_url, last_event_id, last_sync_at, last_error)
      VALUES ($1, $2, $3::timestamptz, $4)
      ON CONFLICT (peer_base_url)
      DO UPDATE SET
        last_event_id = EXCLUDED.last_event_id,
        last_sync_at = EXCLUDED.last_sync_at,
        last_error = EXCLUDED.last_error
    `,
    [baseUrl, lastEventId, lastSyncAt, lastError]
  );
}

async function lookupAppliedEvent(store, event) {
  const result = await store.client.query(
    `
      SELECT outcome
      FROM warehouse_sync_applied
      WHERE source_server_id = $1 AND source_event_id = $2
    `,
    [String(event.serverId || "").trim(), Number(event.eventId || 0)]
  );
  return result.rows[0]?.outcome || null;
}

async function markAppliedEvent(store, event, outcome) {
  await store.client.query(
    `
      INSERT INTO warehouse_sync_applied (source_server_id, source_event_id, outcome)
      VALUES ($1, $2, $3)
      ON CONFLICT (source_server_id, source_event_id)
      DO UPDATE SET outcome = EXCLUDED.outcome, applied_at = NOW()
    `,
    [String(event.serverId || "").trim(), Number(event.eventId || 0), outcome]
  );
}

async function recordConflict(store, event, localRow) {
  await store.client.query(
    `
      INSERT INTO warehouse_sync_conflicts (
        source_server_id,
        source_event_id,
        local_state_hash,
        remote_state_hash,
        local_updated_at,
        remote_occurred_at
      )
      VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
      ON CONFLICT (source_server_id, source_event_id)
      DO NOTHING
    `,
    [
      String(event.serverId || "").trim(),
      Number(event.eventId || 0),
      String(localRow?.state_hash || ""),
      String(event.stateHash || ""),
      localRow?.updated_at || new Date().toISOString(),
      event.occurredAt || new Date().toISOString(),
    ]
  );
}

export async function applyWarehouseSyncEvent(store, event) {
  const normalizedEvent = {
    eventId: Number(event?.eventId || 0),
    recordId: String(event?.recordId || store.recordId).trim() || store.recordId,
    serverId: String(event?.serverId || "").trim(),
    stateSnapshot: normalizeWarehouseState(event?.stateSnapshot || {}),
    stateHash: String(event?.stateHash || "").trim(),
    occurredAt: event?.occurredAt || new Date().toISOString(),
  };

  if (!normalizedEvent.serverId || normalizedEvent.eventId <= 0) {
    throw new Error("Sync event noto'g'ri");
  }
  if (normalizedEvent.serverId === store.serverId) {
    return { skipped: true, sameServer: true };
  }

  const appliedOutcome = await lookupAppliedEvent(store, normalizedEvent);
  if (appliedOutcome) {
    return { skipped: true, duplicate: true, outcome: appliedOutcome };
  }

  const localRow = await readWarehouseStateRow(store);
  const localUpdatedAtMs = localRow?.updated_at ? new Date(localRow.updated_at).getTime() : 0;
  const remoteOccurredAtMs = new Date(normalizedEvent.occurredAt).getTime();

  if (localRow?.state_hash && localRow.state_hash === normalizedEvent.stateHash) {
    await markAppliedEvent(store, normalizedEvent, "noop");
    return {
      skipped: true,
      noop: true,
      nextState: normalizedEvent.stateSnapshot,
    };
  }

  if (localUpdatedAtMs > 0 && localUpdatedAtMs > remoteOccurredAtMs) {
    await recordConflict(store, normalizedEvent, localRow);
    await markAppliedEvent(store, normalizedEvent, "conflict");
    return {
      skipped: true,
      conflict: true,
      nextState: null,
    };
  }

  await writeWarehouseStateToPostgres(store, normalizedEvent.stateSnapshot, {
    skipSyncEvent: true,
    occurredAt: normalizedEvent.occurredAt,
    sourceEventId: normalizedEvent.eventId,
  });
  await markAppliedEvent(store, normalizedEvent, "applied");
  return {
    applied: true,
    nextState: normalizedEvent.stateSnapshot,
  };
}
