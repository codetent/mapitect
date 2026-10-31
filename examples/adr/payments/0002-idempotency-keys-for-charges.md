---
status: accepted
date: 2025-04-08
decision-makers: Checkout team
---

# Send an idempotency key with every charge

## Context and Problem Statement

Retries after timeouts sometimes charged customers twice. How do we make charges safe to retry?

## Considered Options

* Derive an idempotency key from the order and attempt, and send it to Stripe
* Check for existing charges before retrying

## Decision Outcome

Chosen option: "Derive an idempotency key", because Stripe guarantees that requests with the same
key are executed once, without a race between check and retry.

### Consequences

* Good, because retries can't double-charge.
* Neutral, because keys expire after 24 hours, which is longer than any retry window.
