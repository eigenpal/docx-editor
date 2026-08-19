## 0. Baseline before code

- [x] 0.1 Record the baseline: `bun install`, then `bun run typecheck`, `bun run lint`,
      `bun run test`, `bun run check:parity`, `bun run api:check`, `bun run i18n:validate`.
      Fresh worktrees are not green — build `@docx-editor.dev/i18n` before typecheck means
      anything, and note every failure that is already there so a new one is visible
- [x] 0.2 Record the export gap as numbers, from `scripts/lib/named-exports.mjs`: React exports,
      Vue exports, React-only, Vue-only. The starting point is 273 / 68 / 216 / 11
- [x] 0.3 Prove the double-engine defect: `bun run build:packages:vue` as the tree stands, and
      show `dist/index.js` carries the engine rather than importing it

## 1. Remove the old package, deprecate the old React chrome

- [x] 1.1 Delete `packages/vue/src` and `packages/vue/test`, then restore
      `packages/vue/src/styles/editor.css` BYTE FOR BYTE — it is already thin and already passes
      `check:adapter-css-thin`, and rewriting it is how an adapter grows a forked style. Re-create
      `packages/vue/src/index.ts` as an empty entry
- [x] 1.2 Tag the pre-v2 React shell chrome `@deprecated`, naming the replacement on each:
      `Toolbar`, `ToolbarButton`, `ToolbarGroup`, `ToolbarProps` → `DocxEditor.Toolbar`;
      `TitleBar`, `MenuBar`, `DocumentName`, `Logo`, `TitleBarRight`, `DocxEditorShell`,
      `PaginatedDocxEditorShell`, `PaginatedDocxEditorShellProps` → the packaged `<DocxEditor>`
      and `DocxEditor.Menu`. `bun run api:extract` so the tag lands in the snapshot. NOT
      deprecated: `HorizontalRuler`, `VerticalRuler`, `DocumentOutline`, `PageIndicator`,
      `PaginatedDocxEditor` — the v2 parts wrap them
- [x] 1.2b Teach `check-export-parity.mjs` and the new composable gate to skip a symbol the
      snapshot marks deprecated. Read the tag; do not maintain a list
- [x] 1.2c In the SAME commit as 1.1: grow the divergence file to cover the remaining React
      surface, and remove the `vue root chrome surface` bucket from
      `check-public-docs-surface.mjs`. This is the only commit where the divergence file gets
      larger; from here it only shrinks, to zero
- [x] 1.3 Record the gap numbers again: Vue-only becomes 0 and never rises above it; React-only
      is the non-deprecated surface, which is the number this change drives to zero
- [x] 1.4 Adopt the mirror rule: a paired export lives at the same relative path in both
      adapters. Write it down in `packages/vue/README.md` and add a check that every Vue source
      file has a React file at the same relative path, modulo the extension
- [x] 1.5 Delete the v1 build leftovers with the source: `packages/vue/tailwind.config.js` (the
      stylesheet is compiled and scoped in core), and check `tsconfig.api.json` still describes
      the tsup output
- [x] 1.5b Assign every non-deprecated React export to a phase of this plan, in a checklist. A
      name with no phase is a gap in the PLAN, not in the implementation, and this is the only
      step that finds it before `check:export-parity` does at the end
- [x] 1.6 Remove the four dead `max-lines` globs in `eslint.config.js` that name three pre-v2 Vue
      files (`components/DocxEditor.vue`, `components/Toolbar.vue`,
      `composables/useDocxEditor.ts`), and add one guard that every file-specific glob matches a
      real file

## 2. The package installs, and the engine is external

Lands before any new surface: everything after it must be written against ONE engine.

- [x] 2.1 `@docx-editor.dev/core` from `dependencies` to `peerDependencies` (required, not
      optional) plus a `workspace:*` `devDependency`
- [x] 2.2 `@docx-editor.dev/i18n` gets a real semver range; drop `private: true`
- [x] 2.3 Replace `vite.config.ts` with `tsup.config.ts`: `platform: 'browser'`,
      `format: ['cjs','esm']`, `dts: true`, `metafile: true`,
      `external: ['vue','@docx-editor.dev/core','@docx-editor.dev/i18n','harfbuzzjs','emf-converter']`
- [x] 2.4 `packages/vue/test/package-dependencies.test.ts`, the twin of React's, asserting all
      three facts (peer present, no regular dependency, dev dependency pins the workspace)
- [x] 2.5 A build assertion that `dist/index.js` imports the engine by bare specifier and inlines
      no copy of it
- [x] 2.6 Add the package to `build:packages`; keep `build:packages:vue` working or fold it in
- [x] 2.7 `bun run check:package-artifacts`, `SKIP_CONSUMER_INSTALL_BUILD=1 bun run
check:consumer-install`, `bun run notices:generate` all pass with Vue in the set
- [x] 2.8 Mirror React's dependency list rather than inventing one: `harfbuzzjs` and
      `emf-converter` stay declared (pinned, external), `fflate` stays a devDependency — it is
      what the tests build DOCX fixtures with, and moving it would externalize it and change the
      published output. Add NO component library: `Slot` is in-tree, and React's one Radix import
      backs a file nothing imports

## 2b. The consistency gate, built BEFORE the composables

Written against an empty Vue package, where it reports twenty-eight missing composables. Each
one turns it greener. Written afterwards it would audit decisions already made, and every
mismatch would be a rewrite rather than a spec.

- [x] 2b.1 `scripts/check-composable-parity.mjs`, over the two committed API Extractor
      snapshots. Generalize `extractInterfaceFields` from `check-parity-contract.mjs`, which
      already parses that file
- [x] 2b.2 Assert MEMBERS: for every `use*` export, every interface one returns, and every other
      interface both snapshots export (`ToolbarButtonProps`, `FontFamilyProps`,
      `NavigationPartProps`, `MenuItemProps`, …), the member name sets match in BOTH directions.
      Exclude `DocxEditorProps` and `DocxEditorRef` — `check:parity-contract` owns those, so
      there is one gate per interface and no overlap
- [x] 2b.3 Assert MEMBER TYPES: exact match after normalization
- [x] 2b.4 Assert SIGNATURES: parameter names, count, optionality, OVERLOAD COUNT
      (`useEditorValueCommand` has two), and the return type name
- [x] 2b.5 Exactly two normalizations: `Ref`/`ShallowRef`/`ComputedRef`/`Readonly` unwrap to the
      inner type; `MaybeRefOrGetter<T>` in a PARAMETER position reduces to `T`. No third, no
      allowlist, no opt-out file — that is what the divergence file became
- [x] 2b.6 Enumerate the return interfaces rather than pattern-matching a suffix: React mixes
      `Result` (nine) and `Return` (two), and `useTranslation` / `useNoteScopeState` return
      anonymous shapes
- [x] 2b.7 Wire into `check:parity` and into `ci.yml` AFTER `api:check` — the gate reads
      committed snapshots, so a stale snapshot would make it measure nothing
- [x] 2b.8 Self-test: a fixture pair proves it fails on a missing member, a renamed member, a
      wrong member type, a dropped parameter and a dropped overload

## 3. The composition layer

Rebuilt from nothing, one file per React file, at the React file's path.

- [x] 3.1 `editor/context.ts`: `InjectionKey<ShallowRef<DocxEditorInstance | null>>`, the review
      rail key under the name `ReviewRailContext`, and `useDocxEditor()` returning the ref
- [x] 3.2 `DocxEditorRoot` + `provideDocxEditor()`: `provide` a `shallowRef` in `setup`, create
      the container-less instance in `onMounted` (NEVER in `setup` — it runs on the server),
      one instance per `document`/`fonts`/`translate`/`imageDecodePort` identity — React's four
      creation-effect dependencies, no more and no fewer — destroy in `onUnmounted`
- [x] 3.2b No engine value is deep-reactive: `shallowRef` everywhere, no `reactive()`, no
      `readonly()` on anything compared by identity. Add a lint or test that fails on any of the
      three applied to an editor, a snapshot or a slice
- [x] 3.3 `ready` after the instance is published AND after any Content in the same commit has
      attached; a large document is behind the engine's open yield, so wait for the mount's own
      `change` before emitting
- [x] 3.4 Zoom in ONE watcher, level then mode, with the by-value `zoomMode` comparison; a fit
      declared alongside a level is re-asserted after `setZoom` leaves fit
- [x] 3.5 `DocxEditorViewport`: the three load-bearing classes, the scope class, the review
      gutter keyed on a REGISTERED rail, `--docx-nav-shift` as a custom property, and the
      capture-phase zoom chord with the input/dialog guard
- [x] 3.6 `DocxEditorContent`: render `docx-paginated-surface`, then attach from a WATCHER on the
      instance ref (`immediate`, `flush: 'post'`) — not from `onMounted`, which runs before the
      Root's and sees `null`. `detach` on `onUnmounted` AND `onDeactivated`, re-attach on
      `onActivated`, and `detach` after `destroy` must be a no-op
- [x] 3.7 `scope-context.ts` twin: `useScopeClassName()` over an injected boolean, so parts inside
      the packaged wrapper do not repeat `.docx-editor`
- [x] 3.8 Tests: the pages actually PAINT on first mount (the ordering trap — this test fails
      against an `onMounted` attach); instance lands; document identity rebuilds and re-attaches;
      zoom does not rebuild; a locale change DOES rebuild, matching React; KeepAlive round trip
      preserves edits and undo; unmount detaches before destroy; server render creates nothing
- [x] 3.9 Test: the injected instance and a selected slice are the engine's own objects, not
      proxies of them

## 4. The reactive read model

- [x] 4.1 One tick source per Root: `shallowRef` bumped by `change`, `selectionChange`, `error`
- [x] 4.2 The deferred notifier, ported with its reasoning: microtask by default, task when
      `navigator.scheduling.isInputPending({ includeContinuous: true })` is true, coalesced
- [x] 4.3 `useEditorState(selector, isEqual?)`: eager `shallowRef` + `watch(tick)` with the
      memoized `(snapshot, slice)` pair and the equality bail-out. NOT `computed` — it cannot
      take a custom equality and is lazy
- [x] 4.4 Lift `LOADING_SNAPSHOT` into `@docx-editor.dev/core/editor` and re-export it from both
      adapters. Vue cannot import a React file, and copying is what let React's copy gain
      `canUndo`/`canRedo` while Vue's `PRE_MOUNT_SNAPSHOT` never did. One constant, one home
- [x] 4.5 Scope disposal through `getCurrentScope()` + `onScopeDispose`, so the `…Instance` forms
      called outside a component clean up too
- [x] 4.6 `@internal` counters: consumers mounted, and facade listeners per Root
- [x] 4.7 Tests: unrelated change does not move the slice; custom equality honoured; forty
      consumers still three listeners; consumer counter returns to zero; a burst collapses to one
      evaluation; formatting read after a commit is the committed formatting (the defer's
      correctness half, which is the one a Vue author would delete)

## 5. The command composables

- [x] 5.1 `useEditorCommand`: slot or raw command, `toolbarCommandState` for one and
      `can`/`isActive` for the other, keyed on the command BY VALUE with sorted keys
- [x] 5.2 `useEditorValueCommand` for the value-typed slots, over `commandForSlotValue`
- [x] 5.3 `useEditorEvent`: latest-handler forwarding, resubscribe only on instance or event name
- [x] 5.4 `useEditorCaret`: `{ paragraphId, offset }` by value, on both `change` and
      `selectionChange`, `null` on the server
- [x] 5.5 Tests: payload switch flips the answer; inline object literal adds no watcher; disabled
      reason is the engine's; `execute` before mount returns false; one listener for ten renders;
      caret moves on typing

## 6. The rest of the composables

Each is a read of the engine plus a call back into it. Group them, but give each its own test.

- [x] 6.1 `useZoom` — both halves of the state, the ladder from `zoom-levels.ts`, the off-rung
      step, `canZoomIn`/`canZoomOut` agreeing with what the step does
- [x] 6.2 `usePageSetup`, `useParagraphIndent` — read from the snapshot, write through the
      command, indent geometry from `ruler-indent.ts`
- [x] 6.3 `useFonts` — one resolver for the scope's life, arguments read at resolve time, no
      epoch stamped here
- [x] 6.4 `useDocxSource` — fetch or bytes, fonts composed through `composeFontConfiguration`,
      document held until fonts SETTLE, abort plus a liveness flag on scope disposal, font
      failure never lands on `error`
- [x] 6.5 `useFontFamily`, `useParagraphStyle` — value / options / setValue / isEnabled over
      `getDocumentFonts` and `getDocumentStyles`
- [x] 6.6 `useDocumentOutline`, `useDocumentSearch` — `getOutline`, `findMatches`, `selectMatch`,
      `SEARCH_DEBOUNCE_MS`, `SEARCH_MATCH_LIMIT`, and an honest "cap reached" report
- [x] 6.7 `useNavigationPane`, `useNavigationShift` — the layout store as a store, the shift from
      `navigationShift`, no reactive style at resize frequency
- [x] 6.8 `useHyperlinkPopup` / `useHyperlinkPopupInstance` — ONE state per editor, published by
      the Root, so a toolbar button and the panel share it and only one registers with the
      engine's gestures
- [x] 6.9 `useContentControl` / `useContentControlInstance`, `CONTENT_CONTROL_SLOTS`
- [x] 6.10 `useHeaderFooterState`, `useNoteScopeState`, `useNotePropertiesState`
- [x] 6.11 `useContextMenuTarget`, `useTableBorderTargetLabel`
- [x] 6.12 Each composable declares a named `Use<Name>Result`/`Return` interface and ANNOTATES
      its return type, or core internals leak into the API snapshot
- [x] 6.13 `useEditorSnapshot` — the event counter both adapters export, deleted with the rest in
      phase 1 and rebuilt here. Vue's takes a GETTER (`() => Editor | null`) where React takes the
      value; that is the established shape and the one normalization the parity gate allows for a
      parameter
- [x] 6.14 `bun run check:composable-parity` is green: every composable matches React member for
      member, type for type, parameter for parameter, overload for overload

## 7. i18n

- [x] 7.1 `LocaleProvider` + `useTranslation` through provide/inject, merged onto the INHERITED
      catalogue, reactive so every mounted chrome LABEL re-resolves. The editor INSTANCE still
      rebuilds, because `createDocxEditor` samples `translate` and it paints drawing refusal
      labels — see 3.2 and design trap 5. Do not "improve" on that; it is the React behaviour
- [x] 7.2 `useChromeTranslate` with the host override map taking precedence
- [x] 7.3 Remove the catalogue construction currently inlined in `DocxEditor.ts`
- [x] 7.4 `bun run i18n:validate` and `bun run i18n:unused` — a Vue chrome that resolves the same
      keys should shrink the unused list, not grow the catalogue

## 8. The merge, and the compounds

- [x] 8.1 Port `mergeArrangement` to vnodes: `docxSlot` static on the component TYPE, Fragment
      flattening, last-override-wins, unmatched-appends, `preset` opt-out
- [x] 8.2 A shared table-driven test asserting the six merge bullets on BOTH adapters
- [x] 8.3 `Slot`: `cloneVNode` + `mergeProps` over one child, null for zero or several
- [x] 8.4 `DocxEditorToolbar` derived from `CHROME_GROUPS`, with the parts as statics, the
      overflow policy from `toolbar-overflow.ts`, and the mousedown guard
- [x] 8.5 `DocxEditorMenu` derived from `CHROME_MENUS`, with `chromeMenuSlots` exported
- [x] 8.6 `DocxEditorContextMenu` reusing the menu bar's rows — one row vocabulary, two panels
- [x] 8.7 `DocxEditorNavigation` and its parts, over the three composables
- [x] 8.8 `DocxEditorHyperLink`, `DocxEditorContentControl`, `DocxEditorPageSetupDialog`,
      `DocxEditorLoading` (+ `.Spinner`), `DocxEditorFontNotice`,
      `DocxEditorHeaderFooterChrome`, `DocxEditorNotesChrome`, `DocxEditorDocumentOutline`,
      `DocxEditorHorizontalRuler`, `DocxEditorVerticalRuler`, `DocxEditorPageNumber`
- [x] 8.9 Tests per compound: default arrangement, one override, `hidden`, append, `preset`
      false, a `v-for` over overrides, and minified identification
- [x] 8.10 The image authoring surface, which parity puts here and which no other phase covers:
      `ImageInsertProvider`, `ImageInsertTrigger`, `ImageWrap`, `ImageAltText`,
      `ImagePropertiesTrigger`, `DocxEditorImagePropertiesDialog`, `normalizeImageBytes` and
      `NormalizedImagePayload`. The engine half is shared — `SelectedImageState`,
      `executeImageCommand`, `setImageWrapType` and the `image.*` slots all live in core — so
      this is the value chrome over `useEditorValueCommand`, not a second wrap vocabulary. See
      14.2 on the overlap with `vue-drawing-authoring-parity`

## 9. The sugar host

- [x] 9.1 `DocxEditor` composing Root + Viewport + Content + chrome, with the statics React
      carries on its namespace
- [x] 9.2 `expose` the seven-member handle unchanged
- [x] 9.3 Props pair by name, with three documented form differences and no fourth: EMITS for
      React callbacks (`change`, `ready`, `fontError`, `save`, `open`, `titleChange`), SLOTS for
      `children` / `renderTitleBarLeft` / `renderTitleBarRight`, and native attribute
      fallthrough for `className`
- [x] 9.3b Every Boolean prop declares `default: undefined` and resolves its default in the body.
      Vue casts an absent Boolean to `false`, and `chrome`/`menu`/`navigation`/`rulers`/
      `contextMenu` all default to TRUE in React. Test: the component with only a `document`
      renders the full packaged chrome
- [x] 9.4 `translate` and `tableInteractionLabel` stay PROPS on both adapters — the engine calls
      them and uses the return value, which an emit has no way to give
- [x] 9.5 Chrome-off renders the surface alone and the parts self-scope

## 9b. The props-driven primitives

Not the deprecated shell chrome — that gets no Vue twin (1.2). These are the props-driven parts
the v2 context-fed components WRAP, so Vue needs them. No composables, no injected editor.

- [x] 9b.1 `HorizontalRuler`, `VerticalRuler`, `RULER_WIDTH` — ticks and page box from
      `ruler-ticks.ts`, never recomputed
- [x] 9b.2 `DocumentOutline`, `PageIndicator`
- [x] 9b.3 `PaginatedDocxEditor`, `PaginatedDocxEditorProps`, and the handle under BOTH names
      React exports it under (`PaginatedDocxEditorHandle` and the `PaginatedDocxEditorExpose`
      alias, which exists so the two adapters pair by name)
- [x] 9b.4 Mirror only the `src/components/ui/**` and `src/lib/**` internals these need; none is
      itself exported, and `src/managers/**` and `src/hooks/**` serve only the deprecated chrome
      and get no Vue twin at all
- [x] 9b.5 Tests: each renders from props alone and reads no injected editor

## 10. Security

- [x] 10.1 Add `v-html` to the sink grep in CLAUDE.md and prove `packages/vue/src` has none
- [x] 10.2 Every `href` and window target through `sanitizeHref`; a `javascript:` target test on
      the hyperlink popover
- [x] 10.3 Escape any string interpolated into an inline `style` built from file data

## 11. The gates flip

- [x] 11.1 Empty the divergence file to ZERO entries, delete it, and drop the opt-out load from
      `check-export-parity.mjs` so the gate has nothing to forgive
- [x] 11.2 Assert the numbers: non-deprecated React exports == Vue exports, React-only 0,
      Vue-only 0
- [x] 11.3 `scripts/parity/parity.contract.json`: empty `deferredInVue` into `paired`, keeping
      exactly three form categories and no fourth — EMITS for React callbacks, SLOTS for
      `children`/`renderTitleBarLeft`/`renderTitleBarRight`, attribute fallthrough for
      `className`
- [x] 11.4 Restore the `Parity contract check` step to `.github/workflows/ci.yml`
- [x] 11.5 `check:public-docs-surface`: add the `vue composition and composables surface` bucket
      mirroring the React one (the pre-v2 `vue root chrome surface` bucket went with the deletion
      at 1.2)
- [x] 11.6 `bun run check:feature-parity` — now that the trees share paths, read the report and
      close or record every difference it names
- [x] 11.7 The mirror check from 1.4 runs in CI beside the other parity gates
- [x] 11.8 A cross-adapter DIFFERENTIAL, one table of (composable, action, assertion) run against
      BOTH adapters from a single source over the same document. Shape parity still permits
      `zoomIn()` stepping differently, `useDocumentSearch` reporting a total where React reports
      the cap, or `usePageSetup().apply` landing as two undo steps in one adapter and one in the
      other. Cover at minimum: every chrome slot's enabled/active/disabledReason; the off-ladder
      zoom step; the search cap; a page-setup write as one undo step
- [x] 11.9 `check:composable-parity` runs in CI after `api:check`, with an empty allowlist

## 12. Docs and demo

- [x] 12.1 `docs/site/content/vue/`: `index`, `composition`, `composables`, `props`, `examples`,
      following the Google developer documentation style guide
- [x] 12.1b `check:public-docs-surface` requires EVERY composable name in both `react/hooks` and
      `vue/composables`, so a new one cannot be documented for one adapter alone
- [x] 12.2 Register every page in BOTH `meta.json` files — the `"root": true` one with full
      paths, and the subfolder's
- [x] 12.3 Update `docs/site/data/word-features.ts` where a claim now covers both adapters
- [x] 12.4 Rebuild `examples/vue` on the composition layer, so the demo is the parity witness the
      React demo is; wire it into `bun run dev` and the parity build
- [x] 12.5 Diagrams as mermaid, never ASCII

## 13. Ship

- [x] 13.1 `bun run typecheck`, `bun run lint`, `bun run test`, `bun run api:check`, then
      `bun run check:parity` (which now carries `check:composable-parity`),
      `bun run i18n:validate`, `bun run format`. Snapshot-reading gates run AFTER `api:check`
- [x] 13.2 `openspec validate vue-composable-adapter-parity --strict`
- [x] 13.3 `bun run api:extract` and commit the Vue snapshot
- [x] 13.4 Changeset: one bump for the fixed group, one sentence, consumer-facing. A deprecation
      is a MINOR — the removal is the major that follows, and it is not this change
- [x] 13.5 Compare the run against the 0.1 baseline and report every gate that was already red

## 14. Extended and follow-up scope

- [x] 14.1 `@docx-editor.dev/pro/vue`. `DocxEditorReview` compound rail, `useReview` composable, selection retention via public `retainSelection` / `releaseSelection`.
- [ ] 14.2 `vue-drawing-authoring-parity` overlaps phase 8: its image authoring surface is a
      React export, so parity puts it here. Fold it in and archive it, or keep it as the
      tracking change for that phase — owner call, not one to make by accident
- [ ] 14.3 REMOVING the deprecated React chrome. That is the next major
- [ ] 14.4 An e2e suite for the Vue demo, mirroring `e2e/editor-smoke.config.ts`
