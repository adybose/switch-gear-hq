---
name: issue-refund
description: "Issue a refund through PayMock with a credit note, within limits. Use on refund.requested or a hand-off asking for a refund."
---

# Issue a refund

1. Take the order, amount, reason and ticket from the hand-off (your key can't read
   orders; if something is missing, ask the requester in their room). The store checks
   the amount against what was paid and applies the refund gates.
2. `sg refunds create ORD-n --amount <rupees> --reason "<reason>" --ticket TCK-n`.
3. If it answers `202` (over ₹1,000, or a 2nd refund in 30 days), follow `request-approval`.
   An order cancelled before printing is always allowed.
4. When processed, the credit note is against the invoice: `sg invoices get <INV>`.
   Tell the requester (usually `@support`) the amount and date so they can reply to the customer.
5. A refund you think is wrong, or an unbalanced ledger, goes to the founder or
   `#engineering`; don't adjust around it.
