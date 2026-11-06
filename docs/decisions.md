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
