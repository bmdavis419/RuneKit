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
	let monitor_activeTab = $state<'feed' | 'variables'>('feed');
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

	const toggleOpen = () => {
		monitor_isOpen = !monitor_isOpen;
	};

	const toggleRerenderFlash = () => {
		monitor_rerenderFlashEnabled = !monitor_rerenderFlashEnabled;
		setRerenderFlashEnabled(monitor_rerenderFlashEnabled);
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
				{:else if statsRows().length === 0}
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
			</div>
		</section>
	{/if}
</div>
