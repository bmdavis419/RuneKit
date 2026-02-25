import type { Plugin, ViteDevServer } from 'vite';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const VIRTUAL_ID = 'virtual:runekit/routes';
const RESOLVED_ID = '\0virtual:runekit/routes';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

interface LoadInfo {
	file: string;
	hasLoad: boolean;
}

interface PageServerInfo extends LoadInfo {
	hasActions: boolean;
}

interface EndpointInfo {
	file: string;
	methods: HttpMethod[];
}

interface PageInfo {
	component?: { file: string };
	load?: LoadInfo;
	server?: PageServerInfo;
}

interface LayoutInfo {
	component?: { file: string };
	load?: LoadInfo;
	server?: LoadInfo;
}

interface RemoteInfo {
	file: string;
	name: string;
	exports: string[];
}

export interface RouteNode {
	id: string;
	segment: string;
	params: string[];
	endpoint?: EndpointInfo;
	page?: PageInfo;
	layout?: LayoutInfo;
	error?: { file: string };
	remotes: RemoteInfo[];
}

// --- static analysis ---

const tryRead = (file: string) => readFile(file, 'utf-8').catch(() => '');

const detectMethods = (src: string): HttpMethod[] =>
	HTTP_METHODS.filter((m) =>
		new RegExp(`\\bexport\\s+(?:async\\s+)?(?:function|const)\\s+${m}\\b`).test(src)
	);

const detectLoad = (src: string) => /\bexport\s+(?:async\s+)?(?:function|const)\s+load\b/.test(src);

const detectActions = (src: string) => /\bexport\s+const\s+actions\b/.test(src);

const detectExports = (src: string): string[] => {
	const names: string[] = [];
	const re = /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm;
	let m;
	while ((m = re.exec(src)) !== null) names.push(m[1]);
	return names;
};

// --- routing ---

const isGroup = (s: string) => /^\(.*\)$/.test(s);

const toRouteId = (rawSegments: string[]): string => {
	const parts = rawSegments.filter((s) => !isGroup(s));
	return parts.length === 0 ? '/' : '/' + parts.join('/');
};

const parseParams = (id: string): string[] => {
	const re = /\[{1,2}\.{0,3}([^\]]+?)\]{1,2}/g;
	const params: string[] = [];
	let m;
	while ((m = re.exec(id)) !== null) params.push(m[1]);
	return params;
};

const findFile = (files: string[], ...names: string[]): string | undefined =>
	names.find((n) => files.includes(n));

const isWithin = (parent: string, file: string) => !relative(parent, file).startsWith('..');

// --- walk ---

async function walk(
	dir: string,
	projectRoot: string,
	segments: string[],
	nodes: RouteNode[]
): Promise<void> {
	let entries: { name: string; isFile: boolean; isDirectory: boolean }[];
	try {
		const raw = await readdir(dir, { withFileTypes: true });
		entries = raw.map((e) => ({ name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory() }));
	} catch {
		return;
	}

	const fileNames = entries.filter((e) => e.isFile).map((e) => e.name);
	const dirNames = entries
		.filter((e) => e.isDirectory && !e.name.startsWith('.'))
		.map((e) => e.name);

	const routeFiles = fileNames.filter((f) => f.startsWith('+') && /\.(svelte|ts|js)$/.test(f));
	const remoteFileNames = fileNames.filter((f) => /\.remote\.[jt]s$/.test(f));

	if (routeFiles.length > 0 || remoteFileNames.length > 0) {
		const id = toRouteId(segments);
		const urlSegments = segments.filter((s) => !isGroup(s));
		const segment = urlSegments[urlSegments.length - 1] ?? '';
		const params = parseParams(id);
		const abs = (f: string) => join(dir, f);
		const rel = (f: string) => relative(projectRoot, join(dir, f)).split(sep).join('/');

		const serverFile = findFile(routeFiles, '+server.ts', '+server.js');
		const pageFile = findFile(routeFiles, '+page.svelte');
		const pageLoadFile = findFile(routeFiles, '+page.ts', '+page.js');
		const pageServerFile = findFile(routeFiles, '+page.server.ts', '+page.server.js');
		const layoutFile = findFile(routeFiles, '+layout.svelte');
		const layoutLoadFile = findFile(routeFiles, '+layout.ts', '+layout.js');
		const layoutServerFile = findFile(routeFiles, '+layout.server.ts', '+layout.server.js');
		const errorFile = findFile(routeFiles, '+error.svelte');

		const [serverSrc, pageLoadSrc, pageServerSrc, layoutLoadSrc, layoutServerSrc] =
			await Promise.all([
				serverFile ? tryRead(abs(serverFile)) : Promise.resolve(''),
				pageLoadFile ? tryRead(abs(pageLoadFile)) : Promise.resolve(''),
				pageServerFile ? tryRead(abs(pageServerFile)) : Promise.resolve(''),
				layoutLoadFile ? tryRead(abs(layoutLoadFile)) : Promise.resolve(''),
				layoutServerFile ? tryRead(abs(layoutServerFile)) : Promise.resolve('')
			]);

		const endpoint: EndpointInfo | undefined = serverFile
			? { file: rel(serverFile), methods: detectMethods(serverSrc) }
			: undefined;

		const page: PageInfo | undefined =
			pageFile || pageLoadFile || pageServerFile
				? {
						component: pageFile ? { file: rel(pageFile) } : undefined,
						load: pageLoadFile
							? { file: rel(pageLoadFile), hasLoad: detectLoad(pageLoadSrc) }
							: undefined,
						server: pageServerFile
							? {
									file: rel(pageServerFile),
									hasLoad: detectLoad(pageServerSrc),
									hasActions: detectActions(pageServerSrc)
								}
							: undefined
					}
				: undefined;

		const layout: LayoutInfo | undefined =
			layoutFile || layoutLoadFile || layoutServerFile
				? {
						component: layoutFile ? { file: rel(layoutFile) } : undefined,
						load: layoutLoadFile
							? { file: rel(layoutLoadFile), hasLoad: detectLoad(layoutLoadSrc) }
							: undefined,
						server: layoutServerFile
							? { file: rel(layoutServerFile), hasLoad: detectLoad(layoutServerSrc) }
							: undefined
					}
				: undefined;

		const error = errorFile ? { file: rel(errorFile) } : undefined;

		const remotes: RemoteInfo[] = await Promise.all(
			remoteFileNames.map(async (f) => ({
				file: rel(f),
				name: f.replace(/\.remote\.[jt]s$/, ''),
				exports: detectExports(await tryRead(abs(f)))
			}))
		);

		nodes.push({ id, segment, params, endpoint, page, layout, error, remotes });
	}

	for (const name of dirNames) {
		await walk(join(dir, name), projectRoot, [...segments, name], nodes);
	}
}

// --- plugin ---

// --- remote scan (entire src dir) ---

const SKIP_DIRS = new Set(['.svelte-kit', 'node_modules', '.git', 'dist', 'build']);

async function walkForRemotes(dir: string, projectRoot: string, acc: RemoteInfo[]): Promise<void> {
	let entries: { name: string; isFile: boolean; isDirectory: boolean }[];
	try {
		const raw = await readdir(dir, { withFileTypes: true });
		entries = raw.map((e) => ({ name: e.name, isFile: e.isFile(), isDirectory: e.isDirectory() }));
	} catch {
		return;
	}

	for (const entry of entries) {
		if (entry.isDirectory) {
			if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name)) {
				await walkForRemotes(join(dir, entry.name), projectRoot, acc);
			}
		} else if (entry.isFile && /\.remote\.[jt]s$/.test(entry.name)) {
			const abs = join(dir, entry.name);
			acc.push({
				file: relative(projectRoot, abs).split(sep).join('/'),
				name: entry.name.replace(/\.remote\.[jt]s$/, ''),
				exports: detectExports(await tryRead(abs))
			});
		}
	}
}

// --- plugin ---

const buildVirtualModule = (routes: RouteNode[], remotes: RemoteInfo[]) =>
	`
export let routes = ${JSON.stringify(routes)};
export let remotes = ${JSON.stringify(remotes)};

const _routeListeners = new Set();
const _remoteListeners = new Set();

export function onRoutesUpdated(fn) {
  _routeListeners.add(fn);
  return () => _routeListeners.delete(fn);
}

export function onRemotesUpdated(fn) {
  _remoteListeners.add(fn);
  return () => _remoteListeners.delete(fn);
}

if (import.meta.hot) {
  import.meta.hot.on('runekit:routes-updated', (newRoutes) => {
    routes = newRoutes;
    _routeListeners.forEach(fn => fn(routes));
  });
  import.meta.hot.on('runekit:remotes-updated', (newRemotes) => {
    remotes = newRemotes;
    _remoteListeners.forEach(fn => fn(remotes));
  });
}
`.trim();

export function routesTracker(options?: { routesDir?: string; srcDir?: string }): Plugin {
	let routesDir: string;
	let srcDir: string;
	let projectRoot: string;
	let routes: RouteNode[] = [];
	let remotes: RemoteInfo[] = [];
	let routesTimer: ReturnType<typeof setTimeout> | null = null;
	let remotesTimer: ReturnType<typeof setTimeout> | null = null;

	const rebuildRoutes = async () => {
		routes = [];
		await walk(routesDir, projectRoot, [], routes);
	};

	const rebuildRemotes = async () => {
		remotes = [];
		await walkForRemotes(srcDir, projectRoot, remotes);
	};

	const scheduleRoutes = (server: ViteDevServer) => {
		if (routesTimer) clearTimeout(routesTimer);
		routesTimer = setTimeout(async () => {
			await rebuildRoutes();
			const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
			if (mod) server.moduleGraph.invalidateModule(mod);
			server.hot.send({ type: 'custom', event: 'runekit:routes-updated', data: routes });
		}, 50);
	};

	const scheduleRemotes = (server: ViteDevServer) => {
		if (remotesTimer) clearTimeout(remotesTimer);
		remotesTimer = setTimeout(async () => {
			await rebuildRemotes();
			const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
			if (mod) server.moduleGraph.invalidateModule(mod);
			server.hot.send({ type: 'custom', event: 'runekit:remotes-updated', data: remotes });
		}, 50);
	};

	return {
		name: 'vite-plugin-routes-tracker',

		async configResolved(config) {
			projectRoot = config.root;
			routesDir = join(projectRoot, options?.routesDir ?? 'src/routes');
			srcDir = join(projectRoot, options?.srcDir ?? 'src');
			await Promise.all([rebuildRoutes(), rebuildRemotes()]);
		},

		resolveId(id) {
			if (id === VIRTUAL_ID) return RESOLVED_ID;
		},

		load(id) {
			if (id === RESOLVED_ID) return buildVirtualModule(routes, remotes);
		},

		configureServer(server) {
			server.watcher.add(srcDir);

			const onAdd = (file: string) => {
				if (isWithin(routesDir, file)) scheduleRoutes(server);
				if (isWithin(srcDir, file) && /\.remote\.[jt]s$/.test(file)) scheduleRemotes(server);
			};
			const onUnlink = (file: string) => {
				if (isWithin(routesDir, file)) scheduleRoutes(server);
				if (isWithin(srcDir, file) && /\.remote\.[jt]s$/.test(file)) scheduleRemotes(server);
			};
			const onChange = (file: string) => {
				if (isWithin(routesDir, file)) scheduleRoutes(server);
				if (isWithin(srcDir, file) && /\.remote\.[jt]s$/.test(file)) scheduleRemotes(server);
			};

			server.watcher.on('add', onAdd);
			server.watcher.on('unlink', onUnlink);
			server.watcher.on('change', onChange);
		}
	};
}
