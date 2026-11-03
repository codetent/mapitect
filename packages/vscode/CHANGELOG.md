# Changelog

## [0.2.0](https://github.com/codetent/mapitect/compare/v0.1.0...v0.2.0) (2026-11-03)


### Features

* Clicking the "x items inside" chip expands a collapsed card ([aff9b33](https://github.com/codetent/mapitect/commit/aff9b339e3e35e722c67fffb7aee6d2cd79a0421))
* Clicking the link mark on a card opens its link ([aff9b33](https://github.com/codetent/mapitect/commit/aff9b339e3e35e722c67fffb7aee6d2cd79a0421))
* Connections are always drawn orthogonally with rounded corners; the edge style toggle is gone ([aff9b33](https://github.com/codetent/mapitect/commit/aff9b339e3e35e722c67fffb7aee6d2cd79a0421))
* Lifecycle status per element (live, future, deprecated, removed), set with `vars: {status: …}` and inherited by everything inside the element, with its own look on cards, groups and connections ([aff9b33](https://github.com/codetent/mapitect/commit/aff9b339e3e35e722c67fffb7aee6d2cd79a0421))
* New previews start with the minimap hidden; press M or the map button to show it ([aff9b33](https://github.com/codetent/mapitect/commit/aff9b339e3e35e722c67fffb7aee6d2cd79a0421))
* Status filter in the toolbar that hides elements by lifecycle status while keeping the containers around what is still shown ([aff9b33](https://github.com/codetent/mapitect/commit/aff9b339e3e35e722c67fffb7aee6d2cd79a0421))
* Status picker in the details panel ([aff9b33](https://github.com/codetent/mapitect/commit/aff9b339e3e35e722c67fffb7aee6d2cd79a0421))
* The sidebar groups each element's children and decision records into Components and ADRs folders ([aff9b33](https://github.com/codetent/mapitect/commit/aff9b339e3e35e722c67fffb7aee6d2cd79a0421))


### Bug Fixes

* Toolbar menus open above the details panel instead of behind it ([aff9b33](https://github.com/codetent/mapitect/commit/aff9b339e3e35e722c67fffb7aee6d2cd79a0421))
* Unknown lifecycle statuses are reported as warnings, and warnings are no longer shown as errors ([aff9b33](https://github.com/codetent/mapitect/commit/aff9b339e3e35e722c67fffb7aee6d2cd79a0421))


### Miscellaneous Chores

* release 0.2.0 ([dc5f4ee](https://github.com/codetent/mapitect/commit/dc5f4ee9748577d7992a7cf1b534bba7eda90f77))

## 0.1.0

First release.

- Interactive preview of `.d2` files, compiled with the official D2 compiler: zoom, pan, drill-down, detail levels, collapsible containers, minimap and search.
- Details panel, selection highlighting and two-way sync between the diagram and its source.
- Editing in the diagram: rename elements and connections, edit descriptions and links, pick element types and fill colors, change the layout direction, with undo and redo.
- Architecture decision records (MADR) shown next to their elements, with a decision reader and *New decision…*.
- Export as SVG or PNG.
- D2 syntax highlighting, bracket matching, folding and compiler diagnostics.
