## Contract (this change)

- [x] Declare `Editor` with editing (`exec`/`can`), typed `query`, `snapshot`,
      lifecycle, and geometry (`getDisplay`, `getSelectionRects`, `getCaretRect`,
      `hitTest`, `getPageGeometry`, `getScrollGeometry`).
- [x] Declare the positioned render IR (`DisplayPage`, `DisplayItem`, `GlyphRun`,
      `ImageRef`, `BorderSeg`, `DocPoint`) in `core/geometry`.
- [x] Reduce `EditorHost` to DOM handles, `scheduleFrame`, `afterCommit`, and
      event callbacks; deliver pages via `onDisplay` / the `display` event.
- [x] Remove the old layout-output and measurement types from the public
      surface; no editing-engine or layout-internal type remains adapter-facing.
- [x] Update the consumer type test to the new surface; add no new test suites.
- [x] `packages/core` typecheck passes in isolation.

## Follow-up (separate changes, not in scope here)

- [ ] Implement the engine behind the contract.
- [ ] Repoint the React and Vue adapters onto the new contract once the engine
      exists, retiring their direct editing-engine and layout-internal imports.
