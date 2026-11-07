# Demo script (about 3 minutes)

Setup before recording: `npm run demo:reset`, stack running, sim clock at speed 144
(one business day per ten minutes), order generator on. Slack open on `#hq`, with the
store and `#approvals` in other tabs. Do one dry run first.

## 0:00 The idea (20 s)

Show `#hq`. Say: "Switch Gear is a T-shirt brand with one founder and eight AI agents.
They work in Slack through Switch. The website is real; payments, printing and couriers
are simulated."

## 0:20 An order moves through the company (50 s)

Live: place an order in the checkout and pay on the PayMock page, then show `#events`
and `#fulfilment` reacting to `order.paid`.

Pre-staged: PrintHub takes about 1.9 business days (about 19 real minutes at 144×), so
the order will not ship live. Before recording, place an order and let it run, then cut to
that order's printed and shipped state. Say: "Nobody told them. A store event woke the
right role."

## 1:10 Hand-off between departments (40 s)

Pre-staged: run the misprint scenario (T-27 buttons) or use a misprinted print job
prepared ahead. Show `#fulfilment` ordering a free reprint and handing off to `#finance`
and `#support` with the record ID. Point at the hand-off message: role, record ID, the ask.

## 1:50 The approval gate (50 s)

Live: an over-limit action returns `202` with `APR-n`; Gatekeeper posts it in
`#approvals`, `@chief-of-staff` adds context, and you reply `approve APR-n`.
Gatekeeper checks it is the founder and confirms with the store.

Pending: refund execution (T-18), the ledger (T-16) and the admin console approvals queue
(T-12) are not on main yet. Until they are, use a gate that works today, or show a
pre-recorded refund. Say: "The limit lives in the store. The agents can't bypass it."

## 2:40 The build and the close (20 s)

Show `#engineering`: `@builder` opened a PR and `@reviewer`, a different agent on Codex,
approved it. Say: "Even the code is built this way. The founder merges."

Close on the daily report in `#hq` (pending T-16 and T-20): orders, revenue, margin, open approvals.

## Preparation

- `npm run demo:reset`, then seed and start the stack; clock at 144×, generator on.
- Place and pay one order about 20 minutes before recording, so it is printed and shipped.
- Prepare the misprint order and the over-limit action for the approval step.
- Close on the daily report only once T-16 and T-20 land; until then skip it.

## If something goes wrong

- Agent is slow: cut to a prepared screenshot of the same step.
- Payment stuck: `npm run demo:reset` and rerun from the order.
