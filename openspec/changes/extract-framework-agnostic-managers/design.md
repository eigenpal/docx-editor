## Context

This change follows `extract-core-monorepo`, which splits the codebase into `@eigenpal/docx-core` and `@eigenpal/docx-js-editor` (React). After that split, the package boundary is clean but the React package still contains ~50% framework-agnostic business logic embedded in React components and hooks. Specifically:

- `PagedEditor.tsx` (2080 lines) — coordinates PM state, layout engine, layout painter, selection overlays, column resizing, image interaction. Uses 50+ `useRef`/`useState`.
- `DocxEditor.tsx` (1400 lines) — manages document parsing, font loading, zoom, dialog state, extension manager, agent commands. Orchestrates everything.
- `useClipboard` — DOM selection traversal, formatting extraction, clipboard read/write wrapped in React hook
- `useAutoSave` — localStorage persistence with debounce wrapped in React hook
- `useTableSelection` — multi-cell selection state machine wrapped in React hook
- `PluginHost.tsx` — plugin state tracking, dispatch wrapping, CSS injection, DOM event listening
- `renderAsync.ts` — imperative mount via `React.createRoot()`
- `ErrorBoundary.tsx` — error capture via `componentDidCatch` + React context

A Vue contributor would need to reimplement all of this logic. The goal is to extract the state machines and coordination logic into framework-agnostic classes in `@eigenpal/docx-core`.

## Goals / Non-Goals

**Goals:**

- Extract framework-agnostic state machines and coordination logic from React components into plain TypeScript classes in `@eigenpal/docx-core`
- React components become thin wrappers (~50-70% line reduction) that subscribe to manager state and render
- Vue contributor can build components by wrapping the same managers in Vue composables
- Manager classes are independently unit-testable without DOM or React
- Zero behavioral changes — pure internal refactor

**Non-Goals:**

- Rewriting PagedEditor or DocxEditor from scratch (incremental extraction)
- Building the Vue composables (community contribution)
- Changing any public API of `@eigenpal/docx-js-editor`
- Extracting visual rendering logic (layout painter is already framework-agnostic)
- Optimizing performance (preserve current behavior exactly)

## Decisions

### 1. Event-emitter pattern for manager→UI communication

**Decision:** Manager classes use a simple typed event emitter (or callback registration) pattern to notify UI of state changes. No framework-specific reactivity.

```typescript
class LayoutCoordinator {
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // React: useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot)
  // Vue: watchEffect(() => { coordinator.subscribe(triggerRef) })
}
```

**Rationale:** React 18's `useSyncExternalStore` is designed exactly for this — subscribing React to external state stores. Vue's `watchEffect` + manual trigger achieves the same. This is the standard pattern used by Zustand, Redux, and other framework-agnostic state libraries.

**Alternative considered:** Making managers observable with Proxy/getter interception. Rejected — adds complexity, harder to debug, and both React and Vue have well-established patterns for subscribing to external stores.

### 2. Incremental extraction, not big-bang rewrite

**Decision:** Extract one manager at a time, run E2E tests after each extraction, commit when green.

**Order of extraction (lowest risk first):**

1. `AutoSaveManager` — simplest, isolated localStorage logic
2. `TableSelectionManager` — self-contained state machine
3. `ClipboardManager` — DOM logic, no layout dependencies
4. `ErrorManager` — replaces React context with pub/sub
5. `PluginLifecycleManager` — plugin state + dispatch wrapping
6. `LayoutCoordinator` — biggest, most complex (PagedEditor core)
7. `EditorCoordinator` — biggest, most complex (DocxEditor core)

**Rationale:** Extracting in risk order lets us validate the pattern on simple cases before tackling the 2000-line components. Each step is independently shippable.

**Alternative considered:** Extract everything at once. Rejected — too risky for components this large; a single mistake would be hard to bisect.

### 3. Managers own state, components subscribe

**Decision:** Each manager class holds its own state as plain properties. Framework components read from the manager (not copy into local state).

```typescript
// Manager owns the state
class LayoutCoordinator {
  layout: Layout | null = null;
  selectionRects: SelectionRect[] = [];
  caretPosition: CaretPosition | null = null;

  getSnapshot() {
    return { layout: this.layout, selectionRects: this.selectionRects, ... };
  }
}

// React component subscribes
function PagedEditor({ coordinator }) {
  const state = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot
  );
  // render using state
}
```

**Rationale:** Avoids state duplication (manager + component both holding layout). Single source of truth. The `getSnapshot` pattern works with both `useSyncExternalStore` (React) and manual subscription (Vue).

**Alternative considered:** Managers emit events with payloads, components store in local state. Rejected — leads to stale state bugs and sync issues.

### 4. Keep managers in `@eigenpal/docx-core` as plain classes

**Decision:** All manager/coordinator classes live in `packages/core/src/managers/` and are exported from `@eigenpal/docx-core`.

**Rationale:** They have zero framework dependencies (pure TS + DOM APIs). Putting them in core means both React and Vue packages can import them directly.

### 5. renderAsync becomes a framework-agnostic interface

**Decision:** Define `EditorHandle` interface in core. Each framework provides its own `renderAsync` implementation.

```typescript
// Core
interface EditorHandle {
  save(): Promise<Blob>;
  getDocument(): Document;
  focus(): void;
  destroy(): void;
}

// React: renderAsync(input, container, options) → Promise<EditorHandle>
// Vue: renderAsyncVue(input, container, options) → Promise<EditorHandle>
```

**Rationale:** The handle interface is what consumers actually use. The mounting mechanism (createRoot vs createApp) is an implementation detail.

### 6. ErrorManager replaces React ErrorBoundary + Context

**Decision:** Replace the React-specific error capture pattern with a framework-agnostic `ErrorManager` class using pub/sub.

```typescript
class ErrorManager {
  private notifications: ErrorNotification[] = [];
  private listeners = new Set<(notifications: ErrorNotification[]) => void>();

  showError(message: string, options?: ErrorOptions) { ... }
  dismiss(id: string) { ... }
  subscribe(listener) { ... }
}
```

**Rationale:** `componentDidCatch` only catches render errors. The current error system also handles async errors via context. A pub/sub manager handles both cases and works with any framework.

## Risks / Trade-offs

**[Risk] PagedEditor extraction breaks subtle timing** → The current `useEffect` ordering in PagedEditor is load-bearing (layout must compute before selection overlay renders). Mitigation: LayoutCoordinator must preserve the same sequencing internally. Validate with E2E tests after extraction.

**[Risk] Performance regression from subscription overhead** → Adding subscribe/notify between manager and component adds a layer. Mitigation: `useSyncExternalStore` is optimized for this. Benchmark before/after on large documents.

**[Risk] Ref-based imperative APIs break** → PagedEditor exposes imperative methods via `forwardRef` + `useImperativeHandle`. Mitigation: These methods delegate to the coordinator, which the ref can still expose.

**[Risk] Scope creep** → Extracting managers may reveal more tightly-coupled patterns. Mitigation: Strict incremental approach — extract, test, commit. Stop if a manager can't be cleanly extracted.

**[Trade-off] More files, more indirection** → Components become simpler but there are now separate manager classes. Accepted — the reduction in component complexity and enabling Vue outweighs the extra files.

**[Trade-off] `useSyncExternalStore` requires React 18+** → Already the minimum supported version. No impact.
