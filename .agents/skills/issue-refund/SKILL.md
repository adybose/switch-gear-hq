---
name: issue-refund
description: Issue a refund through PayMock with a credit note, within limits. Use on refund.requested or a hand-off asking for a refund.
---

# Issue a refund

1. `sg orders get ORD-n` and `sg refunds list`: confirm the order was paid, the amount
   isn't more than paid, and whether the customer had a refund in the last 30 days.
2. `sg refunds create ORD-n --amount <rupees> --reason "<reason>" --ticket TCK-n`.
3. If it answers `202` (over ₹1,000, or a 2nd refund in 30 days), follow `request-approval`.
   An order cancelled before printing is always allowed.
4. When processed, the credit note is against the invoice: `sg invoices get <INV>`.
   Tell the requester (`@support`) the amount and date so they can reply to the customer.
5. A refund you think is wrong, or an unbalanced ledger, goes to the founder or
   `#engineering`; don't adjust around it.
