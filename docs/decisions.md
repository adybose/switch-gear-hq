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
