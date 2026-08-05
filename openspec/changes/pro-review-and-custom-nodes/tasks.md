# Tasks: pro-review-and-custom-nodes

## 1. Core seam

- [ ] 1.1 Define `EditorModule` interface in `packages/core/src/contracts/` (reviewModel, commands, displayModes, customNodes contribution points) with null-object defaults
- [ ] 1.2 Add `modules` option to `createDocxEditor`; build the module registry and thread it to exec/chrome dispatch points
- [ ] 1.3 Gate display modes: editor stays in final-state projection unless a module grants additional `RevisionDisplayMode`s; remove/redirect any free-core API that switches modes
- [ ] 1.4 Add `hasReviewContent` derived read to the snapshot (lazy, version-cached, reference-stable)
- [ ] 1.5 Add the `pro` unavailable reason for unwired review slots (`review.comments`, `review.editingMode`) in `toolbarCommandState`; i18n string for the reason
- [ ] 1.6 Tests: no-module editor renders final state for a tracked-changes fixture, round-trips losslessly, `hasReviewContent` true, review slots disabled with `pro` reason

## 2. Pro package scaffolding

- [ ] 2.1 Create `packages/pro` (`@docx-editor.dev/pro`): package.json (`SEE LICENSE IN LICENSE.md`, peer-deps core-contract + optional react entry), tsup/build config matching sibling packages
- [ ] 2.2 Write commercial `LICENSE.md`; add package to the fixed changeset group and workspace tooling (typecheck, test, api:extract targets)
- [ ] 2.3 Accept optional `licenseKey` on pro entry points (stored, unvalidated in v1 — honor system); no warning, no banner, never a network call
- [ ] 2.4 Tests: module without key is fully functional and silent; no licensing network traffic

## 3. Review module lift

- [ ] 3.1 Move `review-model.ts` and `comment-anchors.ts` from `packages/core/src/layout/` to `packages/pro`; keep `ReviewItem`/anchor types in core `contracts/`
- [ ] 3.2 Replace core call sites (`tree-session.ts` `collectReviewItems`, layout barrel exports) with module-registry lookups and null-object defaults
- [ ] 3.3 Move review command implementations from core editor exec into `reviewModule` command contributions (accept/reject/reply/add-comment/toggle-track-changes), all through `TreeDocumentStore.transact`
- [ ] 3.4 Implement `reviewModule(options)` assembling display modes + review model + commands; wire license state
- [ ] 3.5 Move `DocxEditorReview.tsx` + `useReview.ts` from `packages/react` to the pro React entry; wire review slots on mount; unlicensed banner in the pane
- [ ] 3.6 Move review i18n strings to a pro-owned namespace; `bun run i18n:fix`
- [ ] 3.7 Tests: accept/reject/reply round-trip fixtures (semantic digest on untouched content), pane wires slots, published-artifact check that free packages contain no review implementation

## 4. Custom nodes

- [ ] 4.1 Complete inline (run-level) SDT modeling in the canonical tree and `storyBlocks` so inline SDTs are addressable layout content
- [ ] 4.2 Implement `defineCustomNode`: definition shape, tag scheme `<prefix>:<name>?<attrs>` encode/decode, customXml data-part escape hatch for oversized attrs, `sdtLocked` default on serialize
- [ ] 4.3 Implement `fromDocx` recognition pass over inline SDTs by tag prefix (null → literal rendering); surface literal content for label-drift decisions
- [ ] 4.4 Implement `toDocx` ctx builders (hyperlink/text/SDT content) with `sanitizeHref` and XML escaping on every attacker-derived string
- [ ] 4.5 Core render contract: host furniture element (`createElement`, `contenteditable=false`, data attrs) + extent (fixed or text-equivalent) fed to layout/`TextMeasurer`; explicit invalidation API, no observed reflow
- [ ] 4.6 Atomic offset semantics: node occupies its SDT text offsets; caret skip, whole-SDT backspace/delete, copy/paste carries OOXML
- [ ] 4.7 Interaction: hover/click dispatch through the interaction layer to `onHover`/`onClick` handlers
- [ ] 4.8 React portal sugar: mount JSX renders into host elements at measured extent
- [ ] 4.9 Tests: Word-round-trip fixtures `e2e/fixtures/sdt-custom-tag-original.docx` / `sdt-custom-tag-word-roundtrip.docx` (SDT + tag survive; recognition identical on both), oversized-attrs data part, malicious-URL fixture dropped by `sanitizeHref`, pagination with fixed-extent chip, atomic deletion, unrecognized SDT renders literally

## 5. Surface bookkeeping

- [ ] 5.1 Parity contract: add pro bucket for moved review members; `bun run check:parity` + `check:parity-contract` green
- [ ] 5.2 API Extractor: new snapshot dir for pro, re-extract core/react after the lift; `bun run api:check` green
- [ ] 5.3 CSS: pro chrome imports the core stylesheet tokens (`check:adapter-css-thin` green)
- [ ] 5.4 Docs: update `docs/site/data/word-features.ts` + MDX for the free/pro split (both meta.json files for new pages); changeset for the release
- [ ] 5.5 Full gates: `bun run typecheck`, `bun test` vs baseline, `bun run i18n:validate`, `openspec validate pro-review-and-custom-nodes --strict`
