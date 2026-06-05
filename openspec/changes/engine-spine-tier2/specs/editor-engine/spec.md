## ADDED Requirements

### Requirement: DocxEditorEngine orchestrator

`@eigenpal/docx-editor-core` SHALL expose a `DocxEditorEngine` class in `core/editor/` constructed with a DI'd `EngineHost`. The engine SHALL own the orchestration state (PM view map, current layout, pending-frame handle, load generation) and expose `run`, `scheduleLayout`, `handleTransaction`, `syncHfViews`, `load`, and `save`. It SHALL NOT read framework reactive state; all framework-specific operations (view creation, host elements, render targets, output callbacks, frame scheduling) come through `EngineHost`.

#### Scenario: Engine drives orchestration via the host

- **WHEN** an adapter constructs `new DocxEditorEngine(host)` and routes its transactions/load/save through the engine
- **THEN** the engine performs the orchestration (layout, scheduling, view lifecycle, session) and calls back through `host` hooks, with no direct dependency on React or Vue

#### Scenario: Both adapters become thin wrappers

- **WHEN** Tier 2 is complete
- **THEN** React's `PagedEditor`/layout/view/session hooks and Vue's `useDocxEditor` delegate orchestration to the engine, keeping only reactivity bridges and overlay painting

#### Scenario: Headless host supplied synchronously

- **WHEN** a host provides a synchronous `scheduleFrame` stub (e.g. tests / SSR)
- **THEN** the engine runs without requestAnimationFrame and produces the same layout result
