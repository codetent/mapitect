---
status: accepted
date: 2025-05-06
decision-makers: Checkout team
consulted: Platform team
---

# Publish order events instead of calling consumers

## Context and Problem Statement

[0002](0002-notify-customers-synchronously.md) tied checkout to the Notification Service, and more
consumers (stock, analytics) want to know about orders. How does the Order Service tell them?

## Considered Options

* Publish `order.placed`, `order.paid` and `order.cancelled` to the Event Bus
* Keep calling every consumer synchronously

## Decision Outcome

Chosen option: "Publish order events to the Event Bus" (see [shop/0002](../shop/0002-asynchronous-domain-events-over-kafka.md)).
Events are written in the same transaction as the order (outbox) and relayed to Kafka.

### Consequences

* Good, because checkout no longer depends on e-mail delivery.
* Good, because new consumers subscribe without changes to the Order Service.
* Bad, because the outbox relay is one more component to monitor.
