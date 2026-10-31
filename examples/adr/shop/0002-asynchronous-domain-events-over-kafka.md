---
status: accepted
date: 2025-04-22
decision-makers: Platform team
consulted: Checkout team
---

# Publish domain events to Kafka for asynchronous work

## Context and Problem Statement

Several things happen after an order is placed: confirmation e-mails, stock updates, analytics.
Calling every consumer synchronously makes checkout slow and fragile. How do services react to
each other's changes?

## Decision Drivers

* Checkout latency must not depend on consumers such as notifications.
* New consumers should be added without changing the producer.
* Events must not get lost when a consumer is down.

## Considered Options

* Domain events on Kafka topics (the Event Bus)
* Synchronous REST calls from the producer
* A database outbox polled by each consumer

## Decision Outcome

Chosen option: "Domain events on Kafka topics", because consumers are decoupled from producers and
can replay events after an outage.

### Consequences

* Good, because checkout no longer waits for e-mails.
* Good, because new consumers subscribe to existing topics.
* Bad, because flows become eventually consistent and harder to trace; every event carries a
  correlation ID.

### Confirmation

Producers publish through a shared library that adds the correlation ID; contract tests check the
event schemas.
