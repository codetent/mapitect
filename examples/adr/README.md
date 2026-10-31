# Architecture decision records

Decisions for the components in [`../platform.d2`](../platform.d2), in [MADR](https://adr.github.io/madr/) format.
Archer lists them per element in the diagram's details panel and opens them in its decision reader.

## Layout

The diagram points here with `adr-folders: [adr; adr-shared]` in its `vars`. Decisions from both
folders are merged per element. Each folder shows one way a folder can match its element:

| Folder | Element | Matched by |
| --- | --- | --- |
| `adr/shop/` | Bookshop (a group: the count shows in its header) | key |
| `adr/gateway/`, `adr-shared/gateway/` | API Gateway | key, merged from two roots |
| `adr/shop.backend.orders/` | Order Service | full id |
| `adr/shop/backend/payments/` | Payment Service | path mirroring the nesting |
| `adr/catalog-service/` | Catalog Service | label |

Between them the files use every status (accepted, proposed, rejected, deprecated, superseded),
MADR 4 front matter as well as MADR 2 bullets (`catalog-service/0001`), and links to other ADRs,
which open in the reader.

Files are numbered per folder: `NNNN-short-title.md`. This README is ignored, as are
`index.md`, `template.md` and files starting with `.` or `_`.
