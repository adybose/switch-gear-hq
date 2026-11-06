# Switch Gear — Org and Build Plan

Source: the "Switch Gear — Org and Build Plan" doc. This file is the version agents read.

## Slack channels (each one is a Switch room)

Free Slack workspace "Switch Gear". Agent name autocomplete is OFF (paid-only feature).

| Channel | Department | Purpose | Agents |
| --- | --- | --- | --- |
| `#hq` | Founder's office | Founder sets goals; daily company report | `@chief-of-staff` |
| `#approvals` | Founder's office | Every action above a limit waits for the founder | `@chief-of-staff`, `@gatekeeper` |
| `#engineering` | Engineering | Tasks, bugs, PRs, reviews, deploys, incidents | `@builder`, `@reviewer` |
| `#fulfilment` | Fulfilment | Print jobs, shipments, misprints, failed deliveries | `@fulfilment` |
| `#finance` | Finance | Refunds, invoices, payouts, settlements, GST, P&L | `@finance` |
| `#marketing` | Marketing | Campaigns, posts, discount codes, ad budget | `@marketing` |
| `#support` | Customer Support | Tickets, returns, exchanges, order tracking | `@support` |
| `#events` | All (read-only) | Every store event, in order; nobody replies | `@gatekeeper` posts |

Room links: `#support → #finance` (refunds), `#support → #fulfilment` (delivery issues),
every room → `#engineering` (bugs), every room → `#approvals` (over-limit actions).

## Agents (each holds a Switch role; work is addressed to the role)

| Agent | Role | Runs on | Home | Never does |
| --- | --- | --- | --- | --- |
| Chief of Staff | `@chief-of-staff` | Claude Code | `#hq`, `#approvals` | Approve anything; do another department's work |
| Builder | `@builder` | Claude Code | `#engineering` | Merge to main or deploy without approval |
| Reviewer | `@reviewer` | Codex | `#engineering` | Write the feature it reviews |
| Fulfilment Lead | `@fulfilment` | Codex | `#fulfilment` | Refund; pay partners |
| Finance Controller | `@finance` | Claude Code | `#finance` | Change prices; pay above its limit |
| Marketing Lead | `@marketing` | Claude Code | `#marketing` | Raise budget or publish designs without approval |
| Support Agent | `@support` | Codex | `#support` | Refund directly; promise outside policy |
| Gatekeeper | `@gatekeeper` | Custom Node.js, no AI | `#events` | Make decisions |

Three limits on every agent: role instructions (`agents/<role>/AGENTS.md`; builder and reviewer: `agents/external/<role>/AGENTS.md`), its department API key,
and the store's approval gates.

## Where agents run (founder's MacBook, via Switch Console)

| Agent | Working folder | Tools |
| --- | --- | --- |
| Builder | `~/repos/switch-gear-hq-worktrees/builder` (git worktree) | git, gh, npm, docker |
| Reviewer | `~/repos/switch-gear-hq-worktrees/reviewer` (git worktree) | git, gh, test runner |
| Fulfilment, Finance, Marketing, Support | `~/repos/switch-gear-hq/agents/<role>/` | `sg` CLI with that department's key |
| Chief of Staff | `~/repos/switch-gear-hq/agents/chief-of-staff/` | `sg` read-only across departments |
| Gatekeeper | Docker container `gatekeeper` | Switch agent protocol, founder key |
| Store, sim, db | Docker Compose, `localhost:3000` | — |

What wakes an agent: a store event (Gatekeeper mentions the role), an @mention, or a timer
(daily report, weekly partner invoices). Agents act only when addressed.

Hand-off format: post in the other room, mention the role, include the record ID and the ask.
Example: `@finance refund ORD-1042, ₹799, misprint, ticket TCK-88`.

Approval flow:

1. Agent asks the store for an over-limit action → store returns `202` with `APR-<n>`.
2. Gatekeeper posts it in `#approvals` mentioning the founder; Chief of Staff adds context.
3. Founder replies `approve APR-7` or `reject APR-7 <reason>`.
4. Gatekeeper verifies the reply came from the founder's Slack account, then confirms with the founder key.
5. Store executes; Gatekeeper posts the result in the requesting room.

## Build order (target: done by 2026-11-07 21:00 IST)

1. Setup: Slack workspace, Switch Console quickstart, connect Slack (autocomplete off), GitHub repo.
2. Planning files: spec, architecture + OpenAPI, AGENTS.md/CLAUDE.md, tasks, engineering skills.
3. Store core: skeleton, schema + seed, storefront, checkout + PayMock, tracking, admin, API keys, approval gates, event outbox.
4. Partners and money: PrintHub, ShipFast, order generator, demo clock, ledger, invoices, refunds, payouts, P&L, `sg` CLI.
5. Switch org live: Gatekeeper, role + room files, business skills, Switch template, 8 channels, 7 AI agents onboarded.
6. Scenarios + rehearsal: misprint spike, checkout bug, invoice mismatch; two full demo runs.
7. Submit: README, 3–5 min demo video, submission; optional blog and #HowISwitch post.

From step 3 on, run Builder and Reviewer from `#engineering` so the build itself is demo footage.

If time runs short, cut in order: ad simulator → Support Agent (Chief of Staff covers) → public
deploy. Never cut Gatekeeper or approvals.
