---
name: handle-failed-delivery
description: Handle a failed or lost shipment: let retries run, then reship or refund via the right owners. Use on shipment.failed or shipment.rto.
---

# Handle a failed delivery

1. `sg shipments list --status failed` and `sg orders get ORD-n`. ShipFast retries a failed
   delivery twice; wait for those. A lost parcel (`reason lost`) or an RTO needs action.
2. Reship: `sg shipments reship <id>`. One reship per order is free to run. A second returns
   `202`: follow `request-approval`.
3. Refund instead (customer prefers it, or reship isn't sensible): hand off to `@finance`
   with order, amount and reason (`hand-off`).
4. Tell `@support` the outcome so the customer hears it.
5. RTO costs the shipping price again; mention it to `@finance`.
