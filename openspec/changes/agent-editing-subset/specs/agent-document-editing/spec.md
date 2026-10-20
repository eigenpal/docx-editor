## ADDED Requirements

### Requirement: Fixed editing profile

The API SHALL implement the 81 editing members listed in tasks.md within the documented operating profile. Supporting reads SHALL remain mandatory without entering the editing denominator.

#### Scenario: Editing inventory

- **WHEN** the subset report runs
- **THEN** it lists exactly 81 unique editing members and reports signature and runtime evidence separately

#### Scenario: Incomplete evidence

- **WHEN** a member exists without passing behavioral evidence
- **THEN** it is not reported as behaviorally verified

### Requirement: Pinned public signatures and explicit runtime limits

The public members SHALL match the pinned Office.js signatures. Supported argument domains and behavior differences SHALL be documented per member.

#### Scenario: Table insertion location

- **WHEN** a caller inserts a table through a Range
- **THEN** its signature uses the upstream Before/After location domain rather than copying the broader text-insertion domain

#### Scenario: Existing differing signature

- **WHEN** the implementation reviews an already-present member with a differing signature
- **THEN** it resolves or explicitly records the difference instead of marking it complete based on name presence

### Requirement: Host-neutral canonical mutations

Required operations SHALL use canonical store transactions through the automation host in both browser and headless environments.

#### Scenario: Identical operation

- **WHEN** the same fixture and operation run through either host
- **THEN** both saved documents contain the same intended semantic changes

#### Scenario: Rejected operation

- **WHEN** validation, locking, tracking policy, or target resolution rejects a mutation
- **THEN** the batch leaves the document and package relationships unchanged

### Requirement: Usable object model

New objects SHALL expose Office.js-shaped targeting and load/sync behavior with documented runtime limitations. Required table, picture, field, section, and control navigation SHALL be available.

#### Scenario: Create and configure

- **WHEN** a caller inserts an object then configures its returned proxy
- **THEN** the supported batching path resolves the intended object without positional guessing

#### Scenario: Stale target

- **WHEN** a caller edits a deleted or stale target
- **THEN** the operation reports a stable error and never edits a replacement object

#### Scenario: Conflicting aliases

- **WHEN** two aliases queue incompatible snapshot-based mutations
- **THEN** the host either combines them correctly or explicitly refuses without lost updates

### Requirement: Everyday formatting and structures

The profile SHALL support text, hyperlinks, headings, character/paragraph formatting, nested bullet/decimal lists, rectangular tables, and plain/rich content controls.

#### Scenario: Ordinary document

- **WHEN** a workflow applies the required formatting and structural edits
- **THEN** save/reopen preserves those edits and untouched sentinel content

#### Scenario: Protected control

- **WHEN** a mutation violates a control or ancestor lock
- **THEN** it fails without removing the control or changing its contents

#### Scenario: Unsupported structure

- **WHEN** a requested mutation would alter an unsupported merged table or bound control
- **THEN** it explicitly refuses and preserves the original structure

### Requirement: Review fidelity

Tracked text insertion, deletion, and replacement SHALL create valid revision records under TrackMineOnly with an explicit author. Comment and revision operations SHALL preserve targets.

#### Scenario: Review workflow

- **WHEN** a caller edits tracked text, replies to and resolves a comment, then accepts or rejects a revision
- **THEN** original/final text, records, and comment state agree after save/reopen

#### Scenario: Tracked structural operation

- **WHEN** a caller attempts an unsupported tracked structural or formatting edit
- **THEN** it refuses without disabling tracking

### Requirement: Page furniture and inline media

The profile SHALL support inline PNG/JPEG images, page and next-page section breaks, page setup, primary headers/footers, and PAGE/NUMPAGES fields.

#### Scenario: Picture round trip

- **WHEN** a caller inserts, resizes, annotates, and later deletes an inline image
- **THEN** dimensions and alt text persist and unrelated media remains intact

#### Scenario: Missing footer

- **WHEN** a caller authors a primary footer in a section without its own footer part
- **THEN** the supported Office-shaped path creates valid parts and relationships with documented inheritance behavior

#### Scenario: Field result

- **WHEN** a caller updates an eligible PAGE or NUMPAGES field
- **THEN** the result reflects the documented pagination context and survives save/reopen; marking dirty alone is not reported as computation

#### Scenario: Unsafe field

- **WHEN** a field contains an unsupported executable or external instruction
- **THEN** the engine never executes or fetches it

### Requirement: Evidence and informational reporting

Completion SHALL require named tests and runtime notes. CI percentages SHALL remain informational. Uncertain document behavior SHALL be checked using disposable fixtures in local Word.

#### Scenario: Word evidence

- **WHEN** Word is used as an oracle
- **THEN** the evidence records fixture, version, actions, observations, and limitations without claiming that UI behavior proves Office.js batching semantics

#### Scenario: Readiness report

- **WHEN** workflow results are published
- **THEN** browser and headless outcomes remain separate from signature coverage and unverified items remain visible
