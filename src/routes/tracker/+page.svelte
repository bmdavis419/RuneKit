<script lang="ts">
	import { routes, remotes, onRoutesUpdated, onRemotesUpdated } from 'virtual:runekit/routes';

	let liveRoutes = $state([...routes]);
	let liveRemotes = $state([...remotes]);
	let tab = $state<'pages' | 'endpoints' | 'remotes'>('pages');

	$effect(() => onRoutesUpdated((r) => (liveRoutes = [...r])));
	$effect(() => onRemotesUpdated((r) => (liveRemotes = [...r])));

	const pages = $derived(liveRoutes.filter((r) => r.page).sort((a, b) => a.id.localeCompare(b.id)));
	const endpoints = $derived(
		liveRoutes.filter((r) => r.endpoint).sort((a, b) => a.id.localeCompare(b.id))
	);

	const tabCount = $derived(
		tab === 'pages' ? pages.length : tab === 'endpoints' ? endpoints.length : liveRemotes.length
	);
</script>

<div class="min-h-screen bg-slate-100 p-8 font-mono text-xs text-slate-800">
	<div class="mx-auto max-w-2xl">
		<!-- header -->
		<div class="mb-6 flex items-baseline justify-between">
			<div class="flex items-center gap-1">
				<a href="/" class="mr-2 text-slate-400 hover:text-[#FF815A]">← app tree</a>
				{#each ['pages', 'endpoints', 'remotes'] as t (t)}
					<button
						class={`rounded px-2 py-1 font-semibold capitalize ${tab === t ? 'bg-[#FF815A] text-white' : 'text-slate-500 hover:bg-[#FF815A]/10'}`}
						onclick={() => (tab = t as typeof tab)}
						type="button"
					>
						{t}
					</button>
				{/each}
			</div>
			<span class="text-slate-400">{tabCount}</span>
		</div>

		<!-- pages -->
		{#if tab === 'pages'}
			{#if pages.length === 0}
				<p class="text-slate-400">No pages found.</p>
			{:else}
				<ul class="space-y-2">
					{#each pages as route (route.id)}
						<li class="rounded border border-[#FF815A]/25 bg-white p-2.5 shadow-sm">
							<div class="mb-1.5 font-semibold text-slate-700">{route.id}</div>
							<div class="flex flex-wrap gap-1">
								{#if route.layout?.component}
									<span
										class="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700"
										>layout</span
									>
								{/if}
								{#if route.layout?.load}
									<span class="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-500"
										>layout load</span
									>
								{/if}
								{#if route.layout?.server}
									<span class="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-500"
										>layout server</span
									>
								{/if}
								{#if route.page?.component}
									<span
										class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700"
										>page</span
									>
								{/if}
								{#if route.page?.load}
									<span class="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-500"
										>load</span
									>
								{/if}
								{#if route.page?.server?.hasLoad && route.page?.server?.hasActions}
									<span
										class="rounded bg-[#FF815A]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#d4532a]"
										>server load + actions</span
									>
								{:else if route.page?.server?.hasActions}
									<span
										class="rounded bg-[#FF815A]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#d4532a]"
										>actions</span
									>
								{:else if route.page?.server?.hasLoad}
									<span class="rounded bg-[#FF815A]/15 px-1.5 py-0.5 text-[10px] text-[#d4532a]"
										>server load</span
									>
								{/if}
								{#if route.error}
									<span
										class="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600"
										>error</span
									>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			<!-- endpoints -->
		{:else if tab === 'endpoints'}
			{#if endpoints.length === 0}
				<p class="text-slate-400">No endpoints found.</p>
			{:else}
				<ul class="space-y-2">
					{#each endpoints as route (route.id)}
						<li class="rounded border border-[#FF815A]/25 bg-white p-2.5 shadow-sm">
							<div class="mb-1.5 font-semibold text-slate-700">{route.id}</div>
							<div class="flex flex-wrap gap-1">
								{#if route.endpoint && route.endpoint.methods.length > 0}
									{#each route.endpoint.methods as method (method)}
										<span
											class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
											>{method}</span
										>
									{/each}
								{:else}
									<span class="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600"
										>endpoint</span
									>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			<!-- remotes -->
		{:else if liveRemotes.length === 0}
			<p class="text-slate-400">No .remote.ts files found.</p>
		{:else}
			<ul class="space-y-2">
				{#each liveRemotes as remote (remote.file)}
					<li class="rounded border border-[#FF815A]/25 bg-white p-2.5 shadow-sm">
						<div class="mb-1.5 text-slate-500">{remote.file}</div>
						<div class="flex flex-wrap gap-1">
							{#each remote.exports as fn (fn)}
								<span
									class="rounded bg-[#FF815A] px-1.5 py-0.5 text-[10px] font-semibold text-white"
									>{fn}</span
								>
							{/each}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
