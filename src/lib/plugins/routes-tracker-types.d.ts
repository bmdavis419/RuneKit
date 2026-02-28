declare module 'virtual:runekit/routes' {
	export interface LoadInfo {
		file: string;
		hasLoad: boolean;
	}

	export interface PageServerInfo extends LoadInfo {
		hasActions: boolean;
	}

	export interface EndpointInfo {
		file: string;
		/** HTTP methods exported by the +server file. */
		methods: string[];
	}

	export interface PageInfo {
		/** +page.svelte */
		component?: { file: string };
		/** +page.ts */
		load?: LoadInfo;
		/** +page.server.ts */
		server?: PageServerInfo;
	}

	export interface LayoutInfo {
		/** +layout.svelte */
		component?: { file: string };
		/** +layout.ts */
		load?: LoadInfo;
		/** +layout.server.ts */
		server?: LoadInfo;
	}

	export interface RemoteInfo {
		file: string;
		/** Browser-visible module path for dev imports. */
		modulePath: string;
		/** Filename stem before .remote.ts, e.g. "db" for db.remote.ts */
		name: string;
		/** Exported runtime symbol names found in the module. */
		exports: string[];
	}

	export interface RouteNode {
		/** SvelteKit route id, e.g. "/blog/[slug]" */
		id: string;
		/** Final URL segment (without group wrappers), e.g. "[slug]" */
		segment: string;
		/** Dynamic param names extracted from the id. */
		params: string[];
		/** Present when a +server file exists at this route. */
		endpoint?: EndpointInfo;
		/** Present when any +page file exists at this route. */
		page?: PageInfo;
		/** Present when any +layout file exists at this route. */
		layout?: LayoutInfo;
		/** Present when a +error.svelte exists at this route. */
		error?: { file: string };
		/** All *.remote.ts/js files found at this route. */
		remotes: RemoteInfo[];
	}

	export interface EndpointInvocationInput {
		path: string;
		method?: string;
		query?: Record<string, string | number | boolean | null | undefined>;
		headers?: Record<string, string>;
		body?: unknown;
	}

	export interface EndpointInvocationResult {
		ok: boolean;
		status: number;
		statusText: string;
		durationMs: number;
		headers: Record<string, string>;
		body: unknown;
	}

	export interface RemoteInvocationResult {
		ok: boolean;
		durationMs: number;
		result?: unknown;
		error?: { message: string; stack?: string };
	}

	/** All discovered routes, sorted by route id. */
	export let routes: RouteNode[];

	/** All *.remote.ts/js files discovered under src/. */
	export let remotes: RemoteInfo[];

	/** Path used by the development middleware for remote invocation. */
	export const remoteInvokePath: string;

	/** Subscribe to route list changes during HMR. Returns an unsubscribe function. */
	export function onRoutesUpdated(fn: (routes: RouteNode[]) => void): () => void;

	/** Subscribe to remote list changes during HMR. Returns an unsubscribe function. */
	export function onRemotesUpdated(fn: (remotes: RemoteInfo[]) => void): () => void;

	/** Execute a route endpoint from the browser with structured timing/output details. */
	export function invokeEndpoint(input: EndpointInvocationInput): Promise<EndpointInvocationResult>;

	/** Execute a remote function through RuneKit's development middleware. */
	export function invokeRemote(
		file: string,
		exportName: string,
		args?: unknown[]
	): Promise<RemoteInvocationResult>;
}
