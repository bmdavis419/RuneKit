<script lang="ts">
	import { onSignalChange, type SignalChangeEvent } from 'virtual:signal-tracker';
	import { onMount } from 'svelte';

	type TraceKind = 'count' | 'input';

	let count = $state(0);
	let doubled = $derived(count * 2);
	let name = $state('world');
	let events = $state<SignalChangeEvent[]>([]);
	let activeTrace = $state<TraceKind>('count');

	const traces: Record<TraceKind, { title: string; steps: string[]; compiled: string }> = {
		count: {
			title: 'Trace A: count++',
			steps: [
				'1. Source: onclick={() => count++}',
				'2. Compiled: runtime call uses $.update(...) (or $.set(...))',
				'3. Plugin proxy intercepts $.update/$.set on the local $ namespace',
				'4. Real runtime runs sources.update -> sources.set -> internal_set',
				'5. write version (wv) changes, reactions get scheduled, tracker emits event'
			],
			compiled: `import * as $ from 'svelte/internal/client';\n...\nonclick = () => $.update(count_signal);`
		},
		input: {
			title: 'Trace B: bind:value',
			steps: [
				'1. Source: <input bind:value={name} />',
				'2. Compiled: bind helper writes through a setter using $.set(name_signal, value)',
				'3. Plugin proxy intercepts that $.set call',
				'4. Runtime set/internal_set updates v + wv and marks downstream reactions dirty',
				'5. template/render effects re-run and tracker event shows operation + callsite'
			],
			compiled: `import * as $ from 'svelte/internal/client';\n...\n$.bind_value(input, () => $.get(name_signal), (v) => $.set(name_signal, v));`
		}
	};

	const latest = () => events[0];
	const clearEvents = () => {
		events = [];
	};
	const runCount = () => {
		activeTrace = 'count';
		count++;
	};
	const showInputTrace = () => {
		activeTrace = 'input';
	};

	onMount(() =>
		onSignalChange((event) => {
			events = [event, ...events].slice(0, 20);
		})
	);
</script>

<div class="space-y-6 p-8 font-mono text-sm">
	<h1 class="text-2xl font-bold">Learning: how the signal tap works</h1>
	<p class="max-w-3xl text-slate-600">
		Yes, we hijack the compiled module's <code>$</code> namespace. Any tracked runtime write call (<code
			>set</code
		>, <code>update</code>, <code>update_pre</code>, <code>mutate</code>) goes through our proxy
		first, then into real Svelte internals.
	</p>

	<div class="flex flex-wrap items-center gap-3">
		<button class="rounded bg-blue-600 px-3 py-2 text-white" onclick={runCount}>
			Run count++ trace ({count})
		</button>
		<input
			class="rounded border px-3 py-2"
			bind:value={name}
			onfocus={showInputTrace}
			placeholder="Type to run bind:value trace"
		/>
		<span class="text-slate-600">name: {name}</span>
		<button class="rounded bg-slate-700 px-3 py-2 text-white" onclick={clearEvents}
			>Clear events</button
		>
	</div>

	<div>
		another signal of count: {count}
	</div>

	<div>
		doubled count: {doubled}
	</div>

	<section class="rounded border border-slate-200 bg-slate-50 p-4">
		<h2 class="mb-2 font-semibold">{traces[activeTrace].title}</h2>
		<ol class="list-inside list-decimal space-y-1">
			{#each traces[activeTrace].steps as step}
				<li>{step}</li>
			{/each}
		</ol>
		<pre class="mt-3 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{traces[
				activeTrace
			].compiled}</pre>
	</section>

	<section class="rounded border border-slate-200 p-4">
		<h2 class="mb-2 font-semibold">Latest intercepted event</h2>
		{#if latest()}
			<p>
				operation: <strong>{latest()?.mutation.operation}</strong>
				| label: <strong>{latest()?.label ?? '(unlabeled)'}</strong>
				| downstream updates:
				<strong>{latest()?.downstream.filter((r) => r.updated).length ?? 0}</strong>
			</p>
			<p class="mt-1 text-xs break-all text-slate-600">
				callsite: {latest()?.mutation.callsite ?? '(unknown callsite)'}
			</p>
		{:else}
			<p class="text-slate-600">No events yet. Click the button or type in the input.</p>
		{/if}
	</section>

	<section class="rounded border border-slate-200 p-4">
		<h2 class="mb-2 font-semibold">What this proves</h2>
		<ol class="list-inside list-decimal space-y-1">
			<li>Compiled output calls methods on the local <code>$</code> runtime namespace.</li>
			<li>Your plugin wraps that namespace, so those writes are intercepted.</li>
			<li>
				After interception, the real runtime still executes and schedules reactivity normally.
			</li>
		</ol>
	</section>
</div>
