<script lang="ts">
	import {
		routes,
		remotes,
		onRoutesUpdated,
		onRemotesUpdated,
		invokeEndpoint,
		invokeRemote,
		type RouteNode,
		type EndpointInvocationResult,
		type RemoteInvocationResult
	} from 'virtual:runekit/routes';
	import type { DashboardHistoryItem, RuneKitDashboardProps } from './types.js';

	let {
		title = 'RuneKit Dashboard',
		maxHistory = 80,
		initialTab = 'routes'
	}: RuneKitDashboardProps = $props();

	let tab = $state<'routes' | 'endpoints' | 'remotes' | 'history'>('routes');
	let liveRoutes = $state<RouteNode[]>([...routes]);
	let liveRemotes = $state([...remotes]);
	let history = $state<DashboardHistoryItem[]>([]);

	let endpointRouteId = $state('');
	let endpointMethod = $state('GET');
	let endpointQueryInput = $state('{}');
	let endpointHeadersInput = $state('{}');
	let endpointBodyInput = $state('{}');
	let endpointRunning = $state(false);
	let endpointResult = $state<EndpointInvocationResult | { error: string } | null>(null);

	let remoteFile = $state('');
	let remoteExport = $state('');
	let remoteArgsInput = $state('[]');
	let remoteRunning = $state(false);
	let remoteResult = $state<RemoteInvocationResult | { error: string } | null>(null);

	let runSeq = 0;

	$effect(() => onRoutesUpdated((next) => (liveRoutes = [...next])));
	$effect(() => onRemotesUpdated((next) => (liveRemotes = [...next])));
	$effect(() => {
		tab = initialTab;
	});

	const routeRows = $derived([...liveRoutes].sort((a, b) => a.id.localeCompare(b.id)));
	const endpointRoutes = $derived(
		routeRows.filter((route) => route.endpoint).sort((a, b) => a.id.localeCompare(b.id))
	);

	const endpointRoute = $derived(
		endpointRoutes.find((route) => route.id === endpointRouteId) ?? endpointRoutes[0]
	);
	const endpointMethods = $derived(
		endpointRoute?.endpoint?.methods.length
			? endpointRoute.endpoint.methods
			: endpointRoute
				? ['GET']
				: []
	);

	const selectedRemote = $derived(
		liveRemotes.find((entry) => entry.file === remoteFile) ?? liveRemotes[0]
	);
	const selectedRemoteExports = $derived(selectedRemote?.exports ?? []);

	const pushHistory = (entry: Omit<DashboardHistoryItem, 'id'>) => {
		runSeq += 1;
		history = [
			{ id: `${entry.kind}:${entry.target}:${Date.now()}:${runSeq}`, ...entry },
			...history
		].slice(0, Math.max(10, maxHistory));
	};

	const parseJsonObject = (raw: string, label: string) => {
		const parsed = JSON.parse(raw || '{}');
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error(`${label} must be a JSON object`);
		}
		return parsed as Record<string, unknown>;
	};

	const parseJsonArray = (raw: string, label: string) => {
		const parsed = JSON.parse(raw || '[]');
		if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array`);
		return parsed;
	};

	const normalizeQuery = (input: Record<string, unknown>) =>
		Object.fromEntries(
			Object.entries(input).map(([key, value]) => {
				if (value === null || value === undefined) return [key, value];
				if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
					return [key, value];
				}
				return [key, JSON.stringify(value)];
			})
		);

	const normalizeHeaders = (input: Record<string, unknown>) =>
		Object.fromEntries(
			Object.entries(input).map(([key, value]) => [key, String(value ?? '')])
		) as Record<string, string>;

	const pretty = (value: unknown) => {
		if (typeof value === 'string') return value;
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return '[unserializable]';
		}
	};

	const relativeTime = (timestamp: number) => {
		const age = Date.now() - timestamp;
		if (age < 1000) return 'just now';
		if (age < 60_000) return `${Math.floor(age / 1000)}s ago`;
		if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
		return `${Math.floor(age / 3_600_000)}h ago`;
	};

	$effect(() => {
		if (endpointRoutes.length === 0) {
			endpointRouteId = '';
			return;
		}
		if (!endpointRouteId || !endpointRoutes.some((route) => route.id === endpointRouteId)) {
			endpointRouteId = endpointRoutes[0].id;
		}
	});

	$effect(() => {
		if (endpointMethods.length === 0) {
			endpointMethod = 'GET';
			return;
		}
		if (!endpointMethods.includes(endpointMethod)) endpointMethod = endpointMethods[0];
	});

	$effect(() => {
		if (liveRemotes.length === 0) {
			remoteFile = '';
			return;
		}
		if (!remoteFile || !liveRemotes.some((entry) => entry.file === remoteFile)) {
			remoteFile = liveRemotes[0].file;
		}
	});

	$effect(() => {
		if (selectedRemoteExports.length === 0) {
			remoteExport = '';
			return;
		}
		if (!selectedRemoteExports.includes(remoteExport)) remoteExport = selectedRemoteExports[0];
	});

	const runEndpoint = async () => {
		if (!endpointRoute) return;

		endpointRunning = true;
		endpointResult = null;
		const startedAt = Date.now();

		try {
			const query = normalizeQuery(parseJsonObject(endpointQueryInput, 'Query'));
			const headers = normalizeHeaders(parseJsonObject(endpointHeadersInput, 'Headers'));
			const body =
				endpointMethod === 'GET' || endpointMethod === 'HEAD'
					? undefined
					: JSON.parse(endpointBodyInput || '{}');

			const result = await invokeEndpoint({
				path: endpointRoute.id,
				method: endpointMethod,
				query,
				headers,
				body
			});

			endpointResult = result;
			pushHistory({
				kind: 'endpoint',
				timestamp: Date.now(),
				target: `${endpointMethod} ${endpointRoute.id}`,
				input: { query, headers, body },
				output: result.body,
				status: result.status,
				durationMs: result.durationMs
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			endpointResult = { error: message };
			pushHistory({
				kind: 'endpoint',
				timestamp: Date.now(),
				target: `${endpointMethod} ${endpointRoute.id}`,
				input: {
					query: endpointQueryInput,
					headers: endpointHeadersInput,
					body: endpointBodyInput
				},
				error: message,
				durationMs: Date.now() - startedAt
			});
		} finally {
			endpointRunning = false;
		}
	};

	const runRemote = async () => {
		if (!selectedRemote || !remoteExport) return;

		remoteRunning = true;
		remoteResult = null;
		const startedAt = Date.now();

		try {
			const args = parseJsonArray(remoteArgsInput, 'Arguments');
			const result = await invokeRemote(selectedRemote.file, remoteExport, args);
			remoteResult = result;
			pushHistory({
				kind: 'remote',
				timestamp: Date.now(),
				target: `${selectedRemote.name}.${remoteExport}()`,
				input: args,
				output: result.result,
				durationMs: result.durationMs
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			remoteResult = { error: message };
			pushHistory({
				kind: 'remote',
				timestamp: Date.now(),
				target: `${selectedRemote.name}.${remoteExport}()`,
				input: remoteArgsInput,
				error: message,
				durationMs: Date.now() - startedAt
			});
		} finally {
			remoteRunning = false;
		}
	};
</script>

<div
	class="min-h-screen bg-gradient-to-b from-[#fffaf5] via-[#fff] to-[#f8fafc] p-6 font-mono text-xs text-slate-800"
>
	<div class="mx-auto max-w-6xl space-y-5">
		<header
			class="rounded-2xl border border-[#FF815A]/25 bg-white/90 p-4 shadow-sm backdrop-blur-sm"
		>
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p class="text-[10px] tracking-[0.22em] text-slate-400 uppercase">RuneKit</p>
					<h1 class="mt-1 text-lg font-bold text-slate-800">{title}</h1>
					<p class="mt-1 max-w-3xl text-slate-500">
						Inspect routes, execute endpoints, and invoke remote functions with live input/output
						traces.
					</p>
				</div>
				<div class="grid grid-cols-3 gap-2 text-right text-[10px]">
					<div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
						<p class="text-slate-400">Routes</p>
						<p class="mt-0.5 text-sm font-semibold text-slate-700">{routeRows.length}</p>
					</div>
					<div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
						<p class="text-slate-400">Endpoints</p>
						<p class="mt-0.5 text-sm font-semibold text-slate-700">{endpointRoutes.length}</p>
					</div>
					<div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
						<p class="text-slate-400">Remotes</p>
						<p class="mt-0.5 text-sm font-semibold text-slate-700">{liveRemotes.length}</p>
					</div>
				</div>
			</div>
		</header>

		<div class="flex flex-wrap gap-2">
			{#each ['routes', 'endpoints', 'remotes', 'history'] as nextTab (nextTab)}
				<button
					class={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase ${
						tab === nextTab
							? 'border-[#FF815A] bg-[#FF815A] text-white'
							: 'border-slate-200 bg-white text-slate-600 hover:border-[#FF815A]/45 hover:text-[#d4532a]'
					}`}
					onclick={() => (tab = nextTab as typeof tab)}
					type="button"
				>
					{nextTab}
				</button>
			{/each}
		</div>

		{#if tab === 'routes'}
			<section class="rounded-2xl border border-[#FF815A]/20 bg-white p-4 shadow-sm">
				{#if routeRows.length === 0}
					<p class="text-slate-400">No routes discovered.</p>
				{:else}
					<ul class="space-y-2">
						{#each routeRows as route (route.id)}
							<li class="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<a class="font-semibold text-slate-700 hover:text-[#d4532a]" href={route.id}
										>{route.id}</a
									>
									<div class="flex flex-wrap gap-1 text-[10px]">
										{#if route.endpoint}
											{#if route.endpoint.methods.length > 0}
												{#each route.endpoint.methods as method (method)}
													<span
														class="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-700"
														>{method}</span
													>
												{/each}
											{:else}
												<span
													class="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-700"
													>ENDPOINT</span
												>
											{/if}
										{/if}
										{#if route.page?.load}
											<span class="rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-700"
												>LOAD</span
											>
										{/if}
										{#if route.page?.server?.hasActions}
											<span class="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700"
												>ACTIONS</span
											>
										{/if}
										{#if route.remotes.length > 0}
											<span class="rounded bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-700"
												>REMOTE×{route.remotes.length}</span
											>
										{/if}
									</div>
								</div>
								{#if route.params.length > 0}
									<div class="mt-1 text-[10px] text-slate-500">
										params: {route.params.join(', ')}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{:else if tab === 'endpoints'}
			<section class="grid gap-4 lg:grid-cols-[18rem,1fr]">
				<div class="rounded-2xl border border-[#FF815A]/20 bg-white p-3 shadow-sm">
					<h2 class="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
						Endpoints
					</h2>
					{#if endpointRoutes.length === 0}
						<p class="text-slate-400">No endpoints found.</p>
					{:else}
						<ul class="space-y-1">
							{#each endpointRoutes as route (route.id)}
								<li>
									<button
										class={`w-full rounded-lg border px-2 py-1.5 text-left ${
											endpointRouteId === route.id
												? 'border-[#FF815A] bg-[#FF815A]/8 text-[#c24722]'
												: 'border-slate-200 bg-slate-50 text-slate-600 hover:border-[#FF815A]/40'
										}`}
										onclick={() => (endpointRouteId = route.id)}
										type="button"
									>
										{route.id}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<div class="space-y-3 rounded-2xl border border-[#FF815A]/20 bg-white p-4 shadow-sm">
					{#if !endpointRoute}
						<p class="text-slate-400">Select an endpoint route.</p>
					{:else}
						<div class="grid gap-2 sm:grid-cols-[8rem,1fr] sm:items-center">
							<label class="text-slate-500" for="endpoint-method">Method</label>
							<select
								id="endpoint-method"
								class="rounded border border-slate-300 px-2 py-1.5"
								bind:value={endpointMethod}
							>
								{#each endpointMethods as method (method)}
									<option value={method}>{method}</option>
								{/each}
							</select>

							<label class="text-slate-500" for="endpoint-query">Query JSON</label>
							<textarea
								id="endpoint-query"
								class="h-16 rounded border border-slate-300 px-2 py-1.5"
								bind:value={endpointQueryInput}
							></textarea>

							<label class="text-slate-500" for="endpoint-headers">Headers JSON</label>
							<textarea
								id="endpoint-headers"
								class="h-16 rounded border border-slate-300 px-2 py-1.5"
								bind:value={endpointHeadersInput}
							></textarea>

							<label class="text-slate-500" for="endpoint-body">Body JSON</label>
							<textarea
								id="endpoint-body"
								class="h-24 rounded border border-slate-300 px-2 py-1.5"
								disabled={endpointMethod === 'GET' || endpointMethod === 'HEAD'}
								bind:value={endpointBodyInput}
							></textarea>
						</div>

						<div class="flex items-center gap-3">
							<button
								class="rounded-lg bg-[#FF815A] px-3 py-1.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
								disabled={endpointRunning}
								onclick={runEndpoint}
								type="button"
							>
								{endpointRunning ? 'Running...' : 'Send Request'}
							</button>
							<span class="text-[10px] text-slate-400">target: {endpointRoute.id}</span>
						</div>

						{#if endpointResult !== null}
							<div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
								{#if 'error' in endpointResult}
									<p class="font-semibold text-red-600">{endpointResult.error}</p>
								{:else}
									<p class="font-semibold text-slate-700">
										status {endpointResult.status} · {endpointResult.durationMs}ms
									</p>
									<pre
										class="mt-2 overflow-auto rounded bg-slate-900/95 p-3 text-[11px] text-slate-100">{pretty(
											{ headers: endpointResult.headers, body: endpointResult.body }
										)}</pre>
								{/if}
							</div>
						{/if}
					{/if}
				</div>
			</section>
		{:else if tab === 'remotes'}
			<section class="grid gap-4 lg:grid-cols-[18rem,1fr]">
				<div class="rounded-2xl border border-[#FF815A]/20 bg-white p-3 shadow-sm">
					<h2 class="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
						Remote Modules
					</h2>
					{#if liveRemotes.length === 0}
						<p class="text-slate-400">No `.remote.ts` files found.</p>
					{:else}
						<ul class="space-y-1">
							{#each liveRemotes as entry (entry.file)}
								<li>
									<button
										class={`w-full rounded-lg border px-2 py-1.5 text-left ${
											remoteFile === entry.file
												? 'border-[#FF815A] bg-[#FF815A]/8 text-[#c24722]'
												: 'border-slate-200 bg-slate-50 text-slate-600 hover:border-[#FF815A]/40'
										}`}
										onclick={() => (remoteFile = entry.file)}
										type="button"
									>
										{entry.file}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<div class="space-y-3 rounded-2xl border border-[#FF815A]/20 bg-white p-4 shadow-sm">
					{#if !selectedRemote}
						<p class="text-slate-400">Select a remote module.</p>
					{:else}
						<div class="grid gap-2 sm:grid-cols-[8rem,1fr] sm:items-center">
							<label class="text-slate-500" for="remote-export">Export</label>
							<select
								id="remote-export"
								class="rounded border border-slate-300 px-2 py-1.5"
								bind:value={remoteExport}
							>
								{#each selectedRemoteExports as item (item)}
									<option value={item}>{item}</option>
								{/each}
							</select>

							<label class="text-slate-500" for="remote-args">Args JSON</label>
							<textarea
								id="remote-args"
								class="h-24 rounded border border-slate-300 px-2 py-1.5"
								bind:value={remoteArgsInput}
							></textarea>
						</div>

						<div class="flex items-center gap-3">
							<button
								class="rounded-lg bg-[#FF815A] px-3 py-1.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
								disabled={remoteRunning || !remoteExport}
								onclick={runRemote}
								type="button"
							>
								{remoteRunning ? 'Invoking...' : 'Invoke Remote'}
							</button>
							<span class="text-[10px] text-slate-400">module: {selectedRemote.modulePath}</span>
						</div>

						{#if remoteResult !== null}
							<div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
								{#if 'error' in remoteResult}
									<p class="font-semibold text-red-600">{remoteResult.error}</p>
								{:else}
									<p class="font-semibold text-slate-700">duration {remoteResult.durationMs}ms</p>
									<pre
										class="mt-2 overflow-auto rounded bg-slate-900/95 p-3 text-[11px] text-slate-100">{pretty(
											remoteResult.result
										)}</pre>
								{/if}
							</div>
						{/if}
					{/if}
				</div>
			</section>
		{:else}
			<section class="rounded-2xl border border-[#FF815A]/20 bg-white p-4 shadow-sm">
				<div class="mb-3 flex items-center justify-between">
					<h2 class="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
						Execution History
					</h2>
					<button
						class="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-500 hover:border-[#FF815A]/40"
						onclick={() => (history = [])}
						type="button"
					>
						Clear
					</button>
				</div>

				{#if history.length === 0}
					<p class="text-slate-400">No recorded runs yet.</p>
				{:else}
					<ul class="space-y-2">
						{#each history as item (item.id)}
							<li class="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<div class="flex items-center gap-2">
										<span
											class={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
												item.kind === 'endpoint'
													? 'bg-emerald-100 text-emerald-700'
													: 'bg-rose-100 text-rose-700'
											}`}>{item.kind}</span
										>
										<span class="font-semibold text-slate-700">{item.target}</span>
									</div>
									<span class="text-[10px] text-slate-400">{relativeTime(item.timestamp)}</span>
								</div>
								<div class="mt-1 text-[10px] text-slate-500">
									{item.durationMs}ms{item.status ? ` · status ${item.status}` : ''}
								</div>
								<pre
									class="mt-2 overflow-auto rounded bg-slate-900/95 p-3 text-[11px] text-slate-100">{pretty(
										{
											input: item.input,
											output: item.output,
											error: item.error
										}
									)}</pre>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</div>
</div>
