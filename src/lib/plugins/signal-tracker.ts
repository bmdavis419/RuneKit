import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

const VIRTUAL_ID = 'virtual:signal-tracker';
const RESOLVED_ID = '\0virtual:signal-tracker';
const SHIM_RESOLVED_ID = '\0virtual:signal-tracker-shim';
const ORIG_ID = 'virtual:signal-tracker-orig';

const RUNTIME_MODULE_URL = new URL('./signal-tracker-runtime.js', import.meta.url);
const RUNTIME_MODULE_PATH = fileURLToPath(RUNTIME_MODULE_URL);

const normalizeImporter = (importer: string | undefined) => {
	if (typeof importer !== 'string' || importer.length === 0) return '';
	return importer.split('?')[0].split('#')[0].replace(/\\/g, '/');
};

const isSvelteImporter = (importer: string | undefined) =>
	normalizeImporter(importer).endsWith('.svelte');

const isMonitorImporter = (importer: string | undefined) => {
	const normalized = normalizeImporter(importer);
	if (normalized.length === 0) return false;
	if (normalized.includes('/lib/monitor/')) return true;
	return (
		normalized.endsWith('/SignalTrackerMonitor.svelte') ||
		normalized.endsWith('/RuneKitDashboard.svelte')
	);
};

const shouldInstrumentImporter = (importer: string | undefined) =>
	isSvelteImporter(importer) && !isMonitorImporter(importer);

const loadRuntimeModule = async () => {
	const { readFile } = await import('node:fs/promises');
	return readFile(RUNTIME_MODULE_URL, 'utf8');
};

const SHIM_CODE = `
import * as __orig from '${ORIG_ID}';
import {
  __emit as __stEmit,
  __isEmitting as __stIsEmitting,
  __mutationMeta as __stMutationMeta,
  __snapshotDownstream as __stSnapshotDownstream,
  __finalizeDownstream as __stFinalizeDownstream,
  __flashDomByOperation as __stFlashDomByOperation,
  __setActiveSourceLabel as __stSetActiveSourceLabel,
  __emitRead as __stEmitRead,
  __emitWrite as __stEmitWrite,
  __beginReadLabel as __stBeginReadLabel,
  __endReadLabel as __stEndReadLabel,
  __takeReadChain as __stTakeReadChain,
  __sourceChain as __stSourceChain
} from '${VIRTUAL_ID}';

const _isInternalLabel = (label) =>
  typeof label === 'string' && (label.startsWith('monitor_') || label.startsWith('__st'));

const _wrapMutation = (fn, op) => (src, ...args) => {
  if (_isInternalLabel(src?.label)) return fn(src, ...args);
  __stSetActiveSourceLabel(src?.label);
  const _ov = src?.v;
  const _wv = src?.wv;
  const _mutation = __stMutationMeta(op);
  const _downstream = __stSnapshotDownstream(src);
  const _r = fn(src, ...args);
  if (src?.wv !== _wv && !__stIsEmitting()) {
    const _sourceChain = __stSourceChain();
    const _dispatch = () =>
      __stEmit({
        label: src?.label,
        oldValue: _ov,
        newValue: src?.v,
        timestamp: Date.now(),
        mutation: _mutation,
        downstream: __stFinalizeDownstream(_downstream)
      });
    __stEmitWrite({
      label: src?.label,
      operation: op,
      timestamp: Date.now(),
      sourceChain: _sourceChain
    });
    if (typeof queueMicrotask === 'function') queueMicrotask(_dispatch);
    else Promise.resolve().then(_dispatch);
  }
  return _r;
};

const _wrapDomOp = (fn, op) => (...args) => {
  const _r = fn(...args);
  const _readChain = __stTakeReadChain();
  const _chain = __stSourceChain(_readChain);
  __stFlashDomByOperation(op, args, _chain);
  return _r;
};

export * from '${ORIG_ID}';

export const set = _wrapMutation(__orig.set, 'set');
export const update = _wrapMutation(__orig.update, 'update');
export const update_pre = _wrapMutation(__orig.update_pre, 'update_pre');
export const mutate = _wrapMutation(__orig.mutate, 'mutate');

export const get = (signal, ...args) => {
  if (_isInternalLabel(signal?.label)) return __orig.get(signal, ...args);
  const _isTopLevelRead = __stBeginReadLabel(signal?.label);
  try {
    return __orig.get(signal, ...args);
  } finally {
    __stEndReadLabel();
    if (_isTopLevelRead) {
      __stEmitRead({
        label: signal?.label,
        timestamp: Date.now(),
        sourceChain: __stSourceChain([signal?.label])
      });
    }
  }
};

export const set_text = _wrapDomOp(__orig.set_text, 'set_text');
export const set_value = _wrapDomOp(__orig.set_value, 'set_value');
export const set_checked = _wrapDomOp(__orig.set_checked, 'set_checked');
export const set_selected = _wrapDomOp(__orig.set_selected, 'set_selected');
export const set_attribute = _wrapDomOp(__orig.set_attribute, 'set_attribute');
export const set_xlink_attribute = _wrapDomOp(__orig.set_xlink_attribute, 'set_xlink_attribute');
export const set_class = _wrapDomOp(__orig.set_class, 'set_class');
export const set_style = _wrapDomOp(__orig.set_style, 'set_style');
`;

export function signalTracker(): Plugin {
	return {
		name: 'vite-plugin-signal-tracker',
		enforce: 'pre',

		async resolveId(id, importer, options) {
			if (id === VIRTUAL_ID) return RESOLVED_ID;

			if (id === 'svelte/internal/client' && !options?.ssr) {
				if (!shouldInstrumentImporter(importer)) return null;
				return SHIM_RESOLVED_ID;
			}

			if (id === ORIG_ID) {
				const resolved = await this.resolve('svelte/internal/client', undefined, {
					skipSelf: true
				});
				return resolved?.id ?? null;
			}
		},

		async load(id) {
			if (id === RESOLVED_ID) {
				this.addWatchFile(RUNTIME_MODULE_PATH);
				return loadRuntimeModule();
			}
			if (id === SHIM_RESOLVED_ID) return SHIM_CODE;
		}
	};
}

export const __signalTrackerInternals = {
	normalizeImporter,
	isSvelteImporter,
	isMonitorImporter,
	shouldInstrumentImporter
};
