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

GitHub push -> auto deploy (configured):
  Workflow file:
    .github/workflows/deploy.yml

  Required GitHub repository secrets:
    DEPLOY_SSH_PRIVATE_KEY     # private key for DEPLOY_USER

  Required GitHub repository variables:
    DEPLOY_HOST                # server IP or hostname
    DEPLOY_PORT                # optional, default 22
    DEPLOY_USER                # ssh user
    DEPLOY_PATH                # app root on server, e.g. /opt/syr-akbel-warehouse
    DEPLOY_RESTART_CMD         # restart command, e.g. systemctl restart syr-akbel-warehouse
    VERIFY_PROD_BASE_URL       # e.g. https://akbelim.com

  Deploy flow summary:
    1) push to main
    2) workflow runs tests
    3) artifact uploads to server
    4) release unpacked into DEPLOY_PATH/releases/<commit_sha>
    5) .build-sha file is written with commit sha
    6) current symlink switches to the new release
    7) restart command is executed
    8) workflow verifies /healthz build == pushed commit sha

Commit traceability guarantee:
  - /healthz returns JSON field build
  - /readyz returns JSON field build
  - If build equals pushed commit SHA, latest commit is confirmed in production.

Before first push:
  1) Set real git user.name
  2) Set real git user.email
  3) Create GitHub repo and add remote origin
  4) git add .
  5) git commit -m "Initial AKBEL deploy"
  6) git push -u origin main