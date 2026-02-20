import type { SignalMutationSource } from 'virtual:signal-tracker';

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
