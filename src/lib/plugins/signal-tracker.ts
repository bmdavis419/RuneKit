import type { Plugin } from 'vite';

const VIRTUAL_ID = 'virtual:signal-tracker';
const RESOLVED_ID = '\0virtual:signal-tracker';

// Mutation functions the Svelte compiler emits at call sites.
// `set`       → explicit assignment (count = 5)
// `update`    → post-increment/decrement (count++)
// `update_pre`→ pre-increment/decrement (++count)
// `mutate`    → non-proxied object mutation
// TODO: track downstream reactions (which effects re-ran)
// TODO: resolve source locations via source maps
const TRACKED_FNS = `new Set(['set','update','update_pre','mutate'])`;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const VIRTUAL_MODULE = /* js */ `
console.log('[signal-tracker] virtual module loaded');
const _listeners = new Set();
let _active = false;

export function onSignalChange(handler) {
  console.log('[signal-tracker] onSignalChange registered');
  _listeners.add(handler);
  return () => _listeners.delete(handler);
}

/** @internal – injected into compiled Svelte output by vite-plugin-signal-tracker */
export function __emit(event) {
  // Re-entrancy guard: if the handler itself updates $state we skip that
  // secondary emission so we don't loop.
  if (_active) return;
  _active = true;
  try {
    for (const handler of _listeners) {
      try { handler(event); } catch (e) { console.error('[signal-tracker]', e); }
    }
  } finally {
    _active = false;
  }
}
`.trim();

export function signalTracker(): Plugin {
	console.log('[signal-tracker] plugin created');

	return {
		name: 'vite-plugin-signal-tracker',
		enforce: 'post', // run after @sveltejs/vite-plugin-svelte

		resolveId(id) {
			if (id === VIRTUAL_ID) {
				console.log('[signal-tracker] resolving virtual module');
				return RESOLVED_ID;
			}
		},

		load(id) {
			if (id === RESOLVED_ID) {
				console.log('[signal-tracker] loading virtual module');
				return VIRTUAL_MODULE;
			}
		},

		transform(code, id) {
			// Only handle Svelte-compiled client output.
			// SSR output imports from svelte/internal/server — skip it.
			if (!id.endsWith('.svelte')) return null;

			const hasClientImport =
				code.includes("'svelte/internal/client'") || code.includes('"svelte/internal/client"');
			console.log(
				`[signal-tracker] transform: ${id.split('/').slice(-2).join('/')} | has client import: ${hasClientImport}`
			);

			if (!hasClientImport) return null;

			// Log raw bytes around the import so we can see invisible characters
			const clientIdx = code.indexOf('svelte/internal/client');
			console.log(
				'[signal-tracker] raw context:',
				JSON.stringify(code.slice(Math.max(0, clientIdx - 40), clientIdx + 40))
			);

			// Capture the namespace alias (almost always `$`).
			const importRe =
				/^import\s+\*\s+as\s+([$_A-Za-z][$_0-9A-Za-z]*)\s+from\s+(['"])svelte\/internal\/client\2\s*;?/m;
			const match = importRe.exec(code);
			if (!match) {
				console.log('[signal-tracker] warn: could not find namespace import alias, skipping');
				return null;
			}

			const alias = match[1];
			const origAlias = `${alias}__orig`;

			console.log(`[signal-tracker] injecting proxy into ${id.split('/').pop()} (alias: ${alias})`);

			// 1. Rename the original import alias.
			let result = code.replace(
				importRe,
				`import * as ${origAlias} from 'svelte/internal/client';`
			);

			// 2. Build the proxy + tracker import injection.
			const injection = `
import { __emit as __stEmit } from '${VIRTUAL_ID}';
const _tracked = ${TRACKED_FNS};
const ${alias} = new Proxy(${origAlias}, {
  get(t, p) {
    if (!_tracked.has(p)) return t[p];
    return (src, ...args) => {
      const _ov = src?.v;
      const _wv = src?.wv;
      const _r = t[p](src, ...args);
      if (src?.wv !== _wv) __stEmit({ label: src?.label, oldValue: _ov, newValue: src?.v, timestamp: Date.now() });
      return _r;
    };
  }
});`;

			// 3. Insert before the first alias usage so we don't hit TDZ when
			//    compiled output references `$.FILENAME` before imports.
			const aliasUseRe = new RegExp(`${escapeRegExp(alias)}\\s*\\.`, 'm');
			const aliasUseMatch = aliasUseRe.exec(result);
			if (aliasUseMatch) {
				const lineStart = result.lastIndexOf('\n', aliasUseMatch.index) + 1;
				console.log('[signal-tracker] placement: inserted before first alias usage');
				result = result.slice(0, lineStart) + injection + '\n' + result.slice(lineStart);
				return { code: result, map: null };
			}

			const renamedImportRe = new RegExp(
				`^import\\s+\\*\\s+as\\s+${escapeRegExp(origAlias)}\\s+from\\s+['"]svelte\\/internal\\/client['"]\\s*;?`,
				'm'
			);
			const renamedImportMatch = renamedImportRe.exec(result);
			if (!renamedImportMatch) {
				console.log('[signal-tracker] warn: could not find renamed client import, skipping');
				return null;
			}
			const importLineEnd = renamedImportMatch.index + renamedImportMatch[0].length;
			const fallbackIndex = result.indexOf('\n', importLineEnd);
			console.log(
				'[signal-tracker] placement: first alias usage not found, using post-import fallback'
			);
			result =
				result.slice(0, fallbackIndex === -1 ? result.length : fallbackIndex + 1) +
				injection +
				'\n' +
				result.slice(fallbackIndex === -1 ? result.length : fallbackIndex + 1);

			return { code: result, map: null };
		}
	};
}
