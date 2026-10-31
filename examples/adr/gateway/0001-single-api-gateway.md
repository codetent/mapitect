---
status: accepted
date: 2025-02-18
decision-makers: Platform team
---

# One API gateway for authentication, rate limiting and routing

## Context and Problem Statement

The storefront and the back-office UI both call the domain services. Each service would otherwise
implement authentication and rate limiting itself.

## Decision Drivers

* Cross-cutting concerns should be implemented once.
* Internal service addresses should not leak to clients.

## Considered Options

* One API gateway in front of all domain services
* Authentication and rate limiting in every service
* A service mesh with per-service policies

## Decision Outcome

Chosen option: "One API gateway in front of all domain services".

### Consequences

* Good, because policies are configured in one place.
* Bad, because the gateway is on every request path and must be highly available.

## Pros and Cons of the Options

### A service mesh with per-service policies

* Good, because it also secures service-to-service traffic.
* Bad, because it is a lot of infrastructure for a team our size.
