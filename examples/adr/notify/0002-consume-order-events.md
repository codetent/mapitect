---
status: accepted
date: 2025-05-06
decision-makers: Checkout team
---

# Send notifications from order events

## Context and Problem Statement

With order events on the Event Bus (see [orders/0003](../orders/0003-publish-order-events.md)),
the Notification Service no longer needs to be called by the Order Service.

## Decision Outcome

The Notification Service consumes `order.placed` and `order.paid` and sends the matching e-mails.
The synchronous endpoint stays for back-office actions only.

### Consequences

* Good, because e-mail problems no longer affect checkout.
* Bad, because e-mails can arrive a few seconds after the order page shows success.
