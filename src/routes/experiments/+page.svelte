<script lang="ts">
	import { onSignalChange, type SignalChangeEvent } from 'virtual:signal-tracker';
	import { onMount } from 'svelte';

	let count = $state(0);
	const doubled = $derived(count * 2);

	let name = $state('world');
	// The re-entrancy guard in __emit prevents this from causing a feedback loop:
	// when the handler updates `events`, our proxy intercepts the $.set call but
	// __emit skips it because _active is already true.
	let events = $state<SignalChangeEvent[]>([]);

	const stringify = (value: unknown) => {
		try {
			return JSON.stringify(value);
		} catch {
			return '[unserializable]';
		}
	};

	const formatCallsite = (callsite: string | undefined) =>
		callsite?.replace(/^at\s+/, '') ?? '(unknown callsite)';

	const reactionName = (reaction: SignalChangeEvent['downstream'][number]) =>
		reaction.label ??
		reaction.componentName ??
		reaction.fnName ??
		`${reaction.kind}#${reaction.writeVersionAfter ?? reaction.writeVersionBefore ?? '?'}`;

	const updatedDownstream = (event: SignalChangeEvent) =>
		event.downstream.filter((reaction) => reaction.updated);

	const updatedDownstreamNames = (event: SignalChangeEvent) =>
		updatedDownstream(event)
			.map((reaction) => reactionName(reaction))
			.join(', ');

	const updatedDownstreamCount = (event: SignalChangeEvent) => updatedDownstream(event).length;

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

	<div>
		<p>Another signal of count: {count}</p>
		<p>Doubled count: {doubled}</p>
	</div>

	<h2 class="mb-2 text-sm font-semibold text-slate-500">signal events (last 30)</h2>

	<ul class="space-y-1 text-sm">
		{#each events as e, i (`${e.timestamp}:${e.label ?? 'unknown'}:${i}`)}
			<li class="rounded bg-slate-100 px-3 py-2">
				<span class="font-semibold text-blue-700">{e.label ?? '(unlabeled)'}</span>
				<span class="text-slate-400"> · </span>
				<span class="text-red-500">{stringify(e.oldValue)}</span>
				<span class="text-slate-400"> → </span>
				<span class="text-green-600">{stringify(e.newValue)}</span>
				<span class="ml-2 text-xs text-slate-400"
					>{new Date(e.timestamp).toISOString().slice(11, 23)}</span
				>
				<div class="mt-1 text-xs text-slate-500">
					<span class="font-semibold text-slate-600">{e.mutation.operation}</span>
					<span class="text-slate-400"> @ </span>
					<span>{formatCallsite(e.mutation.callsite)}</span>
				</div>
				<div class="mt-1 text-xs text-slate-500">
					<span>downstream updated: </span>
					<span class="font-semibold text-green-700">{updatedDownstreamCount(e)}</span>
					<span> / {e.downstream.length}</span>
					{#if updatedDownstreamCount(e) > 0}
						<span class="text-slate-400"> · </span>
						<span>{updatedDownstreamNames(e)}</span>
					{/if}
				</div>
				{#if e.downstream.length > 0}
					<details class="mt-1 text-xs text-slate-500">
						<summary class="cursor-pointer select-none">show downstream details</summary>
						<ul class="mt-1 space-y-0.5">
							{#each e.downstream as reaction, reactionIndex (`${reaction.kind}:${reactionIndex}`)}
								<li>
									<span class={reaction.updated ? 'text-green-700' : 'text-slate-400'}
										>{reaction.updated ? 'updated' : 'stable'}</span
									>
									<span class="text-slate-400"> · </span>
									<span class="font-semibold text-slate-600">{reaction.kind}</span>
									<span class="text-slate-400"> · </span>
									<span>{reactionName(reaction)}</span>
								</li>
							{/each}
						</ul>
					</details>
				{/if}
			</li>
		{/each}
	</ul>
</div>
