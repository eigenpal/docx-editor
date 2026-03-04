## Why

After the monorepo extraction (`extract-core-monorepo`), the package boundary is clean but ~50% of the editor's business logic remains trapped inside React components and hooks. `PagedEditor.tsx` (2080 lines), `DocxEditor.tsx` (1400 lines), and hooks like `useClipboard`, `useAutoSave`, `useTableSelection` all contain framework-agnostic state machines and coordination logic wrapped in React's `useState`/`useRef`/`useEffect`. A Vue contributor building `@eigenpal/docx-editor-vue` would need to reverse-engineer and reimplement all of this logic, which defeats the purpose of the core extraction.

## What Changes

- Extract `LayoutCoordinator` class from `PagedEditor.tsx` — manages layout pipeline caching, selection state, image interaction, column resizing, and the PM↔layout↔painter synchronization loop
- Extract `EditorCoordinator` class from `DocxEditor.tsx` — manages document lifecycle, zoom, font loading, extension manager initialization, dialog state, and agent command execution
- Extract `ClipboardManager` class from `useClipboard` hook — clipboard read/write, DOM selection traversal, formatting extraction
- Extract `AutoSaveManager` class from `useAutoSave` hook — localStorage persistence, debounced save, restore logic
- Extract `TableSelectionManager` class from `useTableSelection` hook — multi-cell selection state machine, data attribute queries
- Extract `RenderAsync` interface from `renderAsync.ts` — framework-agnostic contract for imperatively mounting an editor into a DOM element
- Extract `ErrorManager` class — error notification state, replacing React's `componentDidCatch` + context pattern with a pub/sub system
- Extract `PluginLifecycleManager` from `PluginHost.tsx` — plugin state tracking, dispatch wrapping, CSS injection, event listening (separate from React rendering)
- Refactor React components (`PagedEditor`, `DocxEditor`, hooks) to be thin wrappers around the extracted managers
- Existing behavior unchanged — internal refactor only

## Capabilities

### New Capabilities

- `layout-coordinator`: Framework-agnostic class coordinating the PM state → layout engine → layout painter → selection overlay pipeline, including caching, invalidation, and resize handling
- `editor-coordinator`: Framework-agnostic class managing document lifecycle (parse, load, save), zoom, font loading, extension manager, and agent command dispatch
- `manager-classes`: Framework-agnostic manager classes extracted from React hooks — `ClipboardManager`, `AutoSaveManager`, `TableSelectionManager`, `ErrorManager`, `PluginLifecycleManager`
- `render-async-interface`: Framework-agnostic interface for imperatively mounting an editor into a container element, with React and Vue implementations

### Modified Capabilities

## Impact

- **`@eigenpal/docx-core`**: Gains new exports — coordinator classes, manager classes, `RenderAsyncHandle` interface
- **`@eigenpal/docx-js-editor`**: `PagedEditor.tsx`, `DocxEditor.tsx`, and hooks become thin React wrappers (~50-70% line reduction). No public API changes.
- **`@eigenpal/docx-editor-vue`**: Vue contributor can now build components by wrapping the same coordinators/managers in Vue composables instead of reverse-engineering React logic
- **Testing**: Manager classes are unit-testable in isolation (no DOM/React needed for logic tests)
- **Risk**: Large internal refactor touching the two biggest components. Requires careful incremental extraction with E2E test validation at each step.
