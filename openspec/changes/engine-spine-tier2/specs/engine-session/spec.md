## ADDED Requirements

### Requirement: Load session seam with race guard

The engine SHALL expose `load(buffer)` performing: normalize input → `parseDocx` → recreate PM views → initial layout. It SHALL hold a private monotonic generation counter so a late `parseDocx` result from a superseded load is dropped (never overwrites a newer load's state). Both adapters SHALL load through `engine.load`; Vue thereby gains the race guard it currently lacks.

#### Scenario: Late parse is dropped

- **WHEN** two `load` calls overlap and the older `parseDocx` resolves after the newer one started
- **THEN** the older result is discarded and the newer document remains loaded

#### Scenario: Load recreates views and lays out

- **WHEN** `load(buffer)` completes
- **THEN** the body and HF EditorViews are recreated for the new document and an initial layout pass has run

### Requirement: Save session seam with selective save

The engine SHALL expose `save({ selective })` performing: sync PM content (and comment/reply-range markers) into the document, then serialize — using the selective save path (via the agent, honoring changed-paragraph / structural / untracked-change signals) when `selective` is not false, falling back to a full repack otherwise — and clearing tracked-change tracker state after a successful save. Both adapters SHALL save through `engine.save`; Vue thereby gains selective save and the post-save tracker clear it currently lacks.

#### Scenario: Selective save honors changed paragraphs

- **WHEN** `save({ selective: true })` runs after editing a subset of paragraphs
- **THEN** the engine performs a selective serialization via the agent and returns the saved bytes

#### Scenario: Full repack fallback

- **WHEN** selective save is disabled or not applicable
- **THEN** the engine performs a full repack/create and returns the saved bytes

#### Scenario: Tracker cleared after save

- **WHEN** a save completes successfully
- **THEN** tracked-change tracker state is cleared in both adapters (Vue matches React)

#### Scenario: Reply-range markers injected

- **WHEN** the document has comment/tracked-change replies
- **THEN** reply-range markers are injected before serialization, matching prior behavior in both adapters
