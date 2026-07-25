# M6P.1 — per-block partial body editability

Safe preserved paragraphs are now editable beside immutable tables, SDTs, unsafe
paragraphs, and unsupported structures. Document-wide read-only is gone.

## The problem, measured

`diagnoseBodyPatchability` reduced the body to one boolean and returned at the FIRST
blocking block. On `e2e/fixtures/comprehensive-word-element-test.docx` — the document the
React demo now loads by default — that meant **0 editable paragraphs out of 237**, to
protect 20 tables and SDTs.

## What the assessment reports

`assessBodyEditability` classifies every top-level block:

| Field | Comprehensive fixture |
| --- | --- |
| `mode` | `partial` |
| `patchableBlockIds` | **167** |
| `regions` | **91** — 20 `non-editable-kind`, 70 `unmodeled-content`, 1 `non-contiguous-blocks` |
| `structuralMutationAllowed` | `false` |

`diagnoseBodyPatchability` is now a projection of `mode === 'full'`, so every existing
caller keeps its previous answer and the two cannot diverge.

## Policy is enforced at three layers, not one

1. **Projection** — a read-only block projects through the atom projector regardless of
   kind. Measured: **167 `paragraph` nodes, 90 `blockEmbed` atoms**. A paragraph stays a
   `paragraph` canonically; only its projection differs, so layout and queries keep their
   semantics.
2. **Reverse mapping** — an atom must match its block by id AND kind, and an atom naming a
   block the policy says is editable is refused rather than silently freezing it.
3. **Pre-commit** — a changed top-level block count is rejected before
   `DocumentStore.apply`, so a split, join, insert, delete, reorder, or multi-block paste
   fails atomically with the store unadvanced. Enforced here rather than only by disabling
   key bindings, because a transaction can also come from a plugin, clipboard handling, a
   test, or a future adapter.

## Two guards had to be reconciled, not just relaxed

**`isBindingEditableKind` was load-bearing in two places** and both assumed "paragraph
kind ⇒ editable". The reverse mapper rejected every edit in a partial document with
`read-only block moved, replaced, or retyped`, because 70 paragraphs are legitimately
atoms now. Diagnosed by surfacing the actual `BindingRejection` message rather than
guessing.

**Preservation-patchable is not the same as reverse-lane projectable.** A run carrying a
stable id, a styleId, underline, or an explicit-off bold/italic cannot round-trip through
the ProseMirror projection, and `commitFromDoc` already refused to overwrite such a
paragraph. Had the policy not narrowed to *patchable AND projectable*, the UI would have
offered an editable caret and silently rejected every keystroke — the exact silent no-op
this feature must not ship. (On this fixture the narrowing removes none: all 167 are
projectable. It is a correctness guarantee, not a count change.)

## Preservation proof

Edit one paragraph, save, reopen:

| Assertion | Result |
| --- | --- |
| Edit commits | `committed: true, opCount: 1` |
| Blocks before/after | **257 / 257** |
| Kind counts before/after | `{paragraph: 237, sdt: 8, table: 12}` — identical |
| Package parts whose bytes changed | **only `/word/document.xml`** |
| Edit present after reopen | yes |

Relationships, media, styles, and every other part are byte-identical. Structural
rejection is atomic: revision unchanged after a dropped-node transaction.

## Browser

`http://localhost:5273/`, bare route, comprehensive fixture:
status **"Editable (paragraphs)"**, **9 pages**, click a paragraph and type →
revision 0 → 5 with a painted caret.

## Not claimed

No table, SDT, image, field, or other unsupported-feature editing. No structural body
mutation in partial mode. No inline editing inside a paragraph that also contains an
unsupported inline child — that whole paragraph is one read-only region, and
ownership-scoped inline capsules remain a separate capability. Nothing here executes or
fetches active or external content.

## Gates

1,084 engine tests (667 binding+core, 417 editor), 11 new. Typecheck clean except the
pre-existing `@docx-editor.dev/nuxt` TS5097.
