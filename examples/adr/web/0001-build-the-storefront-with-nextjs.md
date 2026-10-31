---
status: accepted
date: 2025-02-11
decision-makers: Storefront team
---

# Build the storefront with Next.js

## Context and Problem Statement

The public shop needs fast product pages that search engines can index, plus interactive parts
such as the cart. Which framework do we build it with?

## Decision Drivers

* Product and category pages must render on the server for SEO.
* The team's experience is in React and TypeScript.

## Considered Options

* Next.js
* A single-page React app
* Server-rendered templates from the API Gateway

## Decision Outcome

Chosen option: "Next.js", because it renders pages on the server and keeps the React component
model for interactive parts.

### Consequences

* Good, because pages are indexable and fast on first load.
* Bad, because the storefront needs its own Node.js runtime in the cluster.
