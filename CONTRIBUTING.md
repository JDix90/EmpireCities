# Contributing to Borderfall

## Workflow

- Prefer **small, focused** changes with a clear description of behavior.
- Run **`pnpm run test:backend`** and **`pnpm run validate:maps`** from the repo root before opening a PR that touches game logic or map JSON.
- Run **`pnpm exec tsc --noEmit`** in `frontend/` and `backend/` when you change TypeScript types.

## Project layout

- [README.md](README.md) — setup, Docker, seeds, architecture.
- [docs/CODEBASE_STATUS.md](docs/CODEBASE_STATUS.md) — what is already implemented vs common misconceptions.
- [AGENTS.md](AGENTS.md) — short orientation for coding agents.

## Shared types

Domain types shared between frontend and backend live in `packages/shared` (`@borderfall/shared`). Prefer adding new cross-boundary types there instead of duplicating.
