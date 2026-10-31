---
status: accepted
date: 2025-03-18
decision-makers: Checkout team
---

# Orchestrate checkout in the Order Service

## Context and Problem Statement

Checkout reserves stock, charges the customer and confirms the order. Who coordinates these steps,
and what happens when one fails?

## Decision Drivers

* A failed payment must not leave a confirmed order behind.
* The flow should be readable in one place.

## Considered Options

* The Order Service orchestrates the steps and compensates on failure
* Choreography: each service reacts to the previous service's event

## Decision Outcome

Chosen option: "The Order Service orchestrates", because the checkout flow is short and its order
matters; orchestration keeps it in one place and makes compensation explicit.

### Consequences

* Good, because the whole checkout can be followed in one service.
* Bad, because the Order Service knows about payments and stock.
