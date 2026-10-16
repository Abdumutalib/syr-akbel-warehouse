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

## Audit fixes

- Admin login now issues random, signed eight-hour sessions. Default/static cookies
  are rejected, and changing admin credentials invalidates existing sessions.
- Staff PIN verification issues a session for the verifying browser only. A shared
  link does not become globally unlocked. Link revocation and permission changes
  are checked on each authenticated request.
- Public operator profiles contain the effective link permissions and no access
  tokens. Only the admin staff-management API returns managed links.
- Customer management requires the customers permission; sale writes require the
  matching cash/transfer write permission. Order edits and deletes require orders.
  Company analytics and the combined ledger require admin authentication.
- Writes operate on a draft state and publish it only after persistence succeeds.
  Rejected updates cannot alter another seller's records. Legacy sales use the
  same queue and configured state as the regular warehouse API.
- Hidden seller balances are removed from API summaries, history and mutation
  responses. Legacy unassigned customers retain the existing shared visibility;
  records assigned to a seller remain isolated from other sellers.
- User-controlled names, notes and URLs are escaped in HTML renderers. Photo URLs
  are limited to warehouse uploads and supported raster image data URLs.
- API cache keys are bound to hashed credentials. Cookie-only requests are always
  authorized on the server, and old unscoped IndexedDB caches are purged on upgrade.
- Both Telegram webhook routes require the shared secret. The extended bot reads
  the active state and its summary fields, and replies only in private user chats.

Validation includes the existing suite plus HTTP regressions for session forgery,
PIN isolation, permission boundaries, rollback, hidden balances and legacy writes;
client regressions cover escaping, account-scoped caching and session expiry.

## Follow-up: staff page access

- Staff navigation and seller-page links are hidden unless the loaded operator profile contains the matching page permission. Customer search is not requested unless the profile has customer-page access.
- Staff links can be scoped to one selected permission or to all permissions granted to the account. Non-admin page checks compare link and account permissions exactly, so cash/transfer sale-write permissions do not grant the corresponding admin report page. PIN-authenticated admin accounts retain their full admin permissions across pages.
- On successful link access, the staff token is exchanged for an `HttpOnly`, `SameSite=Strict` cookie with an eight-hour lifetime. The page URL is cleaned, internal navigation does not reattach the token, and warehouse HTML responses are `private, no-store` with `Referrer-Policy: no-referrer`.
- Staff tokens are retained in tab-scoped session storage for the existing API client; legacy local-storage values are migrated to session storage. The cookie is additionally used by server-side API authentication. Production HTTPS deployments should forward `X-Forwarded-Proto: https` so the cookie receives the `Secure` attribute.
- The service worker no longer caches protected HTML navigation responses, preventing cached pages from bypassing route checks after revocation. Static assets remain cacheable for mobile responsiveness; absolute performance depends on device and network and is not guaranteed by this change.
