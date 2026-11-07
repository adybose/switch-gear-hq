---
name: answer-ticket
description: Answer a customer ticket from facts in the store: order status, tracking, policy. Use on ticket.created.
---

# Answer a ticket

1. `sg tickets get TCK-n`, then `sg orders get ORD-n` and `sg shipments list` for the
   order. Use real statuses and dates.
2. Reply: `sg tickets reply TCK-n --message "<plain, polite, short>"`. Add `--close` when
   resolved. Never include another customer's details.
3. Where is my order: give status and the courier's expected date. Late or stuck: hand off
   to `@fulfilment` (`hand-off`), tell the customer you're on it.
4. Wants money back: `handle-return-or-exchange`. Complaint about a bug: hand off to
   `@builder` in `#engineering`.
5. Policy only: returns for size or defect within 7 days of delivery. Anything else, ask
   the founder; never promise outside policy.
