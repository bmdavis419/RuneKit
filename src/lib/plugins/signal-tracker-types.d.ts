// Ambient declarations for the virtual:signal-tracker module provided by
// vite-plugin-signal-tracker. No top-level imports/exports — TypeScript
// treats this as a script file so the module declaration is globally visible.

declare module 'virtual:signal-tracker' {
	export interface SignalChangeEvent {
		/** The signal's label (variable name as tagged by Svelte in dev mode). */
		label: string | undefined;
		oldValue: unknown;
		newValue: unknown;
		timestamp: number;
		// TODO: source location (file, line, column) — deferred
		// TODO: downstream reactions (which effects re-ran) — deferred
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
