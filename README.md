# Archer: interactive D2 diagrams for VS Code

Archer renders [D2](https://d2lang.com) files as interactive, IcePanel-style architecture maps. You can zoom, pan, drill into systems, collapse groups, and jump between the diagram and its source.

## Features

- **Live preview**: open any `.d2` file and press `Cmd+K V` (`Ctrl+K V`), or use the preview button in the editor title bar. The diagram re-renders as you type and animates between layouts.
- **Zoom & pan**: drag the canvas to pan. Use the wheel, a trackpad pinch, `+`/`-` or the zoom bar to zoom. Trackpad scrolling pans; see `archer.wheel` to change that. `F` fits the diagram, `1` resets to 100%.
- **Drill-down navigation**: double-click a container to focus on it, like moving between C4 levels. External elements it talks to stay visible as dashed context cards. Breadcrumbs, `Esc` or `Backspace` take you back up.
- **Detail levels**: the *Level 1 / 2 / 3 / All* switcher collapses nested containers. When a container is collapsed, the connections to its contents are merged into dashed *implied connections* that show a combined label.
- **Collapse / expand** any container in place with its corner button or `[` / `]`.
- **Model tree & search**: the sidebar lists the whole hierarchy. Press `/` or `Cmd+F` to search, and `Enter` reveals the first match.
- **Details panel**: shows an element's description (`tooltip`), link, incoming and outgoing connections, and children, each clickable.
- **Selection highlighting**: selecting an element animates its connections and dims everything else. Arrow keys move the selection to the nearest element in that direction.
- **Source sync**: the element under the editor cursor is outlined in the diagram. `Cmd/Ctrl+click` an element (or use *Source*) to jump to its definition.
- **Semantic zoom**: descriptions and labels fade out as you zoom away, and group names grow so large maps stay readable.
- **Minimap**: click or drag it to navigate (`M` toggles it).
- **Export**: save the diagram as SVG or PNG.
- **Editor support**: syntax highlighting, bracket matching, folding, and diagnostics for parse errors and unknown shapes or keywords.
- Follows the VS Code light, dark and high-contrast themes.

## Supported D2

Shapes, nested containers (`a.b.c` or `{}` blocks), edges `->` `<-` `<->` `--`, edge chains, labels, `_` parent references, `shape`, `style.*`, `icon`, `tooltip`, `link`, `near`, `direction`, `classes`, `vars` (`${name}`), block strings (`|md ... |`), `sql_table` and `class` shapes with constraints, and `null` deletion.

Not supported yet: imports, globs, edge references like `(a -> b)[0]`, and `layers` / `scenarios` / `steps`. These are reported as diagnostics and skipped. Layout is computed automatically with ELK, so `width`, `height`, `top`, `left` and grid settings are ignored.

Each element type gets its own icon and accent color: actors (`person`), services, gateways (`hexagon`), data stores (`cylinder`), queues, cloud services, tables, and more.

## Keyboard

| Key | Action |
| --- | --- |
| `F` / `1` | Fit to screen / 100% |
| `+` `-` | Zoom |
| Arrows | Move the selection (pan when nothing is selected; `Shift` for bigger steps) |
| `Enter` | Expand, drill into, or open the source of the selection |
| `Esc` / `Backspace` | Clear the selection, then go up a level |
| `[` `]` | Collapse / expand the selected container |
| `/`, `Cmd+F` | Search |
| `M` | Toggle the minimap |

## Settings

- `archer.wheel`: `auto` (default; trackpad pans, mouse wheel zooms), `zoom`, or `pan`.
- `archer.defaultDepth`: nesting level to expand when a preview first opens (`0` expands everything).
- `archer.syncSelection`: highlight the element under the editor cursor.

## Development

```bash
npm install
npm run build      # bundles dist/extension.js, dist/webview.js and the dev harness
npm test           # parser tests and the extension-host smoke test
npm run package    # produces archer-d2-<version>.vsix
```

Press `F5` in VS Code to start an Extension Development Host with `examples/` open.

To iterate on the webview in a plain browser, serve the repo with `python3 dev/serve.py` and open `http://localhost:5317/dev/index.html`. Add `?theme=light` or `?file=<name>.d2` to change the theme or the example file.

Code layout:

- `src/parser/d2.ts`: error-tolerant D2 parser that produces the JSON model in `src/model.ts`
- `src/extension.ts`: preview panels, live updates, diagnostics, cursor sync, export
- `webview/view.ts`: drill-down focus, collapsing, and lifting edges to visible ancestors
- `webview/layout.ts`: node sizing and the ELK layered layout
- `webview/render.ts`: d3 rendering with animated transitions
- `webview/main.ts`: camera, sidebar, details panel, minimap, keyboard
