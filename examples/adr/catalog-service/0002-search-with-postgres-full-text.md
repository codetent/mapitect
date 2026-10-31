---
status: accepted
date: 2025-06-03
decision-makers: Catalog team
---

# Search with PostgreSQL full-text search

## Context and Problem Statement

Keeping Elasticsearch in sync with the catalog caused stale results, and the catalog has fewer
than 100,000 books. Do we still need a separate search engine?

## Decision Outcome

Chosen option: PostgreSQL full-text search on the `books` table, so there is one less system to run.

### Consequences

* Good, because search results are never stale.
* Bad, because ranking is simpler than Elasticsearch's.
