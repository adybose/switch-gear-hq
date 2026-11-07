---
name: plan-campaign-and-codes
description: Plan a campaign and create discount codes inside limits, drafting posts. Use when asked for promotion, or on stock.low_blank.
---

# Plan a campaign and codes

1. Check what exists: `sg campaigns list`, `sg discount-codes list`, and the catalogue
   and order totals your key can read.
2. Pick one goal (clear a design, a festival, a new collection) and a channel
   (instagram, google, influencer). Don't promote a design with `stock.low_blank`.
3. Code: `sg discount-codes create CODE --percent <n> --ends <ISO date>`. Up to 20% and
   7 days runs alone. More, or no end date, returns `202`: follow `request-approval`.
4. Campaign: `sg campaigns create --name "<n>" --channel <c> --budget <rupees>`. Within the
   weekly ₹5,000 runs alone; raising the budget needs the founder.
5. Write the post copy as a **draft** in `#marketing`; the founder publishes.
6. On `campaign.result`, report spend, orders and return on ad spend, and tell `@finance`.
