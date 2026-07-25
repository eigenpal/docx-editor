# Independent review — rounds 4 and 5

Continues `independent-review-round3.md`, which ended mid-sentence at "## Round 4"
with reviewers dispatched and no results. A round-5 evidence audit flagged that as a
High record defect: three product commits had landed unrecorded. This file closes it.

## Rounds and ranges

| Round | Frozen HEAD | Lanes | Verdict |
| --- | --- | --- | --- |
| 4 | `checkpoint-fd4db029` | correctness, security | Both: Blocker/High open |
| 5 | `checkpoint-69838887` | correctness, security, architecture, evidence | correctness 6 High; architecture 1 Blocker + 3 High; evidence 2 High record defects |

Fix commits: `checkpoint-a488e555` (round-4 correctness), `checkpoint-69838887` (round-4 security),
`checkpoint-72db8860` (round-5 Blocker + 5 High), `checkpoint-267885cf` (round-5 coverage gap).
`checkpoint-fd410052` landed the M6V.1 toolbar chrome between them.

## Round 4 — findings and fixes

| Severity | Finding | Fix |
| --- | --- | --- |
| High | Affinity normalization covered only 2 call sites, so a plain click in inter-word whitespace still published a non-canonical affinity — caret painted, six geometry keys refused, both adapters | `checkpoint-a488e555` moved normalization into `publishSelectionOverlay`, the single point a selection enters a frame |
| High | The round-3 quadratic fix INTRODUCED a wrap regression: a grapheme cluster straddling a token boundary double-counted an advance. Measured 7 lines vs an ASCII control's 6 on a 300-char paragraph | `checkpoint-a488e555` clamped the advance walk |
| High | `focus()` returned `ok: true` after a committed edit while leaving input unauthorized, dropping every keystroke | `checkpoint-a488e555`, gated on a new `semanticSelectionEverApplied` |
| High | Quadratic layout STILL open (third time): `emitPaintSlices` recomputed `prefixWidth` per style segment. A **4,039-byte** .docx froze `createEditor()` for **45.2 s**, 736,460,001 `advance()` calls, exponent 2.05 | `checkpoint-69838887` accumulates the prefix |

The security finding is the one worth remembering. The guard in place at the time
counted *segmented characters*, which for that shape is exactly **1.0x linear**, while
`metrics.advance` ran **4,003x per character**. The guard read perfectly clean while a
4 KB file froze the tab. A second guard counting `advance()` calls now exists.

## Round 5 — findings and fixes

| Severity | Finding | Fix |
| --- | --- | --- |
| Blocker | The M6V.1 rewrite discarded `useEditorSnapshot`'s ref, so the **Vue toolbar never re-rendered** on engine events and `can()` answers froze at first render. Proven by differential against React | `checkpoint-72db8860` |
| High | `relayout()` and any zoom change **un-painted the caret permanently** in both adapters, because `selectionChange` had four subscribers and ZERO emitters | `checkpoint-72db8860` emits it on publish |
| High | The straddle clamp fixed one direction only; a cluster ending in the following whitespace still double-counted. `ab<U+0600> cd` measured 708 against ground truth 648; 10 lines vs 7 | `checkpoint-72db8860` clamps both bounds |
| High | `focus()` after `load()` returned ok with a painted caret while dropping every keystroke — the round-4 flag moved the hole rather than closing it | `checkpoint-72db8860` focuses through the sync path |
| High | All **24 disabled toolbar controls stole focus**: clicking any moved `activeElement` to BODY, un-painted the caret, and left all six geometry keys refused, 24/24 both adapters | `checkpoint-72db8860` |
| High | The round-4 regression guard was **vacuous** — the paired spec read `res.ok` on a `{outcome, hostEffects}` return, so every key recorded `"refused: "` and the assertion passed either way | `checkpoint-72db8860` |
| High (record) | Round-4 High #1 had **no test guard anywhere**; reverting it left the suite byte-identical | `checkpoint-267885cf` |
| High (record) | The evidence record stopped at round 3 | this file |

Architecture Highs still open, recorded not fixed (per the speed policy, and both
pre-date this range): `--doc-page-gap` and `DEFAULT_PAGE_GAP_PX` are unbound, and a
CSS override was measured moving a hit test by **12 paragraphs**; and
`InteractionHostMetrics` is specified three incompatible ways across contract TSDoc,
the shipped helper, and its unit test, so a conforming third-party host double-counts
scroll.

## The pattern, stated plainly

**Five rounds, and every round found a defect in the previous round's fixes.** The
recurring mechanism is not carelessness in the fixes; it is that each *guard*
instrumented whatever had just been fixed:

- the quadratic DoS was "fixed" four times because each test measured the term that
  had already been closed;
- four separate tests in this change were later shown to measure nothing — the
  input-host gate compared two JS-computed values, the scroll assertion compared two
  unchanged rectangles, the typing scenario never looked at the caret, and the
  dead-keys guard read a field that is always `undefined`;
- the caret/zoom defect stayed invisible because the gate inspected
  `getInputHostObservation()` rather than the painted caret.

Practice adopted as a result: every new guard is verified to FAIL with its fix
reverted before the fix is committed, and cost guards must instrument the quantity
that actually amplifies. That check caught a fifth vacuous test (`checkpoint-267885cf`) before it
was committed.

## Independently reproduced at `checkpoint-69838887`

The round-5 evidence audit re-measured every load-bearing claim in a clean
environment. All four performance claim families reproduced within tolerance, none
wrong by more than 2x:

| Claim | Recorded | Audit measured |
| --- | --- | --- |
| single paragraph 2k / 12k / 30k / 1M words | 6 / 17 / 37 / 1,241 ms | 5 / 12 / 24 / 656 ms |
| k=1k/2k/4k/8k style segments | 6 / 15 / 27 / 50 ms | 12 / 19 / 37 / 63 ms (linear) |
| same, pre-fix | 296 / 1,229 / 5,091 ms | 336 / 1,327 / 5,459 ms (quadratic) |
| 8 MB capsule at 300 / 1,200 / 6,000 chars | +402 / +406 / +402 ms | +397 / +386 / +393 ms (flat) |
| segmentation amplification, pre-fix | 80,036,000 chars, 4,000x | 80,036,000 chars, 4,001.8x |

Also confirmed by the audit: baseline `checkpoint-90e74c0a` is 1716 pass / 6 fail / 2 errors in a
throwaway clone, exactly as recorded; **no failure at HEAD is new** and HEAD's set is
a subset of baseline's; all eleven repo gates and five browser lanes green; and
**never-stage compliance is clean across all 60 commits** — no commit touched
`read.ts`, `preservation-capsule.ts`, or `docs/api/docx-editor-{react,vue}/*`.

Six of eight guards the auditor revert-tested genuinely fail without their fix. The
two that did not are recorded above as findings and are now fixed.

## Corrections to the record made by round 5

- **The true task total at `checkpoint-69838887` is 116**, not 114 or 115. `tasks.md:3` was
  correct; `one-surface-execution-plan.md:251` says `33/114` and is wrong. The 117
  seen mid-audit is a later owner edit.
- `evidence/m4/demo-boundary.md` line 52 went stale at `checkpoint-fd410052`: it lists
  find/replace, hyperlink, insert image/table/symbol and image properties as "Absent",
  but they now render as disabled parity-only controls.
- `full-repo-sweep.md` enumerates 3 named failures against a total of 5; the other two
  are the unhandled-error spec files, and one of them is under
  `packages/engine-editor/e2e/`, not `packages/core/spike/tests/**`.
- Every gate number in this record was measured with **81 lines of uncommitted change
  live in the tree** (`read.ts` +59, `preservation-capsule.ts` +22, both on the DOCX
  read path). They were never staged, but they are active in every measurement, and
  nobody has yet run the gates against the strictly committed tree.

## Hazards confirmed live

- A **leaked detached vite child on port 5299** from `a11y-harness-lifecycle.mjs`
  makes `verify-a11y-harness-vite-exports` fail in a way that looks exactly like a
  code regression. Two reviewers independently guessed environmental without being
  able to confirm; a third proved it. `lsof -ti:5299` is necessary but NOT sufficient —
  it also reports ESTABLISHED connections, so check for a LISTEN socket.
- Symlinking `packages/*/node_modules` into a clone makes workspace packages resolve
  back to the real repo, so a revert experiment silently no-ops and the test "passes"
  either way. Probe resolution before trusting a revert result.

## M6V.1 status

`checkpoint-fd410052` is titled M6V.1 but does **not** satisfy it. Its manifest also requires
`e2e/paired-retired-chrome.visual.spec.ts` and
`evidence/m6/retired-visual-parity.md`, which are M6V.1's stated pass boundary and do
not exist. Per owner direction the task is React-only and requires porting the actual
retired component hierarchy and presentation, not a generic metadata-driven toolbar.
The checkbox is correctly unchecked.

## Gate status

M4-R3 and M6-R2 remain **unchecked**. Round 5 returned a Blocker and Highs; those are
fixed in `checkpoint-72db8860` and `checkpoint-267885cf`, so a round 6 against the new HEAD is required
before either gate can be signed. No evidence file claims either passed.
