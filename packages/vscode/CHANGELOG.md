# Changelog

## [1.0.0](https://github.com/codetent/mapitect/compare/v0.3.0...v1.0.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* the folder an ADR is in no longer links it to an element. Add `components: [<element>]` to its metadata; files whose folder name still matches an element get a hint naming the entry.

### Features

* link decisions through a components field and report problems ([1bbe610](https://github.com/codetent/mapitect/commit/1bbe610da419a6141570af64052e782a5cef8cdb))
* **ui:** give the sidebar root Components and ADRs folders ([faa92b3](https://github.com/codetent/mapitect/commit/faa92b31098c3d84313f8c86babc8fc00488e85a))

## [0.3.0](https://github.com/codetent/mapitect/compare/v0.2.0...v0.3.0) (2026-11-07)


### Features

* add a free-text technology to elements ([9ed6053](https://github.com/codetent/mapitect/commit/9ed6053f6ddf867dd81b29d0e28ee8fba6cd74c3))
* add a free-text technology to elements ([d353dc3](https://github.com/codetent/mapitect/commit/d353dc3ac7cfad83955a770600d775623573f73b))
* **core:** The removed lifecycle status is gone; use deprecated for what is on its way out ([ab84c48](https://github.com/codetent/mapitect/commit/ab84c485268647c2b24fce54a9f2d1dc26bb04f2))
* Lifecycle statuses show as a badge with a symbol on the element's top-right corner, with a tooltip that explains it, instead of restyling the card ([ab84c48](https://github.com/codetent/mapitect/commit/ab84c485268647c2b24fce54a9f2d1dc26bb04f2))
* **ui:** move level and filters to a bottom-left bar and group the f… ([c168a1c](https://github.com/codetent/mapitect/commit/c168a1c28222b9d5cfdb67acc34a1f3df0c853fd))
* **ui:** move level and filters to a bottom-left bar and group the filter menu ([cc25f23](https://github.com/codetent/mapitect/commit/cc25f2399fe25a1ec9a2eded55cae60c04727f9c))
* **ui:** show the lifecycle status as a corner badge with a tooltip ([2e01cce](https://github.com/codetent/mapitect/commit/2e01cce9eeb58e30f7ac341f01231cc428c2e791))
* **ui:** show the lifecycle status as a corner badge with a tooltip ([ab84c48](https://github.com/codetent/mapitect/commit/ab84c485268647c2b24fce54a9f2d1dc26bb04f2))

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
