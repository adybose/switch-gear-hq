---
name: fulfil-paid-order
description: "Send a paid order to PrintHub and book the shipment when printing is done. Use when order.paid mentions you or a paid order has no print job."
---

# Fulfil a paid order

1. `sg orders get ORD-n`: confirm status `paid` (never start before payment is captured).
2. `sg print-jobs create ORD-n`. PrintHub should accept within 1 hour; if it rejects
   (`artwork_rejected`, `blank_out_of_stock`), post in `#fulfilment` and, for blanks, tell
   `@marketing`; bugs go to `@builder`.
3. Watch `printjob.status`. Printing takes about 2 business days; on `printjob.late`
   check `sg print-jobs list` and tell `@support` the new date.
4. When the job is `handed_over`, `sg shipments create ORD-n`. Note the AWB.
5. Post one line: `ORD-n printing → shipped, AWB <awb>`. Delivery is tracked by
   `shipment.status`; `@support` takes over at `delivered`.
