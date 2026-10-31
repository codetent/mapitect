# Search books with Elasticsearch

* Status: superseded by ADR-0002
* Deciders: Catalog team
* Date: 2025-02-11

## Context and Problem Statement

Readers search by title, author and ISBN. What powers the search?

## Decision Outcome

Chosen option: a separate Elasticsearch cluster, kept in sync with the catalog database.

Superseded by [Search with PostgreSQL full-text search](0002-search-with-postgres-full-text.md):
the catalog stayed small enough for the database itself.
