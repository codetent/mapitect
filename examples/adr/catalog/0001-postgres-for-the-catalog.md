---
status: accepted
date: 2025-02-25
decision-makers: Catalog team
---

# Keep the catalog in PostgreSQL

## Context and Problem Statement

Products have categories, variants and prices, and editors change them in the back office. Where
does the catalog live?

## Considered Options

* PostgreSQL
* A document database
* A headless commerce SaaS

## Decision Outcome

Chosen option: "PostgreSQL", because the catalog is relational (categories, variants, prices) and
the team already runs PostgreSQL for orders.

### Consequences

* Good, because one database technology for all services.
* Bad, because full-text search needs a separate index later.
