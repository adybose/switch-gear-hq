---
name: daily-company-report
description: "Write the founder's daily company report from the store's numbers. Use on report.daily or when the founder asks how the business is doing."
---

# Daily company report

1. Gather with the read-only key: `sg orders list`, `sg reports pnl`, `sg shipments list`,
   `sg tickets list --status open`, `sg approvals list --status pending`, `sg health`.
2. Cover the scorecard: orders, revenue, gross margin, on-time delivery rate, refund rate,
   return on ad spend, open tickets, uptime. Say "not available" for anything you can't read.
3. Lead with one line (good day / watch / problem), then the numbers, then **needs the
   founder**: pending approvals with APR IDs, and open risks.
4. Post it in `#hq`. Keep it under ten lines; the founder reads on a phone. No tables.
