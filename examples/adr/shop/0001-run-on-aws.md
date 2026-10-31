---
status: accepted
date: 2025-03-04
decision-makers:
  - Platform team
consulted: [Storefront team, Checkout team]
informed: Everyone
---

# Run the bookshop on AWS

## Context and Problem Statement

The bookshop is a storefront, a back office, an API gateway and a handful of services. Where do
they run?

## Considered Options

* AWS, with managed services where they exist
* A platform-as-a-service
* Our own servers

## Decision Outcome

Chosen option: "AWS", because CloudFront, SQS and managed PostgreSQL cover most of what we need and
the team already knows it. All traffic enters through one gateway, see
[ADR-0001 for the gateway](../gateway/0001-single-api-gateway.md).

### Consequences

* Good, because there are no servers to patch.
* Bad, because we depend on one cloud provider.
