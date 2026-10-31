# Architecture decision records

Decisions for the components in [`../platform.d2`](../platform.d2), in [MADR 4](https://adr.github.io/madr/) format.
Archer lists them per element in the diagram's details panel and opens them in its decision reader.

## Layout

The diagram points here with `adr-folders: [adr]` in its `vars`; more folders can be added to that list.
One folder per component. A folder matches an element by its key (`gateway/`), its full id
(`shop.services.orders/`) or a path mirroring the diagram's nesting (`shop/services/orders/`).

| Folder | Element |
| --- | --- |
| `shop/` | Online Shop (platform-wide decisions) |
| `web/` | Storefront |
| `gateway/` | API Gateway |
| `catalog/` | Catalog Service |
| `orders/` | Order Service |
| `payments/` | Payment Service |
| `notify/` | Notification Service |

Files are numbered per folder: `NNNN-short-title.md`. This README is ignored, as are
`index.md`, `template.md` and files starting with `.` or `_`.
