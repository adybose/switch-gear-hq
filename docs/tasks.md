# Tasks

How to use this file:

- Work only on tasks assigned to you (Owner). Pick the lowest-numbered `todo` task whose
  dependencies are `done`, unless the founder says otherwise.
- Set Status to `doing` when you start (in your branch) and `review` when the PR is open.
  The founder sets `done` on merge.
- One task = one branch = one PR (`t-07-paymock`). Use the `implement-task` skill.
- Acceptance criteria (AC) are the definition of done, together with AGENTS.md.
- Priority: **MVP** must ship for the demo; **Stretch** only if time allows.

## Summary

| ID | Title | Owner | Depends on | Priority | Status |
| --- | --- | --- | --- | --- | --- |
| T-01 | Monorepo skeleton, Docker Compose, CI | builder | — | MVP | todo |
| T-02 | Database schema and migrations | builder | T-01 | MVP | todo |
| T-03 | Seed data and demo reset | builder | T-02 | MVP | todo |
| T-04 | Shared package: money, GST, events, clock | builder | T-01 | MVP | todo |
| T-05 | Storefront pages | builder | T-03 | MVP | todo |
| T-06 | Checkout and pricing rules | builder | T-04, T-05 | MVP | todo |
| T-07 | PayMock gateway and payment flow | builder | T-06, T-08 | MVP | todo |
| T-08 | Event outbox, events API, signed webhooks | builder | T-02, T-04 | MVP | todo |
| T-09 | API keys, scopes, validation | builder | T-02 | MVP | todo |
| T-10 | Approval gates | builder | T-08, T-09 | MVP | todo |
| T-11 | Order tracking and contact form | builder | T-06 | MVP | todo |
| T-12 | Admin console | builder | T-09, T-10 | MVP | todo |
| T-13 | PrintHub simulator and print jobs | builder | T-08, T-09 | MVP | todo |
| T-14 | ShipFast simulator and shipments | builder | T-13 | MVP | todo |
| T-15 | Demo clock and order generator | builder | T-07, T-14 | MVP | todo |
| T-16 | Double-entry ledger | builder | T-07 | MVP | todo |
| T-17 | GST invoices and credit notes | builder | T-16 | MVP | todo |
| T-18 | Refunds, refund requests, returns | builder | T-10, T-17 | MVP | todo |
| T-19 | Partner invoices and payouts | builder | T-16, T-14 | MVP | todo |
| T-20 | Reports: daily P&L, GST summary | builder | T-17, T-19 | MVP | todo |
| T-21 | Discount codes, campaigns, ad simulator | builder | T-10, T-15 | Stretch (codes MVP) | todo |
| T-22 | Tickets, ticket simulator, email outbox | builder | T-11, T-15 | MVP | todo |
| T-23 | `sg` CLI | builder | T-09 | MVP | todo |
| T-24 | Gatekeeper (custom Switch agent) | builder | T-08, T-10 | MVP | todo |
| T-25 | Role, room and business skill files; agent folders | builder | T-23 | MVP | todo |
| T-26 | Switch template and onboarding | founder | T-24, T-25 | MVP | todo |
| T-27 | Scenario buttons | builder | T-15, T-19 | MVP (3 of 6) | todo |
| T-28 | README and demo script | founder | T-26 | MVP | todo |

Reviewer (`@reviewer`) reviews every builder PR with the `review-pr` skill.

---

## Phase A — Foundation

### T-01 Monorepo skeleton, Docker Compose, CI

- AC: npm workspaces `apps/store` (Next.js App Router, TS, Tailwind), `apps/sim` (Fastify, TS),
  `apps/gatekeeper` (TS, empty entry), `packages/shared`, `packages/sg-cli`.
- AC: root scripts from AGENTS.md exist: `dev`, `lint`, `typecheck`, `test`, `test:e2e`,
  `db:migrate`, `db:seed`, `demo:reset` (later tasks may stub).
- AC: `docker-compose.yml` runs `db` (Postgres 16), `store`, `sim`, `gatekeeper`; `.env.example`
  with test-only values; `.gitignore` covers `.env`, `node_modules`, build output.
- AC: GitHub Actions workflow runs lint, typecheck and test on every PR.
- AC: `npm install && npm run lint && npm run typecheck && npm test` pass on a clean clone.

### T-02 Database schema and migrations

- AC: Prisma schema in `apps/store/prisma/schema.prisma` with every model in
  `docs/architecture.md`; money fields are `Int` paise.
- AC: first migration applies on an empty database.
- AC: ledger balance is enforced (service-level check + test that an unbalanced txn is rejected).

### T-03 Seed data and demo reset

- AC: seed creates 12 products in 4 collections with variants and prices from `docs/spec.md` §2.
- AC: seed creates approval limits and budgets as `Setting` rows (spec §8), feature flags,
  founder login, and one API key per department, written once to `.env.local.keys` (git-ignored).
- AC: `npm run demo:reset` wipes data and reseeds to the same state every time.

### T-04 Shared package: money, GST, events, clock

- AC: `money.ts` — paise helpers, rupee formatting (₹1,299), GST split (5% up to ₹2,500 per
  piece, 18% above; CGST+SGST if state is Karnataka, else IGST) with unit tests.
- AC: `events.ts` — event type names and payload types for every event in spec §10.
- AC: `clock.ts` — reads business time from the sim clock, falls back to real time.

## Phase B — Store

### T-05 Storefront pages

- AC: home, collection, product (variant picker, size chart), cart, policy pages; mobile-first.
- AC: product mockups are generated SVGs (tee shape + design text); no copied artwork.
- AC: "Demo store. No real payments or deliveries." banner on every page.

### T-06 Checkout and pricing rules

- AC: `POST /checkout` per `api/openapi.yaml`; creates customer, order (`placed`), event `order.placed`.
- AC: pricing: 10% off any 3+ tees, discount codes, free shipping at ₹999+ else ₹79, GST included
  in prices; totals match unit tests for 5 sample carts.
- AC: PIN code check against ShipFast serviceable list; unserviceable PIN blocked with a clear message.
- AC: confirmation page shows order number and totals.

### T-07 PayMock gateway and payment flow

- AC: sim serves a mock payment page with Success / Failure / Pending buttons.
- AC: signed webhook updates payment → order `paid` (event `order.paid`) or `cancelled`
  (`payment.failed`); pending resolves within 5 business minutes.
- AC: fee (2% + 18% GST on fee) recorded; settlement T+2 emits `settlement.received`.
- AC: unpaid orders auto-cancel after 30 business minutes.

### T-08 Event outbox, events API, signed webhooks

- AC: every state-changing service writes an `Event` in the same transaction.
- AC: `GET /events?after=` returns events in `seq` order with paging.
- AC: webhook endpoint verifies `X-SG-Signature` HMAC and ignores duplicate `eventId`s (tests).

### T-09 API keys, scopes, validation

- AC: bearer key middleware maps key → department; scope table from `docs/architecture.md`.
- AC: calling an endpoint outside the key's scope returns 403 (tests per department).
- AC: zod validation on every endpoint; errors use the `Error` schema.

### T-10 Approval gates

- AC: limits read from `Setting`; over-limit refund, reship, payout, discount code and budget
  requests return 202 `{approvalId, status: pending}` and emit `approval.requested`.
- AC: `POST /approvals/{id}/decision` accepts only the founder key; approve executes the stored
  action exactly once; reject records the reason; both emit `approval.decided`.
- AC: tests for each gate's boundary (e.g. refund ₹1,000 passes, ₹1,001 waits).

### T-11 Order tracking and contact form

- AC: track page (order number + email) shows status timeline, AWB and invoice link.
- AC: contact/return form creates a ticket (`ticket.created`).

### T-12 Admin console

- AC: founder login; orders list + detail with timeline; approvals queue with approve/reject;
  read-only fulfilment and finance views.
- AC: approve/reject in the admin uses the same endpoint as Gatekeeper.

## Phase C — Partners

### T-13 PrintHub simulator and print jobs

- AC: sim implements PrintHub API and status progression per spec §5, using the demo clock.
- AC: store endpoints `POST /print-jobs`, `POST /print-jobs/{id}/reprint`; order moves to `printing`.
- AC: misprint (3%), artwork_rejected and late (> 2 business days → `printjob.late`) are produced.

### T-14 ShipFast simulator and shipments

- AC: sim implements ShipFast API with zones, transit times, failed delivery (2 retries), RTO, loss.
- AC: store endpoints `POST /shipments`, `POST /shipments/{id}/reship` (2nd reship needs approval).
- AC: events `shipment.delivered`, `shipment.failed`, `shipment.rto`; order status follows.

### T-15 Demo clock and order generator

- AC: sim clock with speed setting (1× and demo: 1 business day = 10 minutes) and an admin control.
- AC: generator places ~30 orders per business day through `POST /checkout` with fake customers
  from a fixed list of Indian cities, then pays them with the 95/4/1 outcome mix.
- AC: on/off switch; deterministic with a seed.

## Phase D — Finance

### T-16 Double-entry ledger

- AC: posting rules for payment captured, fee, settlement, refund, print cost, shipping cost,
  partner payout, GST output/input, discounts, marketing spend.
- AC: `GET /ledger` with filters; trial balance always sums to zero (test).

### T-17 GST invoices and credit notes

- AC: invoice on `order.paid`: HSN 6109, dummy GSTIN, intra/inter-state split, numbered `INV-YYYY-NNNNN`.
- AC: credit note on every refund; JSON and printable HTML views.

### T-18 Refunds, refund requests, returns

- AC: `POST /refunds` (finance) via PayMock; partial and full; 202 above ₹1,000 or 2nd refund in 30 days.
- AC: `POST /refund-requests` (support) emits `refund.requested`, moves no money.
- AC: `POST /returns` books a ShipFast return; refund allowed once the parcel is back.

### T-19 Partner invoices and payouts

- AC: sim sends weekly invoices for PrintHub and ShipFast (`invoice.received`).
- AC: `verify` compares lines to print jobs/shipments and lists mismatches; `dispute`; `pay`
  (202 if mismatch > ₹100 or total > ₹25,000); ledger updated on pay.

### T-20 Reports

- AC: `GET /reports/pnl?date=` — revenue, discounts, refunds, COGS, shipping, fees, marketing, profit.
- AC: `GET /reports/gst?month=` — output GST, input GST, net payable, by rate and by intra/inter.

## Phase E — Marketing and Support

### T-21 Discount codes, campaigns, ad simulator

- AC (MVP): discount codes CRUD with the 20% / 7-day gate.
- AC (Stretch): campaigns with budget; ad sim converts spend to clicks and generator orders
  tagged by channel; daily `campaign.result`.

### T-22 Tickets, ticket simulator, email outbox

- AC: ticket list/detail/reply/close endpoints; replies go to an in-app email outbox page.
- AC: ticket sim creates tickets at the rates in spec §9, tied to real orders.

## Phase F — Agents and Switch

### T-23 `sg` CLI

- AC: `packages/sg-cli` exposes `sg` with subcommands for every department endpoint, e.g.
  `sg orders list --status paid`, `sg refunds create ORD-1042 --amount 799 --reason misprint`.
- AC: reads `SG_API_URL` and `SG_API_KEY` from the working folder's `.env`; prints short
  human-readable output by default and `--json` on request; exit code ≠ 0 on errors.
- AC: a 202 response prints `Waiting for founder approval: APR-7`.

### T-24 Gatekeeper (custom Switch agent)

- AC: implements the Switch agent protocol (register once, WebSocket connection with stable
  connection id, ping/pong with cursor, act only on addressed messages), per
  https://docs.switchagents.ai/switch-rooms/internals/agent-protocol.md.
- AC: polls `GET /events`, keeps its cursor, posts each event to `#events` and, per
  `apps/gatekeeper/routes.ts`, to the owning room mentioning the role.
- AC: in `#approvals`, parses `approve APR-n` / `reject APR-n <reason>` only from the founder's
  Switch identity and calls the decision endpoint with the founder key; ignores everyone else.
- AC: timers: `report.daily` to `@chief-of-staff` at end of each business day; weekly invoices nudge to `@finance`.

### T-25 Role, room and business skill files; agent folders

- AC: a role file for all 8 AI roles: `agents/<role>/AGENTS.md`, or `agents/external/<role>/AGENTS.md` for
  builder and reviewer; `rooms/<channel>.md` for all 9 channels (see `docs/plan.md`).
- AC: business skills in `.agents/skills/` (list in the plan doc), each with `name` + `description`.
- AC: `agents/{chief-of-staff,fulfilment,finance,marketing,support}/` each with `AGENTS.md`, `CLAUDE.md`
  (`@AGENTS.md`) and `.env.example`; `agents/external/{builder,reviewer}/` each with `AGENTS.md`
  and `CLAUDE.md`.

### T-26 Switch template and onboarding (founder)

- AC: `switch/switch-gear.template.yaml` creates rooms, roles and agents; tested on a fresh server.
- AC: all 9 channels exist in Slack and each agent answers `!agents-greet`.

### T-27 Scenario buttons

- AC: admin buttons + sim endpoints for misprint spike, checkout bug (feature flag), invoice mismatch.
- AC (Stretch): courier disruption, gateway outage, viral post.

### T-28 README and demo script (founder)

- AC: README explains the idea, how Switch is used (rooms, roles, handoffs, approvals, custom
  agent), screenshots, and run steps; demo script for a 3–5 minute video.
