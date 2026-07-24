# M4.1 shell port inventory

Recorded: 2026-07-25. Archaeology reference:
the recorded presentation baseline (190 files under `packages/react/src`).

Each row is a decision about **presentation**, read via `git show`. Nothing is
wholesale checked out: the retired shell is wired to retired authority
(`PagedEditor`, `useLayoutPipeline`, PM access, DOM measurement), and porting a
file means re-expressing its *look and behavior* against public
`Editor`/`EditorHost` contracts.

## Decision key

| Decision | Meaning |
| --- | --- |
| **Port** | Re-express the presentation against greenfield contracts in this milestone. |
| **Port (reduced)** | Port the visual shell, drop the interactive parts that need contracts this change does not own. |
| **Defer** | Real feature, no greenfield contract yet. Hidden or disabled, not faked. |
| **Never** | Retired authority. Forbidden by the architecture rules; not portable at any point. |

## Shell chrome — M4.2 / M4.3

| Retired file | Lines | Decision | Greenfield contract |
| --- | --- | --- | --- |
| `DocxEditor/DocxEditorShell.tsx` | 309 | **Port (reduced)** | Layout frame, backdrop, page shadow, content scoping. Its ruler/outline/agent props are dropped; it becomes a presentational frame around the one-surface viewport. |
| `DocxEditor/PageIndicator.tsx` | 48 | **Port** | `Editor.getCurrentPage()` / `Editor.getTotalPages()`. |
| `TitleBar.tsx` | 451 | **Port (reduced)** | Document title is **shell/example local state** per M4.0 — the engine owns no title contract. File menu, sharing, and account chrome are dropped. |
| `DocumentOutline.tsx` + `OutlineToggleButton.tsx` | — | **Defer** | Needs a heading-query contract. No `Editor.query({type:'headings'})` exists. |

## Rulers — M4.4

| Retired file | Lines | Decision | Greenfield contract |
| --- | --- | --- | --- |
| `ui/HorizontalRuler.tsx` | 621 | **Port (reduced)** | **Display-only** from `Editor.getPageGeometry()`. |
| `ui/VerticalRuler.tsx` | 384 | **Port (reduced)** | Same. |

The retired rulers take eight mutation callbacks — `onLeftMarginChange`,
`onRightMarginChange`, `onIndentLeftChange`, `onIndentRightChange`,
`onFirstLineIndentChange`, `onTabMarkRemove`, `onTopMarginChange`,
`onBottomMarginChange` — plus `SectionProperties` and `TabMark[]`. **This change
owns no section-geometry contract**, so every one of those is dropped and the
markers/drag handles are omitted. A ruler that renders a draggable margin handle
which silently does nothing would be worse than a ruler without one.

## Toolbar — M4.5

| Retired file | Lines | Decision | Greenfield contract |
| --- | --- | --- | --- |
| `DocxEditor/DocxEditorToolbar.tsx` | 241 | **Port (reduced)** | `Editor.can(command)` → `Editor.exec(command)` via `toolbarCommands.ts` (M4.0); save via `Editor.save()`. |
| `Toolbar.tsx`, `EditorToolbar.tsx`, `EditorToolbarContext.tsx` | — | **Never** | Retired PM/plugin authority and context wiring. |
| `DocxEditor/internals/deriveToolbarSelectionFormatting.ts` | — | **Defer** | Needs `Editor.query({type:'selectionFormatting'})`, which returns a neutral default today. Active-state highlighting is therefore **not** implemented; buttons reflect `can()` only. |
| `DocxEditor/EditingModeDropdown.tsx` | — | **Defer** | No editing-mode contract in this change. |

Supported in M4.5: **bold**, **italic**, **undo**, **redo**, **save**.
Disabled with the engine's own reason: **underline** (see M4.0 — `w:u` carries a
style, `RunProps.underline` is a boolean, and the serializer fails closed).

## Dialogs and sidebar — M4.6

| Retired file | Decision | Reason |
| --- | --- | --- |
| `dialogs/FindReplaceDialog.tsx` | **Defer** | No find/replace query contract. |
| `dialogs/HyperlinkDialog.tsx`, `InsertImageDialog`, `InsertTableDialog`, `InsertSymbolDialog`, `ImageProperties*`, `FootnoteProperties*` | **Defer** | Each needs an insert/mutate contract this change does not own. |
| `dialogs/KeyboardShortcutsDialog.tsx` | **Port** | Static presentation, no engine contract needed. |
| `UnifiedSidebar.tsx`, `CommentMarginMarkers.tsx`, `commentFactories.ts` | **Defer** | Annotations are section 9. |
| `LocalizedAgentPanel.tsx`, `AgentPanelToggle.tsx` | **Defer** | Agent bridge is out of scope. |
| `ErrorBoundary.tsx` | **Port** | Presentation only. |

## Forbidden — never implemented

These are the retired **authority** modules the architecture rules name
explicitly, plus the ones that reach around the public facade:

| Retired file | Why it can never be implemented |
| --- | --- |
| `DocxEditor/PagedEditor.tsx` | Retired layout/painter authority. |
| `DocxEditor/OffscreenEditorHost.tsx` | Retired hidden-host authority; superseded by the approved input host. |
| `DocxEditor/hooks/useLayoutPipeline.ts` | Retired layout authority — the engine owns layout. |
| `DocxEditor/hooks/usePagesPointer.ts` | Retired pointer authority — superseded by `attachAdapterEventBridge`. |
| `DocxEditor/internals/ClickPositionResolver.ts`, `PointerEventHandler.ts`, `domSelection.ts`, `pmAnchors.ts`, `forwardNavKeysToPm.ts` | Adapter-side hit testing, DOM selection reading, and PM access. The engine is the only geometry and selection authority. |
| `DocxEditor/internals/measureBlock.ts`, `tableResize.ts`, `scrollUtils.ts` | Adapter-side DOM measurement — geometry authority violation. |
| `DocxEditor/DocxEditorPagedArea.tsx`, `overlays/SelectionOverlay.tsx`, `overlays/DecorationLayer.tsx`, `overlays/ImageSelectionOverlay.tsx` | Retired overlay painting from PM/DOM. Replaced by `overlaysForFrame` (M2.2). |
| `DocxEditor/HiddenHeaderFooterPMs.tsx`, `InlineHeaderFooterEditor.tsx` | Multiple PM views; the one-surface model has exactly one hidden host. |
| `DocxEditor/ContentControlWidgets.tsx`, `DocxEditorContentControlLayer.tsx` | Content-control authority, section 9. |

## Demo boundary (recorded in full at M4.7)

| Surface | Status after M4 |
| --- | --- |
| `?realAdapter=1` | The one-surface editor. Gains the polished shell in M4. |
| `?edit=1` split edit/preview | **Diagnostic only.** Task 6.6 removes it from normal startup after the paired baseline passes; until then it is labelled non-conformance UI. |
| Retired museum Apps | **Reference only.** Never a claim surface, never the default. |
| `/` default | Unchanged in M4. The switch is **M6** (task 6.6). |

## Standing constraint

The M3 interaction flow must keep passing through the shell.
`bun run test:e2e:react-one-surface-interaction` is re-run at **M4-R1** for
exactly that reason: chrome that breaks click-to-caret is a failed port, however
good it looks.
