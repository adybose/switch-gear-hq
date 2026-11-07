---
name: handle-return-or-exchange
description: "Handle a return, exchange or refund request: book the pickup and hand the refund to finance. Use when a customer wants to return or swap an item."
---

# Handle a return or exchange

1. `sg orders get ORD-n`: delivered, and within 7 days of delivery? If not, tell the
   customer kindly and ask the founder if there's a reason to bend it.
2. `sg returns create ORD-n --reason size|defect --ticket TCK-n` books the pickup.
3. Refund: `@finance` refunds, not you. Hand off (`hand-off`) with order, amount, reason,
   ticket. For a misprint or defect, a free reprint via `@fulfilment` may be better.
4. Exchange: a return for the old size and a new order by the customer, or a reprint from
   `@fulfilment`; say which in the ticket.
5. Reply to the customer with what happens next and when (`sg tickets reply`). Fulfilment
   handles the returned parcel.
