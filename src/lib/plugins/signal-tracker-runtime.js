// @ts-nocheck
const _listeners = new Set();
const _readListeners = new Set();
const _writeListeners = new Set();
let _active = false;
const _stackIgnore = ['virtual:signal-tracker', '__st', 'svelte/internal/client'];
const _flashClass = '__signal_tracker_flash';
let _flashStyleReady = false;
let _rerenderFlashEnabled = true;
const _flashExclusionRoots = new Set();
let _activeSourceLabel = undefined;
let _activeSourceExpiresAt = 0;
const _sourceLabelTTL = 1500;
let _lastReadChain = undefined;
let _lastReadAt = 0;
const _readLabelTTL = 100;
let _readDepth = 0;
let _readStack = [];
const _derivedChainCache = new Map();

const _isReaction = (value) => value && typeof value === 'object' && typeof value.wv === 'number';
const _fnName = (value) =>
	typeof value?.name === 'string' && value.name.length > 0 ? value.name : undefined;
const _extractFrames = (stack) =>
	stack
		?.split('\n')
		.slice(1)
		.map((line) => line.trim()) ?? [];
const _firstExternalFrame = (frames) =>
	frames.find((line) => !_stackIgnore.some((token) => line.includes(token)));
const _isElement = (value) => typeof Element !== 'undefined' && value instanceof Element;
const _isText = (value) => typeof Text !== 'undefined' && value instanceof Text;
const _currentSourceLabel = () =>
	typeof _activeSourceLabel === 'string' && _activeSourceExpiresAt > Date.now()
		? _activeSourceLabel
		: undefined;

const _ensureFlashStyle = () => {
	if (_flashStyleReady || typeof document === 'undefined') return;
	_flashStyleReady = true;
	const style = document.createElement('style');
	style.setAttribute('data-signal-tracker-flash', 'true');
	style.textContent =
		'.' +
		_flashClass +
		'{outline:2px solid #fb923c;outline-offset:2px;transition:outline-color .2s ease;position:relative}' +
		'.' +
		_flashClass +
		'::after{content:attr(data-signal-tracker-source);position:absolute;left:0;top:-1.15rem;background:#fb923c;color:#111827;font:600 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;padding:1px 6px;border-radius:4px;pointer-events:none;white-space:nowrap;z-index:2147483647}';
	document.head?.appendChild(style);
};

const _toFlashElement = (value) => {
	if (_isElement(value)) return value;
	if (_isText(value)) return value.parentElement;
	return undefined;
};

const _flash = (value, sourceLabel) => {
	const element = _toFlashElement(value);
	if (!element || !sourceLabel) return;
	for (const root of _flashExclusionRoots) {
		if (root?.contains?.(element)) return;
	}
	if (element.closest?.('[data-signal-tracker-monitor="true"]')) return;
	// Svelte components might be detached from the root when updated or have different DOM structures
	// so we check if any exclusion root contains this element OR if the element is part of the monitor component
	if (element.id && typeof element.id === 'string' && element.id.startsWith('monitor-')) return;

	_ensureFlashStyle();
	element.setAttribute('data-signal-tracker-source', sourceLabel);
	element.classList.add(_flashClass);
	setTimeout(() => {
		element.classList.remove(_flashClass);
		element.removeAttribute('data-signal-tracker-source');
	}, 1000);
};

const _safeEmit = (listeners, event) => {
	for (const handler of listeners) {
		try {
			handler(event);
		} catch (e) {
			console.error('[signal-tracker]', e);
		}
	}
};

export function onSignalChange(handler) {
	_listeners.add(handler);
	return () => _listeners.delete(handler);
}

export function onSignalRead(handler) {
	_readListeners.add(handler);
	return () => _readListeners.delete(handler);
}

export function onSignalWrite(handler) {
	_writeListeners.add(handler);
	return () => _writeListeners.delete(handler);
}

export function setRerenderFlashEnabled(enabled) {
	_rerenderFlashEnabled = Boolean(enabled);
}

export function getRerenderFlashEnabled() {
	return _rerenderFlashEnabled;
}

export function registerFlashExclusionRoot(element) {
	if (!element || typeof element.contains !== 'function') return () => {};
	_flashExclusionRoots.add(element);
	return () => _flashExclusionRoots.delete(element);
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

export function __flashDomByOperation(operation, args, label) {
	if (!_rerenderFlashEnabled) return;
	if (typeof operation !== 'string' || !Array.isArray(args) || args.length === 0) return;
	if (typeof label !== 'string' || label.length === 0) return;
	if (operation === 'set_text') {
		_flash(args[0], label);
		return;
	}
	if (
		operation === 'set_value' ||
		operation === 'set_checked' ||
		operation === 'set_selected' ||
		operation === 'set_attribute' ||
		operation === 'set_xlink_attribute' ||
		operation === 'set_class' ||
		operation === 'set_style'
	) {
		_flash(args[0], label);
	}
}

export function __setActiveSourceLabel(label) {
	if (typeof label !== 'string' || label.length === 0) return;
	_activeSourceLabel = label;
	_activeSourceExpiresAt = Date.now() + _sourceLabelTTL;
}

const _expandChain = (chain) => {
	if (chain.length === 0) return chain;
	const subchain = _derivedChainCache.get(chain[0]);
	if (!subchain || subchain.length < 2) return chain;
	return [...subchain.slice(0, -1), ...chain];
};

export function __beginReadLabel(label) {
	_readDepth += 1;
	const isTopLevel = _readDepth === 1;
	if (isTopLevel) _readStack = [];
	if (typeof label === 'string' && label.length > 0) {
		_readStack.push(label);
	}
	return isTopLevel;
}

export function __endReadLabel() {
	if (_readDepth === 0) return;
	_readDepth -= 1;
	if (_readDepth !== 0) return;
	const raw = [];
	const seen = new Set();
	for (let i = _readStack.length - 1; i >= 0; i -= 1) {
		const label = _readStack[i];
		if (seen.has(label)) continue;
		seen.add(label);
		raw.push(label);
	}
	const chain = _expandChain(raw);
	if (chain.length > 1) _derivedChainCache.set(chain[chain.length - 1], chain);
	_lastReadChain = chain.length > 0 ? chain : undefined;
	_lastReadAt = Date.now();
	_readStack = [];
}

export function __takeReadChain() {
	if (!Array.isArray(_lastReadChain) || _lastReadChain.length === 0) return undefined;
	if (Date.now() - _lastReadAt > _readLabelTTL) {
		_lastReadChain = undefined;
		return undefined;
	}
	const chain = _lastReadChain;
	_lastReadChain = undefined;
	return chain;
}

const _truncateChain = (nodes, maxNodes = 4) => {
	if (!Array.isArray(nodes) || nodes.length <= maxNodes) return nodes;
	if (maxNodes < 2) return [nodes[0], '...'];
	const tailSize = Math.max(1, Math.floor((maxNodes - 1) / 2));
	const headSize = Math.max(1, maxNodes - tailSize);
	return [...nodes.slice(0, headSize), '...', ...nodes.slice(nodes.length - tailSize)];
};

export function __sourceChain(readChain) {
	const source = _currentSourceLabel();
	const chain = Array.isArray(readChain)
		? readChain.filter((label) => typeof label === 'string' && label.length > 0)
		: [];

	if (!source) return undefined;
	if (chain.length === 0) return source;

	if (!chain.includes(source)) return undefined;
	return _truncateChain(chain, 4).join(' > ');
}

export function __emitRead(event) {
	_safeEmit(_readListeners, event);
}

export function __emitWrite(event) {
	_safeEmit(_writeListeners, event);
}

/** @internal – injected into compiled Svelte output by vite-plugin-signal-tracker */
export function __emit(event) {
	// Re-entrancy guard: if the handler itself updates $state we skip that
	// secondary emission so we don't loop.
	if (_active) return;
	__setActiveSourceLabel(event?.label);
	_active = true;
	try {
		_safeEmit(_listeners, event);
	} finally {
		_active = false;
	}
}
