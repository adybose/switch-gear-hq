---
name: handle-misprint
description: Handle a misprinted print job: free reprint, tell finance about the cost, tell support. Use on printjob.misprint.
---

# Handle a misprint

1. `sg print-jobs list --status misprinted` and `sg orders get ORD-n`: confirm which
   items and the job ID.
2. `sg print-jobs reprint <job-id>`: a free reprint, one per attempt. The order goes
   back to `printing`.
3. Tell `@finance` (`hand-off`): `ORD-n misprint, reprint job <id>, cost ₹<n> to dispute`.
4. Tell `@support` if a ticket exists, with the new date.
5. Several misprints in a row (a spike) → post the count and SKUs in `#fulfilment` and
   ask `@researcher` or `@builder` only if the cause looks like artwork or code.
   Never switch print partner; that needs the founder.
