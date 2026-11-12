# Architecture decision records

Decisions for the components in [`../platform.d2`](../platform.d2), in [MADR](https://adr.github.io/madr/) format.
mapitect lists them per element in the diagram's details panel and opens them in its decision reader.

## Layout

The diagram points here with `adr-folders: [adr; adr-shared]` in its `vars`. Each file names the
elements it applies to in its metadata, so the folders are only there to keep things tidy:

| File | Applies to | Shows |
| --- | --- | --- |
| `adr/0001-run-on-aws.md` | the whole system | no `components`: a system-wide decision |
| `adr/gateway/0001-…`, `adr-shared/gateway/0002-…` | API Gateway | decisions merged from two roots |
| `adr/shop.backend.orders/0001-…` | Order Service and Payment Service | one decision, two elements |
| `adr/shop/backend/payments/` | Payment Service | the element's full id |
| `adr/catalog-service/` | Catalog Service | its key, also in MADR 2 bullets (`* Components: catalog`) |

```yaml
---
status: accepted
components: [shop.backend.orders, payments]   # full ids, or keys that only one element has
---
```

Between them the files use every status (accepted, proposed, rejected, deprecated, superseded),
MADR 4 front matter as well as MADR 2 bullets (`catalog-service/0001`), and links to other ADRs,
which open in the reader.

Files are numbered per folder: `NNNN-short-title.md`. This README is ignored, as are
`index.md`, `template.md` and files starting with `.` or `_`.
