# Security review

Review scope: unauthenticated warehouse API routes and Telegram webhook trust boundaries.

## Findings and remediation

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | HIGH | `POST /api/sales` could create approved transactions without authentication. | Fixed: now requires warehouse admin authentication. |
| 2 | HIGH | Telegram webhook updates were accepted without verifying Telegram's webhook secret; reminder commands did not validate the sender. | Fixed: webhook requires `TELEGRAM_WEBHOOK_SECRET`; `/ha`, `/yoq`, and `/eslatma` require the sender's ID to match `TELEGRAM_ADMIN_USER_ID`. |
| 3 | MEDIUM | `POST /api/warehouse/business-message` accepted unauthenticated transaction submissions. | Fixed: now requires `X-Warehouse-Business-Token` matching `WAREHOUSE_BUSINESS_MESSAGE_TOKEN`. |
| 4 | MEDIUM | An early `GET /api/forecast` handler returned forecasts before reaching the admin-protected handler. | Fixed: removed the early handler; the remaining route requires warehouse admin authentication. |

## Deployment requirements

Set these values in the deployment environment; do not commit their values:

- `TELEGRAM_WEBHOOK_SECRET`: set this to Telegram's webhook `secret_token` so Telegram sends the matching `X-Telegram-Bot-Api-Secret-Token` header.
- `TELEGRAM_ADMIN_USER_ID`: numeric Telegram sender ID authorized for the three reminder commands. This is the sender ID, not a group/chat ID.
- `WAREHOUSE_BUSINESS_MESSAGE_TOKEN`: a strong secret for trusted callers of `/api/warehouse/business-message`, sent in the `X-Warehouse-Business-Token` header. If the integration is unused, leave it unset and the endpoint will fail closed.

The review is limited to the findings above and is not a certification of the entire application.
