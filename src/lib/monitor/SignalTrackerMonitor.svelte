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
		type SignalChangeEvent,
		type SignalReadEvent,
		type SignalWriteEvent
	} from 'virtual:signal-tracker';
	import type { SignalFeedItem, SignalStatsRow, SignalTrackerMonitorProps } from './types.js';

	let {
		position = 'bottom-right',
		maxFeed = 200,
		showAppSignalsOnly = true,
		initialOpen = false,
		zIndex = 2147483640,
		initialRerenderFlashEnabled = true
	}: SignalTrackerMonitorProps = $props();

	let monitor_isOpen = $state(false);
	let monitor_activeTab = $state<'feed' | 'variables' | 'timeline'>('feed');
	let monitor_feed = $state<SignalFeedItem[]>([]);
	let monitor_statsByLabel = $state<Record<string, SignalStatsRow>>({});
	let monitor_rerenderFlashEnabled = $state(true);
	let monitor_eventSeq = 0;
	let now = $state(Date.now());

	let pendingFeed: SignalFeedItem[] = [];
	let pendingStats: Array<{
		label: string;
		kind: 'read' | 'write';
		timestamp: number;
		operation?: SignalWriteEvent['operation'];
		sourceChain?: string;
	}> = [];
	let frameHandle = 0;
	let monitor_rootEl: HTMLDivElement | undefined = undefined;

	const leftClass = () => (position === 'bottom-left' ? 'left-4' : 'right-4');

	const relativeTime = (timestamp: number, currentNow: number) => {
		const diffMs = currentNow - timestamp;
		if (diffMs < 1000) return 'just now';
		const diffSec = Math.floor(diffMs / 1000);
		if (diffSec < 60) return `${diffSec}s ago`;
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHour = Math.floor(diffMin / 60);
		return `${diffHour}h ago`;
	};

	const stringify = (value: unknown) => {
		if (typeof value === 'string') return value;
		try {
			return JSON.stringify(value);
		} catch {
			return '[unserializable]';
		}
	};

	const nextId = (prefix: string, label: string) => {
		monitor_eventSeq += 1;
		return `${prefix}:${label || 'unknown'}:${Date.now()}:${monitor_eventSeq}`;
	};

	const isAppSignal = (label: string) =>
		label.length > 0 && !label.startsWith('__st') && !label.startsWith('monitor_');

	const includeLabel = (label: string | undefined) => {
		if (typeof label !== 'string' || label.length === 0) return false;
		if (!showAppSignalsOnly) return true;
		return isAppSignal(label);
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
			const nextFeed = [...pendingFeed.reverse(), ...monitor_feed].slice(0, Math.max(1, maxFeed));
			pendingFeed = [];
			monitor_feed = nextFeed;
		}

		if (pendingStats.length > 0) {
			const next = { ...monitor_statsByLabel };
			for (const stat of pendingStats) {
				const existing = next[stat.label] ?? {
					label: stat.label,
					reads: 0,
					writes: 0,
					lastWriteOp: undefined,
					lastSeenAt: stat.timestamp,
					lastChain: stat.sourceChain
				};
				if (stat.kind === 'read') existing.reads += 1;
				if (stat.kind === 'write') {
					existing.writes += 1;
					existing.lastWriteOp = stat.operation;
				}
				existing.lastSeenAt = stat.timestamp;
				existing.lastChain = stat.sourceChain;
				next[stat.label] = existing;
			}
			pendingStats = [];
			monitor_statsByLabel = next;
		}
	};

	const onChange = (event: SignalChangeEvent) => {
		const label = event.label ?? '';
		const id = nextId('change', label);
		queueFeed({
			id,
			kind: 'change',
			label,
			timestamp: event.timestamp,
			sourceChain: event.downstream.find((entry) => entry.updated)?.label,
			oldValue: event.oldValue,
			newValue: event.newValue,
			downstreamUpdated: event.downstream.filter((entry) => entry.updated).length,
			downstreamTotal: event.downstream.length
		});
	};

	const onRead = (event: SignalReadEvent) => {
		const label = event.label ?? '';
		const id = nextId('read', label);
		queueFeed({
			id,
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
		const id = nextId(`write:${event.operation}`, label);
		queueFeed({
			id,
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
		Object.values(monitor_statsByLabel).sort(
			(a, b) => b.reads + b.writes - (a.reads + a.writes) || b.lastSeenAt - a.lastSeenAt
		);

	const formatRelMs = (ms: number) =>
		ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;

	const kindOrder = { read: 0, write: 1, change: 2 } as const;

	const TRACK_PX = 340;
	const MAX_GAP_MS = 800;

	const niceTickIntervalMs = (span: number) => {
		if (span < 500) return 100;
		if (span < 2000) return 500;
		if (span < 10000) return 1000;
		if (span < 30000) return 5000;
		if (span < 120000) return 15000;
		return 30000;
	};

	const timelineData = () => {
		const items = [...monitor_feed].sort((a, b) => a.timestamp - b.timestamp);
		if (items.length === 0) return null;

		const byLabel: Record<string, SignalFeedItem[]> = {};
		for (const item of items) (byLabel[item.label] ??= []).push(item);
		for (const label of Object.keys(byLabel))
			byLabel[label].sort(
				(a, b) => a.timestamp - b.timestamp || kindOrder[a.kind] - kindOrder[b.kind]
			);

		const minTs = items[0].timestamp;
		const maxTs = items[items.length - 1].timestamp;
		const span = Math.max(maxTs - minTs, 1);

		// Build compressed scale: cap large inter-event gaps to MAX_GAP_MS
		const eventTs = [...new Set(items.map((i) => i.timestamp))].sort((a, b) => a - b);
		const compressedTs: number[] = [0];
		for (let i = 1; i < eventTs.length; i++)
			compressedTs.push(compressedTs[i - 1] + Math.min(eventTs[i] - eventTs[i - 1], MAX_GAP_MS));
		const totalCompressed = compressedTs[compressedTs.length - 1] || 1;

		const toX = (ts: number): number => {
			if (ts <= eventTs[0]) return 0;
			if (ts >= eventTs[eventTs.length - 1]) return TRACK_PX;
			let lo = 0;
			for (let i = 1; i < eventTs.length; i++) {
				if (eventTs[i] >= ts) {
					lo = i - 1;
					break;
				}
			}
			const frac = (ts - eventTs[lo]) / (eventTs[lo + 1] - eventTs[lo]);
			return (
				((compressedTs[lo] + frac * (compressedTs[lo + 1] - compressedTs[lo])) / totalCompressed) *
				TRACK_PX
			);
		};

		const labels = Object.keys(byLabel).sort((a, b) => a.localeCompare(b));

		const intervalMs = niceTickIntervalMs(span);
		const ticks: { ms: number; x: number }[] = [{ ms: 0, x: 0 }];
		for (let ms = intervalMs; ms < span; ms += intervalMs) ticks.push({ ms, x: toX(minTs + ms) });
		ticks.push({ ms: span, x: TRACK_PX });

		const lastKnown: Record<string, unknown> = {};
		const stateByItemId: Record<string, unknown> = {};
		for (const item of items) {
			stateByItemId[item.id] = lastKnown[item.label];
			if (item.kind === 'change') lastKnown[item.label] = item.newValue;
		}

		return { labels, byLabel, minTs, maxTs, span, toX, ticks, stateByItemId };
	};

	let monitor_tooltip = $state<{
		item: SignalFeedItem;
		valueAtTime: unknown;
		minTs: number;
		x: number;
		y: number;
		flipDown: boolean;
	} | null>(null);

	const TOOLTIP_W = 224;
	const TOOLTIP_H = 110;

	const showTooltip = (
		e: MouseEvent,
		item: SignalFeedItem,
		valueAtTime: unknown,
		minTs: number
	) => {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const dotCx = rect.left + rect.width / 2;
		const x = Math.max(8, Math.min(window.innerWidth - TOOLTIP_W - 8, dotCx - TOOLTIP_W / 2));
		const flipDown = rect.top - TOOLTIP_H - 8 < 0;
		monitor_tooltip = {
			item,
			valueAtTime,
			minTs,
			x,
			y: flipDown ? rect.bottom : rect.top,
			flipDown
		};
	};

	const hideTooltip = () => {
		monitor_tooltip = null;
	};

	const toggleOpen = () => {
		monitor_isOpen = !monitor_isOpen;
	};

	const toggleRerenderFlash = () => {
		monitor_rerenderFlashEnabled = !monitor_rerenderFlashEnabled;
		setRerenderFlashEnabled(monitor_rerenderFlashEnabled);
	};

	const resetData = () => {
		monitor_feed = [];
		monitor_statsByLabel = {};
		pendingFeed = [];
		pendingStats = [];
	};

	onMount(() => {
		monitor_isOpen = initialOpen;
		setRerenderFlashEnabled(initialRerenderFlashEnabled);
		monitor_rerenderFlashEnabled = getRerenderFlashEnabled();
		const offFlashExclusion = monitor_rootEl
			? registerFlashExclusionRoot(monitor_rootEl)
			: () => {};

		const offChange = onSignalChange(onChange);
		const offRead = onSignalRead(onRead);
		const offWrite = onSignalWrite(onWrite);

		const timeInterval = setInterval(() => {
			now = Date.now();
		}, 1000);

		return () => {
			clearInterval(timeInterval);
			offFlashExclusion();
			offChange();
			offRead();
			offWrite();
			if (frameHandle !== 0) cancelAnimationFrame(frameHandle);
		};
	});
</script>

<div
	id="monitor-root"
	bind:this={monitor_rootEl}
	data-signal-tracker-monitor="true"
	class={`fixed bottom-4 ${leftClass()}`}
	style={`z-index:${zIndex}`}
>
	{#if !monitor_isOpen}
		<button
			id="monitor-open-btn"
			aria-label="Open signal monitor"
			class="group h-12 w-12 overflow-hidden rounded-2xl border border-orange-300/70 bg-white p-0 shadow-[0_10px_30px_rgba(0,0,0,0.15)] transition hover:scale-[1.03] hover:border-[#FF815A]"
			onclick={toggleOpen}
			type="button"
		>
			<img
				alt="Signal tracker monitor"
				class="h-full w-full object-cover opacity-95 transition group-hover:opacity-100"
				src={devToolsIcon}
			/>
		</button>
	{:else}
		<section
			id="monitor-panel"
			class="w-[min(94vw,40rem)] overflow-hidden rounded-2xl border border-[#FF815A]/40 bg-white text-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.2)]"
		>
			<div
				id="monitor-header"
				class="flex items-center justify-between border-b border-[#FF815A]/30 bg-slate-50 px-3 py-2"
			>
				<div class="flex items-center gap-1" id="monitor-tabs">
					<button
						id="monitor-tab-feed"
						class={`rounded px-2 py-1 text-xs font-semibold ${
							monitor_activeTab === 'feed'
								? 'bg-[#FF815A] text-white'
								: 'text-slate-600 hover:bg-[#FF815A]/10'
						}`}
						onclick={() => (monitor_activeTab = 'feed')}
						type="button"
					>
						Feed
					</button>
					<button
						id="monitor-tab-variables"
						class={`rounded px-2 py-1 text-xs font-semibold ${
							monitor_activeTab === 'variables'
								? 'bg-[#FF815A] text-white'
								: 'text-slate-600 hover:bg-[#FF815A]/10'
						}`}
						onclick={() => (monitor_activeTab = 'variables')}
						type="button"
					>
						Variables
					</button>
					<button
						id="monitor-tab-timeline"
						class={`rounded px-2 py-1 text-xs font-semibold ${
							monitor_activeTab === 'timeline'
								? 'bg-[#FF815A] text-white'
								: 'text-slate-600 hover:bg-[#FF815A]/10'
						}`}
						onclick={() => (monitor_activeTab = 'timeline')}
						type="button"
					>
						Timeline
					</button>
				</div>
				<div class="flex items-center gap-3" id="monitor-controls">
					<button
						id="monitor-close-btn"
						class="text-xs text-slate-500 hover:text-slate-800"
						onclick={toggleOpen}
						type="button"
					>
						Close
					</button>
					<button
						id="monitor-rerender-btn"
						class="flex items-center gap-2 text-xs text-slate-600"
						onclick={toggleRerenderFlash}
						type="button"
					>
						<span>Re-renders</span>
						<span
							class={`inline-flex h-5 w-9 items-center rounded-full transition-colors ${
								monitor_rerenderFlashEnabled ? 'bg-[#FF815A]' : 'bg-slate-300'
							}`}
						>
							<span
								class={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
									monitor_rerenderFlashEnabled ? 'translate-x-4' : 'translate-x-0.5'
								}`}
							></span>
						</span>
					</button>
				</div>
			</div>

			<div class="h-[55vh] overflow-auto bg-slate-50 p-3 pb-6 font-mono text-xs">
				{#if monitor_activeTab === 'feed'}
					{#if monitor_feed.length === 0}
						<p class="text-slate-500">No signal activity yet.</p>
					{:else}
						<ul class="space-y-2">
							{#each monitor_feed as item (item.id)}
								<li class="rounded border border-[#FF815A]/25 bg-white p-2 shadow-sm">
									<div class="flex items-center justify-between gap-2">
										<div class="flex items-center gap-1">
											<span
												class="rounded bg-[#FF815A] px-1.5 py-0.5 text-[10px] font-semibold text-white"
												>{item.kind}</span
											>
											<span class="font-semibold text-slate-800">{item.label || '(unlabeled)'}</span
											>
											{#if item.operation}
												<span class="text-slate-500">({item.operation})</span>
											{/if}
										</div>
										<span class="text-slate-400">{relativeTime(item.timestamp, now)}</span>
									</div>
									{#if item.kind === 'change'}
										<div class="mt-1 text-slate-600">
											{stringify(item.oldValue)} → {stringify(item.newValue)}
										</div>
										<div class="mt-1 text-slate-500">
											downstream: {item.downstreamUpdated ?? 0}/{item.downstreamTotal ?? 0}
										</div>
									{/if}
									{#if item.sourceChain}
										<div class="mt-1 break-all text-slate-500">chain: {item.sourceChain}</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{:else if monitor_activeTab === 'variables'}
					{#if statsRows().length === 0}
						<p class="text-slate-500">No tracked variables yet.</p>
					{:else}
						<ul class="space-y-2">
							{#each statsRows() as row (row.label)}
								<li class="rounded border border-[#FF815A]/25 bg-white p-2 shadow-sm">
									<div class="flex items-center justify-between gap-2">
										<span class="font-semibold text-slate-800">{row.label}</span>
										<span class="text-slate-400">{relativeTime(row.lastSeenAt, now)}</span>
									</div>
									<div class="mt-1 text-slate-600">reads: {row.reads} · writes: {row.writes}</div>
									<div class="mt-1 text-slate-500">last write: {row.lastWriteOp ?? '—'}</div>
									{#if row.lastChain}
										<div class="mt-1 break-all text-slate-500">chain: {row.lastChain}</div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					{@const tl = timelineData()}
					<div class="mb-2 flex justify-end">
						<button
							class="text-[10px] text-slate-400 hover:text-slate-700"
							onclick={resetData}
							type="button"
						>
							Reset
						</button>
					</div>
					{#if tl === null}
						<p class="text-slate-500">No signal activity yet.</p>
					{:else}
						<div>
							<div class="flex">
								<div class="shrink-0">
									<div class="mb-1.5 h-5"></div>
									<div class="space-y-1">
										{#each tl.labels as label}
											<div
												class="flex h-5 max-w-[9rem] items-center truncate pr-2 text-[10px] font-medium text-slate-700"
												title={label}
											>
												{label}
											</div>
										{/each}
									</div>
								</div>
								<div class="min-w-0 flex-1 overflow-x-auto px-4">
									<div style="width: {TRACK_PX}px">
										<div class="relative mb-1.5 h-5 border-b border-slate-200">
											{#each tl.ticks as tick}
												<div
													class="absolute flex -translate-x-1/2 flex-col items-center"
													style="left: {tick.x}px"
												>
													<div class="h-1.5 w-px bg-slate-300"></div>
													<span class="text-[9px] text-slate-400">{formatRelMs(tick.ms)}</span>
												</div>
											{/each}
										</div>
										<div class="space-y-1">
											{#each tl.labels as label}
												<div class="relative h-5 rounded bg-slate-100">
													{#each tl.byLabel[label] as item}
														<div
															role="img"
															aria-label="{item.kind} {item.label}"
															class="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-default rounded-full border border-white shadow-sm"
															style="left: {tl.toX(
																item.timestamp
															)}px; background-color: {item.kind === 'read'
																? '#93c5fd'
																: item.kind === 'write'
																	? '#FF815A'
																	: '#4ade80'}"
															onmousemove={(e) =>
																showTooltip(e, item, tl.stateByItemId[item.id], tl.minTs)}
															onmouseleave={hideTooltip}
														></div>
													{/each}
												</div>
											{/each}
										</div>
									</div>
								</div>
							</div>
							<div class="mt-4 flex items-center gap-4 text-[9px] text-slate-500">
								<span class="flex items-center gap-1">
									<span
										class="inline-block h-2.5 w-2.5 rounded-full border border-white bg-[#4ade80] shadow-sm"
									></span>change
								</span>
								<span class="flex items-center gap-1">
									<span
										class="inline-block h-2.5 w-2.5 rounded-full border border-white bg-[#FF815A] shadow-sm"
									></span>write
								</span>
								<span class="flex items-center gap-1">
									<span
										class="inline-block h-2.5 w-2.5 rounded-full border border-white bg-[#93c5fd] shadow-sm"
									></span>read
								</span>
							</div>
						</div>
					{/if}
				{/if}
			</div>
		</section>
	{/if}
</div>

{#if monitor_tooltip !== null}
	{@const t = monitor_tooltip}
	<div
		class="pointer-events-none fixed w-[{TOOLTIP_W}px] rounded-xl border border-[#FF815A]/30 bg-white p-2.5 font-mono text-[10px] text-slate-800 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
		style="left: {t.x}px; top: {t.flipDown ? t.y + 16 : t.y - 8}px; transform: {t.flipDown
			? 'none'
			: 'translateY(-100%)'}; z-index: {zIndex + 1}"
	>
		<div class="font-semibold text-slate-800">{t.item.label}</div>
		<div class="mt-0.5 text-slate-400">
			{t.item.kind}{t.item.operation ? ` · ${t.item.operation}` : ''}
		</div>
		{#if t.item.kind === 'change'}
			<div class="mt-1.5 space-y-0.5 border-t border-[#FF815A]/15 pt-1.5">
				<div class="flex gap-1.5">
					<span class="shrink-0 text-slate-400">before</span>
					<span class="truncate text-[#FF815A]">{stringify(t.item.oldValue)}</span>
				</div>
				<div class="flex gap-1.5">
					<span class="shrink-0 text-slate-400">after &nbsp;</span>
					<span class="truncate text-green-600">{stringify(t.item.newValue)}</span>
				</div>
			</div>
		{:else if t.valueAtTime !== undefined}
			<div class="mt-1.5 flex gap-1.5 border-t border-[#FF815A]/15 pt-1.5">
				<span class="shrink-0 text-slate-400">value</span>
				<span class="truncate text-sky-600">{stringify(t.valueAtTime)}</span>
			</div>
		{:else}
			<div class="mt-1 text-slate-400">no value recorded</div>
		{/if}
		<div class="mt-1.5 text-slate-400">+{formatRelMs(t.item.timestamp - t.minTs)}</div>
	</div>
{/if}
