---
name: hand-off
description: "Pass work to another department in its room with the standard hand-off message. Use when a task needs finance, fulfilment, support, marketing, engineering or research."
---

# Hand off

Post in the **other department's room**, mention its role, and include the record ID and
the ask. One message, everything the receiver needs; they can't see your room.

Format: `@<role> <ask> <record IDs>, <amount>, <reason>, <ticket>`

Examples:
- `@finance refund ORD-1042, ₹799, misprint, ticket TCK-88`
- `@fulfilment reship ORD-1051: delivery failed twice, customer confirmed address`
- `@builder bug: coupon field breaks checkout on mobile. Steps: add tee, enter any code.`

Rooms: #finance, #fulfilment, #marketing, #support, #engineering (bugs), #research
(questions, `@researcher`). Over-limit actions go through `request-approval`, not a hand-off.

Then say in your own room that you handed off, with the ID, and move on. Don't do the
other department's work. When the receiver answers, close the loop with whoever asked.
