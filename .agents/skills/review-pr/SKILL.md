---
name: review-pr
description: Review another agent's pull request against its task, the spec and AGENTS.md, then approve or request changes. Use when mentioned to review a PR or task ID.
---

# Review a pull request

You never review your own code. If the PR author is you, say so and stop.

1. **Get context.** `gh pr view <n>` and `gh pr diff <n>`. Find the task in `docs/tasks.md`
   and read its acceptance criteria. Skim the spec sections it touches.
2. **Run it.** `gh pr checkout <n>`, then `npm install`, `npm run lint`, `npm run typecheck`,
   `npm test` (and `npm run test:e2e` for storefront changes). Note any failure exactly.
3. **Check, in this order:**
   1. Each acceptance criterion is actually met (not just claimed).
   2. Correctness: money in paise, GST split, ledger balances, status transitions match
      `docs/spec.md` §4, events written for every state change.
   3. Security: approval gates can't be bypassed, scopes enforced, webhook signatures
      verified, no secrets or real personal data, inputs validated.
   4. Contract: matches `api/openapi.yaml`; the file is updated if the API changed.
   5. Tests: new logic has tests, including the failure path and limit boundaries.
   6. Simplicity: no unneeded dependencies or dead code.
4. **Write the review** with `gh pr review <n>`:
   - `--request-changes` with a numbered list: file:line, what's wrong, what to do.
   - `--approve` only if everything above passes. Comment what you verified and how.
5. **Report in `#engineering`:**
   - Changes needed: "`@builder` T-NN needs changes: <count> items, top one: <one line>."
   - Approved: "T-NN approved; ready for the founder to merge: <PR link>." Then the founder
     merges (merging to main always needs the founder).
