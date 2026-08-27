# Pro collaboration module

## Why

Realtime collaboration is a paid capability, not a free-tier experiment. The Yjs
implementation already lives in an unpublished package, so you can fold it into
`@docx-editor.dev/pro` now without a deprecation shim or a breaking migration.

## What Changes

- Merge `@docx-editor.dev/collaboration-yjs` into `@docx-editor.dev/pro`. Source
  moves to `packages/pro/src/collaboration/`. Consumers install one Pro package.
- Export the Yjs implementation on `@docx-editor.dev/pro/collaboration` and
  `@docx-editor.dev/pro/collaboration/webrtc`. Delete the standalone package.
- Add `collaborationModule(options)` next to `reviewModule()`. Hosts register it
  through `createDocxEditor({ modules })`.
- Extend `EditorModule` in `packages/core/src/contracts/modules.ts` with a
  `collaboration` contribution that carries the session (or a session factory).
  Core still has no lifecycle hooks on the module object.
- Remove the bespoke `collaboration?: EditorCollaborationSession` option from
  `DocxEditorConfig`, `PaginatedSurfaceOptions`, and the React and Vue roots.
  `paginated-surface.ts` attaches from the module registry instead.
- Move `useCollaborationStatus` from `packages/react` and `packages/vue` into
  `packages/pro/src/react/` and `packages/pro/src/vue/`.
- Keep `packages/core/src/collaboration/` in core. That lane stays
  provider-neutral, with no CRDT and no network provider.
- **Free tier:** with no collaboration module, the editor does not attach a
  replica, local undo stays the authority, and
  `snapshot().collaborationStatus` is `'inactive'`. Any path that would attach
  or take over undo refuses with `PRO_COLLABORATION_REASON`.
- No deprecation shim. `@docx-editor.dev/collaboration-yjs` is unpublished, and
  core's CHANGELOG has no collaboration entry. Rewrite the pending changesets
  so they describe the Pro module.

## Capabilities

### New Capabilities

- `editor-module-seam`: the `collaboration` contribution on `EditorModule`, the
  first-registration-wins conflict rule, attach gating in
  `paginated-surface.ts`, and free-tier status plus refusal when the module is
  absent.
- `pro-collaboration-module`: `collaborationModule()`, the source move, Pro
  subpaths, adapter hooks, and Yjs `UndoManager` undo-authority handover.
- `pro-licensing`: Pro packaging for the merged implementation — license
  headers, `y-protocols` as the only new runtime dependency, optional `yjs` and
  `y-webrtc` peers, and the narrowed `package-dependencies.test.ts` allowance.

### Modified Capabilities

None. `editor-module-seam` and `pro-licensing` exist only in the unarchived
`pro-review-and-custom-nodes` change, not in `openspec/specs/`. This change
adds the collaboration requirements as new capabilities rather than deltas
against an unpublished baseline.

## Impact

- `packages/core`: `EditorModule` / `EditorModuleRegistry` /
  `resolveEditorModules` gain `collaboration`. `DocxEditorConfig.collaboration`
  and `PaginatedSurfaceOptions.collaboration` go away.
  `packages/core/src/collaboration/` does not move.
- `packages/pro`: new `src/collaboration/` tree, `collaborationModule()`,
  `./collaboration` and `./collaboration/webrtc` exports, tsup entries,
  license headers, and a non-empty `dependencies` object.
- `packages/react` and `packages/vue`: drop `useCollaborationStatus` and the
  `collaboration` prop. Parity contract gains the hook on the Pro bucket.
- `packages/collaboration-yjs` and `docs/api/docx-editor-collaboration-yjs/`
  are deleted.
- Workspace scripts, API Extractor, consumer-install checks, examples, e2e,
  and the docs-site collaboration row move with the package.
- Changesets: rewrite the pending collaboration notes so they name the Pro
  module.
