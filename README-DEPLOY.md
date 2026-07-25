AKBEL deploy quick notes
========================

Domain:
  akbelim.com

Recommended platform:
  Northflank

Required runtime:
  Node.js 18+

Start command:
  npm start

Health check:
  /healthz

Persistent data:
  Use a mounted volume and point state file there:

  WAREHOUSE_STATE_FILE=/data/warehouse.json

This automatically stores uploaded transaction photos in:

  /data/transaction-photos

Suggested environment variables:
  PORT=3000
  WAREHOUSE_COMPANY_NAME=Сыр АКБЕЛ
  WAREHOUSE_ADMIN_USERNAME=...
  WAREHOUSE_ADMIN_PASSWORD=...
  WAREHOUSE_STATE_FILE=/data/warehouse.json
  WAREHOUSE_DB_URL=postgresql://...
  WAREHOUSE_DB_RECORD_ID=primary
  WAREHOUSE_SERVER_ID=northflank-public
  WAREHOUSE_ALLOWED_ORIGIN=https://akbelim.com
  WAREHOUSE_MAX_REQUEST_BYTES=6291456
  WAREHOUSE_STATE_SYNC_TOKEN=...
  WAREHOUSE_STATE_SYNC_TARGETS=http://178.218.207.161
  WAREHOUSE_STATE_SYNC_INTERVAL_MS=15000
  TELEGRAM_BOT_TOKEN=

Autonomous dual-server notes:
  1) Each server should use its own local PostgreSQL database.
  2) Set a different WAREHOUSE_SERVER_ID on each server.
  3) Use the same WAREHOUSE_STATE_SYNC_TOKEN on both servers.
  4) Point WAREHOUSE_STATE_SYNC_TARGETS to the other server base URL.
  5) After env setup, run:

     npm run migrate:postgres

  6) Optional manual sync run:

     npm run sync:postgres

Northflank status for this project:
  warehouse-pg addon has been created for managed PostgreSQL.
  The public service is already configured with WAREHOUSE_DB_URL and state-sync env vars.

VDS activation still requires shell access:
  Install or configure PostgreSQL on the VDS.
  Add the same sync token and the VDS-specific WAREHOUSE_DB_URL.
  Set WAREHOUSE_SERVER_ID=vds-primary.
  Deploy the latest GitHub commit and run migrate:postgres.

Before first push:
  1) Set real git user.name
  2) Set real git user.email
  3) Create GitHub repo and add remote origin
  4) git add .
  5) git commit -m "Initial AKBEL deploy"
  6) git push -u origin main