import type {
	EffectTimingEntry,
	RedundantWriteEvent,
	SignalMutationSource
} from 'virtual:signal-tracker';

export type SignalWriteOperation = SignalMutationSource['operation'];

export interface SignalFeedItem {
	id: string;
	kind: 'change' | 'read' | 'write';
	label: string;
	timestamp: number;
	sourceChain: string | undefined;
	operation?: SignalWriteOperation;
	oldValue?: unknown;
	newValue?: unknown;
	downstreamUpdated?: number;
	downstreamTotal?: number;
}

export interface SignalStatsRow {
	label: string;
	reads: number;
	writes: number;
	lastWriteOp: SignalWriteOperation | undefined;
	lastSeenAt: number;
	lastChain: string | undefined;
}

export interface SignalTrackerMonitorProps {
	position?: 'bottom-right' | 'bottom-left';
	maxFeed?: number;
	showAppSignalsOnly?: boolean;
	initialOpen?: boolean;
	zIndex?: number;
	initialRerenderFlashEnabled?: boolean;
}

export interface DashboardHistoryItem {
	id: string;
	kind: 'endpoint' | 'remote';
	timestamp: number;
	target: string;
	input: unknown;
	output?: unknown;
	error?: string;
	status?: number;
	durationMs: number;
}

export interface RuneKitDashboardProps {
	title?: string;
	maxHistory?: number;
	initialTab?: 'routes' | 'endpoints' | 'remotes' | 'history';
}

export type RuneKitTab = 'signals' | 'performance' | 'routes' | 'network';

export interface RuneKitProps {
	position?: 'bottom-right' | 'bottom-left';
	maxFeed?: number;
	showAppSignalsOnly?: boolean;
	initialOpen?: boolean;
	zIndex?: number;
	initialTab?: RuneKitTab;
}

export type { EffectTimingEntry, RedundantWriteEvent };
