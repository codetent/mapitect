---
status: proposed
date: 2026-09-15
decision-makers: Checkout team
---

# Offer PayPal as a second payment method

## Context and Problem Statement

A quarter of abandoned checkouts happen on the payment step, and customers ask for PayPal. Should
we offer it?

## Considered Options

* PayPal through Stripe
* A direct PayPal integration

## Decision Outcome

Proposed option: "PayPal through Stripe", so the Payment Service keeps a single provider
integration and refunds work the same way.

### Consequences

* Good, because no second provider integration.
* Bad, because PayPal through Stripe is not available in every country we ship to.
