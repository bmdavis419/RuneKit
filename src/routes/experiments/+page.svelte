<script lang="ts">
	import { onSignalChange, type SignalChangeEvent } from 'virtual:signal-tracker';
	import { onMount } from 'svelte';

	let count = $state(0);
	let name = $state('world');
	// The re-entrancy guard in __emit prevents this from causing a feedback loop:
	// when the handler updates `events`, our proxy intercepts the $.set call but
	// __emit skips it because _active is already true.
	let events = $state<SignalChangeEvent[]>([]);

	onMount(() => {
		return onSignalChange((e) => {
			console.log('[signal-tracker]', e);
			events = [e, ...events].slice(0, 30);
		});
	});
</script>

<div class="p-8 font-mono">
	<h1 class="mb-6 text-xl font-bold">signal-tracker experiment</h1>

	<div class="mb-6 flex gap-4">
		<button class="rounded bg-blue-600 px-4 py-2 text-white" onclick={() => count++}>
			count++ ({count})
		</button>
		<button class="rounded bg-slate-600 px-4 py-2 text-white" onclick={() => (count = 0)}>
			reset
		</button>
		<input class="rounded border px-3 py-2" bind:value={name} placeholder="type something..." />
	</div>

	<h2 class="mb-2 text-sm font-semibold text-slate-500">signal events (last 30)</h2>

	<ul class="space-y-1 text-sm">
		{#each events as e (e.timestamp + (e.label ?? ''))}
			<li class="rounded bg-slate-100 px-3 py-1.5">
				<span class="font-semibold text-blue-700">{e.label ?? '(unlabeled)'}</span>
				<span class="text-slate-400"> · </span>
				<span class="text-red-500">{JSON.stringify(e.oldValue)}</span>
				<span class="text-slate-400"> → </span>
				<span class="text-green-600">{JSON.stringify(e.newValue)}</span>
				<span class="ml-2 text-xs text-slate-400"
					>{new Date(e.timestamp).toISOString().slice(11, 23)}</span
				>
			</li>
		{/each}
	</ul>
</div>
