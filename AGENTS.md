# AGENTS.md — Switch Gear HQ

Rules for every AI agent working in this repo (Claude Code, Codex, or any other).
This file is the single source of truth. `CLAUDE.md` imports it. Folders may add their
own `AGENTS.md` with extra rules for that folder; the nearest one wins on conflicts.

## What this project is

Switch Gear is a fictional one-founder T-shirt brand from Bangalore, run by AI agents
working in Slack through [Switch](https://docs.switchagents.ai/). The store is a real
website; payments, printing (PrintHub), courier (ShipFast), ad spend and most orders are
simulated. Built for the WeMakeDevs "Flip the Switch" hackathon (deadline 2026-11-07,
23:59 IST).

Read before you start any task:

- `docs/spec.md` — the business: catalogue, order lifecycle, partners, finance, approval gates
- `docs/architecture.md` — components, data model, events
- `api/openapi.yaml` — the store API contract (code must match it)
- `docs/plan.md` — the org (Slack channels, agents, roles) and build order
- `docs/tasks.md` — the task list; work only on tasks assigned to you
- `docs/decisions.md` — decisions already made; don't reopen them without asking

## Stack

- Monorepo with npm workspaces, Node.js 20+, TypeScript everywhere (strict mode)
- `apps/store` — Next.js (App Router), Tailwind, Prisma, Postgres: storefront, admin, REST API
- `apps/sim` — Node.js + Fastify: PayMock, PrintHub, ShipFast, order generator, ad sim, demo clock
- `apps/gatekeeper` — Node.js custom Switch agent (WebSocket agent protocol), no AI
- `packages/shared` — shared types, event names, money helpers
- `packages/sg-cli` — the `sg` command-line tool agents use to call the store API
- Tests: Vitest (unit, API), Playwright (checkout end-to-end)
- Local run: `docker compose up` (store, sim, gatekeeper, postgres)

## Commands

These are the target commands; T-01 creates them. Keep this list in sync with `package.json`.

```bash
npm install                 # install all workspaces
docker compose up -d db     # start Postgres only
npm run db:migrate          # apply Prisma migrations
npm run db:seed             # seed catalogue, partners, demo data
npm run dev                 # store + sim in watch mode
npm run lint                # eslint + prettier check
npm run format              # prettier --write
npm run typecheck           # tsc --noEmit across workspaces
npm test                    # vitest
npm run test:e2e            # playwright
npm run demo:reset          # wipe and reseed to the demo starting point
```

## Coding rules

- Money is always an integer number of **paise** (`amountPaise: number`). Never floats.
  Format to rupees only at the UI edge, with `packages/shared/money.ts`.
- Dates are ISO 8601 strings in UTC in the API and database; display in IST.
- Every state change to an order, payment, print job, shipment or refund goes through a
  service function that also writes an `Event` row (the outbox). No direct table updates
  from route handlers.
- Every ledger write is double-entry and must balance (debits = credits). A failing
  balance check is a bug, never something to work around.
- Validate every API input with zod schemas that mirror `api/openapi.yaml`.
- Partner webhooks are verified with HMAC-SHA256 signatures. Reject unsigned calls.
- Approval gates live in the store, not in agents. If an action is over a limit, the API
  returns `202` with an `approvalId`; never add a bypass.
- Prefer small, boring code. No new dependency without a one-line reason in the PR.
- Names: files `kebab-case.ts`, React components `PascalCase.tsx`, DB tables singular.

## Git and PR rules

- Never push to `main`. One branch per task: `t-07-event-outbox`.
- Commit messages: `T-07: short summary` (imperative, under 72 characters).
- PR title starts with the task ID; the PR description has: what changed, how to test,
  and `Closes T-07` (tasks live in `docs/tasks.md`, not GitHub issues).
- Update the task's status in `docs/tasks.md` in the same PR.
- A PR must pass `lint`, `typecheck` and `test` before review is requested.
- Reviewer and author are always different agents. Only the founder merges to `main`.

## Definition of done

- Acceptance criteria in `docs/tasks.md` are met and demonstrated (test or screenshot).
- Tests added for new logic; existing tests pass.
- API changes are reflected in `api/openapi.yaml`.
- New decisions are appended to `docs/decisions.md`.
- No secrets, no real personal data, no TODOs left without a task ID.

## Safety rules (never break these)

- No real money, real cards, real customer data or real third-party accounts. Ever.
- Only test keys in `.env.example`. Real `.env` files are git-ignored.
- Generated customer names, emails (`@example.com`) and addresses are fake.
- Don't disable tests, lint rules or approval gates to make something pass.
- If a task is unclear or seems to conflict with the spec, stop and ask in `#engineering`.

## Skills

Shared playbooks live in `.agents/skills/<name>/SKILL.md` (Codex reads this folder;
`.claude/skills` links to it for Claude Code). Use the matching skill before starting:

- `implement-task` — picking up and delivering a task from `docs/tasks.md`
- `review-pr` — reviewing another agent's PR
- `run-and-test` — running the stack and tests locally
