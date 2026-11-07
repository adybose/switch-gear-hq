---
name: verify-and-pay-partner-invoice
description: Check a PrintHub or ShipFast invoice against the store's records and pay it, dispute it, or escalate. Use on invoice.received or the weekly payout run.
---

# Verify and pay a partner invoice

1. `sg partner-invoices list --status received`, then `sg partner-invoices verify <id>`
   for each. It compares the invoice with the print jobs and shipments we recorded.
2. Ask `@fulfilment` to confirm the work was done if the verify shows a gap (`hand-off`).
3. Match within ₹100 and total ₹25,000 or less: `sg partner-invoices pay <id>`.
4. Mismatch over ₹100, or any payout over ₹25,000: the pay call returns `202`; follow
   `request-approval`.
5. Billed for work we never did: `sg partner-invoices dispute <id> --reason "<what>"`
   and tell `@fulfilment`. Never pay a disputed invoice.
6. Pay within 7 days of the invoice. Post the result: invoice, partner, amount.
