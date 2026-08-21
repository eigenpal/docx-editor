## ADDED Requirements

### Requirement: Canonical-first provisional presentation

The editor MAY preflight eligibility and local shaping against a store-produced uncommitted `CandidateChange`. Commit SHALL compare-and-swap its predecessor revision, paragraph identity and fingerprint, source layout revision, normalized effects, and shaping resource fingerprints. The editor SHALL present only after the exact candidate commits and matches. A rejected or stale candidate SHALL produce no provisional display.

#### Scenario: Eligible character commits

- **WHEN** a collapsed text insertion commits and passes provisional eligibility
- **THEN** the editor presents text read from the committed paragraph before complete document layout settles

#### Scenario: Text operation is rejected

- **WHEN** a text insertion violates an invariant, lock, form rule, or editing-mode rule
- **THEN** canonical state and visible document content remain unchanged

#### Scenario: Provisional installation fails after commit

- **WHEN** an eligible candidate commits but its provisional DOM installation fails
- **THEN** the editor completes authoritative presentation synchronously or makes the document non-editable until `displayRevision` reaches `modelRevision`

### Requirement: Provisional state is distinct from complete layout

The surface SHALL track `modelRevision`, `layoutRevision`, `displayRevision`, model selection, monotonic selection epoch, and optional provisional display as distinct state. One atomic surface transition SHALL publish a committed model revision, `ModelChange`, mapped model selection, and selection epoch. A provisional display SHALL NOT publish a partial `SemanticLayout`, change complete page geometry, enter public snapshots, or appear as authoritative geometry.

#### Scenario: Model is newer than complete layout

- **WHEN** an eligible text edit commits and provisional content is visible while complete layout still names the preceding revision
- **THEN** model reads observe `modelRevision`, editable DOM names `displayRevision`, page reads retain `layoutRevision`, and no consumer receives a mixed page graph

#### Scenario: Complete layout publishes

- **WHEN** authoritative layout for the latest model revision finishes
- **THEN** one atomic publish replaces the provisional display and all complete layout consumers move to that revision together

### Requirement: Public editor events follow completed display transitions

For each accepted editor intent, the store SHALL commit first. The surface SHALL then map selection, install verified provisional or complete DOM, and replace its coherent snapshot. On the next microtask, the editor SHALL emit `change` before `selectionChange`. Reentrant editor mutations SHALL queue after the current transition.

#### Scenario: Change handler reads snapshot

- **WHEN** a public `change` handler reads editor state
- **THEN** it observes committed model state, current editable display, mapped selection, and revision-tagged complete page state from one finished surface transition

#### Scenario: External store commit arrives

- **WHEN** the surface observes a canonical commit that did not originate from its current input transition
- **THEN** it suspends editing synchronously and restores editing only after `displayRevision` reaches the external `modelRevision`

### Requirement: Provisional eligibility fails closed

Provisional eligibility SHALL finish before commit. Candidate grapheme segmentation, glyph IDs, positions, clusters, caret stops, bidirectional levels, visual order, source mappings, and fallback-font identities SHALL equal a clean local shape of that candidate. Only fragment count, page ownership, line breaks, vertical metrics, and flow extent SHALL remain unchanged against previous complete layout. Unsupported, stale, or changed geometry SHALL use the synchronous authoritative path.

#### Scenario: Character stays on the same lines

- **WHEN** a body-story insertion reshapes one materialized paragraph and proves unchanged line and fragment geometry
- **THEN** the editor can patch that paragraph provisionally

#### Scenario: Character causes wrapping

- **WHEN** local reshaping changes a line break, line count, fragment boundary, page ownership, or flow extent
- **THEN** provisional presentation is refused and authoritative layout determines the display

#### Scenario: Paragraph has an unsupported dependency

- **WHEN** the paragraph requires an unsupported script, composition state, field, note, drawing, table, content control, review wrapper, structural break, or stale resource
- **THEN** provisional presentation is refused without weakening the normal editing behavior

### Requirement: Provisional records remain semantic and DOM-free

The layout lane SHALL produce provisional source-addressable line and style-span records from the store-produced candidate, exact prior width, resolved styles, font resources, and shaping configuration. After commit, output SHALL verify the candidate fingerprint and consume the record without remeasuring text or making DOM geometry canonical.

#### Scenario: Mixed run formatting remains on one line

- **WHEN** an eligible insertion occurs beside supported run formatting and local reshaping preserves geometry
- **THEN** provisional spans retain ordered canonical UTF-16 ranges and exact resolved formatting

#### Scenario: Output patches a paragraph

- **WHEN** a valid provisional paragraph record targets an existing materialized fragment
- **THEN** output changes only that paragraph's owned DOM and uses the record's semantic positions for caret placement

### Requirement: Continued typing uses model positions

While provisional display is active, each later accepted `beforeinput` intent SHALL commit independently and address the committed model selection plus provisional source map. Presentation and settle work MAY coalesce, but semantic transactions and history boundaries SHALL NOT coalesce. Browser DOM mutation and stale complete-layout geometry SHALL NOT determine insertion position.

#### Scenario: Rapid characters arrive before settle

- **WHEN** several eligible characters arrive while an older complete layout job is pending
- **THEN** every character commits once in order with its history boundary, the provisional paragraph advances to the latest model revision, and stale layout work cannot overwrite it

#### Scenario: Selection evidence is stale

- **WHEN** a delayed browser selection event refers to DOM replaced by provisional or authoritative paint
- **THEN** its selection epoch is rejected before it can move the model caret or affect later input

### Requirement: Geometry operations cross a settle barrier

Any operation that requires geometry outside the proved provisional record SHALL capture an intent token containing model revision, selection epoch, and input queue sequence. Later mutations SHALL wait while settle runs. After complete latest-revision layout publishes, the operation SHALL capture a separate geometry token containing that layout revision and re-hit-test. It SHALL validate the intent token before replay and geometry token before commit. Event handlers SHALL queue their intent. Existing queries MAY return their typed unavailable result.

#### Scenario: Pointer arrives during provisional display

- **WHEN** the user clicks outside the provisional paragraph before complete layout settles
- **THEN** the editor queues the click, settles authoritative layout, re-hit-tests, and applies it only while its barrier token remains current

#### Scenario: Save runs during provisional display

- **WHEN** DOCX save is requested after buffered input has committed
- **THEN** save drains accepted input through one captured queue sequence and serializes that canonical revision without reading provisional DOM

#### Scenario: Print runs during provisional display

- **WHEN** print or paginated export is requested
- **THEN** the operation uses a complete authoritative layout for the latest canonical revision

#### Scenario: New input races with a settled pointer

- **WHEN** keyboard input changes the model after a pointer barrier settles but before selection commits
- **THEN** the token check rejects the stale target and repeats hit testing or cancels the pointer intent

### Requirement: IME composition uses a private draft

Composition SHALL start from complete editable layout. Intermediate composition text SHALL remain in one private draft outside canonical state, save, complete layout, history, and automation. `compositionend` SHALL commit one semantic intent. Cancellation, blur, detach, or failure SHALL remove the draft.

#### Scenario: Composition starts during provisional display

- **WHEN** `compositionstart` occurs while provisional display is active
- **THEN** the surface restores complete latest-revision editable DOM before native updates or cancels composition without reading stale painted DOM

#### Scenario: Composition is cancelled

- **WHEN** composition ends without accepted content
- **THEN** no canonical revision or history entry is created and all draft DOM is removed

#### Scenario: Save runs during composition

- **WHEN** save is requested while a composition draft remains unresolved
- **THEN** public `Editor.save()` rejects with typed `composition-active` and never serializes draft DOM

### Requirement: Complete settle is cooperative and cancellable

Authoritative layout after provisional presentation SHALL capture an immutable package snapshot, model revision, scope, and resource fingerprints. DOM-free resumable loops SHALL use injected clock, deadline, continuation, cancellation, and visibility ports; `isInputPending` MAY provide an additional hint. Hidden tabs SHALL use timer continuations. A newer model revision SHALL cancel or supersede older work, and only the latest complete revision MAY publish.

#### Scenario: New input supersedes settle

- **WHEN** another eligible character commits while authoritative layout for an older revision is incomplete
- **THEN** older work is cancelled or reused only through valid checkpoints and cannot publish

#### Scenario: Input stops

- **WHEN** no newer edit supersedes the pending revision
- **THEN** cooperative work completes, publishes one complete layout, and removes provisional state

#### Scenario: Cooperative path is unavailable

- **WHEN** a layout feature cannot execute incrementally or cooperatively
- **THEN** the editor uses the existing complete authoritative fallback and publishes no partial result

#### Scenario: Cooperative slice is measured

- **WHEN** settle runs on the maintained reference profile
- **THEN** slice duration meets 4 ms p95 and 8 ms maximum, or the responsible leaf is split or excluded from the cooperative lane

#### Scenario: Cancelled work has callbacks

- **WHEN** detach, reload, font change, display-mode change, width change, or newer input cancels a settle job
- **THEN** timers, tasks, animation frames, resource callbacks, accumulators, temporary sequences, and builders are released without stale publication or unfingerprinted cache writes

### Requirement: Settled paint follows layout change evidence

Complete-layout publication SHALL identify changed, created, deleted, remapped, and reused page records and their presentation dependencies. Output SHALL preserve unchanged page shells and materialized-page DOM, and SHALL rebuild global presentation indexes only when their dependency keys change.

#### Scenario: Middle edit converges on the same page

- **WHEN** complete layout changes one materialized page and reuses all later pages
- **THEN** output reconciles the changed page interval without scanning or rebuilding unaffected page content

#### Scenario: Drawing dependency changes

- **WHEN** complete layout reports a changed drawing resource or placement dependency
- **THEN** output updates every affected materialized occurrence and does not reuse an invalid drawing index

### Requirement: Provisional display clears atomically

Authoritative paint SHALL remove provisional tags, records, and DOM in the same publish operation that installs the complete revision. The user SHALL never see duplicate provisional and authoritative text.

#### Scenario: Authoritative paragraph matches provisional text

- **WHEN** complete layout settles after eligible provisional insertion
- **THEN** output adopts or replaces the provisional paragraph once, keeps the semantic caret, and leaves no duplicate glyphs

#### Scenario: Surface detaches before settle

- **WHEN** the mounted surface is destroyed with provisional display active
- **THEN** pending layout and provisional resources are cancelled while committed canonical content remains available for save or remount

#### Scenario: Undo runs before settle

- **WHEN** undo or redo publishes another model revision while provisional display is active
- **THEN** older jobs and display records are cancelled and editable DOM is regenerated from the restored canonical revision before further input

### Requirement: Layout-derived chrome freezes while stale

Review activation, review rail geometry, table context, object controls, and other layout-derived chrome SHALL remain tied to `layoutRevision` while provisional display exists. Geometry actions SHALL be disabled until complete latest-revision layout publishes.

#### Scenario: Provisional caret enters review content

- **WHEN** provisional typing changes the model selection before review geometry settles
- **THEN** review activation remains unavailable and no stale review card action targets the changed selection

### Requirement: Provisional accessibility has one text copy

Provisional replacement SHALL expose one accessible text copy, preserve editor focus, and keep geometry-dependent controls unavailable. Assistive-technology selection that needs stale geometry SHALL cross the same settle barrier as pointer selection.

#### Scenario: Paragraph is replaced provisionally

- **WHEN** output installs provisional committed text
- **THEN** the accessibility tree contains one paragraph copy, focus remains on the editor, and stale geometry controls report unavailable

### Requirement: Adapters cannot implement independent fast paths

Provisional eligibility, local shaping, settle barriers, and authoritative replacement SHALL live in the core engine. React, Vue, Pro review, and other hosts SHALL consume shared engine state and SHALL NOT patch document DOM or maintain adapter-owned typing state.

#### Scenario: React and Vue host the same document

- **WHEN** both adapters exercise an eligible insertion
- **THEN** they receive equivalent canonical edits, provisional state transitions, authoritative layout, and saved bytes from the same engine implementation
