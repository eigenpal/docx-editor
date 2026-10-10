# editor-module-seam Specification (delta)

## ADDED Requirements

### Requirement: Collaboration contribution on EditorModule

`EditorModule` in `packages/core/src/contracts/modules.ts` SHALL gain an optional
`collaboration` field of type `CollaborationModuleContribution`. That contribution
SHALL carry `session: EditorCollaborationSession | CollaborationSessionFactory`.
`CollaborationSessionFactory` SHALL be `(documentId: string) => EditorCollaborationSession`.
`EditorModule` SHALL remain a plain data object with no lifecycle hooks. Core SHALL
call `attach`, `destroy`, `subscribeStatus`, `canUndo`, `undo`, and `redo` on the
resolved session, never on the module object. Registration SHALL stay
construction-time only, through `createDocxEditor({ modules })`.

#### Scenario: Module is still a data object

- **WHEN** a host constructs `collaborationModule({ session })` and registers it
  on `createDocxEditor`
- **THEN** the returned `EditorModule` has `id: 'collaboration'` and a
  `collaboration.session` payload, and it has no `attach`, `destroy`, or other
  lifecycle methods

#### Scenario: Factory is invoked at surface mount, not at module construction

- **WHEN** the contribution carries a `CollaborationSessionFactory`
- **THEN** core invokes that factory at most once per surface mount with the
  opened package's document id, from the existing attach site in
  `packages/core/src/editor/paginated-surface.ts`

### Requirement: First collaboration registration wins

`resolveEditorModules` SHALL keep at most one collaboration contribution. The
first module that carries `collaboration` SHALL win. Later collaboration
contributions SHALL be ignored rather than thrown. This is the same conflict
rule the review slot already uses.

#### Scenario: Second collaboration module is ignored

- **WHEN** `createDocxEditor` is called with two modules that each carry a
  `collaboration` contribution
- **THEN** the registry's `collaboration` field is the first contribution, the
  editor constructs successfully, and the second session is not attached

#### Scenario: Review and collaboration register together

- **WHEN** `modules` contains both `reviewModule()` and `collaborationModule({ session })`
- **THEN** the registry holds both contributions, and neither slot overwrites
  the other

### Requirement: Attach path gates on the module registry

The editor SHALL attach a collaboration replica only from the module registry.
`DocxEditorConfig`, `PaginatedSurfaceOptions`, and the React and Vue editor
roots SHALL NOT accept `collaboration?: EditorCollaborationSession`.
`packages/core/src/editor/paginated-surface.ts` SHALL attach a replica only when
`options.collaborationModel` (the resolved `EditorModuleRegistry.collaboration`)
is present. The attach sequence SHALL remain
`session.collaborationPort(documentId)` then `collaborationSession.attach(port)`.
Automation and `@docx-editor.dev/editor-api` SHALL use the same module path and
SHALL NOT attach a raw session beside it.

#### Scenario: No module means no attach

- **WHEN** `createDocxEditor` is called with no collaboration module
- **THEN** the surface does not call `collaborationPort` or `attach`, and local
  store history remains the undo authority

#### Scenario: Registered module attaches

- **WHEN** a collaboration module with a ready session is registered
- **THEN** the surface attaches that session to the document port and routes
  undo and redo through the session

#### Scenario: Bespoke option is gone

- **WHEN** a host passes `collaboration: session` on `createDocxEditor` or on
  `DocxEditor.Root`
- **THEN** TypeScript rejects the property, and there is no runtime fallback
  that attaches the session

### Requirement: Free-tier collaboration status and refusal

The editor snapshot SHALL expose `collaborationStatus` that is `'inactive'` when
no collaboration module is registered. The field SHALL be computed without Pro,
version-cached, and reference-stable until status changes. Core SHALL define
`PRO_COLLABORATION_REASON` as
`'realtime collaboration requires the pro collaboration module (@docx-editor.dev/pro)'`.
Any path that would attach a replica or take over undo without a registered
collaboration contribution SHALL refuse with that reason.

#### Scenario: Upsell hook in free tier

- **WHEN** an editor is constructed with no modules
- **THEN** `snapshot().collaborationStatus` is `'inactive'` and a host can
  render an upsell from that value without importing `@docx-editor.dev/pro`

#### Scenario: Status follows the session when the module is present

- **WHEN** a collaboration module is registered and the session reports `'ready'`
- **THEN** `snapshot().collaborationStatus` is `'ready'`

#### Scenario: Undo stays local without a module

- **WHEN** the user undoes in an editor with no collaboration module
- **THEN** the canonical store history undoes the edit, and the Yjs
  `UndoManager` is not consulted
