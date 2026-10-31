---
status: accepted
date: 2025-03-04
decision-makers: Platform team
---

# Run all services on Kubernetes

## Context and Problem Statement

The shop consists of a storefront, a back-office UI, an API gateway and four domain services, each
deployed several times a day. Where and how do they run?

## Decision Drivers

* Services scale independently with traffic peaks (sales, newsletters).
* Deployments must be repeatable and roll back quickly.
* The team is small, so the runtime should be a widely known standard.

## Considered Options

* Kubernetes (managed) with one Helm chart per service
* A platform-as-a-service per service
* Virtual machines with configuration management

## Decision Outcome

Chosen option: "Kubernetes (managed) with one Helm chart per service", because it covers scaling,
rolling deploys and service discovery with one tool the team already knows.

### Consequences

* Good, because every service is deployed and scaled the same way.
* Good, because rollbacks are a Helm command.
* Bad, because the cluster itself needs upgrades and monitoring.

## Pros and Cons of the Options

### A platform-as-a-service per service

* Good, because there is no cluster to operate.
* Bad, because private networking between services and the event bus is limited or expensive.

### Virtual machines with configuration management

* Bad, because scaling and rollbacks are slow and manual.
