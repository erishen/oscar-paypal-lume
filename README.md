# oscar-paypal-lume

> This file is the English version; 中文文档：[README.zh-CN.md](README.zh-CN.md)

A rewrite of [django-oscar-paypal-store](https://github.com/erishen/django-oscar-paypal-store) (Django Oscar 4.1 + PayPal demo)
using **lume (host: agent-httpd) + lume-core (language) + Vue3**, with the same business surface:
catalogue / search / basket / checkout / **idempotent PayPal Orders v2 (CAPTURE) payments** (sandbox) +
**admin dashboard** (full order list / real refunds / product publish·stock / overview stats).

> ⚠️ Tech demo / portfolio project. PayPal runs **sandbox only**, no real money (matching the original project's statement).

## Quick start

```bash
cp .secrets.json.example .secrets.json   # fill secret_key + PayPal sandbox credentials
make init          # create DB + tables + seed 140 products (idempotent)
make build-web     # build Vue3 frontend → web/dist (host docroot + SPA fallback)
make create-admin  # create demo account admin/admin123456 (equivalent to original quick-admin)
make run           # default 127.0.0.1:8090
make smoke             # 23 assertions (static / Range 206+416 / catalogue / search / auth / basket)
make smoke-paypal      # 31 assertions (+ real api-m.sandbox.paypal.com create / idempotency guard / cancel)
make smoke-admin       # 45 assertions (+ admin: gating / orders / products / refund contract)
make test-e2e          # 6 Playwright browser E2E (needs system Chrome; default targets 18101)
make test-e2e-live     # 1 real PayPal sandbox full-chain E2E (real order → guest card pay → capture → admin UI partial refund → refund rest)
make test-e2e-live-buyer # same but paying with a buyer account (creds decrypted temporarily from Chrome Keychain)
```

Open `http://127.0.0.1:8090/` in a browser: Chinese/English (EN|中文 toggle in the header), product grid,
search, detail, basket, `Pay with PayPal` (redirects to sandbox login/approve, then returns to `#/checkout/done`
for automatic capture reconciliation), order history. A fixed「演示站点 · DEMO」badge sits in the top-right corner.

## Architecture

```
app.lume            routes + validation (~930 lines)
init.lume           flattened DDL (7 tables) + idempotent migration for old DBs + seed
lib/paypal.lume     PayPal Orders v2 facade (OAuth/create/capture/refund, idempotent)
lib/{auth,db,support,config}.lume   reused from lume-fastapi-web (HMAC sessions, guard, raw SQL)
web/                Vue3 + Vite/ESBuild SPA (hash routing + hand-written i18n/store, zero CDN)
seed/products.json  140 products (exported from the original Oscar fixture CSV + 140 images)
static/media/       product images (/static/media/<sku>.jpg, host static + Range)
```

Host `server { spa = 1; docroot = "./web/dist" }`: unmatched routes + `Accept: text/html`
fall back to `index.html` (agent-httpd's native SPA history fallback), so deep-link refreshes
on hash routes and PayPal return URLs all land in the frontend.

## Mapping to the Oscar version

| Original (Django/Oscar) | This project (lume/Vue3) | Notes |
|---|---|---|
| Oscar catalogue/basket/order models | Flattened 7 tables (products/baskets/basket_items/orders + rate_limits/visits) | Demo slice; doesn't need Oscar's 30+ tables |
| `facade.py` PayPal Orders v2 | `lib/paypal.lume` | 1:1 port: token cache, fresh Request-Id on create, capture first GETs for reconciliation + stable Request-Id + treats `ORDER_ALREADY_CAPTURED` as success; unified outbound `request()`: 3 retries on network errors, GET/OAuth also retry 429/5xx, writes rely on idempotency keys and never replay 5xx |
| Decimal amounts | Integer cents (`price_cents`), `money2()` for 2 decimals | Avoids floats |
| `basket.currency` (Oscar default GBP) | `CURRENCY` env, default USD | `CURRENCY=GBP make run` aligns the original sandbox; order & PayPal amounts always share one source |
| Search (Haystack/Whoosh) | SQL `LIKE` (name/description) | Enough for 140 rows |
| dashboard real refunds (incl. partial) | `POST /api/admin/orders/:id/refund` | Omit `amount_cents` = full; pass integer cents = partial, order stays paid until fully refunded; local key dedupe + stable `PayPal-Request-Id` = double idempotency; stock restored only on full refund, then status → refunded |
| django.po i18n | frontend dictionary i18n (en / 中文) | EN\|中文 toggle in the header |
| Templates + DEMO badge | Vue3 SPA + fixed badge | |

## lume adaptation notes (gotchas)

- **`run()` must be called explicitly**: without a trailing `run()` the script exits cleanly (rc=0, no output) and the service never starts. `make check` only parses, so it won't surface this.
- **`http_get/http_post` don't throw**: network failures land in the result map's `err` field (`status=0`). **Don't wrap them in `try()`** — try puts the response in `.ok` and the outer code reads default `status`/`body` (once misreported "PayPal OAuth failed HTTP 0" while sandbox was actually reachable).
- **Type checker map-field rules**: dynamically adding `m.newfield = x` after a map literal errors with `type has no field`; every map initializer must carry all its fields.
- **int/float mixed arithmetic**: `int(c/100)*100` is rejected ("arithmetic needs numbers"); `money2()` is implemented with pure string slicing.
- **SQLite doesn't auto-create the DB**: `sql_write` opens without a create flag, so `make init` pre-creates with `sqlite3 .data/app.db ""`.
- **Route handler closures may reference later-defined `func`s** (resolved at runtime), but functions referenced at route-registration must exist at parse time (fastapi-web uses inline closures throughout; copy that for safety).
- **Frontend build**: under the macOS sandbox rollup's native binary fails Team ID validation (dlopen rejected), so Vite can't run; the builder was switched to **esbuild** (native binary works) + `@vue/compiler-sfc`, a single IIFE file, no chunks (no lazy-loading pitfalls under static hosting).
- **smoke assertions**: `curl | python3` pipes occasionally returned empty in the script; changed to dump to a temp file first, then parse.

## Acceptance log

- 2026-11-19 (local 8090):
  - `make check`: parse OK
  - `make smoke`: **23/0** (SPA fallback / static + Range 206/416/404 / path traversal / catalogue 140 / search / detail / login / basket CRUD + 401 gating + product_id mapping)
  - `make smoke-paypal`: **31/0**, including real PayPal sandbox calls:
    - `POST /api/orders/` → 201 + `approve_url=https://www.sandbox.paypal.com/checkoutnow?token=…`
    - capture before approve → 422 `ORDER_NOT_APPROVED` rejected by the idempotency guard (HTTP 502, order → `failed`, no double charge)
    - new order cancel → `canceled`; repeated cancel → 404 (idempotent)
- 2026-11-20 (admin phase 2, local 8090):
  - `make smoke-admin`: **45/0** (base 23 + PayPal 8 + admin 14):
    - gating: guest 401 / customer 403 / admin allowed
    - orders: full list (incl. username), by-id, 404, filter by status
    - products: publish/unpublish PATCH, stock/price adjustments, unpublished products absent from the catalogue
    - refund contract: paid without capture → 400; fake capture then real PayPal → 5xx without crashing; already-refunded repeat → 200 already (idempotent)
    - after refund: stock restored + order → `refunded` (aligns the original dashboard)
- 2026-11-21 (aligning with [django-oscar-paypal-store](https://github.com/erishen/django-oscar-paypal-store)):
  - server-side outbound retries ×3 (network errors; GET/OAuth also 429/5xx), aligning `facade.py`'s `Retry` + `_post`
  - refunds get a stable `PayPal-Request-Id`, support partial (`amount_cents`) / cumulative `refunded_cents`, local key dedupe
  - currency moved to `CURRENCY` config (default USD, `CURRENCY=GBP` aligns Oscar), stock restored only after a full refund
  - added `rate_limits` / `visits` tables + idempotent migration for old `orders` refund columns; removed the dead `doc_log_api_key` config
  - regression: `make check` / init parse OK; container healthy; `docker-smoke` 23/0 + full 45/0; three real-chain runs (orders 61/62/67) all passed, incl. partial refund → refund rest → idempotent
- 2026-11-21 (frontend UI alignment):
  - admin order list gets an amount input + 「退款 / 全额退款」; the real-chain E2E does a partial refund via UI (still paid, cumulative refunded) then refunds the rest via API
  - admin product list allows price edits (one PATCH `price_cents` together with stock); E2E restores the original price automatically
  - unauthenticated add-to-cart / restricted access writes `oscar_next`, returning to the original page after login; the source is consumed once, explicit login still lands in the basket
  - English adds `status`; the first screen waits for `/auth/me` before mounting views, removing the unauthenticated-state race
  - regression: `test-e2e` 6/6; real-chain order 67 (admin UI partial refund) passed

## Browser E2E (Playwright)

`scripts/smoke.sh` only hits the HTTP API, so it can't cover frontend interactions. The added E2E drives a real Chrome and operates the page directly:

```bash
make docker-up        # or ensure an instance is already on 18101
make test-e2e         # default E2E_BASE_URL=http://127.0.0.1:18101
# different address: E2E_BASE_URL=http://127.0.0.1:20102 make test-e2e
```

- Doesn't download Playwright's bundled browsers: the config uses `channel: 'chrome'` to call the local Google Chrome directly, plus `--no-proxy-server` so local requests aren't captured by a proxy.
- 6 cases: login → add/change qty/remove (covers the product_id mapping bug), checkout shows USD amounts, `#/checkout/done?key=...&token=...` reconciliation return renders (API stubbed with `page.route`, no real PayPal), admin status filter returns 200 (covers the trailing-slash bug), admin price edit persists consistently front/back, unauthenticated add-to-cart then login returns to the original page and the source is consumed once.
- Between cases the basket is cleared via API; a single worker runs serially so the demo DB isn't polluted concurrently; on failure, traces and screenshots are kept in `/tmp/oscar-lume-playwright-results/` (temp dir, to avoid the sandbox's bulk-delete protection).

### Real PayPal sandbox full-chain E2E (order → pay → refund)

The 4 E2E cases above and the PayPal section of `scripts/smoke.sh` **don't produce real transactions** (capture is rejected by the guard or stubbed via `page.route`). `web/e2e/live-paypal.spec.js` is the only real-chain case, hitting `api-m.sandbox.paypal.com` throughout:

```bash
make docker-up
make test-e2e-live          # guest card payment; explicit target, default test-e2e excludes it
make test-e2e-live-buyer    # buyer-account login payment (creds auto-read from Chrome Keychain)
```

Covers: login → add to basket (pick an in-stock product) → real create order → PayPal sandbox payment → return → real capture (order → paid, stock deducted, basket cleared) → **admin UI partial refund** (enter amount, click 「退款」, refund half: still paid, cumulative `refunded_cents`, stock not restored; same amount repeated → 200 already) → **refund the rest** (→ refunded, stock restored) → refund again idempotent.

Two payment modes:

| Mode | Command | Notes |
|---|---|---|
| **Guest card** (default) | `make test-e2e-live` | Uses "Pay with debit or credit card" with the sandbox public test card `4111111111111111` / `12/28` / `123` (overridable via `PAYPAL_TEST_CARD`/`PAYPAL_TEST_EXP`/`PAYPAL_TEST_CVV`) |
| **buyer account** | `make test-e2e-live-buyer` | Logs in with a real sandbox buyer account to approve, selects PayPal balance/bound card then clicks "Complete purchase", **no card form**; creds decrypted temporarily by `scripts/buyer-creds.sh` from the local Chrome login + Keychain, not written to the repo or printed |

- buyer account source: local Chrome's saved `sb-*@personal.example.com` (sandbox buyer) login; the password is decrypted via the `Chrome Safe Storage` key. The script prefers a personal account; `BUYER_EMAIL` / `BUYER_PASS` can override manually.
- Note: container networking to `api-m.sandbox.paypal.com` may fail TLS (DNS hijacked to `zscloudsafe.com`); on 503 you can run `PORT=20102 <lume> app.lume` on the host and `E2E_BASE_URL=http://127.0.0.1:20102 make test-e2e-live-buyer`.
- sandbox only simulates funds, no real charge; but it does leave real transaction & refund records in your PayPal sandbox merchant dashboard.
- merchant creds still read from `.secrets.json` (`paypal_client_id` / `paypal_client_secret` / `paypal_mode`), identical to the three in [django-oscar-paypal-store](https://github.com/erishen/django-oscar-paypal-store)/.env.
- PayPal sandbox occasionally 5xx/rate-limits; create retries with 3 backoffs; the real chain takes ~1 minute.
- After a run the basket is auto-cleared; orders stay in the demo DB for reconciliation in the PayPal dashboard; for a clean demo DB manually `DELETE FROM orders WHERE id>1`.

## Docker deployment (port 18101, >10000)

```bash
make docker-build     # build a single build context and compile the image (Linux-side compiles lume + bakes the frontend)
make docker-up        # start container: 127.0.0.1:18101, auto-create DB / seed 140 products / create admin
make docker-smoke     # in-container acceptance (base 23 + PayPal/admin sections on demand)
make docker-down      # stop container (data volume kept)
```

- Build context assembled by `make docker-context` (lume toolchain + agent-httpd + the app); the runtime image is slim (only `libsqlite3/libssl3/sqlite3/openssl/curl/tini` + pre-built lume).
- **Port**: default `DPORT=18101` (host binds loopback only). Change with `DPORT=19101 make docker-up` (container & host change together).
- **Admin password**: when `ADMIN_PASSWORD` isn't passed, entrypoint generates a random password into the data volume's `.secrets.json` (not printed to logs); for local demos use `ADMIN_PASSWORD=admin123456 docker compose up -d` to match Oscar's quick-admin.
- **PayPal creds (optional)**: `PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… PAYPAL_MODE=sandbox docker compose up -d`; when absent the site/catalogue/basket still work and checkout returns 503.
- Data volume `oscar-lume-data` mounts `/app/.data` (SQLite + secrets); rebuilding the container keeps data.
- `make docker-smoke`'s DB-layer acceptance works via `SMOKE_DB_CMD`/`SMOKE_USER_CMD` (`docker compose exec` into the container); the local run stays the same (default `sqlite3 .data/app.db`).

## Known boundaries

- Refunds only apply to paid orders that have a `paypal_capture_id`; a paid order hand-made in the demo DB (no capture id) can't be refunded — this is **correct contract behavior** (no money, no refund); smoke-admin uses it to verify 400.
- Partial refund: `POST .../refund` with `amount_cents` refunds only that amount, the order stays `paid` and accumulates `refunded_cents`; once fully refunded it goes `refunded`. Repeating the same `key` (or same amount with the default key) returns 200 already, no double booking / double PayPal call.
- Voucher discounts are written into the PayPal order's `breakdown.discount` (line items keep the original price, `item_total` = sum of line items); otherwise PayPal rejects with `ITEM_TOTAL_MISMATCH` (422). Voucher-based order creation has been tested in sandbox.
- lume routes match in registration order: literal routes (e.g., `delete /api/basket/voucher`) must be registered before parameter routes (`delete /api/basket/:product_id`), otherwise the parameter route swallows them and returns 422.
- Rate limiting / IP allowlists only apply to registered API routes (unregistered paths go through the host docroot without `guard()`); fine for a single demo instance, unlike fastapi-web where every path passes guard.
- `smoke.sh`'s DB-layer refund probe writes via `SMOKE_DB_CMD` on a separate `sqlite3` connection; the SQLite CLI defaults to `busy_timeout=0`, so when live requests write `visits`/`rate_limits` the probe can transiently hit `database is locked` (app connections carry a 5s busy_timeout and are unaffected). The script retries probe write locks up to 3 times with backoff to avoid flaky false positives.
- Under multiple workers the PayPal token cache is per-process (one per worker), slightly more OAuth calls, no correctness issue.
- The newer lume (elastic worker pool) sends **all** registered script routes into the blocking pool (including body-less GETs): with too few workers (default 2) concurrency queues and returns 503 after 5s (no log; surfaces as random E2E hangs). docker-compose raises `WORKERS` default to 8; the suite dropped from ~2.8min to ~50s.
- Stock is deducted on successful payment (Oscar deducts at fulfillment) and restored on **full** refund; partial refunds don't restore (no specific lines specified); demo semantics.
- No migration tool: schema changes go into `init.lume`'s idempotent DDL.
- Security/compliance: the host-served HTML carries a CSP meta (`script-src 'self' 'nonce-…'`, inline JSON-LD allowed via a fixed nonce; `style-src 'unsafe-inline'` because Vue injects `<style>` at runtime); password-reset tokens are stored in the DB only as HMAC hashes (the plaintext appears once in the response/email); content pages include `/privacy/` and `/terms/` (minimal demo data + no real money + AI assistant data-flow disclosure).
- `DEBUG`-equivalent surface: error bodies are fail-closed under `APP_ENV=production` (following fastapi-web).
- admin user is created by `make create-admin` (`admin/admin123456`), aligning Oscar's `quick-admin`; production should use `scripts/create-user.lume <user> <pass> admin` with a strong password.
