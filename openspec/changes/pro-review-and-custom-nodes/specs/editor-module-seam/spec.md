# editor-module-seam Specification (delta)

## ADDED Requirements

### Requirement: EditorModule registration on createDocxEditor

`createDocxEditor` SHALL accept an optional `modules: EditorModule[]` option. `EditorModule` SHALL be a closed-shape interface defined in core contracts with named contribution points: `review` (the queue derivation `collectReviewItems` plus the `displayModes` the editor may enter beyond final-state) and `customNodes` (custom node definitions). The engine's review command implementations stay engine glue over the single write path; a registered review contribution is what makes them reachable, and their enabled state flows through the existing `can`/`toolbarCommandState` plumbing. Core SHALL iterate registered modules at its existing dispatch points and SHALL NOT import any pro package.

#### Scenario: Editor without modules behaves as free tier

- **WHEN** `createDocxEditor` is called with no `modules` option
- **THEN** the editor constructs successfully and all module contribution points resolve to null-object defaults; no code path throws for lack of a module

#### Scenario: Registration flips the command gates

- **WHEN** a module carrying a `review` contribution is registered
- **THEN** `can`/`toolbarCommandState` for the review commands and slots answer enabled, with no per-command module dispatch table

### Requirement: Display-mode gating without a module

The editor SHALL render documents in final-state projection (insertions applied, deletions hidden) when no registered module grants additional display modes. No public API SHALL switch the editor into markup or original display modes unless a module has granted them.

#### Scenario: Tracked-changes document renders final state

- **WHEN** a document containing `w:ins`/`w:del` is opened in an editor with no modules
- **THEN** painted pages show the final-state text and the document round-trips losslessly on save

#### Scenario: Granted modes become reachable

- **WHEN** a module granting markup display mode is registered
- **THEN** the editor can enter markup projection through the module's commands

### Requirement: hasReviewContent derived read

The editor snapshot SHALL expose a `hasReviewContent` boolean that is true when the document contains tracked changes or comment references. It SHALL be computed lazily, version-cached like other derived reads, and available without any module registered.

#### Scenario: Upsell hook in free tier

- **WHEN** a document containing tracked changes is opened with no modules registered
- **THEN** `snapshot().hasReviewContent` is `true` and reference-stable until document state changes

### Requirement: Review chrome slots degrade with a pro reason

Review chrome slots (`review.comments`, `review.editingMode`) SHALL remain in the core chrome registry. When no module wires them, they SHALL render disabled with an unavailable reason identifying the capability as pro-only, following the existing unwired-slot pattern.

#### Scenario: Disabled review buttons in free tier

- **WHEN** a toolbar renders review slots in an editor with no modules
- **THEN** the controls are disabled and `toolbarCommandState` reports the pro unavailable reason
