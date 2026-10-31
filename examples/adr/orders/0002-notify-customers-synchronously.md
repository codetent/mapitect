---
status: superseded by 0003
date: 2025-03-18
decision-makers: Checkout team
---

# Call the Notification Service synchronously after checkout

## Context and Problem Statement

Customers expect a confirmation e-mail right after ordering. How does the Order Service trigger it?

## Considered Options

* Call the Notification Service synchronously at the end of checkout
* Publish an event and let the Notification Service react

## Decision Outcome

Chosen option: "Call the Notification Service synchronously", because the Event Bus did not exist
yet.

### Consequences

* Bad, because an e-mail outage made checkout fail.

## More Information

Superseded by [0003](0003-publish-order-events.md) once the Event Bus was available.
