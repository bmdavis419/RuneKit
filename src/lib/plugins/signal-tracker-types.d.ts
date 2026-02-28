// Ambient declarations for the virtual:signal-tracker module provided by
// vite-plugin-signal-tracker. No top-level imports/exports — TypeScript
// treats this as a script file so the module declaration is globally visible.

declare module 'virtual:signal-tracker' {
	export interface SignalMutationSource {
		operation: 'set' | 'update' | 'update_pre' | 'mutate';
		callsite: string | undefined;
		stack: string | undefined;
	}

	export interface SignalReactionUpdate {
		kind: 'derived' | 'effect';
		label: string | undefined;
		fnName: string | undefined;
		componentName: string | undefined;
		writeVersionBefore: number | undefined;
		writeVersionAfter: number | undefined;
		updated: boolean;
	}

	export interface SignalChangeEvent {
		label: string | undefined;
		oldValue: unknown;
		newValue: unknown;
		timestamp: number;
		mutation: SignalMutationSource;
		downstream: SignalReactionUpdate[];
	}

	export interface SignalReadEvent {
		label: string | undefined;
		timestamp: number;
		sourceChain: string | undefined;
	}

	export interface SignalWriteEvent {
		label: string | undefined;
		operation: SignalMutationSource['operation'];
		timestamp: number;
		sourceChain: string | undefined;
	}

	export interface RedundantWriteEvent {
		label: string;
		count: number;
		lastTimestamp: number;
		operation: string;
	}

	export interface EffectTimingRun {
		duration: number;
		timestamp: number;
	}

	export interface EffectTimingEntry {
		id: string;
		label: string | undefined;
		kind: 'effect' | 'pre_effect';
		runs: EffectTimingRun[];
		totalRuns: number;
		totalDuration: number;
		maxDuration: number;
		lastTimestamp: number;
	}

	export type Unsubscribe = () => void;

	export function onSignalChange(handler: (event: SignalChangeEvent) => void): Unsubscribe;
	export function onSignalRead(handler: (event: SignalReadEvent) => void): Unsubscribe;
	export function onSignalWrite(handler: (event: SignalWriteEvent) => void): Unsubscribe;
	export function setRerenderFlashEnabled(enabled: boolean): void;
	export function getRerenderFlashEnabled(): boolean;
	export function registerFlashExclusionRoot(element: Element): Unsubscribe;

	export function setHeatmapEnabled(enabled: boolean): void;
	export function getHeatmapEnabled(): boolean;

	export function onRedundantWrite(handler: (event: RedundantWriteEvent) => void): Unsubscribe;
	export function getRedundantWrites(): RedundantWriteEvent[];
	export function clearRedundantWrites(): void;

	export function onEffectProfile(handler: (entry: EffectTimingEntry) => void): Unsubscribe;
	export function getEffectTimings(): EffectTimingEntry[];
	export function clearEffectTimings(): void;

	/** @internal */
	export function __emit(event: SignalChangeEvent): void;
	/** @internal */
	export function __emitRedundantWrite(event: {
		label: string;
		operation: string;
		value: unknown;
		timestamp: number;
	}): void;
	/** @internal */
	export function __emitEffectTiming(event: {
		id: string;
		label: string | undefined;
		kind: string;
		duration: number;
		timestamp: number;
	}): void;
}
