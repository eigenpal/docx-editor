# Tasks: pro-review-and-custom-nodes

## 1. Core seam

- [x] 1.1 Define `EditorModule` interface in `packages/core/src/contracts/` (reviewModel, commands, displayModes, customNodes contribution points) with null-object defaults
- [x] 1.2 Add `modules` option to `createDocxEditor`; build the module registry and thread it to exec/chrome dispatch points
- [x] 1.3 Gate display modes: editor stays in final-state projection unless a module grants additional `RevisionDisplayMode`s; remove/redirect any free-core API that switches modes
- [x] 1.4 Add `hasReviewContent` derived read to the snapshot (lazy, version-cached, reference-stable)
- [x] 1.5 Add the pro unavailable reason for review slots via `can` refusals (chrome disables through existing plumbing). Reason is engine English like every other refusal reason — no i18n key, matching precedent
- [x] 1.6 Tests: no-module editor renders final state for a tracked-changes fixture, round-trips losslessly, `hasReviewContent` true, review slots disabled with `pro` reason

## 2. Pro package scaffolding

- [x] 2.1 Create `packages/pro` (`@docx-editor.dev/pro`): package.json (`LicenseRef-EigenPal-Pro-Evaluation-1.0`, EigenPal author, peer-deps core-contract + optional react), typecheck config. NOTE: `private: true` for now — publishing is deferred branch-wide with the other adapters
- [x] 2.2 Write commercial `LICENSE.md`; add package to the fixed changeset group and workspace tooling (typecheck, test, api:extract targets)
- [x] 2.3 Accept optional `licenseKey` on pro entry points (stored, unvalidated in v1 — honor system); no warning, no banner, never a network call
- [x] 2.4 Tests: module without key is fully functional and silent; no licensing network traffic

## 3. Review module lift

- [x] 3.1 Move `review-model.ts` and `comment-anchors.ts` from `packages/core/src/layout/` to `packages/pro`; keep `ReviewItem`/anchor types in core `contracts/`
- [x] 3.2 Replace core call sites (`tree-session.ts` `collectReviewItems`, layout barrel exports) with module-registry lookups and null-object defaults
- [x] 3.3 Review commands stay as engine glue over store ops (single write path) but are unreachable without a registered module — pro-reason refusals at can/exec; spec updated to match this cut
- [x] 3.4 Implement `reviewModule(options)` assembling display modes + review model + commands; wire license state
- [x] 3.5 Move `DocxEditorReview.tsx` + `useReview.ts` from `packages/react` to the pro React entry; wire review slots on mount (no banner — licensing is silent honor-system per 2.3)
- [x] 3.6 Review strings already live under the `review.*` namespace in the shared en.json pipeline; pro consumes them via the react locale binding — verified `i18n:validate` green, no key moves needed
- [x] 3.7 Tests: accept/reject/reply round-trip fixtures (semantic digest on untouched content), pane wires slots, published-artifact check that free packages contain no review implementation

## 4. Custom nodes

- [x] 4.1 Verified already-landed: inline SDTs are typed `contentControl` nodes with UTF-16 affinity (`contentControlAtOf`), value/remove commands, and painted literal content; no new modeling needed for recognition
- [x] 4.2 `defineCustomNode` definition shape + tag codec (encode refuses the 64-char cap; decode guards prototype pollution). REMAINING: customXml data-part escape hatch + `sdtLocked` default land with the write side (4.4)
- [x] 4.3 `recognizeCustomNodes` tag-prefix pass (tolerant of Word-demoted generic `sdtPr`); `fromDocx` sees attrs + literal text, null vetoes to literal rendering
- [x] 4.4 Write side v1: `insertInlineContentControl` TreeDocOp (paragraph-level split mirroring insertHyperlink; validation incl. the 64-char tag cap; serializer escaping covers the tag) + pro `insertCustomNode(editor, def, attrs, text, {alias, lock, at})` — sdtLocked default, one undo unit, save/reopen recognized. REMAINING: rich-content `toDocx` ctx builders (hyperlink content needs `sanitizeHref`), customXml data-part hatch
- [ ] 4.5 Core render contract: host furniture element (`createElement`, `contenteditable=false`, data attrs) + extent (fixed or text-equivalent) fed to layout/`TextMeasurer`; explicit invalidation API, no observed reflow
- [ ] 4.6 Atomic offset semantics: node occupies its SDT text offsets; caret skip, whole-SDT backspace/delete, copy/paste carries OOXML
- [ ] 4.7 Interaction: hover/click dispatch through the interaction layer to `onHover`/`onClick` handlers. (The vite demo shows a CSS-only chip + hover balloon over the engine's per-control `data-tag` chrome layer — demo-level, not the engine contract)
- [ ] 4.8 React portal sugar: mount JSX renders into host elements at measured extent
- [ ] 4.10 `reviewCard` hook: `kind: 'custom'` review items derived from recognized nodes, anchored at the node's range; card-renderer slot on the pro pane (owner request 2026-08-05)
- [x] 4.9 Tests: Word-round-trip fixtures `e2e/fixtures/sdt-custom-tag-original.docx` / `sdt-custom-tag-word-roundtrip.docx` (recognition identical on both — GREEN), codec overflow + proto-pollution guards, unregistered-prefix literalness, fromDocx veto. REMAINING with 4.4-4.8: sanitizeHref fixture, pagination chip, atomic deletion

## 5. Surface bookkeeping

- [x] 5.1 Parity: pro integration points documented in intentional-export-divergence; `check:export-parity`, `check:parity-contract`, `check:adapter-css-thin` green (`check:public-docs-surface` red pre-existing on this branch)
- [x] 5.2 API Extractor: react/vue snapshots re-extracted, `api:check` green. Pro snapshot dir deferred until pro gets a build (extractor runs over dist)
- [x] 5.3 CSS: pane keeps consuming the core stylesheet classes (no new CSS in pro); `check:adapter-css-thin` green
- [~] 5.4 Changeset added (`pro-package-split.md`, minor). REMAINING: docs-site word-features matrix + MDX for the free/pro split before this ships
- [x] 5.5 Full gates: `bun run typecheck`, `bun test` vs baseline, `bun run i18n:validate`, `openspec validate pro-review-and-custom-nodes --strict`
