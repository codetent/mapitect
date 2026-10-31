---
status: rejected
date: 2025-09-02
decision-makers: Platform team, Storefront team
---

# Offer a GraphQL API for the storefront

## Context and Problem Statement

Product pages make several REST calls through the gateway. Should the gateway offer a GraphQL API
so the storefront can fetch everything in one request?

## Considered Options

* Add a GraphQL layer to the gateway
* Keep REST and add a few aggregated endpoints

## Decision Outcome

Chosen option: "Keep REST and add a few aggregated endpoints". Only two pages suffered from
chattiness, and a GraphQL layer would have been a second API to secure, version and cache.

### Consequences

* Good, because there is still one API style to maintain.
* Bad, because aggregated endpoints must be kept in sync with the pages that use them.
