---
name: request-approval
description: "Handle an action that is over a limit: the store returns 202 with an APR id; report it and wait for the founder. Use whenever an sg command answers 202 or an action looks above a limit."
---

# Request approval

Approval gates live in the store (`docs/spec.md` §8). You can't bypass or self-approve.

1. Run the `sg` command as normal. If it answers `202` with `APR-n`, the action has **not**
   happened.
2. Post in your room: what you asked for, the record ID, the `APR-n`, and why it is over
   the limit. Example: `Refund ORD-1042 ₹1,500 is over the ₹1,000 limit. Waiting on APR-7.`
3. Gatekeeper posts it in `#approvals`; the founder replies `approve APR-n` or
   `reject APR-n <reason>`. Gatekeeper then posts the result in your room.
4. Don't retry, split the amount, or try another route to get around the gate.
   Your key can't read approvals; Gatekeeper posts the founder's decision in your room.
5. On approval, take the outcome from Gatekeeper's message and the record your key can read, and
   tell whoever asked. On rejection, tell them the reason and stop.
