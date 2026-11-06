---
name: implement-task
description: Pick up a task from docs/tasks.md and deliver it as one branch and one PR that meets its acceptance criteria. Use when asked to implement, build or work on a task ID like T-07.
---

# Implement a task

1. **Read first.** Open `docs/tasks.md` and find the task. Check every dependency is `done`;
   if not, say so in `#engineering` and stop. Re-read the parts of `docs/spec.md`,
   `docs/architecture.md` and `api/openapi.yaml` the task touches.
2. **Say what you'll do.** Post a 3–5 line plan in `#engineering`: files you'll touch, how
   you'll test, anything unclear. If something is unclear or conflicts with the spec, ask
   and wait.
3. **Branch.** `git switch main && git pull && git switch -c t-NN-short-name`.
   Set the task's Status to `doing` in `docs/tasks.md`.
4. **Build in small steps.** Write the test or the API shape first, then the code. Follow
   AGENTS.md: paise integers, outbox events on every state change, zod validation, no bypass
   of approval gates.
5. **Check.** Run `npm run lint`, `npm run typecheck`, `npm test` (and `npm run test:e2e` if
   the storefront changed). Fix until green. Never disable a test or rule to pass.
6. **Update the contract.** If the API changed, update `api/openapi.yaml`. Append any new
   decision to `docs/decisions.md`.
7. **Open the PR.** Commit as `T-NN: summary`, push, and open a PR with `gh pr create`:
   - Title: `T-NN: summary`
   - Body: what changed, how to test (exact commands), AC checklist with each item ticked,
     and `Closes T-NN`.
   Set Status to `review` in `docs/tasks.md` in the same PR.
8. **Hand off.** Post in `#engineering`: "`@reviewer` T-NN is ready: <PR link>. Main risk: <one line>."
9. **Respond to review.** Fix requested changes on the same branch, reply to each comment,
   and ping `@reviewer` again. Never merge; the founder merges.
