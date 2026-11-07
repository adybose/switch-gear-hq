# Switch Gear — Business Spec

Source: the "Switch Gear — T-shirt Store Business Spec" doc. This file is the version agents read.
All brand names are fictional. Nothing here moves real money or touches real people.

## 1. Overview

Switch Gear is a one-founder brand from Bangalore selling printed T-shirts online across India.
The founder sets direction and approves risky actions; AI agents, organised into departments in
Switch (Slack), run the rest.

| Area | Real | Simulated |
| --- | --- | --- |
| Website | Public storefront, cart, checkout, order tracking, admin console | — |
| Orders | Orders placed through checkout | Extra orders from the order generator |
| Payments | Payment, refund and webhook flows in code | PayMock gateway; no real money |
| Printing | Print jobs created and tracked | PrintHub mock API with delays and defects |
| Delivery | Shipments, tracking numbers, status pages | ShipFast mock API with transit times and failures |
| Finance | Ledger, GST invoices, payouts, P&L | Bank balance and payouts are ledger entries |
| Marketing | Post drafts, discount codes | Ad spend and results from a simulator |
| Code | Real GitHub repo, PRs, CI | — |

## 2. Catalogue and pricing

12 designs in 4 collections, printed on demand (no stock held). Prices in INR, GST included.

| Collection | Designs | Example |
| --- | --- | --- |
| Namma Bengaluru | 3 | "Silk Board Survivor" |
| Dev Humour | 4 | "It works on my machine" |
| Kaapi Culture | 3 | "Powered by filter coffee" |
| Basics | 2 | Plain tee with a small logo |

- Sizes: XS, S, M, L, XL, XXL. Colours: black, white, navy, heather grey, olive.
- SKU: `SG-<DESIGN>-<FIT>-<COLOUR>-<SIZE>`, e.g. `SG-SILKBOARD-OVR-BLK-L`.

| Fit | Price incl. 5% GST | Before GST | PrintHub cost | Gross margin |
| --- | --- | --- | --- | --- |
| Classic (180 GSM) | ₹599 | ₹570 | ₹260 | ₹310 |
| Oversized (220 GSM) | ₹799 | ₹761 | ₹340 | ₹421 |
| Premium (240 GSM) | ₹999 | ₹951 | ₹420 | ₹531 |

- Shipping: free at ₹999 or more (goods after discounts), else ₹79.
- Any 3 tees: 10% off automatically. It doesn't stack with a discount code; the bigger discount applies.
- Discount codes: up to 20% off for up to 7 days without approval.
- Prepaid only (cash on delivery is a stretch goal).

## 3. Storefront and admin

Storefront (public, mobile-first, banner "Demo store. No real payments or deliveries."):
home, collection, product, cart, checkout (PIN code check, mock payment), order confirmation
with GST invoice link, track order (order number + email), returns and help, policy pages.

Admin console (login): orders, catalogue, fulfilment, finance, marketing, approvals queue.

Agents never scrape the website. They use the REST API (via the `sg` CLI) with one API key
per department; each key can call only its department's endpoints.

## 4. Order lifecycle

`placed → paid → printing → shipped → delivered`

| State | Owner | Moves on when | Timer |
| --- | --- | --- | --- |
| placed | Engineering (checkout) | PayMock confirms payment | Cancelled after 30 min unpaid (never sooner than 5 real minutes) |
| paid | Fulfilment | PrintHub accepts the print job | Within 1 hour |
| printing | Fulfilment | PrintHub hands the parcel to ShipFast | 2 business days |
| shipped | Fulfilment | ShipFast confirms delivery | 1–5 days by zone |
| delivered | Support | Return window closes | 7 days |

Exceptions:

- Payment failed → `cancelled`.
- Misprint → free reprint, back to `printing`.
- Delivery failed → 2 retries, then return to origin (RTO) → reship or refund.
- Return request (size or defect, within 7 days) → parcel returns → refund + credit note.
- Customer may cancel for a full refund until printing starts.

## 5. Partners (simulated)

| | PrintHub (print-on-demand) | ShipFast (courier) |
| --- | --- | --- |
| Create | `POST /print-jobs` (order ID, SKUs, artwork URL, ship-to) | `POST /shipments` (pickup, drop, weight) → AWB |
| Statuses | received → in_production → quality_check → packed → handed_over | pickup_scheduled → picked_up → in_transit → out_for_delivery → delivered |
| Failures | artwork_rejected, misprint (3% of items), blank_out_of_stock | delivery_failed (≤2 retries), returned_to_origin, lost (0.5%) |
| Service level | 2 business days; 50 jobs/day | 1 day same city, 3 same zone, 5 rest of India |
| Price | Per tee (see catalogue) | ₹50 same city, ₹65 same zone, ₹85 national; RTO costs the same again |
| Billing | Weekly invoice, pay within 7 days | Weekly invoice, pay within 7 days |

Both send HMAC-signed webhooks for every status change. PIN codes ShipFast doesn't serve are
blocked at checkout.

## 6. Payments and finance

PayMock: payment `created → captured | failed` (customer picks success/failure/pending on the
mock page; pending resolves within 5 minutes). Fee 2% + 18% GST on the fee. Settlement T+2.
Full and partial refunds. Signed webhooks. Can be swapped for Razorpay/Stripe test mode later.

Finance owns:

- GST tax invoice per order: HSN 6109, dummy GSTIN, CGST + SGST inside Karnataka, IGST elsewhere.
- Refunds through PayMock + a credit note against the invoice.
- Weekly partner payouts after checking invoices against the app's records.
- Settlement reconciliation (orders, fees, refunds).
- GST tracking: output GST on sales, input GST on partner invoices; monthly summary shaped like
  GSTR-1/3B (no filing).
- Reports: daily P&L, cash position, cost per order, refund rate, ad spend vs revenue.

Ledger accounts: Bank, Gateway receivable, Sales, Shipping income, Discounts, Refunds, Print
costs, Shipping costs, Gateway fees, Marketing spend, GST output payable, GST input credit,
PrintHub payable, ShipFast payable.

Tax assumptions (simulation, not tax advice): tees up to ₹2,500 a piece at 5% GST, above at 18%
(₹2,500 is the pre-GST value per piece after discounts, i.e. up to ₹2,625 including 5% GST);
the shipping fee is taxed at the tee's rate (the highest rate in the cart if rates differ); partner invoices carry 18% GST, claimed as input credit.

## 7. Departments

| Department | Owns | Measured by |
| --- | --- | --- |
| Founder | Direction, budgets, approvals | Profit, customer rating |
| Engineering | Website, admin, API, simulators, CI, uptime | Uptime, checkout success, time to fix |
| Fulfilment | Paid orders → delivered parcels; PrintHub and ShipFast | Order-to-delivery time, on-time rate, misprint rate |
| Finance | Payments, refunds, invoices, payouts, GST, books | Books balanced daily, days to refund, margin per order |
| Marketing | Campaigns, posts, ads, discount codes | Return on ad spend, cost per order, conversion |
| Support | Tickets, returns, exchanges, complaints | First response, resolution time, satisfaction |

Dependencies: Fulfilment starts only after payment is captured. Finance pays a partner only
after Fulfilment confirms the work. Support requests refunds; Finance executes them; Fulfilment
handles returned parcels. Every department sends bugs to Engineering.

## 8. Approval gates (enforced by the store API)

| Action | Agents alone | Needs founder approval |
| --- | --- | --- |
| Refund | ≤ ₹1,000, or any order cancelled before printing | > ₹1,000, or a 2nd refund to the same customer in 30 days |
| Reship | 1 per order | A 2nd reship |
| Partner payout | Invoice within ₹100 of records | Larger mismatch, or any payout > ₹25,000 |
| Discount code | ≤ 20% off, ≤ 7 days | > 20%, or no end date |
| Ad spend | Within weekly budget (₹5,000) | Any budget increase |
| Price change | Never | Always |
| New design | Draft only | Publishing |
| Code merge to main | Never | Always |
| Production deploy | Rollback to last good version during an incident | Every other deploy |
| Switching partners | Never | Always |

Standing rules: no real money, data or accounts; test data only; when unsure, ask the founder;
every action leaves a trail (department, record, reason).

## 9. Simulation

| Simulator | Produces | Defaults |
| --- | --- | --- |
| Clock | Business time | Real time, or demo speed (1 business day = 10 min) |
| Orders | Fake customers ordering through the checkout API | ~30/day; mix follows campaigns |
| Payments | Gateway outcomes | 95% success, 4% failure, 1% pending |
| PrintHub / ShipFast | Progress and failures | Rates in section 5 |
| Ads | Spend → clicks → orders | Instagram, Google, influencer channels |
| Customers | Support tickets | WISMO 10%, exchanges 4%, returns 5%, complaints 2% |

Scenario buttons: misprint spike (8 orders), courier disruption (North India, 2 days), gateway
outage (15 min), viral post (5× one design), checkout bug (feature flag breaks discount field),
invoice mismatch (PrintHub bills 3 jobs it never printed). `npm run demo:reset` restores the seed.

## 10. Business events

| Event | Owner | Also told |
| --- | --- | --- |
| `order.paid` | Fulfilment | Finance |
| `payment.failed` | Support | Engineering if spiking |
| `order.cancelled` (not paid within 30 min) | Support | — |
| `printjob.status` | Fulfilment | — |
| `printjob.misprint` | Fulfilment | Finance |
| `printjob.late` | Fulfilment | Support |
| `shipment.delivered` | Support | Finance |
| `shipment.failed`, `shipment.rto` | Fulfilment | Support, Finance |
| `ticket.created` | Support | — |
| `refund.requested` | Finance | Founder if above limit |
| `invoice.received` | Finance | Fulfilment |
| `settlement.received` | Finance | — |
| `campaign.result` | Marketing | Finance |
| `stock.low_blank` | Fulfilment | Marketing |
| `checks.failed`, `site.down` | Engineering | Founder if site down |
| `approval.requested` | Founder | Requesting department |
| `report.daily` | Founder (via Chief of Staff) | All |

## 11. Scorecard

Orders, revenue, gross margin, on-time delivery rate, refund rate, return on ad spend, open
tickets, uptime.
