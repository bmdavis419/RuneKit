# RuneKit

Developer tooling plugin suite for SvelteKit.

## Install

```bash
bun add -d @davis7dotsh/runekit
```

## Vite config

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { routesTracker, signalTracker } from '@davis7dotsh/runekit';

export default defineConfig({
	plugins: [sveltekit(), signalTracker(), routesTracker()]
});
```

## Optional monitor UI

```svelte
<script lang="ts">
	import { SignalTrackerMonitor } from '@davis7dotsh/runekit/monitor';
</script>

<SignalTrackerMonitor />
```

## Publish checklist

```bash
bun run format
bun run check
bun run prepack
bun publish --tag alpha
```
