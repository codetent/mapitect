---
status: accepted
date: 2025-03-25
decision-makers: Checkout team
---

# Send e-mail with SendGrid

## Context and Problem Statement

Order confirmations and shipping updates must arrive reliably and not end up in spam. Do we run
our own mail servers?

## Considered Options

* SendGrid
* Amazon SES
* Our own SMTP servers

## Decision Outcome

Chosen option: "SendGrid", because it handles deliverability (SPF, DKIM, reputation) and offers
templates the marketing team can edit.

### Consequences

* Good, because nobody on the team has to run mail servers.
* Bad, because templates live outside our repository.
