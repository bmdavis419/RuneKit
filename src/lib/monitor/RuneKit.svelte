<script lang="ts">
	import { onMount } from 'svelte';
	import devToolsIcon from '../assets/dev-tools-icon.png';
	import {
		getRerenderFlashEnabled,
		onSignalChange,
		onSignalRead,
		onSignalWrite,
		registerFlashExclusionRoot,
		setRerenderFlashEnabled,
		setHeatmapEnabled,
		getHeatmapEnabled,
		onRedundantWrite,
		getRedundantWrites,
		clearRedundantWrites,
		onEffectProfile,
		getEffectTimings,
		clearEffectTimings,
		type SignalChangeEvent,
		type SignalReadEvent,
		type SignalWriteEvent,
		type RedundantWriteEvent,
		type EffectTimingEntry
	} from 'virtual:signal-tracker';
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
	import type {
		SignalFeedItem,
		SignalStatsRow,
		RuneKitTab,
		RuneKitProps,
		DashboardHistoryItem
	} from './types.js';

	let {
		position = 'bottom-right',
		maxFeed = 200,
		showAppSignalsOnly = true,
		initialOpen = false,
		zIndex = 2147483640,
		initialTab = 'signals'
	}: RuneKitProps = $props();

	let isOpen = $state(false);
	let activeTab = $state<RuneKitTab>('signals');
	let signalSubTab = $state<'feed' | 'variables'>('feed');
	let networkSubTab = $state<'endpoints' | 'remotes' | 'history'>('endpoints');
	let now = $state(Date.now());

	// --- Signal tracking state ---
	let feed = $state<SignalFeedItem[]>([]);
	let statsByLabel = $state<Record<string, SignalStatsRow>>({});
	let rerenderFlashEnabled = $state(true);
	let heatmapEnabled = $state(false);
	let eventSeq = 0;

	let pendingFeed: SignalFeedItem[] = [];
	let pendingStats: Array<{
		label: string;
		kind: 'read' | 'write';
		timestamp: number;
		operation?: SignalWriteEvent['operation'];
		sourceChain?: string;
	}> = [];
	let frameHandle = 0;
	let rootEl: HTMLDivElement | undefined = undefined;

	// --- Performance state ---
	let redundantWrites = $state<RedundantWriteEvent[]>([]);
	let effectTimings = $state<EffectTimingEntry[]>([]);
	let perfSubTab = $state<'heatmap' | 'effects' | 'redundant'>('heatmap');

	// --- Routes/Network state ---
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

	const routeRows = $derived([...liveRoutes].sort((a, b) => a.id.localeCompare(b.id)));
	const endpointRoutes = $derived(routeRows.filter((r) => r.endpoint));
	const endpointRoute = $derived(
		endpointRoutes.find((r) => r.id === endpointRouteId) ?? endpointRoutes[0]
	);
	const endpointMethods = $derived(
		endpointRoute?.endpoint?.methods.length
			? endpointRoute.endpoint.methods
			: endpointRoute
				? ['GET']
				: []
	);
	const selectedRemote = $derived(liveRemotes.find((e) => e.file === remoteFile) ?? liveRemotes[0]);
	const selectedRemoteExports = $derived(selectedRemote?.exports ?? []);

	$effect(() => {
		if (endpointRoutes.length === 0) {
			endpointRouteId = '';
			return;
		}
		if (!endpointRouteId || !endpointRoutes.some((r) => r.id === endpointRouteId))
			endpointRouteId = endpointRoutes[0].id;
	});

	$effect(() => {
		if (endpointMethods.length > 0 && !endpointMethods.includes(endpointMethod))
			endpointMethod = endpointMethods[0];
	});

	$effect(() => {
		if (liveRemotes.length === 0) {
			remoteFile = '';
			return;
		}
		if (!remoteFile || !liveRemotes.some((e) => e.file === remoteFile))
			remoteFile = liveRemotes[0].file;
	});

	$effect(() => {
		if (selectedRemoteExports.length > 0 && !selectedRemoteExports.includes(remoteExport))
			remoteExport = selectedRemoteExports[0];
	});

	// --- Helpers ---
	const leftClass = () => (position === 'bottom-left' ? 'left-4' : 'right-4');

	const relativeTime = (timestamp: number, currentNow: number) => {
		const d = currentNow - timestamp;
		if (d < 1000) return 'just now';
		if (d < 60000) return `${Math.floor(d / 1000)}s ago`;
		if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
		return `${Math.floor(d / 3600000)}h ago`;
	};

	const stringify = (v: unknown) => {
		if (typeof v === 'string') return v;
		try {
			return JSON.stringify(v);
		} catch {
			return '[unserializable]';
		}
	};

	const pretty = (v: unknown) => {
		if (typeof v === 'string') return v;
		try {
			return JSON.stringify(v, null, 2);
		} catch {
			return '[unserializable]';
		}
	};

	const nextId = (prefix: string, label: string) => {
		eventSeq += 1;
		return `${prefix}:${label || 'unknown'}:${Date.now()}:${eventSeq}`;
	};

	const isAppSignal = (label: string) =>
		label.length > 0 && !label.startsWith('__st') && !label.startsWith('monitor_');

	const includeLabel = (label: string | undefined) => {
		if (typeof label !== 'string' || label.length === 0) return false;
		return !showAppSignalsOnly || isAppSignal(label);
	};

	const includeFeedItem = (item: SignalFeedItem) =>
		showAppSignalsOnly ? isAppSignal(item.label) : item.label.length > 0;

	const queueFeed = (item: SignalFeedItem) => {
		if (!includeFeedItem(item)) return;
		pendingFeed.push(item);
		scheduleFlush();
	};

	const queueStat = (entry: {
		label: string | undefined;
		kind: 'read' | 'write';
		timestamp: number;
		operation?: SignalWriteEvent['operation'];
		sourceChain?: string;
	}) => {
		if (!includeLabel(entry.label)) return;
		pendingStats.push({
			label: entry.label!,
			kind: entry.kind,
			timestamp: entry.timestamp,
			operation: entry.operation,
			sourceChain: entry.sourceChain
		});
		scheduleFlush();
	};

	const scheduleFlush = () => {
		if (frameHandle !== 0) return;
		frameHandle = requestAnimationFrame(() => {
			frameHandle = 0;
			flushPending();
		});
	};

	const flushPending = () => {
		if (pendingFeed.length > 0) {
			feed = [...pendingFeed.reverse(), ...feed].slice(0, Math.max(1, maxFeed));
			pendingFeed = [];
		}
		if (pendingStats.length > 0) {
			const next = { ...statsByLabel };
			for (const s of pendingStats) {
				const existing = next[s.label] ?? {
					label: s.label,
					reads: 0,
					writes: 0,
					lastWriteOp: undefined,
					lastSeenAt: s.timestamp,
					lastChain: s.sourceChain
				};
				if (s.kind === 'read') existing.reads += 1;
				if (s.kind === 'write') {
					existing.writes += 1;
					existing.lastWriteOp = s.operation;
				}
				existing.lastSeenAt = s.timestamp;
				existing.lastChain = s.sourceChain;
				next[s.label] = existing;
			}
			pendingStats = [];
			statsByLabel = next;
		}
	};

	const onChange = (event: SignalChangeEvent) => {
		const label = event.label ?? '';
		queueFeed({
			id: nextId('change', label),
			kind: 'change',
			label,
			timestamp: event.timestamp,
			sourceChain: event.downstream.find((e) => e.updated)?.label,
			oldValue: event.oldValue,
			newValue: event.newValue,
			downstreamUpdated: event.downstream.filter((e) => e.updated).length,
			downstreamTotal: event.downstream.length
		});
	};

	const onRead = (event: SignalReadEvent) => {
		const label = event.label ?? '';
		queueFeed({
			id: nextId('read', label),
			kind: 'read',
			label,
			timestamp: event.timestamp,
			sourceChain: event.sourceChain
		});
		queueStat({
			label: event.label,
			kind: 'read',
			timestamp: event.timestamp,
			sourceChain: event.sourceChain
		});
	};

	const onWrite = (event: SignalWriteEvent) => {
		const label = event.label ?? '';
		queueFeed({
			id: nextId(`write:${event.operation}`, label),
			kind: 'write',
			label,
			timestamp: event.timestamp,
			sourceChain: event.sourceChain,
			operation: event.operation
		});
		queueStat({
			label: event.label,
			kind: 'write',
			timestamp: event.timestamp,
			operation: event.operation,
			sourceChain: event.sourceChain
		});
	};

	const statsRows = () =>
		Object.values(statsByLabel).sort(
			(a, b) => b.reads + b.writes - (a.reads + a.writes) || b.lastSeenAt - a.lastSeenAt
		);

	const sortedEffects = () =>
		[...effectTimings].sort((a, b) => b.maxDuration - a.maxDuration || b.totalRuns - a.totalRuns);

	const sortedRedundant = () =>
		[...redundantWrites].sort((a, b) => b.count - a.count || b.lastTimestamp - a.lastTimestamp);

	const toggleOpen = () => (isOpen = !isOpen);

	const toggleRerenderFlash = () => {
		rerenderFlashEnabled = !rerenderFlashEnabled;
		setRerenderFlashEnabled(rerenderFlashEnabled);
	};

	const toggleHeatmap = () => {
		heatmapEnabled = !heatmapEnabled;
		setHeatmapEnabled(heatmapEnabled);
	};

	const resetSignals = () => {
		feed = [];
		statsByLabel = {};
		pendingFeed = [];
		pendingStats = [];
	};

	const resetPerformance = () => {
		clearRedundantWrites();
		clearEffectTimings();
		redundantWrites = [];
		effectTimings = [];
	};

	const pushHistory = (entry: Omit<DashboardHistoryItem, 'id'>) => {
		runSeq += 1;
		history = [
			{ id: `${entry.kind}:${entry.target}:${Date.now()}:${runSeq}`, ...entry },
			...history
		].slice(0, 80);
	};

	const runEndpoint = async () => {
		if (!endpointRoute) return;
		endpointRunning = true;
		endpointResult = null;
		const startedAt = Date.now();
		try {
			const query = JSON.parse(endpointQueryInput || '{}');
			const headers = JSON.parse(endpointHeadersInput || '{}');
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
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			endpointResult = { error: msg };
			pushHistory({
				kind: 'endpoint',
				timestamp: Date.now(),
				target: `${endpointMethod} ${endpointRoute.id}`,
				input: {},
				error: msg,
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
			const args = JSON.parse(remoteArgsInput || '[]');
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
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			remoteResult = { error: msg };
			pushHistory({
				kind: 'remote',
				timestamp: Date.now(),
				target: `${selectedRemote.name}.${remoteExport}()`,
				input: remoteArgsInput,
				error: msg,
				durationMs: Date.now() - startedAt
			});
		} finally {
			remoteRunning = false;
		}
	};

	const formatDuration = (ms: number) =>
		ms < 1
			? `${(ms * 1000).toFixed(0)}µs`
			: ms < 1000
				? `${ms.toFixed(1)}ms`
				: `${(ms / 1000).toFixed(2)}s`;

	const durationColor = (ms: number) =>
		ms > 16 ? 'text-red-600' : ms > 4 ? 'text-amber-600' : 'text-emerald-600';

	const TABS: { id: RuneKitTab; label: string }[] = [
		{ id: 'signals', label: 'Signals' },
		{ id: 'performance', label: 'Perf' },
		{ id: 'routes', label: 'Routes' },
		{ id: 'network', label: 'Network' }
	];

	onMount(() => {
		isOpen = initialOpen;
		activeTab = initialTab;
		setRerenderFlashEnabled(true);
		rerenderFlashEnabled = getRerenderFlashEnabled();
		heatmapEnabled = getHeatmapEnabled();

		const offFlash = rootEl ? registerFlashExclusionRoot(rootEl) : () => {};
		const offChange = onSignalChange(onChange);
		const offRead = onSignalRead(onRead);
		const offWrite = onSignalWrite(onWrite);
		const offRedundant = onRedundantWrite((e) => {
			redundantWrites = getRedundantWrites();
		});
		const offEffect = onEffectProfile(() => {
			effectTimings = getEffectTimings();
		});

		const timeInterval = setInterval(() => (now = Date.now()), 1000);

		return () => {
			clearInterval(timeInterval);
			offFlash();
			offChange();
			offRead();
			offWrite();
			offRedundant();
			offEffect();
			if (frameHandle !== 0) cancelAnimationFrame(frameHandle);
		};
	});
</script>

<div
	bind:this={rootEl}
	data-signal-tracker-monitor="true"
	class={`fixed bottom-4 ${leftClass()}`}
	style={`z-index:${zIndex}`}
>
	{#if !isOpen}
		<button
			aria-label="Open RuneKit"
			class="group h-12 w-12 overflow-hidden rounded-2xl border border-orange-300/70 bg-white p-0 shadow-[0_10px_30px_rgba(0,0,0,0.15)] transition hover:scale-[1.03] hover:border-[#FF815A]"
			onclick={toggleOpen}
			type="button"
		>
			<img
				alt="RuneKit"
				class="h-full w-full object-cover opacity-95 transition group-hover:opacity-100"
				src={devToolsIcon}
			/>
		</button>
	{:else}
		<section
			class="flex w-[min(94vw,48rem)] flex-col overflow-hidden rounded-2xl border border-[#FF815A]/40 bg-white text-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.2)]"
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between border-b border-[#FF815A]/30 bg-slate-50 px-3 py-1.5"
			>
				<div class="flex items-center gap-0.5">
					{#each TABS as tab (tab.id)}
						<button
							class={`rounded px-2 py-1 text-xs font-semibold transition-colors ${
								activeTab === tab.id
									? 'bg-[#FF815A] text-white'
									: 'text-slate-500 hover:bg-[#FF815A]/10 hover:text-slate-700'
							}`}
							onclick={() => (activeTab = tab.id)}
							type="button"
						>
							{tab.label}
						</button>
					{/each}
				</div>
				<div class="flex items-center gap-2">
					<!-- Heatmap toggle -->
					<button
						class="flex items-center gap-1.5 text-xs text-slate-600"
						onclick={toggleHeatmap}
						type="button"
						title="Toggle heatmap overlay"
					>
						<span class="text-[10px]">Heatmap</span>
						<span
							class={`inline-flex h-4 w-7 items-center rounded-full transition-colors ${heatmapEnabled ? 'bg-rose-500' : 'bg-slate-300'}`}
						>
							<span
								class={`h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${heatmapEnabled ? 'translate-x-3' : 'translate-x-0.5'}`}
							></span>
						</span>
					</button>
					<!-- Flash toggle -->
					<button
						class="flex items-center gap-1.5 text-xs text-slate-600"
						onclick={toggleRerenderFlash}
						type="button"
						title="Toggle re-render flash"
					>
						<span class="text-[10px]">Flash</span>
						<span
							class={`inline-flex h-4 w-7 items-center rounded-full transition-colors ${rerenderFlashEnabled ? 'bg-[#FF815A]' : 'bg-slate-300'}`}
						>
							<span
								class={`h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${rerenderFlashEnabled ? 'translate-x-3' : 'translate-x-0.5'}`}
							></span>
						</span>
					</button>
					<button
						class="text-xs text-slate-400 hover:text-slate-700"
						onclick={toggleOpen}
						type="button">✕</button
					>
				</div>
			</div>

			<!-- Body -->
			<div class="h-[50vh] overflow-auto bg-slate-50 p-3 pb-6 font-mono text-xs">
				<!-- ===== SIGNALS TAB ===== -->
				{#if activeTab === 'signals'}
					<div class="mb-2 flex items-center gap-1">
						<button
							class={`rounded px-2 py-0.5 text-[10px] font-semibold ${signalSubTab === 'feed' ? 'bg-slate-200 text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
							onclick={() => (signalSubTab = 'feed')}
							type="button">Feed</button
						>
						<button
							class={`rounded px-2 py-0.5 text-[10px] font-semibold ${signalSubTab === 'variables' ? 'bg-slate-200 text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
							onclick={() => (signalSubTab = 'variables')}
							type="button">Variables</button
						>
						<button
							class="ml-auto text-[10px] text-slate-400 hover:text-slate-600"
							onclick={resetSignals}
							type="button">Clear</button
						>
					</div>

					{#if signalSubTab === 'feed'}
						{#if feed.length === 0}
							<p class="text-slate-400">No signal activity yet.</p>
						{:else}
							<ul class="space-y-1.5">
								{#each feed as item (item.id)}
									<li class="rounded border border-[#FF815A]/20 bg-white p-2 shadow-sm">
										<div class="flex items-center justify-between gap-2">
											<div class="flex items-center gap-1">
												<span
													class={`rounded px-1 py-0.5 text-[9px] font-bold text-white ${item.kind === 'read' ? 'bg-sky-400' : item.kind === 'write' ? 'bg-[#FF815A]' : 'bg-emerald-500'}`}
												>
													{item.kind}
												</span>
												<span class="font-semibold text-slate-700"
													>{item.label || '(unlabeled)'}</span
												>
												{#if item.operation}
													<span class="text-slate-400">({item.operation})</span>
												{/if}
											</div>
											<span class="text-[10px] text-slate-400"
												>{relativeTime(item.timestamp, now)}</span
											>
										</div>
										{#if item.kind === 'change'}
											<div class="mt-1 text-slate-500">
												<span class="text-red-400">{stringify(item.oldValue)}</span>
												<span class="text-slate-300"> → </span>
												<span class="text-emerald-500">{stringify(item.newValue)}</span>
											</div>
											<div class="mt-0.5 text-[10px] text-slate-400">
												downstream: {item.downstreamUpdated}/{item.downstreamTotal}
											</div>
										{/if}
										{#if item.sourceChain}
											<div class="mt-0.5 text-[10px] break-all text-slate-400">
												chain: {item.sourceChain}
											</div>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					{:else if statsRows().length === 0}
						<p class="text-slate-400">No tracked variables yet.</p>
					{:else}
						<ul class="space-y-1.5">
							{#each statsRows() as row (row.label)}
								<li class="rounded border border-[#FF815A]/20 bg-white p-2 shadow-sm">
									<div class="flex items-center justify-between">
										<span class="font-semibold text-slate-700">{row.label}</span>
										<span class="text-[10px] text-slate-400"
											>{relativeTime(row.lastSeenAt, now)}</span
										>
									</div>
									<div class="mt-1 text-slate-500">
										reads: <span class="font-semibold text-sky-600">{row.reads}</span> · writes:
										<span class="font-semibold text-[#FF815A]">{row.writes}</span>
									</div>
									{#if row.lastChain}
										<div class="mt-0.5 text-[10px] break-all text-slate-400">
											{row.lastChain}
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

					<!-- ===== PERFORMANCE TAB ===== -->
				{:else if activeTab === 'performance'}
					<div class="mb-2 flex items-center gap-1">
						<button
							class={`rounded px-2 py-0.5 text-[10px] font-semibold ${perfSubTab === 'heatmap' ? 'bg-slate-200 text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
							onclick={() => (perfSubTab = 'heatmap')}
							type="button">Heatmap</button
						>
						<button
							class={`rounded px-2 py-0.5 text-[10px] font-semibold ${perfSubTab === 'effects' ? 'bg-slate-200 text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
							onclick={() => (perfSubTab = 'effects')}
							type="button">Effects</button
						>
						<button
							class={`rounded px-2 py-0.5 text-[10px] font-semibold ${perfSubTab === 'redundant' ? 'bg-slate-200 text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
							onclick={() => (perfSubTab = 'redundant')}
							type="button"
						>
							Redundant
							{#if redundantWrites.length > 0}
								<span class="ml-0.5 rounded-full bg-amber-400 px-1 text-[8px] text-white"
									>{redundantWrites.length}</span
								>
							{/if}
						</button>
						<button
							class="ml-auto text-[10px] text-slate-400 hover:text-slate-600"
							onclick={resetPerformance}
							type="button">Clear</button
						>
					</div>

					{#if perfSubTab === 'heatmap'}
						<div class="space-y-3">
							<div class="rounded-xl border border-slate-200 bg-white p-3">
								<div class="flex items-center justify-between">
									<div>
										<h3 class="font-semibold text-slate-700">Render Heatmap</h3>
										<p class="mt-0.5 text-[10px] text-slate-400">
											Highlights DOM elements by update frequency. Hot elements update often.
										</p>
									</div>
									<button
										class={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${heatmapEnabled ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
										onclick={toggleHeatmap}
										type="button"
									>
										{heatmapEnabled ? 'Active' : 'Enable'}
									</button>
								</div>
								{#if heatmapEnabled}
									<div class="mt-3 flex items-center gap-2">
										<span class="text-[10px] text-slate-400">Cold</span>
										<div
											class="h-2 flex-1 rounded-full"
											style="background: linear-gradient(to right, rgba(59,130,246,0.4), rgba(251,146,60,0.7), rgba(251,70,60,1))"
										></div>
										<span class="text-[10px] text-slate-400">Hot</span>
									</div>
									<p class="mt-2 text-[10px] text-slate-400">
										Interact with your app to see elements light up on the page.
									</p>
								{/if}
							</div>
						</div>
					{:else if perfSubTab === 'effects'}
						{#if sortedEffects().length === 0}
							<div class="rounded-xl border border-slate-200 bg-white p-4 text-center">
								<p class="text-slate-400">No effect timings captured yet.</p>
								<p class="mt-1 text-[10px] text-slate-300">
									Interact with your app — effects using $effect() will appear here.
								</p>
							</div>
						{:else}
							<ul class="space-y-1.5">
								{#each sortedEffects() as eff (eff.id)}
									<li class="rounded border border-slate-200 bg-white p-2 shadow-sm">
										<div class="flex items-center justify-between">
											<div class="flex items-center gap-1.5">
												<span
													class="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-700"
													>{eff.kind}</span
												>
												<span class="font-semibold text-slate-700">{eff.label || eff.id}</span>
											</div>
											<span class="text-[10px] text-slate-400">{eff.totalRuns} runs</span>
										</div>
										<div class="mt-1 flex gap-3 text-[10px]">
											<span class="text-slate-500">
												max: <span class={`font-semibold ${durationColor(eff.maxDuration)}`}
													>{formatDuration(eff.maxDuration)}</span
												>
											</span>
											<span class="text-slate-500">
												avg: <span class="font-semibold text-slate-600"
													>{formatDuration(eff.totalDuration / eff.totalRuns)}</span
												>
											</span>
											<span class="text-slate-500">
												total: <span class="font-semibold text-slate-600"
													>{formatDuration(eff.totalDuration)}</span
												>
											</span>
										</div>
										{#if eff.maxDuration > 16}
											<div class="mt-1 flex items-center gap-1 text-[10px] text-red-500">
												<span>⚠</span>
												<span>Exceeds 16ms frame budget</span>
											</div>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					{:else if sortedRedundant().length === 0}
						<div class="rounded-xl border border-slate-200 bg-white p-4 text-center">
							<p class="text-slate-400">No redundant writes detected.</p>
							<p class="mt-1 text-[10px] text-slate-300">
								Redundant writes occur when a signal is set to the same value it already holds.
							</p>
						</div>
					{:else}
						<div class="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
							<p class="text-[10px] font-semibold text-amber-700">
								{redundantWrites.reduce((sum, w) => sum + w.count, 0)} redundant writes across {redundantWrites.length}
								signals
							</p>
							<p class="mt-0.5 text-[10px] text-amber-600">
								These are set() calls where the value didn't actually change — potential
								optimization targets.
							</p>
						</div>
						<ul class="space-y-1.5">
							{#each sortedRedundant() as rw (rw.label)}
								<li class="rounded border border-amber-200 bg-white p-2 shadow-sm">
									<div class="flex items-center justify-between">
										<span class="font-semibold text-slate-700">{rw.label}</span>
										<span
											class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700"
											>×{rw.count}</span
										>
									</div>
									<div class="mt-1 text-[10px] text-slate-400">
										via {rw.operation} · {relativeTime(rw.lastTimestamp, now)}
									</div>
								</li>
							{/each}
						</ul>
					{/if}

					<!-- ===== ROUTES TAB ===== -->
				{:else if activeTab === 'routes'}
					{#if routeRows.length === 0}
						<p class="text-slate-400">No routes discovered.</p>
					{:else}
						<ul class="space-y-1.5">
							{#each routeRows as route (route.id)}
								<li class="rounded border border-slate-200 bg-white p-2 shadow-sm">
									<div class="flex items-center justify-between gap-2">
										<a class="font-semibold text-slate-700 hover:text-[#FF815A]" href={route.id}
											>{route.id}</a
										>
										<div class="flex flex-wrap gap-0.5 text-[9px]">
											{#if route.endpoint}
												{#each route.endpoint.methods as method (method)}
													<span
														class="rounded bg-emerald-100 px-1 py-0.5 font-bold text-emerald-700"
														>{method}</span
													>
												{/each}
											{/if}
											{#if route.page?.load}
												<span class="rounded bg-blue-100 px-1 py-0.5 font-bold text-blue-700"
													>LOAD</span
												>
											{/if}
											{#if route.page?.server?.hasActions}
												<span class="rounded bg-amber-100 px-1 py-0.5 font-bold text-amber-700"
													>ACTIONS</span
												>
											{/if}
											{#if route.remotes.length > 0}
												<span class="rounded bg-rose-100 px-1 py-0.5 font-bold text-rose-700"
													>REMOTE×{route.remotes.length}</span
												>
											{/if}
										</div>
									</div>
									{#if route.params.length > 0}
										<div class="mt-0.5 text-[10px] text-slate-400">
											params: {route.params.join(', ')}
										</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}

					<!-- ===== NETWORK TAB ===== -->
				{:else if activeTab === 'network'}
					<div class="mb-2 flex items-center gap-1">
						<button
							class={`rounded px-2 py-0.5 text-[10px] font-semibold ${networkSubTab === 'endpoints' ? 'bg-slate-200 text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
							onclick={() => (networkSubTab = 'endpoints')}
							type="button">Endpoints</button
						>
						<button
							class={`rounded px-2 py-0.5 text-[10px] font-semibold ${networkSubTab === 'remotes' ? 'bg-slate-200 text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
							onclick={() => (networkSubTab = 'remotes')}
							type="button">Remotes</button
						>
						<button
							class={`rounded px-2 py-0.5 text-[10px] font-semibold ${networkSubTab === 'history' ? 'bg-slate-200 text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
							onclick={() => (networkSubTab = 'history')}
							type="button"
						>
							History
							{#if history.length > 0}
								<span class="ml-0.5 rounded-full bg-slate-400 px-1 text-[8px] text-white"
									>{history.length}</span
								>
							{/if}
						</button>
					</div>

					{#if networkSubTab === 'endpoints'}
						{#if endpointRoutes.length === 0}
							<p class="text-slate-400">No endpoints found.</p>
						{:else}
							<div class="grid gap-2 sm:grid-cols-[10rem,1fr]">
								<div class="space-y-1">
									{#each endpointRoutes as route (route.id)}
										<button
											class={`w-full rounded border px-2 py-1 text-left text-[10px] ${
												endpointRouteId === route.id
													? 'border-[#FF815A] bg-[#FF815A]/10 text-[#c24722]'
													: 'border-slate-200 text-slate-500 hover:border-[#FF815A]/30'
											}`}
											onclick={() => (endpointRouteId = route.id)}
											type="button">{route.id}</button
										>
									{/each}
								</div>
								<div class="space-y-2">
									{#if endpointRoute}
										<div class="flex gap-2">
											<select
												class="rounded border border-slate-300 px-2 py-1 text-[10px]"
												bind:value={endpointMethod}
											>
												{#each endpointMethods as m (m)}
													<option value={m}>{m}</option>
												{/each}
											</select>
											<button
												class="rounded bg-[#FF815A] px-3 py-1 text-[10px] font-semibold text-white disabled:opacity-50"
												disabled={endpointRunning}
												onclick={runEndpoint}
												type="button"
											>
												{endpointRunning ? '...' : 'Send'}
											</button>
										</div>
										<textarea
											class="h-12 w-full rounded border border-slate-200 px-2 py-1 text-[10px]"
											bind:value={endpointQueryInput}
											placeholder="Query JSON"
										></textarea>
										<textarea
											class="h-12 w-full rounded border border-slate-200 px-2 py-1 text-[10px]"
											bind:value={endpointHeadersInput}
											placeholder="Headers JSON"
										></textarea>
										{#if endpointMethod !== 'GET' && endpointMethod !== 'HEAD'}
											<textarea
												class="h-16 w-full rounded border border-slate-200 px-2 py-1 text-[10px]"
												bind:value={endpointBodyInput}
												placeholder="Body JSON"
											></textarea>
										{/if}
										{#if endpointResult}
											<div class="rounded border border-slate-200 bg-white p-2">
												{#if 'error' in endpointResult}
													<p class="text-red-500">{endpointResult.error}</p>
												{:else}
													<p class="text-slate-600">
														{endpointResult.status} · {endpointResult.durationMs}ms
													</p>
													<pre
														class="mt-1 max-h-32 overflow-auto rounded bg-slate-900 p-2 text-[10px] text-slate-100">{pretty(
															endpointResult.body
														)}</pre>
												{/if}
											</div>
										{/if}
									{/if}
								</div>
							</div>
						{/if}
					{:else if networkSubTab === 'remotes'}
						{#if liveRemotes.length === 0}
							<p class="text-slate-400">No .remote.ts files found.</p>
						{:else}
							<div class="grid gap-2 sm:grid-cols-[10rem,1fr]">
								<div class="space-y-1">
									{#each liveRemotes as entry (entry.file)}
										<button
											class={`w-full rounded border px-2 py-1 text-left text-[10px] ${
												remoteFile === entry.file
													? 'border-[#FF815A] bg-[#FF815A]/10 text-[#c24722]'
													: 'border-slate-200 text-slate-500 hover:border-[#FF815A]/30'
											}`}
											onclick={() => (remoteFile = entry.file)}
											type="button">{entry.file}</button
										>
									{/each}
								</div>
								<div class="space-y-2">
									{#if selectedRemote}
										<div class="flex gap-2">
											<select
												class="rounded border border-slate-300 px-2 py-1 text-[10px]"
												bind:value={remoteExport}
											>
												{#each selectedRemoteExports as item (item)}
													<option value={item}>{item}</option>
												{/each}
											</select>
											<button
												class="rounded bg-[#FF815A] px-3 py-1 text-[10px] font-semibold text-white disabled:opacity-50"
												disabled={remoteRunning || !remoteExport}
												onclick={runRemote}
												type="button"
											>
												{remoteRunning ? '...' : 'Invoke'}
											</button>
										</div>
										<textarea
											class="h-16 w-full rounded border border-slate-200 px-2 py-1 text-[10px]"
											bind:value={remoteArgsInput}
											placeholder="Args JSON array"
										></textarea>
										{#if remoteResult}
											<div class="rounded border border-slate-200 bg-white p-2">
												{#if 'error' in remoteResult}
													<p class="text-red-500">{remoteResult.error}</p>
												{:else}
													<p class="text-slate-600">
														{remoteResult.durationMs}ms
													</p>
													<pre
														class="mt-1 max-h-32 overflow-auto rounded bg-slate-900 p-2 text-[10px] text-slate-100">{pretty(
															remoteResult.result
														)}</pre>
												{/if}
											</div>
										{/if}
									{/if}
								</div>
							</div>
						{/if}
					{:else if history.length === 0}
						<p class="text-slate-400">No recorded runs yet.</p>
					{:else}
						<div class="mb-1 flex justify-end">
							<button
								class="text-[10px] text-slate-400 hover:text-slate-600"
								onclick={() => (history = [])}
								type="button">Clear</button
							>
						</div>
						<ul class="space-y-1.5">
							{#each history as item (item.id)}
								<li class="rounded border border-slate-200 bg-white p-2 shadow-sm">
									<div class="flex items-center justify-between">
										<div class="flex items-center gap-1.5">
											<span
												class={`rounded px-1 py-0.5 text-[9px] font-bold ${item.kind === 'endpoint' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}
												>{item.kind}</span
											>
											<span class="font-semibold text-slate-600">{item.target}</span>
										</div>
										<span class="text-[10px] text-slate-400">{item.durationMs}ms</span>
									</div>
									{#if item.error}
										<p class="mt-1 text-[10px] text-red-500">{item.error}</p>
									{:else if item.output !== undefined}
										<pre
											class="mt-1 max-h-20 overflow-auto rounded bg-slate-900 p-1.5 text-[9px] text-slate-200">{pretty(
												item.output
											)}</pre>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>
		</section>
	{/if}
</div>
