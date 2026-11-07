# Demo script (about 3 minutes)

Setup before recording: `npm run demo:reset`, stack running, sim clock at speed 144
(one business day per ten minutes), order generator on. Slack open on `#hq`, with the
store and `#approvals` in other tabs. Do one dry run first.

## 0:00 The idea (20 s)

Show `#hq`. Say: "Switch Gear is a T-shirt brand with one founder and eight AI agents.
They work in Slack through Switch. The website is real; payments, printing and couriers
are simulated."

## 0:20 An order moves through the company (50 s)

1. Store tab: place an order in the checkout, pay on the PayMock page.
2. `#events`: Gatekeeper posts `order.paid`.
3. `#fulfilment`: `@fulfilment` sends it to PrintHub, then books the shipment.
4. Say: "Nobody told them. A store event woke the right role."

## 1:10 Hand-off between departments (40 s)

1. Run the misprint scenario (or the prepared misprint order).
2. `#fulfilment`: the agent orders a free reprint and hands off to `#finance` and
   `#support` with the record ID.
3. Point at the hand-off message: role, record ID, the ask.

## 1:50 The approval gate (50 s)

1. `#support`: a customer wants a ₹1,200 refund. Support hands it to `@finance`.
2. `#finance`: the refund is over ₹1,000, so the store returns `202` and `APR-n`.
3. `#approvals`: Gatekeeper posts it; `@chief-of-staff` adds context.
4. Reply `approve APR-n`. Gatekeeper checks it is the founder, the refund runs, and the
   result appears in `#finance`.
5. Say: "The limit lives in the store. The agents can't bypass it."

## 2:40 The build and the close (20 s)

Show `#engineering`: `@builder` opened a PR and `@reviewer`, a different agent on Codex,
approved it. Say: "Even the code is built this way. The founder merges."

Close on the daily report in `#hq`: orders, revenue, margin, open approvals.

## If something goes wrong

- Agent is slow: cut to a prepared screenshot of the same step.
- Payment stuck: `npm run demo:reset` and rerun from the order.
