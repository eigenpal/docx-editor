---
'@eigenpal/docx-js-editor': patch
---

Fix crash when accepting a tracked replacement.

The `paragraphChangeTracker` plugin walked `tr.steps` using each step's raw
`from`/`to`/`pos` against `tr.doc` (the final doc after every step has been
applied). Those coords are valid only in the doc as it was _when that step
ran_, so a later doc-shrinking step could leave the earlier step's coords
past the final doc end and crash `Fragment.nodesBetween` on
`undefined.nodeSize`.

Concretely: `acceptChange` emits `[RemoveMarkStep, ReplaceStep]` when the
range contains both an `insertion` mark and a `deletion` (a tracked
replace). The replace shrinks the doc, the mark step's `to` becomes
invalid in `tr.doc`, and the editor crashes.

Remap each step's coords through `tr.mapping.slice(stepIndex + 1)` before
using them with `tr.doc`, and skip steps whose range was fully consumed by
a later deletion. Adds a regression test reproducing the
accept-tracked-replacement crash shape.
