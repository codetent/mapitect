---
status: accepted
date: 2025-02-18
decision-makers: Storefront team, Platform team
---

# The storefront calls the backend only through the API Gateway

## Context and Problem Statement

The storefront needs data from the catalog and order services. May it call them directly?

## Considered Options

* Only through the API Gateway
* Directly, wherever convenient

## Decision Outcome

Chosen option: "Only through the API Gateway", so authentication, rate limiting and routing happen
in one place and the domain services stay internal.

### Consequences

* Good, because domain services are not exposed to the internet.
* Bad, because every new storefront need is a gateway route first.
