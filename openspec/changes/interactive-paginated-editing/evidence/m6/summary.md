# M6 summary (task M6-R2)

Recorded: 2026-07-25. Milestone **M6 — paired bounded-document internal/preview
alpha**.

## Progress ledger

| Snapshot | Count |
| --- | --- |
| After **M5-R2** | **66 / 114** |
| After **6.5** (`checkpoint-3a6a2f6f`) | **67 / 114** |
| After **6.6** (`checkpoint-69f92141`) | **68 / 114** |
| After **M6.1** (`checkpoint-7d870dcc`) | **69 / 114** |
| After **M6-R1** (`checkpoint-2aca56e0`) | **70 / 114** |

## Where this change started and where it is now

At the start of this run the editor painted pages that could not be edited.
Clicking did nothing, because no adapter forwarded pointer events into the
controller, and the tests placed the caret programmatically.

Now, at the **bare root URL of both demos**, with no query parameter:

**Click a painted glyph → the caret lands at that glyph → type → the canonical
document updates → layout repaints → the caret and selection are visible.**

That is the pipeline this change exists to deliver, working in React and Vue,
and proven identical between them.

## What M6 landed

| Task | Deliverable |
| --- | --- |
| 6.5 | Paired spec comparing the two adapters **to each other**, 7 scenarios |
| 6.6 | One-surface editor is the default demo; `?realAdapter=1` no longer required |
| M6.1 | Browser-platform matrix marks the Vue and paired lanes automated |

## The paired gate earned its place immediately

It found a divergence on its first run: Vue painted a caret at mount while React
did not — whichever adapter synced overlays first showed a caret for an editor
nobody had focused. Fixed in the shared helper: a caret is painted only for a
focused frame, because Word does not blink a caret at a document nobody is
editing.

Both adapters pass their own 11-scenario suites, so **neither suite would have
caught this**. That is the exact failure mode a paired-preview claim has to rule
out, and it is why 6.5 compares adapters to each other rather than each to a
fixture.

## Claim allowed after M6

**Internal / preview alpha only — for a bounded document.**

**Not** public `interactive-paginated`. That remains task **8.10**, after
section 7 (async and incremental layout) and section 8 (page virtualization and
the ratified 300–500-page performance budgets). Nothing in M6 exercises a large
document, asynchronous layout, or virtualization.

**And the claim is not yet signable.** M4-R3 and the independent-review half of
M6-R2 both require a reviewer who is not the author. Both remain open.

## Open items

| Item | Status |
| --- | --- |
| **M4-R3** independent review | **Open** — self-review only; a reviewer's starting list is in `../m4/summary.md` |
| **M6-R2** independent review | **Open** — same reason |
| Undo coalescing | Deferred; specs assert a single character rather than pin a policy |
| Per-cluster selection gaps | **Reclassified: required interaction-fidelity defect, not cosmetic.** Owner decision, and the mechanism is now understood — see below. Tracked as **M6V.1**. |
| Underline modelled as a style | `document-engine` lossless-package-model change |
| `@docx-editor.dev/nuxt` TS5097 | Pre-existing, unrelated to this change |
| React/Vue API snapshots | **M4.0's "API snapshot" deliverable is NOT met.** Both files are untracked, so `api:check` cannot detect drift on the two packages this change expands. They are also on an explicit never-stage instruction, so this change cannot close it by committing them; it needs an owner decision about whether the greenfield adapter surface gets a committed baseline. |

### Why the selection gaps are not cosmetic

The earlier note claimed "geometry is correct". That was the wrong conclusion from
a correct observation. The engine's per-run rectangles *are* individually correct,
but the painter emits **one absolutely positioned `div` per run** with no line box,
so there is no inline flow: a selection derived per run leaves a visible hole
wherever whitespace falls on a run boundary, and there is nothing contiguous for
the browser to walk. The retired renderer produced `div.layout-line` containing
inline `span.layout-run` children under `white-space: pre`, which is why selection
covered whitespace continuously there.

So this is a painter-structure defect, not a rectangle-rounding defect, and
coalescing rects on top of a per-run painter would only paper over it. **M6V.1**
covers it: prove copied text retains selected spaces first, then make
engine-derived overlays continuously cover selected whitespace per visual line,
with wrapped-line, run-split, bidi, React, and Vue tests.

## Next

Section 7 (asynchronous and incremental layout), then section 8, then the first
formal public `interactive-paginated` claim at **8.10**.
