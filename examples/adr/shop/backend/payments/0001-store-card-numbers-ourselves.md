---
status: rejected
date: 2025-02-18
decision-makers: Checkout team
consulted: Security guild
components: [shop.backend.payments]
---

# Store card numbers ourselves

## Context and Problem Statement

Returning readers want to pay without typing their card again. Do we keep their card numbers?

## Decision Outcome

Rejected: storing card numbers would put the whole backend in PCI DSS scope. Saved cards are
handled by the payment provider instead, see
[Use Stripe for card payments](0002-use-stripe-for-card-payments.md).
