<script lang="ts">
	import { onMount, untrack } from 'svelte';

	// ── Rapid counter (heatmap: high-frequency DOM updates) ──
	let count = $state(0);
	let autoRunning = $state(false);
	let autoInterval: ReturnType<typeof setInterval> | undefined;

	// ── Derived chain (4 levels deep) ──
	const doubled = $derived(count * 2);
	const quadrupled = $derived(doubled * 2);
	const formatted = $derived(
		quadrupled > 1000 ? `${(quadrupled / 1000).toFixed(1)}k` : String(quadrupled)
	);
	const parity = $derived(count % 2 === 0 ? 'even' : 'odd');
	const magnitude = $derived(
		count < 10 ? 'small' : count < 100 ? 'medium' : count < 1000 ? 'large' : 'massive'
	);

	// ── Color mixer (multiple signals → derived style) ──
	let red = $state(120);
	let green = $state(80);
	let blue = $state(200);
	const rgbString = $derived(`rgb(${red}, ${green}, ${blue})`);
	const hexString = $derived(
		'#' +
			[red, green, blue]
				.map((c) =>
					Math.min(255, Math.max(0, Math.round(c)))
						.toString(16)
						.padStart(2, '0')
				)
				.join('')
	);
	const luminance = $derived(Math.round(0.299 * red + 0.587 * green + 0.114 * blue));
	const textColor = $derived(luminance > 128 ? '#1e293b' : '#f8fafc');

	// ── Live clock (constant heatmap pressure) ──
	let clockTime = $state('');
	let clockMs = $state(0);
	let clockRunning = $state(false);
	let clockInterval: ReturnType<typeof setInterval> | undefined;

	// ── Search filter (many reads from derived) ──
	let searchQuery = $state('');
	const ALL_ITEMS = Array.from({ length: 40 }, (_, i) => ({
		id: i,
		name: `Item ${i + 1}`,
		category: ['alpha', 'beta', 'gamma', 'delta'][i % 4],
		value: Math.round(Math.random() * 1000)
	}));
	let items = $state(ALL_ITEMS);
	const filteredItems = $derived(
		searchQuery.length === 0
			? items
			: items.filter(
					(item) =>
						item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
						item.category.toLowerCase().includes(searchQuery.toLowerCase())
				)
	);
	const totalValue = $derived(filteredItems.reduce((sum, item) => sum + item.value, 0));
	const avgValue = $derived(
		filteredItems.length > 0 ? Math.round(totalValue / filteredItems.length) : 0
	);
	const categoryCounts = $derived(
		filteredItems.reduce(
			(acc, item) => {
				acc[item.category] = (acc[item.category] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>
		)
	);

	// ── Redundant write targets ──
	let staleValue = $state('hello');
	let redundantCount = $state(0);

	const fireRedundantWrites = () => {
		for (let i = 0; i < 10; i++) {
			staleValue = 'hello';
		}
		redundantCount += 1;
	};

	// ── Effect with simulated work (effect profiler) ──
	let effectLog = $state<string[]>([]);
	let heavyInput = $state(0);
	let effectWorkMs = $state(5);

	$effect(() => {
		const val = heavyInput;
		const target = effectWorkMs;
		const start = performance.now();
		let x = 0;
		while (performance.now() - start < target) {
			x += Math.sin(x + val);
		}
		const elapsed = performance.now() - start;
		const entry = `[${new Date().toLocaleTimeString()}] Computed with input=${val}, took ${elapsed.toFixed(1)}ms`;
		untrack(() => {
			effectLog = [entry, ...effectLog].slice(0, 12);
		});
	});

	// ── Cascading effects (effect chain) ──
	let cascadeA = $state(0);
	const cascadeB = $derived(cascadeA * 3);
	const cascadeC = $derived(cascadeB + 10);
	const cascadeD = $derived(Math.round(Math.sqrt(Math.abs(cascadeC))));
	const cascadeLabel = $derived(`${cascadeA} → ${cascadeB} → ${cascadeC} → ${cascadeD}`);

	// ── Stress test (burst of many signal updates) ──
	let stressCount = $state(0);
	let stressValues = $state<number[]>([]);
	const stressSum = $derived(stressValues.reduce((a, b) => a + b, 0));
	const stressAvg = $derived(
		stressValues.length > 0 ? Math.round(stressSum / stressValues.length) : 0
	);

	const runStressTest = () => {
		stressCount += 1;
		const burst: number[] = [];
		for (let i = 0; i < 50; i++) {
			burst.push(Math.round(Math.random() * 100));
		}
		stressValues = burst;
		count += burst.length;
		red = Math.round(Math.random() * 255);
		green = Math.round(Math.random() * 255);
		blue = Math.round(Math.random() * 255);
	};

	const toggleAuto = () => {
		autoRunning = !autoRunning;
		if (autoRunning) {
			autoInterval = setInterval(() => (count += 1), 80);
		} else {
			clearInterval(autoInterval);
		}
	};

	const toggleClock = () => {
		clockRunning = !clockRunning;
		if (clockRunning) {
			clockInterval = setInterval(() => {
				const d = new Date();
				clockTime = d.toLocaleTimeString('en-US', { hour12: false });
				clockMs = d.getMilliseconds();
			}, 50);
		} else {
			clearInterval(clockInterval);
		}
	};

	const shuffleItems = () => {
		items = [...items]
			.sort(() => Math.random() - 0.5)
			.map((item, i) => ({
				...item,
				value: Math.round(Math.random() * 1000)
			}));
	};

	onMount(() => {
		return () => {
			clearInterval(autoInterval);
			clearInterval(clockInterval);
		};
	});
</script>

<div
	class="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-6 font-mono text-xs"
>
	<div class="mx-auto max-w-5xl space-y-5">
		<!-- Header -->
		<header class="rounded-2xl border border-[#FF815A]/25 bg-white/90 p-4 shadow-sm">
			<div class="flex items-start justify-between">
				<div>
					<p class="text-[10px] tracking-[0.22em] text-slate-400 uppercase">RuneKit</p>
					<h1 class="mt-1 text-lg font-bold text-slate-800">DevTools Playground</h1>
					<p class="mt-1 max-w-2xl text-slate-500">
						Interactive demo exercising every dev tools feature — heatmap, effect profiler,
						redundant write detection, derived chains, and signal tracking. Open the RuneKit panel
						(bottom-right) and explore.
					</p>
				</div>
				<a href="/" class="text-slate-400 hover:text-[#FF815A]">← home</a>
			</div>
		</header>

		<div class="grid gap-5 lg:grid-cols-2">
			<!-- ═══ Counter + Derived Chain ═══ -->
			<section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
				<h2 class="mb-3 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
					Counter + Derived Chain
				</h2>
				<p class="mb-3 text-[10px] text-slate-400">
					4-level derived chain: count → doubled → quadrupled → formatted. Use auto-increment for
					heatmap pressure.
				</p>
				<div class="mb-4 flex flex-wrap gap-2">
					<button
						class="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700"
						onclick={() => (count += 1)}
					>
						count++ ({count})
					</button>
					<button
						class="rounded-lg bg-slate-200 px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-300"
						onclick={() => (count += 10)}
					>
						+10
					</button>
					<button
						class="rounded-lg bg-slate-200 px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-300"
						onclick={() => (count = 0)}
					>
						reset
					</button>
					<button
						class={`rounded-lg px-3 py-1.5 font-semibold text-white ${autoRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
						onclick={toggleAuto}
					>
						{autoRunning ? '■ stop auto' : '▶ auto-increment'}
					</button>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<div class="rounded-lg bg-slate-50 p-2">
						<span class="text-slate-400">count</span>
						<span class="ml-2 font-bold text-slate-700">{count}</span>
					</div>
					<div class="rounded-lg bg-slate-50 p-2">
						<span class="text-slate-400">doubled</span>
						<span class="ml-2 font-bold text-blue-600">{doubled}</span>
					</div>
					<div class="rounded-lg bg-slate-50 p-2">
						<span class="text-slate-400">quadrupled</span>
						<span class="ml-2 font-bold text-violet-600">{quadrupled}</span>
					</div>
					<div class="rounded-lg bg-slate-50 p-2">
						<span class="text-slate-400">formatted</span>
						<span class="ml-2 font-bold text-emerald-600">{formatted}</span>
					</div>
					<div class="rounded-lg bg-slate-50 p-2">
						<span class="text-slate-400">parity</span>
						<span class="ml-2 font-bold text-amber-600">{parity}</span>
					</div>
					<div class="rounded-lg bg-slate-50 p-2">
						<span class="text-slate-400">magnitude</span>
						<span class="ml-2 font-bold text-rose-600">{magnitude}</span>
					</div>
				</div>
			</section>

			<!-- ═══ Color Mixer ═══ -->
			<section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
				<h2 class="mb-3 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
					Color Mixer
				</h2>
				<p class="mb-3 text-[10px] text-slate-400">
					Three signals → derived rgb/hex/luminance. Every slider drag fires many writes.
				</p>
				<div
					class="mb-4 flex items-center justify-center rounded-xl p-6 text-center shadow-inner"
					style="background-color: {rgbString}; color: {textColor}"
				>
					<div>
						<div class="text-2xl font-bold">{hexString}</div>
						<div class="mt-1 text-sm opacity-80">{rgbString}</div>
						<div class="mt-1 text-[10px] opacity-60">luminance: {luminance}</div>
					</div>
				</div>
				<div class="space-y-2">
					<label class="flex items-center gap-3">
						<span class="w-8 text-red-500">R</span>
						<input type="range" min="0" max="255" bind:value={red} class="flex-1" />
						<span class="w-8 text-right font-bold text-slate-600">{red}</span>
					</label>
					<label class="flex items-center gap-3">
						<span class="w-8 text-green-500">G</span>
						<input type="range" min="0" max="255" bind:value={green} class="flex-1" />
						<span class="w-8 text-right font-bold text-slate-600">{green}</span>
					</label>
					<label class="flex items-center gap-3">
						<span class="w-8 text-blue-500">B</span>
						<input type="range" min="0" max="255" bind:value={blue} class="flex-1" />
						<span class="w-8 text-right font-bold text-slate-600">{blue}</span>
					</label>
				</div>
			</section>

			<!-- ═══ Live Clock ═══ -->
			<section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
				<h2 class="mb-3 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
					Live Clock
				</h2>
				<p class="mb-3 text-[10px] text-slate-400">
					Updates every 50ms — constant heatmap pressure on the clock elements.
				</p>
				<div class="mb-3 flex items-center gap-3">
					<button
						class={`rounded-lg px-3 py-1.5 font-semibold text-white ${clockRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
						onclick={toggleClock}
					>
						{clockRunning ? '■ stop' : '▶ start clock'}
					</button>
				</div>
				<div class="flex items-baseline gap-3 rounded-xl bg-slate-900 p-4">
					<span class="text-3xl font-bold text-emerald-400">
						{clockTime || '--:--:--'}
					</span>
					<span class="text-lg text-emerald-400/60">
						.{String(clockMs).padStart(3, '0')}
					</span>
				</div>
			</section>

			<!-- ═══ Effect Profiler Target ═══ -->
			<section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
				<h2 class="mb-3 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
					Effect Profiler Target
				</h2>
				<p class="mb-3 text-[10px] text-slate-400">
					$effect() that burns CPU for a configurable duration. Shows up in Perf → Effects.
				</p>
				<div class="mb-3 space-y-2">
					<label class="flex items-center gap-3">
						<span class="w-24 text-slate-500">Work (ms)</span>
						<input type="range" min="1" max="50" bind:value={effectWorkMs} class="flex-1" />
						<span class="w-10 text-right font-bold text-slate-600">{effectWorkMs}ms</span>
					</label>
					<div class="flex gap-2">
						<button
							class="rounded-lg bg-violet-600 px-3 py-1.5 font-semibold text-white hover:bg-violet-700"
							onclick={() => (heavyInput += 1)}
						>
							Trigger effect ({heavyInput})
						</button>
						<button
							class="rounded-lg bg-slate-200 px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-300"
							onclick={() => {
								effectWorkMs = 30;
								heavyInput += 1;
							}}
						>
							Trigger heavy (30ms)
						</button>
					</div>
				</div>
				<div class="max-h-32 overflow-auto rounded-lg bg-slate-50 p-2">
					{#if effectLog.length === 0}
						<p class="text-slate-400">No effect runs yet.</p>
					{:else}
						{#each effectLog as line, i (i)}
							<div class="text-[10px] text-slate-500">{line}</div>
						{/each}
					{/if}
				</div>
			</section>

			<!-- ═══ Redundant Writes ═══ -->
			<section class="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
				<h2 class="mb-3 text-[11px] font-semibold tracking-wide text-amber-600 uppercase">
					Redundant Write Generator
				</h2>
				<p class="mb-3 text-[10px] text-amber-600/80">
					Sets staleValue = "hello" 10× per click — value never changes. Check Perf → Redundant in
					the dev tools.
				</p>
				<div class="mb-3 flex items-center gap-3">
					<button
						class="rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-white hover:bg-amber-600"
						onclick={fireRedundantWrites}
					>
						Fire 10 redundant writes
					</button>
					<span class="text-amber-700"
						>clicked {redundantCount}× ({redundantCount * 10} writes)</span
					>
				</div>
				<div class="rounded-lg bg-white p-2">
					<span class="text-slate-400">staleValue =</span>
					<span class="ml-1 font-bold text-slate-700">"{staleValue}"</span>
					<span class="ml-2 text-[10px] text-slate-400">(never changes)</span>
				</div>
			</section>

			<!-- ═══ Cascade Chain ═══ -->
			<section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
				<h2 class="mb-3 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
					Cascade Chain
				</h2>
				<p class="mb-3 text-[10px] text-slate-400">
					A → B(×3) → C(+10) → D(√). Shows deep derived dependency propagation.
				</p>
				<div class="mb-3 flex flex-wrap gap-2">
					<button
						class="rounded-lg bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-700"
						onclick={() => (cascadeA += 1)}
					>
						A++ ({cascadeA})
					</button>
					<button
						class="rounded-lg bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-700"
						onclick={() => (cascadeA += 10)}
					>
						A+10
					</button>
					<button
						class="rounded-lg bg-slate-200 px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-300"
						onclick={() => (cascadeA = 0)}
					>
						reset
					</button>
				</div>
				<div class="rounded-lg bg-slate-50 p-3">
					<div class="flex items-center gap-2 text-sm">
						<span class="rounded bg-sky-100 px-2 py-1 font-bold text-sky-700">{cascadeA}</span>
						<span class="text-slate-300">→</span>
						<span class="rounded bg-sky-100 px-2 py-1 font-bold text-sky-600">{cascadeB}</span>
						<span class="text-slate-300">→</span>
						<span class="rounded bg-sky-100 px-2 py-1 font-bold text-sky-500">{cascadeC}</span>
						<span class="text-slate-300">→</span>
						<span class="rounded bg-sky-100 px-2 py-1 font-bold text-sky-400">{cascadeD}</span>
					</div>
					<div class="mt-2 text-[10px] text-slate-400">
						chain: {cascadeLabel}
					</div>
				</div>
			</section>

			<!-- ═══ Search + Filter (many reads) ═══ -->
			<section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
				<h2 class="mb-3 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
					Filterable List
				</h2>
				<p class="mb-3 text-[10px] text-slate-400">
					40 items, live search. Typing triggers reads across all items + derived aggregates.
				</p>
				<div class="mb-3 flex flex-wrap items-center gap-2">
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="search items..."
						class="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700"
					/>
					<button
						class="rounded-lg bg-slate-200 px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-300"
						onclick={shuffleItems}
					>
						Shuffle values
					</button>
					<span class="text-slate-400">
						{filteredItems.length}/{items.length} items · sum: {totalValue} · avg: {avgValue}
					</span>
				</div>
				<div class="mb-3 flex flex-wrap gap-2">
					{#each Object.entries(categoryCounts) as [cat, cnt] (cat)}
						<span
							class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
						>
							{cat}: {cnt}
						</span>
					{/each}
				</div>
				<div class="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-5">
					{#each filteredItems.slice(0, 20) as item (item.id)}
						<div class="rounded border border-slate-100 bg-slate-50 p-1.5">
							<div class="font-semibold text-slate-600">{item.name}</div>
							<div class="flex justify-between text-[10px]">
								<span class="text-slate-400">{item.category}</span>
								<span class="font-bold text-slate-500">{item.value}</span>
							</div>
						</div>
					{/each}
					{#if filteredItems.length > 20}
						<div
							class="flex items-center justify-center rounded border border-dashed border-slate-200 p-1.5 text-slate-400"
						>
							+{filteredItems.length - 20} more
						</div>
					{/if}
				</div>
			</section>
		</div>

		<!-- ═══ Stress Test ═══ -->
		<section class="rounded-2xl border border-rose-200 bg-rose-50/50 p-4 shadow-sm">
			<h2 class="mb-3 text-[11px] font-semibold tracking-wide text-rose-600 uppercase">
				Stress Test
			</h2>
			<p class="mb-3 text-[10px] text-rose-600/80">
				Fires 50+ signal writes in one burst — updates count, color sliders, and a value array.
				Great for testing heatmap saturation.
			</p>
			<div class="flex flex-wrap items-center gap-3">
				<button
					class="rounded-lg bg-rose-500 px-4 py-2 font-semibold text-white hover:bg-rose-600"
					onclick={runStressTest}
				>
					🔥 Run stress test
				</button>
				<span class="text-rose-700">runs: {stressCount}</span>
				{#if stressValues.length > 0}
					<span class="text-rose-600/70">
						{stressValues.length} values · sum: {stressSum} · avg: {stressAvg}
					</span>
				{/if}
			</div>
			{#if stressValues.length > 0}
				<div class="mt-3 flex flex-wrap gap-1">
					{#each stressValues.slice(0, 30) as v, i (i)}
						<span
							class="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold"
							style="color: hsl({v * 3.6}, 70%, 40%)"
						>
							{v}
						</span>
					{/each}
					{#if stressValues.length > 30}
						<span class="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] text-rose-400">
							+{stressValues.length - 30}
						</span>
					{/if}
				</div>
			{/if}
		</section>

		<footer class="text-center text-[10px] text-slate-300">
			Open the RuneKit panel (bottom-right) → enable Heatmap → interact with the sections above
		</footer>
	</div>
</div>
