import type { Plugin, ViteDevServer } from 'vite';
import { readdir, readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { init, parse } from 'es-module-lexer';

const VIRTUAL_ID = 'virtual:runekit/routes';
const RESOLVED_ID = '\0virtual:runekit/routes';
const REMOTE_INVOKE_PATH = '/__runekit/remote';
const MAX_JSON_BODY_BYTES = 1_000_000;

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
	modulePath: string;
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

interface SourceAnalysis {
	exports: string[];
	methods: HttpMethod[];
	hasLoad: boolean;
	hasActions: boolean;
}

interface RemoteInvocationResult {
	ok: boolean;
	durationMs: number;
	result?: unknown;
	error?: { message: string; stack?: string };
}

type NextFunction = (error?: unknown) => void;

const tryRead = (file: string) => readFile(file, 'utf-8').catch(() => '');

const fallbackExportNames = (src: string) => {
	const names: string[] = [];
	const re =
		/(^|\n)\s*export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(src)) !== null) names.push(match[2]);
	return [...new Set(names)].sort((a, b) => a.localeCompare(b));
};

let exportLexerReady: Promise<void> | null = null;
const ensureExportLexer = () => (exportLexerReady ??= init);

const parseExportNames = async (src: string, id: string) => {
	if (src.trim().length === 0) return [];
	try {
		await ensureExportLexer();
		const [, rawExports] = parse(src, id);
		const names = rawExports
			.map((entry) => (typeof entry === 'string' ? entry : entry.n))
			.filter(
				(name): name is string => typeof name === 'string' && name.length > 0 && name !== 'default'
			);
		return [...new Set(names)].sort((a, b) => a.localeCompare(b));
	} catch {
		return fallbackExportNames(src);
	}
};

const analyzeSource = async (file: string): Promise<SourceAnalysis> => {
	const src = await tryRead(file);
	const exports = await parseExportNames(src, file);
	return {
		exports,
		methods: HTTP_METHODS.filter((method) => exports.includes(method)),
		hasLoad: exports.includes('load'),
		hasActions: exports.includes('actions')
	};
};

const isGroup = (segment: string) => /^\(.*\)$/.test(segment);

const toRouteId = (rawSegments: string[]) => {
	const parts = rawSegments.filter((segment) => !isGroup(segment));
	return parts.length === 0 ? '/' : `/${parts.join('/')}`;
};

const parseParams = (id: string) => {
	const re = /\[{1,2}\.{0,3}([^\]]+?)\]{1,2}/g;
	const params: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = re.exec(id)) !== null) params.push(match[1]);
	return params;
};

const findFile = (files: string[], ...names: string[]) =>
	names.find((name) => files.includes(name));

const normalizePath = (value: string) => value.split(sep).join('/');

const isWithin = (parent: string, file: string) => {
	const rel = relative(parent, file);
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const toRemoteInfo = async (projectRoot: string, absoluteFile: string): Promise<RemoteInfo> => {
	const file = normalizePath(relative(projectRoot, absoluteFile));
	const exports = (await analyzeSource(absoluteFile)).exports;
	return {
		file,
		modulePath: file.startsWith('/') ? file : `/${file}`,
		name:
			absoluteFile
				.split(sep)
				.pop()
				?.replace(/\.remote\.[jt]s$/, '') ?? 'unknown',
		exports
	};
};

const sortRemoteInfo = (remotes: RemoteInfo[]) =>
	[...remotes].sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));

const sortRouteNodes = (nodes: RouteNode[]) =>
	[...nodes].sort((a, b) => {
		const byId = a.id.localeCompare(b.id);
		if (byId !== 0) return byId;
		return (a.endpoint?.file ?? a.page?.component?.file ?? '').localeCompare(
			b.endpoint?.file ?? b.page?.component?.file ?? ''
		);
	});

async function walkRoutes(
	dir: string,
	projectRoot: string,
	segments: string[],
	nodes: RouteNode[]
) {
	let entries: { name: string; isFile: boolean; isDirectory: boolean }[];
	try {
		const raw = await readdir(dir, { withFileTypes: true });
		entries = raw.map((entry) => ({
			name: entry.name,
			isFile: entry.isFile(),
			isDirectory: entry.isDirectory()
		}));
	} catch {
		return;
	}

	const fileNames = entries.filter((entry) => entry.isFile).map((entry) => entry.name);
	const dirNames = entries
		.filter((entry) => entry.isDirectory && !entry.name.startsWith('.'))
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));

	const routeFiles = fileNames.filter(
		(file) => file.startsWith('+') && /\.(svelte|ts|js)$/.test(file)
	);
	const remoteFileNames = fileNames
		.filter((file) => /\.remote\.[jt]s$/.test(file))
		.sort((a, b) => a.localeCompare(b));

	if (routeFiles.length > 0 || remoteFileNames.length > 0) {
		const id = toRouteId(segments);
		const routeSegments = segments.filter((segment) => !isGroup(segment));
		const segment = routeSegments[routeSegments.length - 1] ?? '';
		const params = parseParams(id);
		const abs = (file: string) => join(dir, file);
		const rel = (file: string) => normalizePath(relative(projectRoot, abs(file)));

		const serverFile = findFile(routeFiles, '+server.ts', '+server.js');
		const pageFile = findFile(routeFiles, '+page.svelte');
		const pageLoadFile = findFile(routeFiles, '+page.ts', '+page.js');
		const pageServerFile = findFile(routeFiles, '+page.server.ts', '+page.server.js');
		const layoutFile = findFile(routeFiles, '+layout.svelte');
		const layoutLoadFile = findFile(routeFiles, '+layout.ts', '+layout.js');
		const layoutServerFile = findFile(routeFiles, '+layout.server.ts', '+layout.server.js');
		const errorFile = findFile(routeFiles, '+error.svelte');

		const [serverInfo, pageLoadInfo, pageServerInfo, layoutLoadInfo, layoutServerInfo, remotes] =
			await Promise.all([
				serverFile ? analyzeSource(abs(serverFile)) : Promise.resolve<SourceAnalysis | null>(null),
				pageLoadFile
					? analyzeSource(abs(pageLoadFile))
					: Promise.resolve<SourceAnalysis | null>(null),
				pageServerFile
					? analyzeSource(abs(pageServerFile))
					: Promise.resolve<SourceAnalysis | null>(null),
				layoutLoadFile
					? analyzeSource(abs(layoutLoadFile))
					: Promise.resolve<SourceAnalysis | null>(null),
				layoutServerFile
					? analyzeSource(abs(layoutServerFile))
					: Promise.resolve<SourceAnalysis | null>(null),
				Promise.all(remoteFileNames.map((file) => toRemoteInfo(projectRoot, abs(file))))
			]);

		const endpoint = serverFile
			? {
					file: rel(serverFile),
					methods: serverInfo?.methods ?? []
				}
			: undefined;

		const page =
			pageFile || pageLoadFile || pageServerFile
				? {
						component: pageFile ? { file: rel(pageFile) } : undefined,
						load: pageLoadFile
							? { file: rel(pageLoadFile), hasLoad: Boolean(pageLoadInfo?.hasLoad) }
							: undefined,
						server: pageServerFile
							? {
									file: rel(pageServerFile),
									hasLoad: Boolean(pageServerInfo?.hasLoad),
									hasActions: Boolean(pageServerInfo?.hasActions)
								}
							: undefined
					}
				: undefined;

		const layout =
			layoutFile || layoutLoadFile || layoutServerFile
				? {
						component: layoutFile ? { file: rel(layoutFile) } : undefined,
						load: layoutLoadFile
							? { file: rel(layoutLoadFile), hasLoad: Boolean(layoutLoadInfo?.hasLoad) }
							: undefined,
						server: layoutServerFile
							? { file: rel(layoutServerFile), hasLoad: Boolean(layoutServerInfo?.hasLoad) }
							: undefined
					}
				: undefined;

		nodes.push({
			id,
			segment,
			params,
			endpoint,
			page,
			layout,
			error: errorFile ? { file: rel(errorFile) } : undefined,
			remotes: sortRemoteInfo(remotes)
		});
	}

	for (const name of dirNames) {
		await walkRoutes(join(dir, name), projectRoot, [...segments, name], nodes);
	}
}

const SKIP_DIRS = new Set(['.svelte-kit', 'node_modules', '.git', 'dist', 'build']);

async function walkRemotes(dir: string, projectRoot: string, remotes: RemoteInfo[]) {
	let entries: { name: string; isFile: boolean; isDirectory: boolean }[];
	try {
		const raw = await readdir(dir, { withFileTypes: true });
		entries = raw.map((entry) => ({
			name: entry.name,
			isFile: entry.isFile(),
			isDirectory: entry.isDirectory()
		}));
	} catch {
		return;
	}

	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (entry.isDirectory) {
			if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name)) {
				await walkRemotes(join(dir, entry.name), projectRoot, remotes);
			}
			continue;
		}

		if (!entry.isFile || !/\.remote\.[jt]s$/.test(entry.name)) continue;
		remotes.push(await toRemoteInfo(projectRoot, join(dir, entry.name)));
	}
}

const scanRoutes = async (projectRoot: string, routesDir: string) => {
	const nodes: RouteNode[] = [];
	await walkRoutes(routesDir, projectRoot, [], nodes);
	return sortRouteNodes(nodes);
};

const scanRemotes = async (projectRoot: string, srcDir: string) => {
	const remotes: RemoteInfo[] = [];
	await walkRemotes(srcDir, projectRoot, remotes);
	return sortRemoteInfo(remotes);
};

export const collectRoutesAndRemotes = async ({
	projectRoot,
	routesDir,
	srcDir
}: {
	projectRoot: string;
	routesDir: string;
	srcDir: string;
}) => {
	const [routes, remotes] = await Promise.all([
		scanRoutes(projectRoot, routesDir),
		scanRemotes(projectRoot, srcDir)
	]);
	return { routes, remotes };
};

const safeSerialize = (value: unknown) => {
	try {
		return JSON.parse(
			JSON.stringify(value, (_key, next) => {
				if (typeof next === 'bigint') return next.toString();
				if (typeof next === 'function') return '[Function]';
				if (typeof next === 'symbol') return String(next);
				return next;
			})
		);
	} catch {
		return String(value);
	}
};

const toErrorPayload = (error: unknown) => {
	if (error instanceof Error) return { message: error.message, stack: error.stack };
	return { message: String(error) };
};

const sendJson = (res: ServerResponse, status: number, payload: unknown) => {
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.end(JSON.stringify(payload));
};

const readJsonBody = async (req: IncomingMessage) => {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > MAX_JSON_BODY_BYTES) throw new Error('Request body exceeds 1MB limit');
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString('utf8').trim();
	if (text.length === 0) return {};
	try {
		return JSON.parse(text);
	} catch {
		throw new Error('Expected JSON request body');
	}
};

const buildRemoteInvocationResult = async ({
	projectRoot,
	srcDir,
	server,
	remotes,
	file,
	exportName,
	args
}: {
	projectRoot: string;
	srcDir: string;
	server: ViteDevServer;
	remotes: RemoteInfo[];
	file: unknown;
	exportName: unknown;
	args: unknown;
}): Promise<RemoteInvocationResult> => {
	const start = Date.now();
	if (typeof file !== 'string' || file.length === 0) {
		throw new Error('`file` must be a non-empty string');
	}
	if (typeof exportName !== 'string' || exportName.length === 0) {
		throw new Error('`exportName` must be a non-empty string');
	}
	if (!Array.isArray(args)) throw new Error('`args` must be an array');

	const remote = remotes.find((entry) => entry.file === file);
	if (!remote) throw new Error(`Unknown remote module: ${file}`);

	const absoluteFile = resolve(projectRoot, remote.file);
	if (!isWithin(srcDir, absoluteFile) || !/\.remote\.[jt]s$/.test(remote.file)) {
		throw new Error(`Refusing to invoke non-remote path: ${file}`);
	}

	const module = await server.ssrLoadModule(absoluteFile);
	const fn = module?.[exportName];
	if (typeof fn !== 'function') {
		throw new Error(`Export \`${exportName}\` in ${file} is not a function`);
	}

	const result = await fn(...args);
	return {
		ok: true,
		durationMs: Date.now() - start,
		result: safeSerialize(result)
	};
};

const buildVirtualModule = (routes: RouteNode[], remotes: RemoteInfo[]) =>
	`
export let routes = ${JSON.stringify(routes)};
export let remotes = ${JSON.stringify(remotes)};
export const remoteInvokePath = ${JSON.stringify(REMOTE_INVOKE_PATH)};

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

const _parseResponseBody = async (response) => {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (text.length === 0) return null;
  if (contentType.includes('application/json')) {
    try { return JSON.parse(text); }
    catch { return text; }
  }
  return text;
};

export async function invokeEndpoint({ path, method = 'GET', query, headers, body } = {}) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('invokeEndpoint requires a non-empty path.');
  }

  const url = new URL(path, window.location.origin);
  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      url.searchParams.set(key, String(value));
    });
  }

  const normalizedMethod = String(method).toUpperCase();
  const requestHeaders = { ...(headers || {}) };
  const init = { method: normalizedMethod, headers: requestHeaders };

  if (body !== undefined && normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') {
    if (!('content-type' in Object.fromEntries(Object.entries(requestHeaders).map(([k, v]) => [k.toLowerCase(), v])))) {
      requestHeaders['content-type'] = 'application/json';
    }
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const startedAt = Date.now();
  const response = await fetch(url.toString(), init);
  const responseBody = await _parseResponseBody(response);

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    durationMs: Date.now() - startedAt,
    headers: Object.fromEntries(response.headers.entries()),
    body: responseBody
  };
}

export async function invokeRemote(file, exportName, args = []) {
  const response = await fetch(remoteInvokePath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file, exportName, args })
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    const message = payload?.error?.message || 'Remote invocation failed';
    throw new Error(message);
  }

  return payload;
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
	let routesDir = '';
	let srcDir = '';
	let projectRoot = '';
	let routes: RouteNode[] = [];
	let remotes: RemoteInfo[] = [];
	let routesTimer: ReturnType<typeof setTimeout> | null = null;
	let remotesTimer: ReturnType<typeof setTimeout> | null = null;

	const logError = (label: string, error: unknown) => {
		console.error(`[runekit/routes-tracker] ${label}`, error);
	};

	const rebuildRoutes = async () => {
		routes = await scanRoutes(projectRoot, routesDir);
	};

	const rebuildRemotes = async () => {
		remotes = await scanRemotes(projectRoot, srcDir);
	};

	const invalidateVirtualModule = (server: ViteDevServer) => {
		const module = server.moduleGraph.getModuleById(RESOLVED_ID);
		if (module) server.moduleGraph.invalidateModule(module);
	};

	const scheduleRoutes = (server: ViteDevServer) => {
		if (routesTimer) clearTimeout(routesTimer);
		routesTimer = setTimeout(async () => {
			try {
				await rebuildRoutes();
				invalidateVirtualModule(server);
				server.hot.send({ type: 'custom', event: 'runekit:routes-updated', data: routes });
			} catch (error) {
				logError('failed rebuilding routes', error);
			}
		}, 60);
	};

	const scheduleRemotes = (server: ViteDevServer) => {
		if (remotesTimer) clearTimeout(remotesTimer);
		remotesTimer = setTimeout(async () => {
			try {
				await rebuildRemotes();
				invalidateVirtualModule(server);
				server.hot.send({ type: 'custom', event: 'runekit:remotes-updated', data: remotes });
			} catch (error) {
				logError('failed rebuilding remotes', error);
			}
		}, 60);
	};

	return {
		name: 'vite-plugin-routes-tracker',

		async configResolved(config) {
			projectRoot = config.root;
			routesDir = join(projectRoot, options?.routesDir ?? 'src/routes');
			srcDir = join(projectRoot, options?.srcDir ?? 'src');
			const snapshot = await collectRoutesAndRemotes({ projectRoot, routesDir, srcDir });
			routes = snapshot.routes;
			remotes = snapshot.remotes;
		},

		resolveId(id) {
			if (id === VIRTUAL_ID) return RESOLVED_ID;
		},

		load(id) {
			if (id === RESOLVED_ID) return buildVirtualModule(routes, remotes);
		},

		configureServer(server) {
			server.watcher.add([routesDir, srcDir]);

			const onFileEvent = (file: string) => {
				if (isWithin(routesDir, file)) scheduleRoutes(server);
				if (isWithin(srcDir, file) && /\.remote\.[jt]s$/.test(file)) scheduleRemotes(server);
			};

			const remoteInvoker = (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
				const path = req.url ? new URL(req.url, 'http://localhost').pathname : '';
				if (path !== REMOTE_INVOKE_PATH) return next();
				if (req.method !== 'POST') {
					sendJson(res, 405, { ok: false, error: { message: 'Use POST for remote invocation' } });
					return;
				}

				void (async () => {
					try {
						const body = await readJsonBody(req);
						const payload = await buildRemoteInvocationResult({
							projectRoot,
							srcDir,
							server,
							remotes,
							file: body.file,
							exportName: body.exportName,
							args: body.args
						});
						sendJson(res, 200, payload);
					} catch (error) {
						logError('remote invocation failed', error);
						sendJson(res, 400, {
							ok: false,
							durationMs: 0,
							error: toErrorPayload(error)
						});
					}
				})();
			};

			server.middlewares.use(remoteInvoker);
			server.watcher.on('add', onFileEvent);
			server.watcher.on('unlink', onFileEvent);
			server.watcher.on('change', onFileEvent);

			return () => {
				if (routesTimer) clearTimeout(routesTimer);
				if (remotesTimer) clearTimeout(remotesTimer);
				server.watcher.off('add', onFileEvent);
				server.watcher.off('unlink', onFileEvent);
				server.watcher.off('change', onFileEvent);
			};
		}
	};
}

export const __routesTrackerInternals = {
	parseExportNames,
	analyzeSource,
	toRouteId,
	parseParams,
	scanRoutes,
	scanRemotes,
	buildRemoteInvocationResult
};
