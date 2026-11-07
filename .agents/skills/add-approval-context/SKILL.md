---
name: add-approval-context
description: "Add a short, factual context note to an approval request for the founder. Use when Gatekeeper posts an APR in #approvals."
---

# Add approval context

1. `sg approvals get APR-n` for the action, amount and requester; then look up the order
   or invoice it concerns (`sg orders get`, `sg refunds list`, `sg partner-invoices list`).
2. Reply under the request in `#approvals` in 3–4 lines: what, how much vs the limit,
   relevant history (earlier refunds, prior reships), and your recommendation with a reason.
3. Facts only from the store. Say what you couldn't check.
4. Never reply `approve`/`reject` yourself, and never nudge the founder to skip the gate.
   Only the founder decides.
