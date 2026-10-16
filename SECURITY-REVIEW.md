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

## Follow-up: staff page access

- Staff navigation and seller-page links are hidden unless the loaded operator profile contains the matching page permission. Customer search is not requested unless the profile has customer-page access.
- Staff links are created for one selected permission at a time. Non-admin page checks compare link and account permissions exactly, so cash/transfer sale-write permissions do not grant the corresponding admin report page. PIN-authenticated admin accounts retain their full admin permissions across pages.
- On successful link access, the staff token is exchanged for an `HttpOnly`, `SameSite=Strict` cookie with an eight-hour lifetime. The page URL is cleaned, internal navigation does not reattach the token, and warehouse HTML responses are `private, no-store` with `Referrer-Policy: no-referrer`.
- Staff tokens are retained in tab-scoped session storage for the existing API client; legacy local-storage values are migrated to session storage. The cookie is additionally used by server-side API authentication. Production HTTPS deployments should forward `X-Forwarded-Proto: https` so the cookie receives the `Secure` attribute.
- The service worker no longer caches protected HTML navigation responses, preventing cached pages from bypassing route checks after revocation. Static assets remain cacheable for mobile responsiveness; absolute performance depends on device and network and is not guaranteed by this change.
