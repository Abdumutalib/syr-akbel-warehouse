AKBEL deploy quick notes
========================

Domain:
  akbelim.com

Billing panel:
  https://my.tdc.uz/billmgr?startform=clientoption

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
  WAREHOUSE_ALLOWED_ORIGIN=https://akbelim.com
  WAREHOUSE_MAX_REQUEST_BYTES=6291456
  TELEGRAM_BOT_TOKEN=

Single-server notes:
  - Loyiha bitta server rejimida ishlaydi.
  - Tashqi peer sync endpointlari olib tashlangan.
  - Barcha boshqaruv jarayoni yuqoridagi billing panel orqali yuritiladi.

Before first push:
  1) Set real git user.name
  2) Set real git user.email
  3) Create GitHub repo and add remote origin
  4) git add .
  5) git commit -m "Initial AKBEL deploy"
  6) git push -u origin main