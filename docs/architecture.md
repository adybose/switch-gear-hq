# Switch Gear — Architecture

## Components

```text
Customers ──► apps/store (Next.js) ◄──calls/webhooks──► apps/sim (Fastify)
                 │  storefront · admin · REST API · approval gates · event outbox
                 │  Postgres (Prisma)
                 ▼
          GET /api/v1/events (poll)
                 │
          apps/gatekeeper (custom Switch agent, no AI) ──► Switch rooms in Slack
                                                         ▲
          AI agents (Claude Code, Codex) ── sg CLI ──► store REST API
```

| Service | Port | What it does |
| --- | --- | --- |
| `store` | 3000 | Storefront, admin console, REST API `/api/v1`, approval gates, event outbox |
| `sim` | 4000 | PayMock, PrintHub, ShipFast, order generator, ad sim, ticket sim, demo clock, scenarios |
| `gatekeeper` | 4100 (health only) | Polls store events → posts to Switch rooms; handles founder approvals; timers |
| `db` | 5432 | Postgres 16 |

The simulator never touches the store's database. It talks to the store only through the store
API and HMAC-signed webhooks, exactly like a real partner would.

## Auth and API keys

- Admin console: founder login (seeded test account, credentials in `.env.example`), stored as
  the `founder.login` Setting with an scrypt password hash.
- API: `Authorization: Bearer sg_<department>_<random>`. Keys are stored hashed (SHA-256). The seed
  writes the plaintext keys once to `.env.local.keys` (git-ignored); later seeds and demo resets
  reuse them, so agents keep working keys.
- Scopes per department (enforced in middleware):

| Key | Read | Write |
| --- | --- | --- |
| `fulfilment` | orders, print jobs, shipments | create print jobs/shipments, reship, cancel before printing |
| `finance` | payments, ledger, invoices, partner invoices, reports | refunds, partner payouts, ledger adjustments |
| `marketing` | catalogue, order summary, campaigns, discount codes | discount codes, campaigns, ad budget (within limits) |
| `support` | orders, shipments, tickets | ticket replies, refund requests, returns |
| `engineering` | health, error log, flags | feature flags, rollback marker |
| `hq` | everything | nothing |
| `founder` | everything | approval decisions (used only by Gatekeeper and admin UI) |

## Data model (Prisma, Postgres)

IDs shown to humans are short and prefixed: `ORD-1042`, `TCK-88`, `APR-7`, `INV-2026-00042`.

| Model | Key fields |
| --- | --- |
| Product | slug, name, collection, description, artworkUrl, status (draft, published) |
| Variant | productId, sku, fit, colour, size, pricePaise, active |
| Customer | name, email (`@example.com`), phone, address, city, state, pincode (first order's details; links orders by email, never updated by checkout) |
| Order | number, customerId, shipName, shipPhone, shipAddress, shipCity, shipState, shipPincode (per-order delivery details), status, subtotalPaise, discountPaise, shippingPaise, taxPaise, totalPaise, discountCode, source (web, generator), placedAt |
| OrderItem | orderId, variantId, qty, unitPricePaise |
| Payment | orderId, gatewayRef, status, amountPaise, feePaise, capturedAt, settledAt |
| Refund | orderId, amountPaise, reason, status (requested, pending_approval, processed, rejected), approvalId |
| PrintJob | orderId, partnerRef, status, attempt, costPaise |
| Shipment | orderId, awb, status, zone, attempts, costPaise |
| CustomerInvoice | number, orderId, gstType (intra, inter), taxablePaise, cgstPaise, sgstPaise, igstPaise |
| CreditNote | number, invoiceId, refundId, amounts as invoice |
| PartnerInvoice | partner, partnerRef, periodStart, periodEnd, lines (json), totalPaise, gstPaise, status (received, verified, disputed, pending_approval, paid), approvalId |
| LedgerEntry | txnId, account, debitPaise, creditPaise, refType, refId, memo, at |
| DiscountCode | code, percent, startsAt, endsAt, status, approvalId |
| Campaign | name, channel, budgetPaise, spentPaise, startsAt, endsAt, status |
| Ticket | number, orderId?, customerId, type (wismo, exchange, return, complaint, other), status, messages (json) |
| ApprovalRequest | number, department, action, payload (json), amountPaise?, reason, status (pending, approved, rejected, expired), decidedBy, decidedAt, decisionReason |
| Event | seq (autoincrement), type, entityType, entityId, payload (json), createdAt |
| ApiKey | department, hash, createdAt, revokedAt |
| FeatureFlag | key, enabled |
| Setting | key, value (demo clock speed, budgets, limits) |

Ledger rule: all entries for one `txnId` must sum to zero (debits = credits). Enforced by
`postLedgerTxn()` in `apps/store/src/server/ledger.ts`, a deferred database trigger checked at
commit, and tests for both. All money columns also have non-negative `CHECK` constraints.

## Events (outbox)

- Every state change writes an `Event` row in the same database transaction (outbox pattern).
- `GET /api/v1/events?after=<seq>&limit=100` returns events in order. Gatekeeper polls every 2 s
  and stores its cursor.
- Event names and payloads live in `packages/shared/events.ts`; the list is in `docs/spec.md` §10.
- Gatekeeper routing table: `apps/gatekeeper/routes.ts` maps event type → room + role.

## Approval gates

- Limits live in `Setting` rows (seeded from `docs/spec.md` §8).
- An over-limit request returns `202 {"approvalId":"APR-7","status":"pending"}` and writes
  `approval.requested`.
- `POST /api/v1/approvals/{id}/decision` (founder key only) with `approve` or `reject` + reason.
  On approve, the store executes the stored action and writes `approval.decided` plus the
  action's own events.

## Webhooks (sim → store)

- `POST /api/v1/webhooks/{paymock|printhub|shipfast}`
- Header `X-SG-Signature: sha256=<hex HMAC of raw body>` using a per-partner secret.
- Idempotent: each webhook has an `eventId`; duplicates are ignored.

## Demo clock

- The sim owns business time. `GET /sim/clock` returns `now` and `speed`.
- Speed 1 = real time; demo speed: 1 business day = 10 minutes.
- Store timers (unpaid cancel, late print job) read the sim clock through `packages/shared/clock.ts`.

## Environment

See `.env.example`. Only test values. Real `.env` files are git-ignored.
