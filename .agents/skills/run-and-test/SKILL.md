---
name: run-and-test
description: Start the Switch Gear stack locally, reset demo data, and run lint, type checks, unit and end-to-end tests. Use before opening or reviewing a PR, or when something needs to be reproduced.
---

# Run and test locally

Prerequisites on the Mac: Docker Desktop running, Node.js 20+, npm.

```bash
cp -n .env.example .env          # first time only; test values only
npm install
docker compose up -d db          # Postgres
npm run db:migrate
npm run db:seed                  # or: npm run demo:reset
npm run dev                      # store http://localhost:3000, sim http://localhost:4000
```

Whole stack in containers instead: `docker compose up --build`.

Checks (all must pass before a PR):

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e                 # needs the stack running
```

Reproducing a bug:

1. `npm run demo:reset` for a known starting state.
2. Use the scenario buttons in the admin console or the `sg` CLI to trigger the case.
3. Write a failing test first, then fix.

If a command here doesn't exist yet, the task that adds it may not be done; check
`docs/tasks.md` and say so instead of inventing a workaround.
