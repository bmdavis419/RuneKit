import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectRoutesAndRemotes, __routesTrackerInternals } from './routes-tracker.js';

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map(async (dir) => {
			await rm(dir, { recursive: true, force: true });
		})
	);
});

describe('routesTracker internals', () => {
	it('parses exported names without false positives from comments', async () => {
		const src = `
			const GET = async () => new Response('ok');
			export { GET };
			// export const POST = async () => new Response('nope');
		`;
		const names = await __routesTrackerInternals.parseExportNames(src, '/virtual/file.ts');
		expect(names).toEqual(['GET']);
	});

	it('collects route and remote metadata with stable fields', async () => {
		const root = await mkdtemp(join(tmpdir(), 'runekit-routes-'));
		tempDirs.push(root);

		await mkdir(join(root, 'src/routes/api/demo'), { recursive: true });
		await mkdir(join(root, 'src/routes/tasks'), { recursive: true });

		await writeFile(
			join(root, 'src/routes/api/demo/+server.ts'),
			`const GET = async () => new Response('ok');\nexport { GET };\n`
		);
		await writeFile(
			join(root, 'src/routes/tasks/+page.server.ts'),
			`const load = async () => ({ ok: true });\nexport { load };\nexport const actions = { default: async () => ({ ok: true }) };\n`
		);
		await writeFile(
			join(root, 'src/routes/api/demo/tools.remote.ts'),
			`export const sum = (...values) => values.reduce((a, b) => a + b, 0);\nexport type Hidden = string;\n`
		);

		const snapshot = await collectRoutesAndRemotes({
			projectRoot: root,
			routesDir: join(root, 'src/routes'),
			srcDir: join(root, 'src')
		});

		const apiRoute = snapshot.routes.find((route) => route.id === '/api/demo');
		expect(apiRoute?.endpoint?.methods).toEqual(['GET']);

		const taskRoute = snapshot.routes.find((route) => route.id === '/tasks');
		expect(taskRoute?.page?.server?.hasLoad).toBe(true);
		expect(taskRoute?.page?.server?.hasActions).toBe(true);

		expect(snapshot.remotes).toHaveLength(1);
		expect(snapshot.remotes[0]).toMatchObject({
			file: 'src/routes/api/demo/tools.remote.ts',
			modulePath: '/src/routes/api/demo/tools.remote.ts',
			name: 'tools',
			exports: ['sum']
		});
	});
});
