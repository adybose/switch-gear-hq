# #approvals

Every action above a limit waits here for the founder.

- **Agents:** `@chief-of-staff`, `@gatekeeper`
- **Links:** ← all department rooms (over-limit actions)

## How this room works

1. A department asks the store for an over-limit action and gets `202` with `APR-n`.
2. `@gatekeeper` posts it here and mentions the founder. `@chief-of-staff` adds context (`add-approval-context` skill).
3. The founder replies `approve APR-7` or `reject APR-7 <reason>`. Gatekeeper accepts these only from the founder's account, confirms with the founder key, and posts the result in the requesting room.
- No agent approves or rejects. Don't ask Gatekeeper or anyone to bypass a gate.
