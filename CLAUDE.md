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
