# Fresh developer review and repair

This follow-up reviews PR #811 in its isolated worktree. Two new high-reasoning
agents began without the implementation history. Each could read public docs,
declarations, and imports, then wrote an executable consumer with semantic
assertions. They did not read implementation or previous reviews before recording
their blind findings. Source inspection began only after those reproductions.
A third agent audited and expanded the dedicated documentation.

The consumers model a contract/template agent and a report-authoring agent.
They use public editor-api imports, author input fixtures, save results, and reopen
the saved documents. They never patch saved output XML to make an assertion pass.
The reviewer then inspected the fixes from the other workflow and ran additional
boundary and preservation probes. Root reviewed runtime, batching, package
resolution, documentation, and the final test failures.

## Findings and repairs

| Finding                                                                               | Severity | Repair and regression evidence                                                                                                                                                            |
| ------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unlocking a parsed control with noncanonical property order erased tag, title, and id | P1       | Preserve its generic property container while normalizing metadata; `model-control-creation.test.ts` covers value writes and save/reopen                                                  |
| Partial hyperlink retargeting changed unselected linked text                          | P1       | Split ordinary wrappers at validated character bounds and preserve metadata; `automation-links.test.ts` covers retarget, unlink, and roundtrip                                            |
| Independent text replacements used stale offsets within one paragraph                 | P1       | Rebase disjoint edits from the batch snapshot and update returned ranges; `model-text-batch-offsets.test.ts` covers order, boundaries, refusal, and both hosts                            |
| Cell body font reads returned null despite authored formatting                        | P2       | Resolve spans against the scoped paragraph list; `model-cell-font-reads.test.ts` covers neighboring and nested cells                                                                      |
| Existing nested-table cells could not resolve their parent table                      | P2       | Resolve the actual ancestor; `model-nested-table-navigation.test.ts` covers navigation and isolated editing                                                                               |
| Cell value and ordinary range replacement erased direct font formatting               | P2       | Insert replacement text with the correct run affinity before deleting shifted original text; `model-table-value-formatting.test.ts` and `model-replacement-fonts.test.ts` cover roundtrip |
| Read-derived comment/bookmark/note proxies captured unresolved handles                | P2       | Resolve handles in queued planning and order note-kind dependencies; `runtime-review-read-dependencies.test.ts` covers the read chains                                                    |
| Natural list formatting and membership batches refused unexpectedly                   | P2       | Claim distinct numbering levels separately from paragraph membership; `model-list-authoring.test.ts` covers combined edits and rollback                                                   |
| Optional item loads failed before the caller could check `isNullObject`               | P2       | Skip scalar loads when their optional lookup resolves null; retain atomic write refusal in `runtime-nullable-loads.test.ts`                                                               |
| Repeated paragraph Start inserts changed their existing order                         | P2       | Preserve abstract Start/End anchoring while rebasing explicit snapshot points; existing `runtime-lifecycle.test.ts` remains unchanged                                                     |
| Full placeholder replacement applied a redundant deletion after consuming its prompt  | P2       | Use the canonical prompt-consuming insertion once and verify resulting positions; partial prompt edits refuse atomically in replacement regressions                                       |
| Source-only CI typechecking depended on unbuilt package declarations                  | P2       | Inherit source aliases before build, then independently typecheck and run consumers against built exports after build                                                                     |
| Conflict messages and API discovery obscured supported workflows                      | DX       | Use scope-neutral errors, improve public JSDoc, add 14 dedicated guides and a complete export/member directory                                                                            |

The original reply-batching probe still verifies atomic refusal and recovery.
Multiple replies or review decisions on the same thread require separate syncs.
This limit is documented, not counted as supported batching.
Ranges retain snapshot offsets across later batches. Re-search after editing a
paragraph, or use the returned replacement range. Tracking does not make ranges live.

The final placeholder boundary pass also found insertion away from the prompt
start could return an invalid range after clearing the prompt. Such insertions
now refuse before commit. The supported prompt-start insertion returns a valid
range. Replacement regressions cover the refusal and recovery.

## Reproduce

```sh
bun run build:packages
bun run --filter '@docx-editor-examples/editor-api-consumers' typecheck:published
bun run --filter '@docx-editor-examples/editor-api-consumers' test:published
bun run test --jobs 4
bun run --filter '@docx-editor.dev/editor-api' compat:report
```

The published consumer command uses Node 24 or newer. Node resolves package
exports without the workspace TypeScript aliases. The command runs in CI after
package builds. Source typechecking remains independent of generated declarations.
Compatibility reporting remains informational and separate from behavior tests.

See `examples/editor-api-consumers/fresh-contract-feedback.md` and
`fresh-tables-feedback.md` for blind findings, assertions, and retest details.
See [documentation coverage](docs-coverage.md) for the public inventory and example
checks. The report consumer's recorded retest score is 9.1/10 on its stated rubric.
That score is scoped to its workflow; it is not a claim about all Office.js behavior.

The original Word inspection in [review.md](review.md) verifies generated document
rendering. This follow-up uses executable API and save/reopen checks; it does not
claim that the new edge cases ran through native Office.js in Word.

## Final verification

- The complete test runner passed **13,004 tests across 1,045 files**, with zero failures.
- The final placeholder boundary regressions also passed independently.
- Both fresh consumers passed under Node against the rebuilt public exports:
  11 contract probes and 20 report stages, including save/reopen assertions.
- All package builds passed. Core and editor-api were rebuilt again after the
  last runtime fixes; API snapshots and published consumer typechecking passed.
- Store, layout, export, and automation passed the DOM-free lane checks.
- The 64-page MDX check, docs JSON generation, and strict OpenSpec validation passed.
- The fixed editing profile remains **81/81 exact signatures**. The broad editing
  inventory remains **88/969 (9.08%)**. These are signature metrics, not runtime scores.
- Typecheck, parity, licenses, API snapshots, formatting, and lint are enforced
  by the repository's commit hook. No check is bypassed for this change.

Final cross-review found no open concrete P2-or-higher issue in the reviewed scope.
The reviewer independently checked six prompt-boundary cases and four authored
tracked-edit cases. The contract retest scored 9/10 on its recorded rubric; reply
batching remains partial. These assessments cover the tested workflows.
