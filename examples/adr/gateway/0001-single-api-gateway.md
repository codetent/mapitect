---
status: accepted
date: 2025-03-11
decision-makers: Platform team
---

# One API gateway in front of all services

## Context and Problem Statement

The storefront and the back office both need the catalog and order services. Do they call the
services directly?

## Considered Options

* One API gateway for all clients
* Clients call each service directly

## Decision Outcome

Chosen option: "One API gateway", so authentication, rate limiting and routing happen in one place
and the services stay internal.

### Consequences

* Good, because services are not exposed to the internet.
* Bad, because every new client need is a gateway route first.
