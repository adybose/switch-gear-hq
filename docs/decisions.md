# Decisions

Short, dated log. Newest first. Append; don't rewrite history.

| Date | Decision | Why |
| --- | --- | --- |
| 2026-11-06 | Repo is `switch-gear-hq`, a single npm-workspaces monorepo | One clone + `docker compose up` for judges |
| 2026-11-06 | Money stored as integer paise | Avoid float rounding in ledger and GST |
| 2026-11-06 | Approval gates enforced by the store API, not by agents | Agents can't bypass or self-approve |
| 2026-11-06 | Gatekeeper is plain code (no AI) | Event routing and approvals must be predictable |
| 2026-11-06 | `AGENTS.md` is the source of truth; `CLAUDE.md` imports it | One set of rules for Claude Code and Codex |
| 2026-11-06 | Skills in `.agents/skills/`, linked from `.claude/skills` | Codex and Claude Code read the same files |
| 2026-11-06 | Chat app is Slack (free plan, autocomplete off) | Founder knows Slack; no paid features needed |
| 2026-11-06 | Builder on Claude Code, Reviewer on Codex | Every PR checked by a second model |
| 2026-11-06 | PayMock instead of a real gateway's test mode | Runs with no accounts or keys; adapter allows swapping later |
| 2026-11-07 | Docker and CI use Node 22 LTS; code still supports Node 20.19+ | Node 20 is past end of life; `engines` keeps 20 working locally |
| 2026-11-07 | TypeScript pinned to 5.9, Vitest to 4.x | typescript-eslint doesn't support TS 7 yet; Vitest 5 drops Node 20 |
| 2026-11-07 | One root `Dockerfile` with a target per service; sim and gatekeeper run TS via `tsx` | No per-app build step; workspaces share one `npm ci` layer |
| 2026-11-07 | Workspace packages export TypeScript source (no build); Next transpiles `@switch-gear/shared` | Fewer moving parts for a hackathon monorepo |
| 2026-11-07 | Prettier skips Markdown, `docs/`, `api/` and agent folders | Don't reformat hand-written docs and the API contract |
| 2026-11-07 | Prisma 7 with the `pg` driver adapter; client generated to `apps/store/src/generated` on `npm install` | No native engine download; works on Node 20 and Alpine |
| 2026-11-07 | Ledger balance enforced twice: `postLedgerTxn()` check and a deferred Postgres constraint trigger | A bug or raw write can't leave unbalanced books |
| 2026-11-07 | DB tests skip without `DATABASE_URL`; CI runs them against a Postgres service | `npm test` still passes on a fresh clone with no database |
| 2026-11-07 | Store container runs `prisma migrate deploy` on start | `docker compose up` works on a fresh clone without extra steps |
| 2026-11-07 | A test checks Prisma enums against `api/openapi.yaml`; CI fails if migrations drift from `schema.prisma` | Contract and database stay in step |
| 2026-11-07 | Founder login is a `founder.login` Setting row (email + scrypt hash), not a User table | One account; no schema change for it |
| 2026-11-07 | `.env.local.keys` is written once; reseeds and demo resets reuse its keys, and any key not in it is revoked | Agents' `sg` configs survive `demo:reset`; deleting the file rotates every key |
| 2026-11-07 | `db:seed` only adds missing rows; `demo:reset` truncates everything (in one transaction) and seeds | Seeding a live DB never clobbers changes; reset is repeatable |
| 2026-11-07 | Vitest runs test files one at a time; with `DATABASE_URL` set, `npm test` leaves the DB in the demo seed state | DB tests share one Postgres and the reset test truncates it |
| 2026-11-07 | The ₹2,500 GST limit is the pre-GST value per piece (founder decision; up to ₹2,625 including 5% GST); tax is the inclusive price minus the rounded taxable value | Matches how apparel GST works; the parts always add back up to the price |
| 2026-11-07 | Intra-state GST splits into equal CGST/SGST halves, odd paisa to SGST | Integer paise; deterministic |
| 2026-11-07 | The business clock syncs with the sim every 5 s and runs forward locally in between; real time if the sim is down | No sim call per request; the store keeps working without the sim |
| 2026-11-07 | Storefront pages read the catalogue from Postgres per request (`connection()`); policy pages are static | `next build` needs no database; catalogue changes show immediately |
| 2026-11-07 | Cart lives in the browser (localStorage); checkout re-prices every line on the server | No cart table or session; client prices are never trusted |
| 2026-11-07 | Mockups are SVGs generated at `/artwork/<slug>.svg?colour=<colour>` from the design name | Original artwork only; one URL per design, as the seed stores |
| 2026-11-07 | The 3-tee 10% discount and a discount code don't stack; the bigger one applies | Simple to explain; caps discounts at the code limit |
| 2026-11-07 | Free shipping (₹999+) is measured on goods after discounts; shipping is taxed at the highest GST rate in the cart | Spec §2/§6 don't say; this matches what the customer pays |
| 2026-11-07 | ShipFast service area is a shared rule (`packages/shared/src/shipping.ts`): PINs starting 9, 744, 68255 and 194 are blocked; 560 is same city, 5/6 same zone, rest national | Store checkout and the sim (T-14) agree without a network call |
| 2026-11-07 | Orders are numbered from a Postgres sequence (ORD-1001 up); demo reset restarts it | No gaps or races from counting rows |
| 2026-11-07 | Orders store their own delivery details; the Customer row only links orders by email and checkout never updates it | Public checkout can't change another order's address; repeat-refund rule (spec §8) still sees one customer |
| 2026-11-07 | Order confirmation links carry an HMAC token (`ORDER_LINK_SECRET`); until PayMock (T-07) `paymentUrl` is that page | Order numbers are guessable; the token isn't |
| 2026-11-07 | Added `POST /checkout/quote` (in openapi.yaml) | Checkout page shows totals, code and PIN problems before the order is placed |
