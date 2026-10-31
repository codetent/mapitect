---
status: accepted
date: 2025-03-25
decision-makers: Checkout team
consulted: Finance
---

# Use Stripe for card payments

## Context and Problem Statement

The shop accepts card payments. Do we integrate a payment provider, and which one?

## Decision Drivers

* We must not store or process card data ourselves (PCI DSS scope).
* Strong customer authentication (3-D Secure) must work out of the box.

## Considered Options

* Stripe
* Adyen
* A local acquirer integration

## Decision Outcome

Chosen option: "Stripe", because its hosted fields keep card data out of our systems and its API
and test tooling fit a small team.

### Consequences

* Good, because PCI scope is limited to SAQ A.
* Bad, because fees are higher than with a negotiated acquirer contract.
