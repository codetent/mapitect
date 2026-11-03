# CLAUDE.md

## Project

mapitect is an npm workspaces monorepo:

- `packages/core` — host-agnostic core
- `packages/ui` — UI
- `packages/vscode` — the VS Code extension (`mapitect`)
- `packages/dev` — local dev server

## Commands

- `npm run build` — build all workspaces
- `npm run typecheck` — type-check all workspaces
- `npm run lint` — oxlint (warnings fail)
- `npm test` — run tests in all workspaces
- `npm run dev` — build and start the dev server
- `npm run package` — package the VS Code extension

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages:

```
<type>(<optional scope>): <description>
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, `style`. Use the workspace name as the scope where it fits (e.g. `feat(vscode): ...`, `fix(core): ...`).
