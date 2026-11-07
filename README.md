# Switch Gear HQ

A T-shirt store from Bangalore, run by AI agents in Slack through
[Switch](https://docs.switchagents.ai/). One founder sets direction and approves risky
actions. Eight AI agents, one per department, do the rest. Built for the WeMakeDevs
"Flip the Switch" hackathon.

> Demo store. No real payments, printing or deliveries. Payments, PrintHub (printing),
> ShipFast (courier), ads and most orders are simulated. All customers are fake.

## The idea

The website is real: storefront, checkout, order tracking, admin and a REST API. Around it,
agents run the business the way a small company would: fulfilment sends paid orders to the
printer, finance refunds and pays partners, support answers customers, marketing runs
campaigns, engineering fixes bugs. The founder only approves what is over a limit.

## How Switch is used

- **Rooms.** Each Slack channel is a Switch room: `#hq`, `#approvals`, `#engineering`,
  `#fulfilment`, `#finance`, `#marketing`, `#support`, `#research`, `#events`.
- **Roles.** Each agent holds one role (`@fulfilment`, `@finance`, ...). Work is addressed to
  the role. Role files are in `agents/`, room files in `rooms/`, shared playbooks in
  `.agents/skills/`. Claude Code and Codex agents work side by side.
- **Hand-offs.** One department asks another in its room: `@finance refund ORD-1042, ₹799,
  misprint, TCK-88`. Room links keep the paths short (support to finance, everyone to
  engineering).
- **Approvals.** The store, not the agents, enforces limits. An over-limit action returns
  `202` with `APR-n`. Gatekeeper posts it in `#approvals`; the founder replies
  `approve APR-7` or `reject APR-7 <reason>`. No agent can approve.
- **Custom agent.** Gatekeeper (`apps/gatekeeper`) is a Node.js agent with no AI. It turns
  store events into room messages, wakes the right role, and checks that approvals come
  from the founder's account.
- **One template.** `switch/switch-gear-hq.template.yaml` creates the agents, channels and
  links in one run.

Every agent is limited three ways: its role instructions, its department API key (used
through the `sg` CLI), and the store's approval gates.

## What is in the repo

- `apps/store`: Next.js storefront, admin and REST API (`api/openapi.yaml`)
- `apps/sim`: PayMock, PrintHub, ShipFast, order generator, demo clock
- `apps/gatekeeper`: the custom Switch agent
- `packages/shared`, `packages/sg-cli`: shared types and the `sg` command
- `docs/`: spec, architecture, plan, tasks, decisions

## Run it

Needs Node.js 20+ and Docker.

```bash
cp .env.example .env        # test values only
docker compose up           # db, store (3000), sim (4000), gatekeeper (4100)
```

Or for development:

```bash
npm install
docker compose up -d db
npm run db:migrate && npm run db:seed
npm run dev                 # store + sim in watch mode
```

- Store: <http://localhost:3000>. Founder login is in `.env.example`.
- Sim controls (clock speed, order generator): <http://localhost:4000/sim/admin>.
- `npm run demo:reset` wipes the data and restores the demo starting point.
- Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`.

To bring up the agent org, run the Switch template after setting up the worktrees and
department `.env` files; the header of the template lists the steps. Gatekeeper needs its
Switch registration; without it, it runs health-only.

## Demo

[`docs/demo-script.md`](docs/demo-script.md): a 3-minute walkthrough.

## Project docs

`docs/spec.md` (the business), `docs/architecture.md`, `docs/plan.md` (the org),
`docs/tasks.md`, `docs/decisions.md`. Contributor and agent rules: `AGENTS.md`.
