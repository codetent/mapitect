---
status: accepted
date: 2025-03-10
decision-makers: Platform team
---

# Use REST with OpenAPI between the gateway and the services

## Context and Problem Statement

Which protocol do the gateway and the domain services speak?

## Considered Options

* REST with OpenAPI descriptions
* gRPC
* GraphQL

## Decision Outcome

Chosen option: "REST with OpenAPI descriptions", because the gateway routes and validates requests
from the OpenAPI files and every service can generate its server code from them.

### Consequences

* Good, because API changes are reviewed as OpenAPI diffs.
* Bad, because there is no streaming; long-running work goes through the Event Bus instead.
