# pro-collaboration-module Specification (delta)

## ADDED Requirements

### Requirement: collaborationModule delivers the replica through the seam

`@docx-editor.dev/pro` SHALL export `collaborationModule(options)` returning an
`EditorModule` with `id: 'collaboration'`. `options` SHALL extend
`ProLicenseOptions` and SHALL require
`session: EditorCollaborationSession | CollaborationSessionFactory`. The factory
SHALL call `rememberLicenseKey(options.licenseKey)` and SHALL NOT import Yjs.
Apache-licensed adapter packages SHALL NOT export collaboration UI after the
move.

#### Scenario: Registered module unlocks collaboration

- **WHEN** `createDocxEditor({ modules: [collaborationModule({ session, licenseKey })] })`
  mounts
- **THEN** the surface attaches `session`, remote selections paint, and undo
  routes through the session

#### Scenario: Missing key is fully functional and silent

- **WHEN** `collaborationModule({ session })` is constructed without a license key
- **THEN** attach, presence, and undo handover work with no console output and
  no UI banner

### Requirement: Yjs implementation lives in Pro subpaths

The unpublished `@docx-editor.dev/collaboration-yjs` package SHALL be deleted.
Its source SHALL move to `packages/pro/src/collaboration/`. Pro SHALL export
that implementation as `@docx-editor.dev/pro/collaboration` and
`@docx-editor.dev/pro/collaboration/webrtc`. The default collaboration entry
SHALL NOT import `y-webrtc` or `./webrtc`. Consumers SHALL install
`@docx-editor.dev/pro` only. Core's `packages/core/src/collaboration/` lane
SHALL remain in core and SHALL import no CRDT.

#### Scenario: One Pro install reaches the replica factories

- **WHEN** a host imports `createDocumentCollaboration` from
  `@docx-editor.dev/pro/collaboration` and `createWebrtcCollaboration` from
  `@docx-editor.dev/pro/collaboration/webrtc`
- **THEN** both resolve from the Pro package, and
  `@docx-editor.dev/collaboration-yjs` is not a workspace or published package

#### Scenario: Provider-neutral lane stays in core

- **WHEN** the core lane graph is inspected
- **THEN** `packages/core/src/collaboration/` still exists with
  `mayImport: ['store']`, and binding, layout, automation, and editor still
  list `collaboration` in their own `mayImport`

### Requirement: Adapter hooks move to Pro

`useCollaborationStatus` SHALL move from
`packages/react/src/editor/useCollaborationStatus.ts` and
`packages/vue/src/editor/useCollaborationStatus.ts` to
`packages/pro/src/react/` and `packages/pro/src/vue/`. The Vue composable SHALL
keep a named `UseCollaborationStatusReturn` interface. The React and Vue
adapter public APIs SHALL stop exporting the hook. `scripts/parity/parity.contract.json`
SHALL list `useCollaborationStatus` and `UseCollaborationStatusReturn` in the
Pro paired exports.

#### Scenario: Free adapters no longer export the hook

- **WHEN** the published `@docx-editor.dev/react` and `@docx-editor.dev/vue`
  artifacts are inspected
- **THEN** they do not export `useCollaborationStatus`

#### Scenario: Pro adapters export the hook

- **WHEN** a host imports `useCollaborationStatus` from
  `@docx-editor.dev/pro/react` or `@docx-editor.dev/pro/vue`
- **THEN** the hook subscribes to `session.subscribeStatus` and reports
  `'inactive'` when the session is null

### Requirement: Yjs UndoManager becomes undo authority when attached

While a collaboration session is attached, the surface SHALL report `canUndo` /
`canRedo` from the session and SHALL dispatch undo and redo to
`session.undo()` / `session.redo()`. Core SHALL NOT import Yjs or
`UndoManager`. The session implementation SHALL own that object. On surface
detach, core SHALL call the disposer returned by `session.attach`. The host
SHALL still own `session.destroy()`.

#### Scenario: Collaborative undo does not rewind remote work

- **WHEN** a local actor undoes after a remote peer has edited
- **THEN** the session undo path runs, and the canonical store history is not
  the undo authority for that gesture

#### Scenario: Detach disposes attach, host destroys the room

- **WHEN** the paginated surface unmounts
- **THEN** the attach disposer runs, and `destroy()` is not called by core
