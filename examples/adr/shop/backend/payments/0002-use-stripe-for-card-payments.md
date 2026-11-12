---
status: accepted
date: 2025-02-25
decision-makers: Checkout team
components: [shop.backend.payments]
---

# Use Stripe for card payments

## Context and Problem Statement

We need card payments with saved cards and refunds, without handling card data.

## Considered Options

* [Stripe](https://stripe.com)
* Adyen
* Our bank's payment page

## Decision Outcome

Chosen option: "Stripe", because its hosted fields keep card data off our servers and it notifies
us of payment results through webhooks.

### Consequences

* Good, because we stay out of PCI DSS scope.
* Bad, because Stripe's fees are higher than our bank's.
