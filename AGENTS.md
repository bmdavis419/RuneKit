# Agent Guidelines

## Package manager

- Always use Bun for this repo.
- Never use npm, pnpm, or yarn commands.
- Install dependencies with `bun add` / `bun add -d`.
- Run scripts with `bun run <script>`.

## Required validation after edits

- Always run formatting after changes: `bun run format`
- Always run checks after formatting: `bun run check`
- If relevant to the change, run tests: `bun run test`

## Svelte/SvelteKit coding expectations

- Prefer modern Svelte 5 syntax and patterns (runes-based reactivity where appropriate).
- Keep components small and composable.
- Favor functional patterns and clear data flow.
- Avoid unnecessary explicit return types unless they improve correctness or readability.
- Keep code concise, but keep planning and reasoning thorough before larger changes.

## Reference repositories

- Use local repositories in `references/` as read-only reference context when relevant.
- Do not modify files under `references/`.
- Treat `references/` as supplemental context, not source of truth for this repo.
- Inside `references/`, use `svelte/` and `kit/` for framework reference material.

## Cursor Cloud specific instructions

- **Dev server**: `bun run dev` starts Vite on port 5173. No external services or environment variables are required.
- **Tests**: `bun run test` runs both server-side (Vitest/Node) and browser (Vitest/Playwright+Chromium) tests. Playwright browsers must be installed first via `bunx playwright install chromium --with-deps`.
- **Lint**: `bun run lint` has pre-existing lint errors in the codebase (19 errors as of initial setup). These are not caused by agent changes.
- **Type check**: `bun run check` runs `svelte-kit sync` then `svelte-check`. Passes with 1 pre-existing warning.
- **No external dependencies**: No databases, Docker, API keys, or `.env` files needed. The demo pages use an in-memory todo store.
