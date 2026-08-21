## ADDED Requirements

### Requirement: Deterministic large-document fixture

The repository SHALL own or deterministically generate a sanitized large-document typing fixture with pinned semantic shape and hash. The fixture SHALL exercise hundreds of pages, thousands of paragraphs, multiple sections, tables, drawings, notes, content controls, fields, and review content without containing personal or confidential source data.

#### Scenario: Fixture is generated

- **WHEN** the fixture generator runs from a clean checkout
- **THEN** it produces the pinned package hash, page count, block count, paragraph count, and feature inventory

#### Scenario: Supplied document informs a fixture

- **WHEN** a user-supplied DOCX reveals a performance shape worth preserving
- **THEN** the repository fixture reproduces that structure with synthetic content and excludes supplied names, text, metadata, media, and identifiers

### Requirement: Reference typing profile

The benchmark suite SHALL define a reproducible reference browser profile and pinned ordinary-typing corpus before default-enable measurements. It SHALL record browser version, production build, viewport, device scale, reduced-motion setting, shaped measurer, review-module state, fixture hash, corpus hash, caret positions, warmup count, run count, and machine class.

#### Scenario: Reference run begins

- **WHEN** a maintainer runs the large-document reference benchmark
- **THEN** the report contains every profile field required to compare the result with another run

#### Scenario: Shared continuous-integration runner executes

- **WHEN** the benchmark runs on hardware outside the reference profile
- **THEN** absolute timings are reported as informational while deterministic correctness and work gates remain enforced

### Requirement: One-frame eligible typing budget

On the maintained reference profile, every attempted fast-path insertion SHALL be measured from trusted `beforeinput`, including eligibility. A private benchmark event stream keyed by input queue sequence SHALL mark candidate decision, model commit, display patch, first paint, and settle. Public `change` SHALL NOT serve as a presentation marker. Eligible insertion SHALL present within 16.7 ms median and 33.4 ms p95. A sample completes only after expected text, caret, and revisions are verified.

#### Scenario: Isolated insertion is measured

- **WHEN** at least 100 warm attempts run across pinned paragraph lengths, caret positions, style boundaries, and line-edge positions with undo between samples
- **THEN** median and p95 provisional presentation latency meet the reference budget

#### Scenario: Sustained insertion is measured

- **WHEN** the benchmark types at least 180 eligible characters without waiting for authoritative settle after each character
- **THEN** presentation latency meets the reference budget, every character appears once in order, and the final model caret equals the inserted text length

#### Scenario: Edit is ineligible

- **WHEN** an insertion fails provisional eligibility
- **THEN** the report includes eligibility-decision time, refusal reason, and synchronous authoritative presentation without removing the attempted sample from overall reporting

#### Scenario: Default enablement is evaluated

- **WHEN** the defined ordinary-typing corpus completes
- **THEN** at least 80% of attempted insertions are eligible and ineligible p95 does not regress its recorded synchronous baseline by more than 10%

### Requirement: Text-local mutation work is document-size independent

Warm eligible insertion SHALL satisfy deterministic counters that exclude work proportional to total body width or paragraph count. The benchmark SHALL report wide-sequence materializations, child slots touched, validation visits, package invariant runs, complete index rebuilds, and created temporary bytes or objects where measurable.

#### Scenario: Warm middle insertion runs

- **WHEN** one eligible character commits under a body with thousands of sibling blocks
- **THEN** no wide compatibility child array materializes, no complete node or paragraph index rebuild runs, and validation work is bounded by the changed subtree and ancestor depth

#### Scenario: Package shell remains identical

- **WHEN** eligible insertion changes only an existing canonical part root
- **THEN** the package-invariant-run counter remains zero for that transaction

### Requirement: First presentation performs bounded display work

Eligible first presentation SHALL reshape and paint only the proved provisional region. It SHALL NOT scan every page, rebuild complete-layout indexes, repaint unrelated materialized pages, or mirror selection through unrelated DOM.

#### Scenario: One paragraph presents provisionally

- **WHEN** the local geometry proof accepts an eligible middle-document insertion
- **THEN** counters name one provisional paragraph interval, bounded DOM mutations, and no complete-page scan before presentation

#### Scenario: Viewport contains neighbouring pages

- **WHEN** overscan materializes pages beside the caret page
- **THEN** their detailed DOM identity remains unchanged during provisional presentation

### Requirement: Complete settle remains differentially correct

Every staged typing scenario SHALL compare the final incremental result with clean full layout and clean full paint at the same canonical revision. Canonical fingerprints, semantic digests, page records, source ranges, selection, drawing and review dependencies, normalized save/reopen output, page-directory order, checkpoint state, and cumulative offsets SHALL agree.

#### Scenario: Provisional insertion settles

- **WHEN** eligible provisional content is replaced by complete authoritative layout
- **THEN** the final semantic layout and display plan equal clean full computation for that committed revision

#### Scenario: Pagination changes during settle

- **WHEN** later input makes local geometry ineligible and complete layout changes page count
- **THEN** no mixed layout publishes and the final result equals clean full computation

#### Scenario: Middle edit converges

- **WHEN** a text-local edit settles after changing a bounded middle interval
- **THEN** counters show no complete page-array copy, checkpoint-tail copy, page-shell offset rewrite, or all-page map

### Requirement: Burst input remains exact

Staged presentation SHALL preserve character order, selection epochs, revision attribution, per-intent history boundaries, and input completeness under rapid input and delayed selection echoes. Presentation and settle work MAY coalesce. Canonical input transactions SHALL NOT coalesce. No optimization MAY drop, duplicate, reorder, or silently refuse accepted input.

#### Scenario: Ordered burst arrives

- **WHEN** trusted input sends a known sequence at 100 Hz while selection echoes are delayed
- **THEN** canonical text, visible text, final caret, history entries, and saved text contain exactly that sequence in order

#### Scenario: Suggesting mode burst arrives

- **WHEN** eligible staged support is later enabled for suggesting mode
- **THEN** one or more valid tracked insertion groups contain every accepted character once and undo restores the prior canonical revision

### Requirement: Geometry barriers remain correct

Browser acceptance SHALL exercise pointer selection, vertical navigation, structural commands, table interaction, story switching, composition, print, screenshot, save, accessibility selection, review actions, undo, redo, external edits, and teardown while provisional display is active. Each operation SHALL queue, settle, refuse, or use canonical state according to the staged-presentation contract.

#### Scenario: Vertical arrow interrupts typing

- **WHEN** ArrowDown arrives before authoritative settle
- **THEN** the editor queues the intent, resolves movement from complete latest-revision geometry, and applies it only while its barrier token remains current

#### Scenario: Save interrupts typing

- **WHEN** save runs during a staged typing burst
- **THEN** buffered input commits first and reopened bytes contain the exact canonical text

#### Scenario: Composition starts

- **WHEN** IME composition begins while provisional display is active
- **THEN** the editor restores complete editable DOM or enters the existing composition-safe path before draft text appears

#### Scenario: Pointer races with keyboard input

- **WHEN** keyboard input changes the model after a pointer barrier settles
- **THEN** the barrier token rejects stale geometry and the pointer is re-hit-tested or cancelled

#### Scenario: Undo occurs before settle

- **WHEN** undo or redo runs during provisional display
- **THEN** stale work is cancelled and visible text, selection, history, and later save reflect only the restored revision

### Requirement: Memory and stale-work bounds

Sustained and burst benchmarks SHALL report retained heap, live sequence nodes, sidecar entries, provisional allocations, cancelled-job buffers, stale discards, and retained revision sidecars. The reference run SHALL reach quiescence with no pending jobs or resource callbacks, force collection, record baseline, execute 1,000 edits beyond history capacity, reach quiescence again, then force and measure three collection cycles. Retained growth SHALL NOT exceed the greater of 32 MiB or 10% of baseline opened-document heap. No cancelled or stale job may publish or mutate an unfingerprinted shared cache.

#### Scenario: Sustained typing exceeds history limit

- **WHEN** a benchmark types beyond the configured history capacity and forces collection
- **THEN** evicted revision metadata is collectible and retained heap stays below the configured large-document bound

#### Scenario: Settle jobs are repeatedly superseded

- **WHEN** rapid input cancels several complete layout jobs
- **THEN** cancelled work releases callbacks, accumulators, temporary sequences, and builders, and only the latest complete revision publishes

#### Scenario: External commit arrives during editing

- **WHEN** automation or another store client commits while editable DOM names an older revision
- **THEN** editing suspends synchronously and resumes only after visible DOM reaches the external model revision

### Requirement: Security and rejection behavior are unchanged

Performance acceptance SHALL run malformed text, duplicate identity, namespace mutation, content-control lock, forms protection, unsafe package edit, and invalid relationship cases through incremental paths. Each case SHALL match complete validation and existing typed rejection behavior.

#### Scenario: Incremental validator receives malicious changed content

- **WHEN** changed content violates a canonical or package invariant
- **THEN** it is rejected before provisional display, publication, history, notification, or save output

#### Scenario: Untouched malicious-looking generic content is preserved

- **WHEN** a previously validated generic subtree remains object-identical beside an eligible text edit
- **THEN** prior proof is reused, the subtree remains unchanged, and normalized save preserves it safely

#### Scenario: Operation replaces an undeclared sibling

- **WHEN** a malformed or faulty mutation cannot prove exact sequence lineage for every rebuilt ancestor
- **THEN** scoped validation refuses it or complete validation detects it before publication

#### Scenario: Cancelled job attempts a cache write

- **WHEN** a cancelled settle callback resumes with stale resource inputs
- **THEN** complete fingerprints prevent the write from poisoning a later revision cache

### Requirement: Performance reports separate throughput from responsiveness

Benchmark reports SHALL distinguish input-handler duration, eligibility-decision time, canonical transaction time, provisional presentation latency, complete settle time, layout work, paint work, selection work, queue delay, long tasks, memory, and deterministic counters. A throughput improvement SHALL NOT be described as responsive typing when first presentation misses its budget.

#### Scenario: Presentation work coalesces

- **WHEN** a burst keeps separate canonical intent transactions but coalesces provisional paint or settle work
- **THEN** the report records transaction count, presentation throughput, and responsiveness separately
