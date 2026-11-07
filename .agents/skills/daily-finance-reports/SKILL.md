---
name: daily-finance-reports
description: Produce the daily P&L, GST summary and settlement check. Use for report.daily, month end, or when asked for the numbers.
---

# Daily finance reports

1. `sg reports pnl --date <YYYY-MM-DD>`: revenue, costs, gross margin.
2. `sg ledger --from <date> --to <date>`: the books must balance. If they don't, stop and
   report a bug in `#engineering`.
3. Settlement: compare `settlement.received` with the day's captured payments, fees and
   refunds; list any difference.
4. Month end: `sg reports gst --month <YYYY-MM>` (output GST, input credit, net payable).
   Simulation only, not tax advice, no filing.
5. Post a short summary in `#finance` for `@chief-of-staff`: revenue, margin, refund rate,
   cost per order, anything odd.
