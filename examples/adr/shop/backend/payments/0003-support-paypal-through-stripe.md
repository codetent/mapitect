---
status: proposed
date: 2025-09-09
decision-makers: Checkout team
components: [shop.backend.payments]
---

# Support PayPal through Stripe

## Context and Problem Statement

Some readers ask to pay with PayPal. Should we offer it?

## Considered Options

* PayPal through Stripe
* A direct PayPal integration

## Decision Outcome

Proposed option: "PayPal through Stripe", so the Payment Service keeps a single provider and
refunds work the same way.
