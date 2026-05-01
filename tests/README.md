Warehouse app isolation

- Dedicated Syr AKBEL UI files live in `warehouse-app/public/`.
- Dedicated warehouse backend helpers live in `warehouse-app/lib/warehouse-bot.mjs`.
- Dedicated warehouse API route handler lives in `warehouse-app/server/handle-api.mjs`.
- Dedicated warehouse state now defaults to `warehouse-app/data/warehouse.json`.
- Public URLs are namespaced under `/warehouse/...`.
- Warehouse API URLs are namespaced under `/warehouse/api/...`.
- Legacy bare routes like `/admin`, `/seller`, `/customers` redirect into `/warehouse/...`.
- Local startup can use `npm run warehouse:dev`.
- Main GetdressAI pages remain outside this folder and do not link into warehouse routes.