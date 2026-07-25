#!/usr/bin/env node

import {
  applyWarehouseSyncEvent,
  closeWarehousePostgresStore,
  createWarehousePostgresStore,
  getWarehouseSyncPeerState,
  listWarehouseSyncEvents,
  updateWarehouseSyncPeerState,
} from "../lib/warehouse-postgres.mjs";

function parseTargets(rawValue) {
  return String(rawValue || "")
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/\/+$/, ""));
}

async function fetchPeerEvents(baseUrl, token, afterEventId, limit = 50) {
  const url = new URL(`${baseUrl}/api/warehouse/state-sync/events`);
  url.searchParams.set("afterEventId", String(afterEventId));
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url, {
    headers: {
      "X-Warehouse-Sync-Token": token,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Peer sync xato (${response.status})`);
  }
  return Array.isArray(data.events) ? data.events : [];
}

async function main() {
  const token = String(process.env.WAREHOUSE_STATE_SYNC_TOKEN || process.env.WAREHOUSE_AUTH_SYNC_TOKEN || "").trim();
  const targets = parseTargets(process.env.WAREHOUSE_STATE_SYNC_TARGETS || process.env.WAREHOUSE_AUTH_SYNC_TARGETS);

  if (!token) {
    throw new Error("WAREHOUSE_STATE_SYNC_TOKEN env kiritilmagan");
  }
  if (targets.length === 0) {
    throw new Error("WAREHOUSE_STATE_SYNC_TARGETS env kiritilmagan");
  }

  const store = await createWarehousePostgresStore();
  if (!store) {
    throw new Error("WAREHOUSE_DB_URL yoki DATABASE_URL env kiritilmagan");
  }

  try {
    for (const baseUrl of targets) {
      const peerState = await getWarehouseSyncPeerState(store, baseUrl);
      try {
        const events = await fetchPeerEvents(baseUrl, token, peerState.lastEventId, 100);
        let lastEventId = peerState.lastEventId;
        let applied = 0;
        let conflicts = 0;
        let duplicates = 0;

        for (const event of events) {
          lastEventId = Math.max(lastEventId, Number(event?.eventId || 0));
          const result = await applyWarehouseSyncEvent(store, event);
          if (result.applied) {
            applied += 1;
          } else if (result.conflict) {
            conflicts += 1;
          } else if (result.duplicate || result.noop || result.sameServer) {
            duplicates += 1;
          }
        }

        await updateWarehouseSyncPeerState(store, baseUrl, {
          lastEventId,
          lastSyncAt: new Date().toISOString(),
          lastError: null,
        });

        console.log(`[OK] ${baseUrl} events=${events.length} applied=${applied} conflicts=${conflicts} duplicates=${duplicates} cursor=${lastEventId}`);
      } catch (error) {
        await updateWarehouseSyncPeerState(store, baseUrl, {
          lastEventId: peerState.lastEventId,
          lastSyncAt: new Date().toISOString(),
          lastError: error.message || String(error),
        });
        console.log(`[FAIL] ${baseUrl} ${error.message || error}`);
        process.exitCode = 1;
      }
    }

    const localEvents = await listWarehouseSyncEvents(store, { afterEventId: 0, limit: 3 });
    console.log(`[INFO] local-server=${store.serverId} sample-events=${localEvents.length}`);
  } finally {
    await closeWarehousePostgresStore(store);
  }
}

main().catch((error) => {
  console.error("Sync runner crashed:", error.message || error);
  process.exit(1);
});