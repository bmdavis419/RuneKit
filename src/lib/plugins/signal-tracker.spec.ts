import { describe, expect, it } from 'vitest';
import { signalTracker, __signalTrackerInternals } from './signal-tracker.js';

const getResolveIdHandler = () => {
	const resolveId = signalTracker().resolveId;
	if (!resolveId) throw new Error('resolveId hook missing');
	return (typeof resolveId === 'function' ? resolveId : resolveId.handler) as (
		this: unknown,
		source: string,
		importer: string | undefined,
		options: { ssr?: boolean }
	) => Promise<unknown> | unknown;
};

describe('signalTracker internals', () => {
	it('recognizes Svelte importers even with query params', () => {
		expect(
			__signalTrackerInternals.shouldInstrumentImporter('/src/routes/+page.svelte?direct')
		).toBe(true);
	});

	it('excludes monitor components from instrumentation', () => {
		expect(
			__signalTrackerInternals.shouldInstrumentImporter(
				'/src/lib/monitor/SignalTrackerMonitor.svelte'
			)
		).toBe(false);
		expect(
			__signalTrackerInternals.shouldInstrumentImporter('/src/lib/monitor/RuneKitDashboard.svelte')
		).toBe(false);
	});

	it('ignores non-svelte importers', () => {
		expect(__signalTrackerInternals.shouldInstrumentImporter('/src/lib/util.ts')).toBe(false);
	});
});

describe('signalTracker plugin resolve behavior', () => {
	it('returns shim id for instrumented svelte importer', async () => {
		const resolveId = getResolveIdHandler();

		const result = await resolveId.call(
			{},
			'svelte/internal/client',
			'/src/routes/+page.svelte?direct',
			{ ssr: false }
		);

		expect(result).toBe('\0virtual:signal-tracker-shim');
	});

	it('resolves original svelte internal id through Vite context', async () => {
		const resolveId = getResolveIdHandler();

		const result = await resolveId.call(
			{
				resolve: async () => ({ id: '/deps/svelte/internal/client.js' })
			},
			'virtual:signal-tracker-orig',
			undefined,
			{}
		);

		expect(result).toBe('/deps/svelte/internal/client.js');
	});
});
