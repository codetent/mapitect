# mapitect

Interactive architecture maps from [D2](https://d2lang.com) files. Today mapitect ships as a VS Code extension; see [packages/vscode/README.md](packages/vscode/README.md) for what it does and how to use it.

## Layout

The code is split so the same core and UI can run in other places later, such as a desktop app (Tauri) or a plain browser. This repository is an npm workspace:

| Package | What it is | May use |
|---|---|---|
| [`packages/core`](packages/core) (`@mapitect/core`) | D2 compiling and visual edits, ADRs, the preview session and the UI ↔ host protocol | plain ES2022 only: no Node, DOM or VS Code APIs |
| [`packages/ui`](packages/ui) (`@mapitect/ui`) | the interactive diagram, mounted with `mount(element, bridge)` | the DOM |
| [`packages/vscode`](packages/vscode) (`mapitect`) | the VS Code extension: commands, diagnostics, the webview panel | Node and VS Code |
| [`packages/dev`](packages/dev) (`@mapitect/dev`) | a browser harness for working on the UI without VS Code | Node and the DOM |

Each package's `tsconfig.json` only provides the types it may use, so a stray `node:` import in the core or a `vscode` call in the UI fails `npm run typecheck`.

A host plugs into the core through the interfaces in [`packages/core/src/ports.ts`](packages/core/src/ports.ts):

- `DiagramDocument`: the open `.d2` text, with unsaved changes, and a way to edit it
- `FileSystem`: reading sibling `.d2` files and ADR folders, writing new decisions
- `HostShell`: what only the app can do, like revealing source lines, opening files, dialogs, and sending messages to the UI

`DiagramSession` (one per open preview) handles the UI's messages ([`protocol.ts`](packages/core/src/protocol.ts)) using those ports. On the UI side, a host passes a `HostBridge` that carries the messages (a webview's `postMessage`, HTTP, or a direct call when both run in one page) and themes the UI through the `theme-*` body classes and `--host-*` variables.

Code map:

- `core/src/d2/compiler.ts`: wrapper around the official compiler (worker + WASM)
- `core/src/d2/source.ts`: walks the compiler's syntax tree to map each statement to the node or edge it touches
- `core/src/d2/convert.ts`: combines the compiled diagram and that source index into the model in `core/src/model.ts`
- `core/src/d2/edits.ts`: turns visual edits (texts and appearance) into text edits
- `core/src/adr.ts`: reads `vars.adr-folders`, finds ADR folders, parses MADR and matches folders to elements
- `core/src/compile-cache.ts`: compiles open documents, with their `@imports`, once per version
- `core/src/session.ts`: a preview's logic: updates, edits and undo, cursor sync, ADRs, new decisions, links, export
- `ui/src/editing.ts`: inline rename and the context menu
- `ui/src/decisions.ts`: the decision reader
- `ui/src/view.ts`: drill-down focus, collapsing, and lifting edges to visible ancestors
- `ui/src/layout.ts`: node sizing and the ELK layered layout
- `ui/src/render.ts`: d3 rendering with animated transitions
- `ui/src/app.ts`: camera, sidebar, details panel, minimap, keyboard
- `vscode/src/extension.ts`: preview panels, diagnostics, editor highlights and the VS Code side of every port
- `vscode/src/webview.ts`: the UI inside the webview, bridged with `acquireVsCodeApi`

## Development

```bash
npm install
npm run build      # bundles the extension, its webview and the dev harness; copies the D2 WASM runtime
npm test           # core tests against the real compiler, plus an extension-host smoke test
npm run typecheck  # every package against only the APIs it may use
npm run package    # produces packages/vscode/mapitect-<version>.vsix
```

Press `F5` in VS Code to start an Extension Development Host with `examples/` open.

To iterate on the UI in a plain browser, run `npm run dev` (or `node packages/dev/server.mts` after a build) and open `http://localhost:5317/`. The server runs the real core session against an in-memory copy of a file from `examples/` and never writes to disk. Add `?theme=light` or `?file=<name>.d2` to change the theme or the example file.
