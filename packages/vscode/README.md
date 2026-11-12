# mapitect

An interactive preview for [D2](https://d2lang.com) architecture diagrams in VS Code.

mapitect opens a `.d2` file as a map you can zoom, pan and drill into. Large diagrams start at the top level, and you expand the parts you care about. You can rename elements and change their description, technology, link, lifecycle status, type and color in the preview, and mapitect writes those changes back to the `.d2` file. Mark what is planned or on its way out, say what each part is built with, and filter the map by either. If you keep architecture decision records in MADR format, each element also shows the decisions that belong to it.

The file is parsed by the official D2 compiler ([`@d2lang/d2`](https://www.npmjs.com/package/@d2lang/d2), the WASM build of D2), so the preview understands the same syntax as the `d2` CLI, including classes, vars, globs and imports.

<img src="https://raw.githubusercontent.com/codetent/mapitect/main/docs/images/overview.png" alt="mapitect drilled into the Backend of the example bookshop: the Catalog Service is selected, its connections are highlighted, and the details panel shows its description, technology (Go), lifecycle status, type, two architecture decisions and outgoing connections" width="100%">

## Getting started

Open a `.d2` file and press `Cmd+K V` (`Ctrl+K V` on Windows and Linux), or click the preview button in the editor title bar. The preview opens beside the editor and updates as you type. When the layout changes, elements animate to their new positions.

Compiler errors appear in the Problems panel, and the preview keeps showing the last version of the diagram that compiled.

## Finding your way around

Drag the canvas to pan. Zoom with the mouse wheel, a trackpad pinch, `+` and `-`, or the zoom bar. On a trackpad, two-finger scrolling pans instead of zooming (the `mapitect.wheel` setting changes this). `F` fits the whole diagram on screen and `1` resets the zoom to 100%.

A new preview opens at *Level 1*, which shows only the top-level elements. The *Level 1 / 2 / 3 / All* switcher in the bar at the bottom left expands deeper levels. You can also collapse or expand a single container with its corner button, with `[` and `]`, or by clicking the "items inside" chip on a collapsed card. When a container is collapsed, the connections to the elements inside it are merged into one dashed connection with a combined label.

To focus on one part of the system, double-click a container. mapitect then shows only its contents, plus the outside elements it talks to as dashed context cards. It works much like moving down a level in a C4 model. The breadcrumbs, `Esc` or `Backspace` take you back up.

A few more things help with larger diagrams:

- Clicking an element highlights its connections and dims everything else. The arrow keys move the selection to the nearest element in that direction.
- The details panel shows the selected element's description (`tooltip`), technology, lifecycle status, link, connections and children. Every entry in it is clickable. Cards with a `link` show a link mark in their corner that opens it.
- The filter button in the bottom-left bar hides elements by [lifecycle status](#lifecycle-status) or [technology](#technology).
- The sidebar contains a tree of the whole model, with each element's children under *Components* and its decision records under *ADRs*. It starts collapsed. Open it with the button at the top left, or press `/` or `Cmd+F` to search, and `Enter` to jump to the first match.
- As you zoom out, descriptions and labels fade and group names get larger, so a big map stays readable.
- The minimap is hidden by default. Press `M` or use the map button to show it, then click or drag inside it to move around.

To save the diagram as an image, use the export button in the toolbar at the top right, or run *mapitect: Export Diagram as SVG* or *Export Diagram as PNG* from the Command Palette. The reload button next to it reads the diagram and its decision records from disk again. The preview follows your VS Code theme, including the high-contrast themes.

## Diagram and source side by side

When you select an element or connection in the preview, its declaration is highlighted in any editor that already shows the file and scrolled into view. Your cursor stays where it is, and no new editor is opened. It also works the other way round: the element under the editor cursor is outlined in the diagram. To jump to an element's source, `Cmd+click` it (`Ctrl+click` on Windows and Linux).

You can change the highlight colors with `mapitect.sourceHighlightBackground` and `mapitect.sourceHighlightRuler` in `workbench.colorCustomizations`.

## Editing in the preview

The preview lets you change text and the look of elements. The structure stays in code, so adding, removing and reconnecting elements happens in the `.d2` file. Each change you make in the preview becomes a small edit in the source, based on the compiler's syntax tree. The rest of your formatting and your comments are left as they are.

Here is what you can edit:

- Rename an element, a group title or a connection label by double-clicking it or pressing `F2`.
- In the details panel, edit an element's name, description (`tooltip`), [technology](#technology), link and [lifecycle status](#lifecycle-status), choose its type (service, actor, gateway, data store, queue or cloud service) or set a fill color. For a connection you can edit the label. Other D2 shapes are displayed correctly, but you set them in code.
- Right-click an element or connection for *Rename* or *Edit label*, *Go to source*, *New decision…* and navigation commands.
- `⌘Z` and `⇧⌘Z` undo and redo edits made in the preview. If you have typed in the file since, use the editor's own undo instead.

Editing is paused while the file has compile errors, because the source positions might be out of date. The layout is always automatic, so elements can't be moved by hand. It flows in the direction set by `direction:` at the top of the file (`right`, `down`, `left` or `up`).

## Lifecycle status

Architectures change, and a map should show what is planned and what is on its way out. Give an element a status in its `vars`:

```d2
shop: Bookshop {
  recommendations: Recommendations {
    vars: {status: future}
  }
  export: Sales report job {
    vars: {status: deprecated}
  }
}
```

There are three statuses:

| Status | Meaning | Drawn as |
| --- | --- | --- |
| `live` | Running today. This is the default. | normal |
| `future` | Planned or being built | blue clock badge, connections to it dashed |
| `deprecated` | Still running, but on its way out | amber warning badge |

A status applies to the element and everything inside it, so marking a system `future` marks all of its parts. A child can set a status of its own, including `live`. The badge sits on the top-right corner of the element that sets the status, the same on cards, groups and tables, and hovering it explains what it means. The details panel names the element a status is inherited from. A status in the file's top-level `vars` doesn't count, and an unknown value is reported as a warning.

In the details panel, the *Status* buttons set the status. Picking the status an element would inherit anyway removes its own `status`, together with its `vars` block if nothing else is in it.

Once a diagram uses statuses, the filter menu in the bottom-left bar gets a *Status* group. Uncheck statuses to hide their elements: hide *Deprecated* to see the target architecture, hide *Future* for today's, or hide *Live* to see only what changes. A container stays visible while anything inside it is shown, and connections to hidden elements are left out.

## Technology

Say what an element is built with in its `vars`. The value is free text:

```d2
shop: Bookshop {
  catalog: Catalog Service {
    vars: {technology: Go}
  }
  db: Database {
    shape: cylinder
    vars: {technology: PostgreSQL 16; status: deprecated}
  }
}
```

The technology is shown after the element's type on cards, in group headers and after a table's name, cut short with an ellipsis when it doesn't fit. Unlike a status, it belongs to the element alone and is not passed on to what is inside it. Search finds elements by their technology too.

In the details panel, the *Technology* field sets it. Clearing the field removes `technology`, together with its `vars` block if nothing else is in it.

Once a diagram uses technologies, the filter menu in the bottom-left bar gets a *Technology* group. It lists every technology from A to Z, ignoring case and spacing, and *Unspecified* for elements without one. Uncheck a technology to hide its elements, or uncheck *Unspecified* to see only what has a technology. It combines with the status filter: an element is shown only if both let it through. As with statuses, a container stays visible while anything inside it is shown.

## Architecture decisions

mapitect can show [MADR](https://adr.github.io/madr/) decision records next to the elements they belong to. Add the folders that hold them to an `adr-folders` variable at the top of the `.d2` file. Paths can be relative to the `.d2` file or absolute, and you can list one folder or several:

```d2
vars: {
  adr-folders: [adr; ../shared/decisions]
}
```

<img src="https://raw.githubusercontent.com/codetent/mapitect/main/docs/images/decisions.png" alt="The decision reader showing ADR-0002, 'Search with PostgreSQL full-text search', next to the selected Catalog Service in the map" width="100%">

Each decision names the elements it applies to in a `components` entry of its metadata. Use an element's full id, or its key when no other element has the same one. A decision can apply to several elements, and one that names none applies to the whole system:

```markdown
---
status: accepted
date: 2025-05-06
components: [shop.backend.orders, payments]
---

# Check stock before taking payment
```

In MADR 2 files, write it as a bullet under the title: `* Components: shop.backend.orders, payments`. How you arrange the files inside the folders is up to you; subfolders are searched up to five levels deep, and decisions from every folder are merged.

Elements with decisions get a badge with the number of records, and groups show the count in their header. The details panel lists an element's decisions with number, title and status. Click a decision or a badge to open it in the decision reader, which also shows the date, the decision-makers and every element the decision applies to. Click one of those elements to read the decision next to it. Use `←` and `→` to step through the component's decisions. Links between ADRs open in the reader as well.

System-wide decisions are listed under *System-wide ADRs* at the top of the sidebar's tree, and in the menu you get by right-clicking the empty canvas.

To write a new decision, right-click an element and choose *New decision…*, or click the `+` next to *Decisions* in the details panel. For a system-wide one, right-click the empty canvas and choose *New system-wide decision…*. mapitect asks for a title, creates the next numbered MADR file with `status: proposed`, today's date and the element in `components`, and opens it in the editor. The file goes next to the element's existing decisions (in the first folder that has any), or straight into the first `adr-folders` entry, and gets the number after the highest one in that folder.

A few more details:

- mapitect reads MADR 3 and 4 YAML front matter (`status`, `date`, `decision-makers`, `consulted`, `informed`, `components`) as well as the MADR 2 bullet style (`* Status: …`). Statuses are shown as accepted, proposed, rejected, deprecated or superseded.
- The preview updates when you add or edit Markdown files or change `adr-folders`.
- Without `adr-folders`, mapitect doesn't look for decisions at all. `README.md`, `index.md`, `template.md` and files whose names start with `.` or `_` are ignored.

The [`examples`](https://github.com/codetent/mapitect/tree/main/examples) folder in the repository has a sample diagram with 9 decisions in `adr` and `adr-shared`.

### Upgrading from folder names

Earlier versions of mapitect used the name of the folder an ADR was in to choose its element. That no longer links anything: a decision without `components` is system-wide. While the preview is open, mapitect marks each such file whose folder name matches an element with a hint in the Problems panel that names the `components` entry to add.

## Problems

Compile errors and warnings appear in the Problems panel for every open `.d2` file. While a preview is open, mapitect also reports, with `mapitect` as the source:

- **Decisions:** `components` entries that match no element or several, unknown or missing statuses, dates not written as `YYYY-MM-DD`, numbers used twice in a folder, links to files that don't exist, and `adr-folders` entries that don't exist. These point at the line in the ADR file or the `.d2` file.
- **Drawing:** icons that don't exist or can't be loaded, and a layout that failed.
- **What isn't drawn:** `width`, `height`, `top`, `left` and grid settings, and `layers`, `scenarios` and `steps`, as information.

The footer of the sidebar counts the errors and warnings. Click it to go to the first one.

## Supported D2

mapitect supports whatever the official compiler accepts. Imports are resolved against other `.d2` files in the same folder, up to two levels deep. For now only the main board is shown. `layers`, `scenarios` and `steps` are compiled but not displayed.

mapitect lays out diagrams itself with ELK, which is what makes collapsing and drilling down possible. For that reason `width`, `height`, `top`, `left`, grid settings and the choice of D2 layout engine are ignored.

Each element type has its own icon and accent color. This covers actors (`person`), services, gateways (`hexagon`), data stores (`cylinder`), queues, cloud services, tables and a few more.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `F2` | Rename the selection |
| `⌘Z` / `⇧⌘Z` | Undo / redo an edit made in the preview |
| `F` / `1` | Fit to screen / zoom to 100% |
| `+` `-` | Zoom in and out |
| Arrow keys | Move the selection, or pan when nothing is selected (`Shift` for bigger steps) |
| `Enter` | Expand, drill into, or open the source of the selection |
| `Esc` / `Backspace` | Clear the selection, then go up a level |
| `[` `]` | Collapse / expand the selected container |
| `/`, `Cmd+F` | Search |
| `M` | Show or hide the minimap |

## Commands

| Command | Description |
| --- | --- |
| *mapitect: Open Interactive Preview to the Side* | Open the preview beside the editor (`Cmd+K V` / `Ctrl+K V`, or the button in the editor title bar) |
| *mapitect: Open Interactive Preview* | Open the preview in the current editor group |
| *mapitect: Export Diagram as SVG* / *as PNG* | Save the diagram, as currently expanded and filtered, as an image |
| *mapitect: Fit Diagram to Screen* | Fit the whole diagram into the preview |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `mapitect.wheel` | `auto` | What the scroll wheel does. `auto` pans on a trackpad and zooms with a mouse wheel, `zoom` always zooms, and `pan` always pans (hold `Ctrl`/`Cmd` to zoom). |
| `mapitect.defaultDepth` | `1` | Detail level a new preview opens at. `0` expands everything. |
| `mapitect.syncSelection` | `true` | Outline the element under the editor cursor in the diagram. |
