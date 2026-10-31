---
status: accepted
date: 2025-06-03
decision-makers: Catalog team
---

# Cache product reads in Redis

## Context and Problem Statement

Product pages read the same products thousands of times between edits. During sales the catalog
database became the bottleneck.

## Decision Drivers

* Product pages must stay fast during traffic peaks.
* Editors expect changes to show up within a minute.

## Considered Options

* Cache-aside in Redis with a 60 second TTL, invalidated on edit
* Read replicas of the catalog database
* In-memory caches in each service instance

## Decision Outcome

Chosen option: "Cache-aside in Redis", because all instances share one cache and edits can
invalidate entries immediately.

### Consequences

* Good, because database load dropped by an order of magnitude in load tests.
* Bad, because cache invalidation is now part of every write path.
