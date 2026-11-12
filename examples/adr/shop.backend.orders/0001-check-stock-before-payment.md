---
status: accepted
date: 2025-05-06
decision-makers: Checkout team
components: [shop.backend.orders, payments]
---

# Check stock before taking payment

## Context and Problem Statement

Readers sometimes paid for books that had just sold out, and we had to refund them. When does the
Order Service check stock?

## Considered Options

* Before charging the card
* After charging, refunding when a book is out of stock

## Decision Outcome

Chosen option: "Before charging the card". Only orders that pass the check are charged and
published as `OrderPlaced` events.

### Consequences

* Good, because no more refunds for sold-out books.
* Bad, because checkout makes one more call.
