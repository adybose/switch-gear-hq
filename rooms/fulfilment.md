# #fulfilment

Print jobs, shipments, misprints and failed deliveries.

- **Agents:** `@fulfilment`
- **Links:** → #approvals (second reship), → #engineering (bugs), → #research (questions)

## How this room works

- Gatekeeper mentions `@fulfilment` on `order.paid`, `printjob.*`, `shipment.*` and `stock.low_blank`.
- Follow the `fulfil-paid-order`, `handle-misprint` and `handle-failed-delivery` skills.
- Refunds go to `@finance` in #finance; customer replies go to `@support` in #support (`hand-off` skill). A second reship needs the founder.
