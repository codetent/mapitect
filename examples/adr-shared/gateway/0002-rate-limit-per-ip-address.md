---
status: deprecated
date: 2025-04-02
decision-makers: Security guild
informed: Platform team
---

# Rate limit requests per IP address

## Context and Problem Statement

Scrapers hit the catalog hard. How does the [gateway](../../adr/gateway/0001-single-api-gateway.md)
limit them?

## Decision Outcome

Chosen option: limit each IP address to 100 requests per second.

Deprecated because shoppers behind one corporate proxy share an IP address and got blocked. The
security guild is moving to limits per API key.
