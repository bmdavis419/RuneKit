// Ambient declarations for the virtual:signal-tracker module provided by
// vite-plugin-signal-tracker. No top-level imports/exports — TypeScript
// treats this as a script file so the module declaration is globally visible.

declare module 'virtual:signal-tracker' {
	export interface SignalMutationSource {
		/** Runtime mutation primitive invoked by compiled Svelte output. */
		operation: 'set' | 'update' | 'update_pre' | 'mutate';
		/** First non-tracker stack frame, usually including file:line:column. */
		callsite: string | undefined;
		/** Short stack preview to help trace the write origin. */
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
		/** The signal's label (variable name as tagged by Svelte in dev mode). */
		label: string | undefined;
		oldValue: unknown;
		newValue: unknown;
		timestamp: number;
		mutation: SignalMutationSource;
		/** Transitive downstream reactions observed from this source at mutation time. */
		downstream: SignalReactionUpdate[];
	}

	export type Unsubscribe = () => void;

	/**
	 * Subscribe to every signal change on the page.
	 * Returns an unsubscribe function — pass it as the return value of onMount.
	 */
	export function onSignalChange(handler: (event: SignalChangeEvent) => void): Unsubscribe;

	/** @internal injected into compiled Svelte output by vite-plugin-signal-tracker */
	export function __emit(event: SignalChangeEvent): void;
}
