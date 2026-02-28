# RuneKit — Feature Proposal

> A comprehensive dev tools suite for Svelte 5 / SvelteKit, inspired by React Scan and the broader React DevTools ecosystem, but designed around Svelte's unique reactivity model.

---

## 1. Audit of What Exists Today

### 1.1 RuneKit (this repo)

RuneKit is a Vite plugin suite that ships two plugins and two monitor UI components:

| Feature                    | Implementation                                                                                                                                                                                                                                            | Status  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Signal Tracker plugin**  | Vite plugin that intercepts `svelte/internal/client` via virtual module shim. Wraps `set`, `update`, `update_pre`, `mutate`, `get` plus DOM ops (`set_text`, `set_value`, `set_class`, etc.). Emits change/read/write events through a runtime event bus. | Working |
| **Signal Tracker Monitor** | Floating Svelte component with three tabs — Feed (live event stream), Variables (aggregate read/write stats), Timeline (compressed swimlane visualization). Supports DOM flash highlighting for re-renders with source labels.                            | Working |
| **Routes Tracker plugin**  | Scans `src/routes` at startup, discovers pages/layouts/endpoints/remotes, parses exports via `es-module-lexer`, watches for file changes and pushes HMR updates. Serves a `/__runekit/remote` middleware for invoking `.remote.ts` files.                 | Working |
| **RuneKit Dashboard**      | Full-page dashboard with Routes, Endpoints, Remotes, and History tabs. Supports endpoint testing (method/query/headers/body) and remote function invocation with live output.                                                                             | Working |

**Strengths:**

- Deep integration with Svelte 5 internals (wraps the actual `$.set`/`$.get` calls)
- Source chain tracking — traces reactive dependency paths through derived signals
- DOM flash highlighting with source labels (similar to React Scan's visual highlighting)
- Live HMR-powered route/remote discovery
- Well-structured Vite plugin architecture

**Gaps:**

- No component tree visualization
- No performance profiling (render timing, slow component detection)
- No automatic "problem component" detection (React Scan's core value prop)
- No production monitoring
- No network/fetch inspector
- No error tracking overlay
- Signal tracker only instruments `.svelte` files (not `.ts`/`.js` stores)
- No persistent session (data resets on HMR/navigation)
- No "open in editor" integration
- No plugin/extension system
- No state editing capabilities

### 1.2 Official Svelte DevTools (browser extension)

- Component tree visualization
- Props/state inspection (read-only in Svelte 5)
- Event tracking
- Limited to Chrome/Firefox extension context
- No performance profiling
- No render highlighting
- No SvelteKit-specific features (routes, load functions, server actions)

### 1.3 React Scan

React Scan is the benchmark for what "great dev tools" looks like in the React ecosystem:

| Feature                          | Description                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| **Automatic render detection**   | Identifies components that re-render unnecessarily — zero config                              |
| **Visual highlighting**          | Outlines re-rendering components with colored borders, intensity scales with render frequency |
| **Component profiling**          | Render count, render duration, shows what changed (props/state/context)                       |
| **Slowdown notifications**       | Alerts when a component render exceeds a threshold                                            |
| **Component inspector**          | Hover to see component name, props, render count                                              |
| **Multiple entry points**        | npm, CDN script tag, CLI for scanning remote apps                                             |
| **Production monitoring**        | Tracks real-user performance (INP, LCP) tied to specific components                           |
| **Plugin RFC**                   | Planned extension system for third-party tools                                                |
| **Framework-agnostic ambitions** | Plugin system may support non-React frameworks                                                |

**What makes React Scan great:**

1. **Zero-config value** — drop it in, immediately see which components are slow
2. **Visual-first** — the overlay makes problems obvious at a glance
3. **Actionable** — doesn't just show data, highlights what to fix
4. **Low friction** — CDN script tag means you can try it in 10 seconds

---

## 2. Proposed Feature Set

The proposal is organized into **tiers** — each tier builds on the previous and can be shipped independently.

### Tier 1: Core Performance & Reactivity (highest impact)

#### 1A. Render Performance Overlay

The single highest-impact feature, directly inspired by React Scan's core value proposition but adapted for Svelte's fine-grained reactivity.

**What it does:**

- Visual overlay that highlights DOM elements when they update, with intensity/color scaling based on update frequency and duration
- Unlike React (which re-renders entire components), Svelte updates individual DOM nodes — the overlay should reflect this granularity
- Shows a heatmap mode: elements that update most frequently glow brighter/warmer
- Configurable thresholds: warn when an element updates more than N times in M seconds

**How it differs from React Scan:**

- Svelte doesn't have "unnecessary re-renders" in the React sense. Instead, the focus shifts to:
  - Excessive signal writes (e.g., setting the same value repeatedly)
  - Cascading derived updates (signal A triggers B triggers C triggers D)
  - Expensive effects (effects that take >16ms)
  - Unnecessary DOM operations (e.g., setting text to the same value)
- The overlay labels show the signal name and chain, not just the component name

**Implementation sketch:**

- Extend the existing `signal-tracker-runtime.js` DOM flash system
- Track update frequency per DOM element over a sliding window
- Add a persistent heatmap mode (current flash is transient)
- Add timing instrumentation around `$effect` execution
- Aggregate stats and surface "top offenders" in the monitor

#### 1B. Effect Profiler

**What it does:**

- Instruments all `$effect` and `$derived` computations with timing
- Surfaces the slowest effects in a ranked list
- Shows the dependency graph for each effect (which signals trigger it)
- Detects effect cascades (effect A writes signal that triggers effect B)
- Warns about infinite-loop-prone patterns

**Implementation sketch:**

- Wrap effect/derived execution in the shim (similar to how mutations are wrapped)
- Capture `performance.now()` before and after
- Emit timing events to the monitor
- Build a flame-chart-style visualization for nested effect execution

#### 1C. Redundant Update Detection

**What it does:**

- Detects when `$.set` is called with a value identical to the current value
- Detects when a derived signal recomputes to the same result
- Surfaces these as "optimization opportunities" in the monitor
- Auto-suggests where to add guards or memoization

**Implementation sketch:**

- In the shim's `_wrapMutation`, compare old and new values before emitting
- Track "no-op write" counts per signal
- Add a new "Insights" tab to the monitor that shows optimization suggestions

---

### Tier 2: Component & State Inspection

#### 2A. Component Tree

**What it does:**

- Visual tree of all mounted Svelte components
- Shows component name, file path, prop values, internal state
- Click-to-inspect: highlight the component's DOM in the page
- Search/filter by component name
- "Open in editor" — click to open the source file in VS Code/Cursor

**How it works in Svelte 5:**

- Svelte 5 components are compiled to functions — there's no fiber tree to walk
- Instead, instrument the component mount/unmount lifecycle by wrapping the internal `push`/`pop` context functions
- Build a virtual component tree from mount/unmount events
- Use `$.inspect_fn` or the internal context to read current state

**Implementation sketch:**

- New Vite plugin hook that wraps `svelte/internal/client`'s component lifecycle functions
- Maintain a live tree structure in the runtime module
- Expose tree data through the virtual module system
- New "Components" tab in the monitor UI

#### 2B. State Editor

**What it does:**

- Edit `$state` values directly from the dev tools panel
- Supports primitive values, objects, and arrays
- Changes propagate through the reactive graph immediately
- Undo/redo support

**Implementation sketch:**

- The shim already has references to signal sources — expose a `__setSignalByLabel(label, value)` function
- Add inline editing to the Variables tab
- Use `$.set` internally to trigger proper reactive updates

#### 2C. Props Debugger

**What it does:**

- For any component in the tree, shows current prop values
- Highlights when props change
- Shows whether prop changes caused DOM updates or were no-ops

**Implementation sketch:**

- Instrument `$props()` calls in the shim
- Track prop values over time
- Correlate prop changes with downstream signal/DOM activity

---

### Tier 3: SvelteKit-Specific Tools

#### 3A. Load Function Profiler

**What it does:**

- Instruments `load` functions (both universal and server) with timing and return data
- Shows waterfall visualization of load function execution during navigation
- Detects slow load functions and suggests `depends()` / invalidation strategies
- Shows data flow: which load data ends up in which component

**Implementation sketch:**

- Server-side: middleware that wraps load function execution with timing
- Client-side: instrument `goto`/navigation events and correlate with load timing
- Send profiling data through the HMR channel
- New "Loads" tab in the dashboard

#### 3B. Navigation Tracker

**What it does:**

- Timeline of all SvelteKit navigations (client-side and full-page)
- Shows load function execution, component mounts/unmounts, and signal activity for each navigation
- Identifies slow transitions
- Network request waterfall per navigation

**Implementation sketch:**

- Hook into SvelteKit's `beforeNavigate`/`afterNavigate` lifecycle
- Correlate with load function profiler and signal tracker data
- Build a timeline visualization (extend the existing timeline component)

#### 3C. Form Action Debugger

**What it does:**

- Lists all form actions in the app
- Test form submissions directly from dev tools
- Shows request/response for form actions
- Tracks `use:enhance` behavior

**Implementation sketch:**

- Extend routes tracker to detect actions (already parses `hasActions`)
- Add a form action testing UI similar to the endpoint tester
- Instrument `use:enhance` to capture before/after state

#### 3D. Error Boundary Inspector

**What it does:**

- Shows all active error boundaries (`+error.svelte` components)
- Shows error history (caught errors with stack traces)
- Simulates errors to test error boundaries
- Shows which routes/layouts have error handling coverage

**Implementation sketch:**

- Extend routes tracker (already discovers `+error.svelte` files)
- Instrument error handling in the runtime
- Add error simulation capabilities

---

### Tier 4: Advanced Debugging

#### 4A. Time-Travel Debugging

**What it does:**

- Records a history of all signal state changes
- Slider to move backwards and forwards through application state
- Snapshot/restore: save a point in time and return to it later
- Export/import state snapshots for bug reproduction

**Implementation sketch:**

- Extend signal tracker to maintain a ring buffer of state snapshots
- On "rewind", use `$.set` to restore all signals to their snapshot values
- Need to handle effects carefully (suppress during replay)
- UI: slider control over the timeline, with play/pause

#### 4B. Network Inspector

**What it does:**

- Intercepts all `fetch` calls made by the application
- Shows request/response details, timing, status
- Correlates network requests with the load functions that initiated them
- Highlights failed requests and slow responses
- Shows request waterfall alongside the navigation timeline

**Implementation sketch:**

- Monkey-patch `globalThis.fetch` in the runtime
- Emit events for request start/end/error
- Correlate with load function profiler
- Build a network waterfall tab

#### 4C. Accessibility Auditor

**What it does:**

- Live accessibility checking of the rendered page
- Highlights elements with a11y issues (missing alt text, low contrast, missing labels)
- Integrates with Svelte's built-in a11y warnings
- Shows ARIA tree alongside the component tree

**Implementation sketch:**

- Use `axe-core` or similar library for runtime a11y checking
- Run audits on DOM mutations
- Overlay violations on the page
- New "A11y" tab in the monitor

#### 4D. Bundle Analyzer

**What it does:**

- Shows component-level bundle size contribution
- Identifies heavy dependencies
- Tree-shaking effectiveness report
- Suggests code-splitting opportunities

**Implementation sketch:**

- Vite plugin that analyzes the build output
- Maps chunks back to components/routes
- Generates a treemap visualization
- Integrates with the routes view to show per-route bundle cost

---

### Tier 5: Developer Experience

#### 5A. Unified Dev Tools Panel

**What it does:**

- Single floating panel (like current SignalTrackerMonitor) that contains all tools
- Dockable: bottom, right, left, or floating
- Resizable with drag handles
- Keyboard shortcut to open/close (e.g., `Ctrl+Shift+D`)
- Tab system for switching between tools
- Remembers panel position/size/open tabs across HMR

**Implementation sketch:**

- Merge SignalTrackerMonitor and RuneKitDashboard into a single unified component
- Add a layout system with docking support
- Persist state to `sessionStorage`
- Register keyboard shortcut handler

#### 5B. CLI / CDN Script Tag Mode

**What it does:**

- `npx runekit` to scan any running SvelteKit app (like `npx react-scan`)
- CDN script tag that can be dropped into any Svelte app for quick debugging
- No Vite plugin required for basic features (DOM highlighting, component inspection)

**Implementation sketch:**

- Standalone script that connects to the page's Svelte runtime
- Uses Svelte 5's internal `$.inspect_fn` for state observation
- Injects the overlay UI dynamically
- CLI wraps this in a proxy/bookmarklet approach

#### 5C. VS Code / Cursor Extension

**What it does:**

- "Open in editor" from any component in the dev tools
- Shows signal activity inline in the editor (gutter annotations)
- Component tree in the sidebar
- Breakpoint integration: break on signal write

**Implementation sketch:**

- Communicate between the browser dev tools and the editor via a local WebSocket
- Use the existing `vite-plugin-devtools-json` integration
- Editor extension reads signal tracker events

#### 5D. Plugin System

**What it does:**

- Third-party developers can create RuneKit plugins
- Plugins can add new tabs, new overlay features, new Vite transforms
- Core APIs: `onSignalChange`, `onComponentMount`, `onNavigation`, `onFetch`
- Plugin marketplace (future)

**Implementation sketch:**

- Define a plugin interface with lifecycle hooks
- Plugins register through the Vite plugin options
- Runtime plugins register through a `runekit.use()` API
- Tab registration system for the unified panel

---

## 3. Priority Matrix

| Feature                         | Impact      | Effort | Priority |
| ------------------------------- | ----------- | ------ | -------- |
| Render Performance Overlay (1A) | 🔴 Critical | Medium | **P0**   |
| Effect Profiler (1B)            | 🔴 Critical | Medium | **P0**   |
| Redundant Update Detection (1C) | 🟠 High     | Low    | **P0**   |
| Unified Dev Tools Panel (5A)    | 🟠 High     | Medium | **P1**   |
| Component Tree (2A)             | 🟠 High     | High   | **P1**   |
| Load Function Profiler (3A)     | 🟠 High     | Medium | **P1**   |
| Navigation Tracker (3B)         | 🟡 Medium   | Medium | **P1**   |
| State Editor (2B)               | 🟡 Medium   | Low    | **P2**   |
| Network Inspector (4B)          | 🟡 Medium   | Medium | **P2**   |
| CLI / CDN Script Tag (5B)       | 🟠 High     | High   | **P2**   |
| Form Action Debugger (3C)       | 🟡 Medium   | Low    | **P2**   |
| Time-Travel Debugging (4A)      | 🟡 Medium   | High   | **P3**   |
| Props Debugger (2C)             | 🟡 Medium   | Medium | **P3**   |
| Error Boundary Inspector (3D)   | 🟢 Low      | Low    | **P3**   |
| Accessibility Auditor (4C)      | 🟡 Medium   | High   | **P3**   |
| Bundle Analyzer (4D)            | 🟢 Low      | High   | **P4**   |
| VS Code Extension (5C)          | 🟡 Medium   | High   | **P4**   |
| Plugin System (5D)              | 🟢 Low      | High   | **P4**   |

---

## 4. Recommended Implementation Order

### Phase 1 — "React Scan for Svelte" (P0)

The goal is to match React Scan's core value proposition: drop it in, immediately see performance problems.

1. **Render Performance Overlay** — extend existing DOM flash into a persistent, configurable heatmap
2. **Redundant Update Detection** — low-hanging fruit, adds immediate diagnostic value
3. **Effect Profiler** — complete the performance story with timing data

Deliverable: a developer can add `signalTracker()` to their Vite config and immediately see which parts of their app update most frequently, which effects are slow, and which signal writes are redundant.

### Phase 2 — "Unified Experience" (P1)

1. **Unified Dev Tools Panel** — merge existing UIs into a single, polished panel
2. **Component Tree** — the most-requested dev tools feature across all frameworks
3. **Load Function Profiler** — differentiating SvelteKit-specific value
4. **Navigation Tracker** — completes the SvelteKit story

Deliverable: a single `<RuneKit />` component that provides a complete debugging experience for SvelteKit apps.

### Phase 3 — "Power Tools" (P2-P3)

1. **State Editor** — interactive debugging
2. **Network Inspector** — request correlation
3. **CLI / CDN entry point** — lower the barrier to adoption
4. **Form Action Debugger** — SvelteKit completeness
5. **Time-Travel Debugging** — advanced debugging

### Phase 4 — "Ecosystem" (P4)

1. **Plugin System** — enable community contributions
2. **VS Code Extension** — editor integration
3. **Bundle Analyzer** — build-time insights

---

## 5. Key Design Principles

1. **Zero-config default experience** — adding the Vite plugin should give you immediate value
2. **Svelte-native, not a React port** — Svelte's fine-grained reactivity is fundamentally different from React's component-level re-rendering. The tools should reflect this (signal-level, not component-level)
3. **Visual-first** — overlays and highlights over tables and logs
4. **Dev-only, zero production cost** — all instrumentation should tree-shake away in production builds
5. **Non-invasive** — never affect the app's behavior, timing, or output
6. **Incremental adoption** — each feature works independently; use what you need
7. **Beautiful by default** — the dev tools UI should be a showcase of good Svelte component design

---

## 6. Technical Architecture

```
┌─────────────────────────────────────────────────┐
│                 Vite Plugins                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────┐ │
│  │ signalTracker │  │ routesTracker │  │ effect │ │
│  │              │  │              │  │Profiler│ │
│  └──────┬───────┘  └──────┬───────┘  └───┬────┘ │
│         │                 │              │       │
│         ▼                 ▼              ▼       │
│  ┌──────────────────────────────────────────────┐│
│  │          Virtual Module Runtime               ││
│  │  (event bus, state tracking, DOM overlay)     ││
│  └──────────────────────┬───────────────────────┘│
└─────────────────────────┼────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────┐
│              Unified Monitor UI                  │
│  ┌───────┬──────┬────────┬──────┬──────┬──────┐ │
│  │Signals│Perf  │Compo-  │Routes│Network│A11y  │ │
│  │       │      │nents   │      │       │      │ │
│  └───────┴──────┴────────┴──────┴──────┴──────┘ │
│                                                  │
│  ┌──────────────────────────────────────────────┐│
│  │            Page Overlay Layer                 ││
│  │  (heatmap, component outlines, highlights)   ││
│  └──────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

The architecture maintains the current pattern of:

- **Vite plugins** for build-time instrumentation and file system access
- **Virtual modules** as the bridge between server and client
- **Runtime event bus** for decoupled communication
- **Svelte components** for the monitor UI
- **DOM overlay** for visual debugging directly on the page

---

## 7. Competitive Positioning

| Capability              | Svelte DevTools (ext)  | RuneKit (current) | RuneKit (proposed)    | React Scan | React DevTools         |
| ----------------------- | ---------------------- | ----------------- | --------------------- | ---------- | ---------------------- |
| Component tree          | ✅                     | ❌                | ✅                    | ❌         | ✅                     |
| State inspection        | ✅                     | ✅ (signals)      | ✅                    | ❌         | ✅                     |
| State editing           | ❌                     | ❌                | ✅                    | ❌         | ✅                     |
| Performance overlay     | ❌                     | ✅ (basic flash)  | ✅ (heatmap)          | ✅         | ❌                     |
| Render profiling        | ❌                     | ❌                | ✅ (effect timing)    | ✅         | ✅                     |
| Problem detection       | ❌                     | ❌                | ✅ (redundant writes) | ✅         | ❌                     |
| Route inspection        | ❌                     | ✅                | ✅                    | ❌         | ❌                     |
| Endpoint testing        | ❌                     | ✅                | ✅                    | ❌         | ❌                     |
| Load function profiling | ❌                     | ❌                | ✅                    | N/A        | N/A                    |
| Navigation timeline     | ❌                     | ❌                | ✅                    | ❌         | ❌                     |
| Network inspector       | ❌                     | ❌                | ✅                    | ❌         | ❌                     |
| Time-travel             | ❌                     | ❌                | ✅                    | ❌         | ❌                     |
| A11y auditing           | ❌                     | ❌                | ✅                    | ❌         | ❌                     |
| Zero-config             | ❌ (extension install) | ✅                | ✅                    | ✅         | ❌ (extension install) |
| CLI entry point         | ❌                     | ❌                | ✅                    | ✅         | ❌                     |
| Production monitoring   | ❌                     | ❌                | Future                | ✅         | ❌                     |
| Plugin system           | ❌                     | ❌                | ✅                    | Planned    | ❌                     |

---

## 8. Open Questions

1. **Should the monitor UI be a separate browser extension or in-page only?** In-page is lower friction and allows Vite plugin integration, but an extension gets a dedicated DevTools tab. Recommendation: in-page first, extension later.

2. **How deep should component tree instrumentation go?** Svelte 5's compiled output makes this harder than React (no fiber tree). Need to investigate `$.push`/`$.pop` and what metadata is available at runtime.

3. **Should production monitoring be a paid service (like React Scan Monitoring)?** This could be a sustainability model. Keep all dev-time features free and open source.

4. **Should the CDN/CLI mode support non-SvelteKit Svelte apps?** Yes — the signal tracker already works with plain Svelte 5 + Vite. The routes tracker is SvelteKit-specific.

5. **How to handle SSR instrumentation?** The current signal tracker is client-only. Load function profiling needs server-side instrumentation passed through the HMR channel.
