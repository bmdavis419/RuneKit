import type { Plugin } from 'vite';

const VIRTUAL_ID = 'virtual:signal-tracker';
const RESOLVED_ID = '\0virtual:signal-tracker';

// Mutation functions the Svelte compiler emits at call sites.
// `set`       → explicit assignment (count = 5)
// `update`    → post-increment/decrement (count++)
// `update_pre`→ pre-increment/decrement (++count)
// `mutate`    → non-proxied object mutation
const TRACKED_FNS = `new Set(['set','update','update_pre','mutate'])`;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const VIRTUAL_MODULE = /* js */ `
console.log('[signal-tracker] virtual module loaded');
const _listeners = new Set();
let _active = false;
const _stackIgnore = ['virtual:signal-tracker', '__st', 'svelte/internal/client'];

const _isReaction = (value) => value && typeof value === 'object' && typeof value.wv === 'number';
const _fnName = (value) => (typeof value?.name === 'string' && value.name.length > 0 ? value.name : undefined);
const _extractFrames = (stack) => stack?.split('\\n').slice(1).map((line) => line.trim()) ?? [];
const _firstExternalFrame = (frames) =>
  frames.find((line) => !_stackIgnore.some((token) => line.includes(token)));

export function onSignalChange(handler) {
  console.log('[signal-tracker] onSignalChange registered');
  _listeners.add(handler);
  return () => _listeners.delete(handler);
}

export function __isEmitting() {
  return _active;
}

export function __mutationMeta(operation) {
  const frames = _extractFrames(new Error().stack);
  return {
    operation,
    callsite: _firstExternalFrame(frames),
    stack: frames.slice(0, 6).join('\\n') || undefined
  };
}

export function __snapshotDownstream(source) {
  if (!Array.isArray(source?.reactions) || source.reactions.length === 0) return [];

  const queue = [...source.reactions];
  const visited = new Set();
  const records = [];

  while (queue.length > 0) {
    const reaction = queue.shift();
    if (!_isReaction(reaction) || visited.has(reaction)) continue;
    visited.add(reaction);

    const isDerived = 'reactions' in reaction && 'v' in reaction;
    records.push({
      reaction,
      kind: isDerived ? 'derived' : 'effect',
      label: typeof reaction.label === 'string' ? reaction.label : undefined,
      fnName: _fnName(reaction.fn),
      componentName: _fnName(reaction.component_function ?? reaction.ctx?.function),
      writeVersionBefore: reaction.wv
    });

    if (isDerived && Array.isArray(reaction.reactions)) {
      for (const next of reaction.reactions) queue.push(next);
    }
  }

  return records;
}

export function __finalizeDownstream(snapshot) {
  return (Array.isArray(snapshot) ? snapshot : []).map((record) => {
    const writeVersionAfter = _isReaction(record.reaction) ? record.reaction.wv : undefined;
    return {
      kind: record.kind,
      label: record.label,
      fnName: record.fnName,
      componentName: record.componentName,
      writeVersionBefore: record.writeVersionBefore,
      writeVersionAfter,
      updated:
        typeof record.writeVersionBefore === 'number' &&
        typeof writeVersionAfter === 'number' &&
        writeVersionAfter !== record.writeVersionBefore
    };
  });
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
import {
  __emit as __stEmit,
  __isEmitting as __stIsEmitting,
  __mutationMeta as __stMutationMeta,
  __snapshotDownstream as __stSnapshotDownstream,
  __finalizeDownstream as __stFinalizeDownstream
} from '${VIRTUAL_ID}';
const _tracked = ${TRACKED_FNS};
const ${alias} = new Proxy(${origAlias}, {
  get(t, p) {
    if (!_tracked.has(p)) return t[p];
    return (src, ...args) => {
      const _ov = src?.v;
      const _wv = src?.wv;
      const _op = typeof p === 'string' ? p : String(p);
      const _mutation = __stMutationMeta(_op);
      const _downstream = __stSnapshotDownstream(src);
      const _r = t[p](src, ...args);
      if (src?.wv !== _wv && !__stIsEmitting()) {
        const _dispatch = () =>
          __stEmit({
            label: src?.label,
            oldValue: _ov,
            newValue: src?.v,
            timestamp: Date.now(),
            mutation: _mutation,
            downstream: __stFinalizeDownstream(_downstream)
          });
        if (typeof queueMicrotask === 'function') queueMicrotask(_dispatch);
        else Promise.resolve().then(_dispatch);
      }
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
