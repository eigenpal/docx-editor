# Temporary React/Vue export divergence

These existing adapter exports remain exempt until task 11.3 completes the paired
production surface. Task 11.3 must remove each exemption or move the shared export
to both adapters.

## React-only

- `PaginatedDocxEditorShell` — the paginated surface composed with the editor chrome
  (title bar, menus, formatting rail, ruler). NOT a naming divergence: the Vue chrome
  components exist but nothing composes them over the paginated surface yet, so there is no
  Vue counterpart to pair with. Building it is the remainder of 11.1, and this exemption
  goes when it lands.
- `PaginatedDocxEditorShellProps`
- `Toolbar`
- `ToolbarButton`
- `ToolbarGroup`
- `ToolbarProps`
- `TitleBar`
- `Logo`
- `DocumentName`
- `MenuBar`
- `TitleBarRight`

The provider-first composition layer landed React-first. The Vue twin is the
composable/provide-inject form of the same layer (a `provideDocxEditor` root plus
`useEditorState`-style composables over the shared facade), a future task; these
exemptions go when it lands.

- `DocxEditorNamespace` — the type of the `DocxEditor` export once the composition
  primitives are attached as statics (`DocxEditor.Root` / `.Viewport` / `.Content`);
  Vue's `DocxEditor` is a component default export with no static-composition form.
- `DocxEditorRoot` — provider-first root owning the facade lifetime; Vue twin is the
  provide/inject composable form, future task.
- `DocxEditorRootProps`
- `DocxEditorViewport` — the scroll-container primitive; Vue twin pending with the
  composable layer.
- `DocxEditorViewportProps`
- `DocxEditorContent` — the engine mount-point primitive; Vue twin pending with the
  composable layer.
- `DocxEditorContentProps`
- `useDocxEditor` — React context read of the provided instance; Vue twin is an
  `inject`-based composable, future task.
- `DocxEditorHorizontalRuler` — context-fed horizontal ruler part
  (`DocxEditor.HorizontalRuler`) over the props-driven `HorizontalRuler`; Vue twin
  lands with the composable layer.
- `DocxEditorVerticalRuler` — context-fed vertical ruler part.
- `DocxEditorRulerProps` — the ruler parts' props.
- `DocxEditorDocumentOutline` — context-fed heading-outline part
  (`DocxEditor.DocumentOutline`) over `Editor.getOutline()`; Vue twin lands with the
  composable layer.
- `DocxEditorDocumentOutlineProps` — the outline part's props.
- `useEditorCaret` — the caret as `{ paragraphId, offset }`, the shape the write APIs take
  as their `at`. `snapshot.selection` cannot answer it (`DocRange` addresses paragraphs by
  id and carries no offsets), so hosts were reaching into the instance-only `surface`
  escape hatch to insert at a place. Reference-stable, so it can be captured in a handler
  and used as a dependency. Vue's twin lands with the composable layer.
- `EditorCaret` — that hook's return shape.
- `useEditorState` — `useSyncExternalStore` selector hook over the version-cached
  snapshot; Vue twin is a reactivity-based composable, future task.
- `useReviewAuthors` — the resolved author roster, live: everyone who owns a tracked change
  or a comment. The engine half (`getReviewAuthors`/`setRevisionStyles` on the instance) is
  shared, so a Vue host reaches the capability through the facade today; the Vue twin is a
  composable, with the rest of that layer.
- `DocxEditorColorByChangeType` — declarative opt-out from by-author revision colouring
  (render-nothing component over the shared `setRevisionStyles`). Vue reaches the
  capability through its `revisionStyles` prop and the facade; a declarative twin lands
  with the composable layer.
- `DocxEditorAuthorStyle` — declarative per-author revision styling; same story.
- `DocxEditorAuthorStyleProps` — that component's props.
- `useEditorCommand` — chrome-slot command binding hook; Vue twin is a composable,
  future task.
- `EditorCommandState` — the result type of `useEditorCommand`.
- `useEditorEvent` — typed facade event subscription hook; Vue twin is a composable,
  future task.
- `usePageSetup` — page-setup read/write hook over `snapshot().pageSetup` and the
  `setPageSetup` command; Vue twin is a composable, lands with the composable layer.
- `PageSetupUpdate` — the fields `usePageSetup().apply` accepts.
- `UsePageSetupReturn` — the hook's return type.
- `useParagraphIndent` — paragraph-indent read/write hook over
  `snapshot().formatting.indent` and the `setIndent` command; the indent twin of
  `usePageSetup`, and what the horizontal ruler's four handles are built from. Vue twin
  is a composable, lands with the composable layer. The read derivation and the ruler
  drag geometry both live in core (`ruler-indent.ts`), so the Vue twin is wiring rather
  than reimplementation.
- `IndentUpdate` — the fields `useParagraphIndent().apply` accepts.
- `UseParagraphIndentReturn` — the hook's return type.
- `DocxEditorPageSetupDialog` — context-fed Page Setup dialog part
  (`DocxEditor.PageSetupDialog`) over `usePageSetup`; Vue twin lands with the
  composable layer.
- `DocxEditorPageSetupDialogProps` — the dialog part's props.
- `CHROME_GROUPS` — core chrome registry re-exported for hook-built toolbars; Vue
  re-exports it when its composable layer lands.
- `DocxEditorLoading` — the conditional loading surface (`DocxEditor.Loading`) over
  `snapshot.isLoading`, with a `when` prop for the host's own pre-mount async. It is a
  consumer of the composition layer, so the Vue twin lands with the composable layer
  alongside the other context-fed parts above. The styles and the `loading.label` string
  already live in core, so the Vue part is markup only.
- `DocxEditorLoadingProps` — the part's props (`when`, `className`, `style`, `children`).
- `DocxEditorLoadingSpinner` — the packaged indicator on its own
  (`DocxEditor.Loading.Spinner`), so custom children can compose it back rather than
  hand-copying its class name.
- `DocxEditorLoadingSpinnerProps`
- `DocxEditorLoadingComponent` — the part plus its `.Spinner` static.
- `DocxEditorFontNotice` — context-fed warning for unavailable document fonts; Vue
  exposes the substitution state through the shared snapshot but has no packaged notice yet.
- `DocxEditorFontNoticeProps`
- `DocxEditorHeaderFooterChrome` — React-only scoped HF chrome (region label, options,
  field inserts) over `useHeaderFooterState`; Vue twin deferred with notes/HF editing.
- `DocxEditorHeaderFooterChromeProps`
- `useHeaderFooterState` — selector hook for open HF scope state; Vue twin deferred.
- `HeaderFooterState` — non-null header/footer snapshot type returned by
  `useHeaderFooterState`.
- `DocxEditorNotesChrome` — React-only note chrome (banner, hover preview, context menu,
  properties dialog); Vue twin deferred — notes editing is React-only this change.
- `DocxEditorNotesChromeProps`
- `useNoteScopeState` — selector hook for the open note scope; Vue twin deferred with
  `DocxEditorNotesChrome`.
- `useNotePropertiesState` — selector hook over `Editor.getNotePropertiesState()`; Vue
  twin deferred.
- `NotePropertiesState` — non-null note-properties snapshot type returned by
  `useNotePropertiesState`.

These HF/notes exports are intentional React-first surface. Pairing them into Vue
composables/parts is a tracked follow-up before any adapter-support claim; do not treat
preservation of disabled Vue slots as parity.

The typed-content-controls lane likewise lands its authoring surface in React first.
Core owns the typed model, layout, store enforcement, value operations, widgets, and
chrome slots; Vue can consume those engine capabilities but does not yet expose the
provider/composable inspector surface.

- `useContentControl`
- `useContentControlInstance`
- `CONTENT_CONTROL_SLOTS`
- `ContentControlLock`
- `ContentControlInspectorState`
- `ContentControlSlotId`
- `UseContentControlResult`
- `DocxEditorContentControl`
- `DocxEditorContentControlNamespace`
- `ContentControlActionProps`
- `ContentControlPartProps`
- `ContentControlProps`

The compound toolbar (default set with in-place slot overrides, generic Button part,
FontFamily compound + hook) landed React-first on the composition layer above. Vue's
`DocxEditorToolbar` (the registry-driven toolbar) is the twin surface — `DocxEditorToolbar`
and `DocxEditorToolbarProps` are therefore exported by BOTH adapters and no longer appear
below, but the Vue component is not compound yet; aligning it is a future task, and these
part/prop exports go with it.

- `DocxEditorToolbarNamespace` — the React namespace type (statics `.Button`,
  `.Separator`, the named parts, `.FontFamily`).
- `ToolbarButtonProps` — the generic slot-driven Button part's props.
- `ToolbarPartComponent` — a named part (Bold, Undo, ...): component plus its static
  `docxSlot` marker.
- `ToolbarPartProps` — props of the named parts (slot pinned).
- `ToolbarSlotPartComponent` — a non-button part (picker, stepper, colour split, save)
  pinned to one slot; carries the same `docxSlot` marker.
- `ToolbarSlotPartProps` — props of the non-button parts (`className`, `hidden`).
- `ToolbarSeparatorProps`
- `ToolbarAlignmentComponent` — the merged alignment dropdown part (the four
  `alignment.*` slots behind one merged dropdown trigger); carries `docxSlot:
'alignment'`, the group-keyed marker.
- `ToolbarTranslate` — the toolbar's optional i18n resolver type.
- `useFontFamily` — the font-picker behavior hook (value / options / setValue /
  isEnabled) over `Editor.getDocumentFonts` + `commandForSlotValue`.
- `UseFontFamilyResult`
- `FontFamilyProps` — the compound FontFamily root's props.
- `FontFamilyPartProps` — shared Trigger/Content sub-part props.
- `FontFamilyItemProps`
- `FontFamilyNamespace` — FontFamily with `.Trigger`/`.Content`/`.Item` statics.
- `useParagraphStyle` — the style-picker behavior hook (value / options / setValue /
  isEnabled) over `Editor.getDocumentStyles` + `commandForSlotValue('styles.style')`.
- `UseParagraphStyleResult`
- `ParagraphStyleOption` — one pickable paragraph style (`styleId`, display name, and the
  bounded `preview` a row renders itself in).
- `ParagraphStyleProps` — the compound ParagraphStyle root's props.
- `ParagraphStylePartProps` — shared Trigger/Content sub-part props.
- `ParagraphStyleItemProps`
- `ParagraphStyleNamespace` — ParagraphStyle with `.Trigger`/`.Content`/`.Item` statics.

The hyperlink popover rides the same provider/hooks layer: it is a context-backed hook
plus a compound over it, so its Vue twin is the composable form and lands with the rest of
that layer. The ENGINE half is already adapter-neutral — typed links, the sanitized
projection, click classification, bookmark jumps, the ops and `hyperlinkAt` all live in
core, and Vue's `text.link` control enables from the same `toolbarCommandState` React's
does. Only the panel is React-only.

- `DocxEditorHyperLink` — the link popover compound (`Url`/`Copy`/`Edit`/`Unlink`/
  `Fields`/`Apply`/`Cancel` statics).
- `DocxEditorHyperLinkNamespace`
- `HyperLinkProps`
- `HyperLinkPartProps`
- `HyperLinkActionProps`
- `useHyperlinkPopup` — the popover's behavior hook (state / open / close / copy /
  beginEdit / commitEdit / unlink / openTarget), context-backed so a toolbar button and
  the panel share one state.
- `useHyperlinkPopupInstance` — the un-provided form, for a host publishing its own context.
- `UseHyperlinkPopupResult`
- `HyperlinkPopupState`
- `HyperlinkPopupMode`
- `HyperlinkPopupAnchor`

### Pro integration points (React only, for now)

The review PANE moved to `@docx-editor.dev/pro/react` (pro-review-and-custom-nodes); what
this package now exports are the seams the pro pane composes with. Vue has no review
chrome and therefore no pro pane to feed — its twins land with the Vue review lane.

One thing still blocks a faithful Vue twin beyond the component work: the compose box pins
the selection with `editor.surface.retainSelection()`, and `surface` is the escape hatch,
not the contract. Publishing retain/release on `Editor` is the prerequisite.

- `ReviewRailContext`
- `ReviewRailRegistry`
- `Slot`
- `SlotProps`
- `LocaleProvider`
- `useTranslation`
- `useChromeTranslate` — the catalogue-backed resolver a composing host passes as any
  part's `t` (override-Map-first); rides the same locale binding, so its Vue twin lands
  with `LocaleProvider`/`useTranslation`.
- `ChromeTranslate`

The font-fallback notice is React chrome with no Vue twin yet, same lane as the
rest of the notice/banner chrome:

- `DocxEditorFontNotice`
- `DocxEditorFontNoticeProps`
  The navigation pane rides the same provider/hooks layer: a compound plus three behavior
  hooks over the context-published editor, so its Vue twin is the composable form and lands
  with the rest of that layer. The ENGINE half is already adapter-neutral — the search
  derivation, the session memo, `findMatches`/`selectMatch` and the outline all live in core,
  and Vue reaches them through the same facade. Only the panel and the displacement rule are
  React-only.

- `DocxEditorNavigation` — the pane compound (`DocxEditor.Navigation`) with Headings and
  Find tabs.
- `DocxEditorNavigationNamespace` — the compound plus its `.Header` / `.Close` / `.Title` /
  `.Tabs` / `.Tab` / `.Headings` / `.Find` / `.Toggle` statics.
- `DocxEditorNavigationProps`
- `NavigationHeader` — the pane's title row part.
- `NavigationClose`
- `NavigationTitle`
- `NavigationTabs`
- `NavigationTab`
- `NavigationTabProps`
- `NavigationHeadings` — the heading list part, over `useDocumentOutline`.
- `NavigationFind` — the find panel part, over `useDocumentSearch`.
- `NavigationToggle` — the collapsed disc.
- `NavigationPartProps` — the parts' shared props.
- `NavigationTabValue` — the tab union (`'headings' | 'find'`).
- `useNavigationPane` — open state, active tab, and the displacement an open pane is
  entitled to; Vue twin is a composable, future task.
- `UseNavigationPaneOptions`
- `UseNavigationPaneResult`
- `useNavigationShift` — the px the chrome is currently displaced by, for a host placing
  its own chrome alongside the pane.
- `useDocumentOutline` — headings, nesting depth, and the jump, over `Editor.getOutline`.
- `UseDocumentOutlineResult`
- `OutlineHeading` — one heading of the engine's outline.
- `OutlineHeadingItem` — a heading plus its rendering depth.
- `useDocumentSearch` — the find panel's behavior over `Editor.findMatches` /
  `selectMatch`.
- `UseDocumentSearchResult`
- `SEARCH_DEBOUNCE_MS` — the quiet period before a typed query is run.
- `SEARCH_MATCH_LIMIT` — the engine's cap, so a caller can report "2000+" honestly.
- `navigationShift` — the displacement rule as a pure function (viewport width, page width,
  reservation → padding), exported so a host can reuse or test it rather than
  reverse-engineering the centring behaviour.
- `NavigationShiftInput`
- `navigationPaneReservation` — the left space an open pane needs.
- `NAVIGATION_PANE_WIDTH`
- `NAVIGATION_PANE_INSET`
- `NAVIGATION_PANE_GAP`

- `DocxEditorMenu` — the compound menu bar (`DocxEditor.Menu`): File · Format · Insert ·
  Help, derived from `CHROME_MENUS` so a row and its toolbar twin share one label, icon,
  command and enabled state. It is a consumer of the composition layer above (context,
  `useEditorCommand`, the Page Setup part), so the Vue twin lands with the composable
  layer. The registry, the command rows and the styles already live in core, so the Vue
  part is markup only.
- `DocxEditorMenuNamespace` — the bar plus its parts as statics.
- `DocxEditorMenuProps`
- `MenuProps` — one menu of the bar (`DocxEditor.Menu.Menu`).
- `MenuItemProps` — one chrome slot as a row.
- `MenuRowProps` — a presentational row, for a host action that is not a slot.
- `MenuActionProps` — the pinned Open/Save/Page-setup rows' props.
- `MenuId` — a menu's identity: one of the registry's four, or a host's own. The
  `(string & {})` arm is what lets a product add a menu the library knows nothing about.
- `ToolbarActionProps` — a host-owned toolbar action with no chrome slot, the twin of
  `Menu.Row`. Deliberately NOT a shared concept: it carries no engine wiring, so there is
  nothing for core to own. The Vue twin is markup, and lands with the composable layer.
- `MenuReportIssueProps` — Help's one packaged row, named so a host can drop it or point
  it at its own support channel rather than this project's tracker.
- `MenuSeparatorProps`
- `MenuGroupProps` — a named section of rows: a visible heading plus a real `role="group"`
  taking it as the accessible name. A separator says "these are apart"; a group says what
  they are, which is what a panel needs once a product adds rows beside the packaged ones.
- `MenuSubmenuProps`
- `MenuTableGridProps` — Word's 6×6 insert-table size picker.
- `MenuPartComponent` — a menu pinned to one registry id.
- `CHROME_MENUS` — the core menu registry, re-exported for hook-built menu bars beside
  `CHROME_GROUPS` above; Vue re-exports it when its composable layer lands.
- `chromeMenuSlots` — every slot the menu bar places, for a parity assertion or a host
  enumerating reachable capabilities.
- `ChromeMenu`
- `ChromeMenuId`
- `ChromeMenuEntry`
- `ChromeMenuItemEntry`
- `ChromeMenuSubmenuEntry`
- `ChromeMenuSeparatorEntry`

### The right-click menu

The packaged context menu, part of the same React-first provider/hooks layer as the menu
bar and the navigation pane. The ENGINE half is already shared and is not deferred:
`selectAll`, `copy`, `cut` and `paste` are core `EditorCommand`s, every row's enabled state
comes from the same `Editor.can` both adapters call, and the surface's pointer controller
already ignores non-primary buttons so that a right-click reaches a menu with the selection
intact. What defers is the panel.

Its rows ARE the menu bar's rows — `MenuRow`, `MenuItem`, `MenuSubmenu`, `MenuSeparator`
reused rather than reimplemented — so the Vue twin costs a panel and a placement rule, not a
second row vocabulary.

- `DocxEditorContextMenu` — the compound. Also reachable as `DocxEditor.ContextMenu`.
- `DocxEditorContextMenuNamespace`
- `DocxEditorContextMenuProps`
  The five packaged rows below are each bound to a fixed `EditorCommand` rather than to a
  `ChromeSlotId`, because none of the five is a toolbar or menu-bar control and adding
  registry entries for them would put five dead controls in the default arrangement.

- `ContextMenuCut`
- `ContextMenuCopy`
- `ContextMenuPaste`
- `ContextMenuDelete`
- `ContextMenuSelectAll`
- `ContextMenuItem` — a host-owned row with no slot and no command, the right-click twin of
  `ToolbarAction` and `Menu.Row`. Deliberately NOT a shared concept, for the same reason
  `ToolbarActionProps` is not: it carries no engine wiring, so there is nothing for core to
  own.
- `ContextMenuCommandProps`
- `ContextMenuItemProps`
- `ContextMenuAnchor` — where the panel opened, in client coordinates.
- `useContextMenuTarget` — the element the opening right-click landed on, captured at open
  time like the TOC context. What lets a capability package (pro custom nodes) render a
  contextual section only when the press landed on its own painted chrome, without a second
  `contextmenu` listener. Follows the panel to Vue when the panel does.
  Two documented conventions ride with it: a child component carrying the static
  `docxRowPlacement: 'start'` renders ABOVE the packaged rows (the shape a "you
  right-clicked one of MINE" section wants; note the static lives on the component TYPE, so
  wrapping such a component in another loses the placement); and a keyboard-invoked menu
  (Shift+F10) carries no pointer target, so target-keyed sections cannot appear for it —
  a caret-based fallback is a tracked follow-up.

### Table contextual chrome (React only, for now)

Task 10 landed five contextual toolbar parts and seven fixed table context-menu rows on the React composition layer. Core owns the commands, furniture geometry, enabled state, and refusal text; Vue reaches the same `Editor` commands headlessly but does not ship the value/target UI yet. Pairing is explicitly deferred per user decision on Task 12 — do not treat disabled Vue slots as parity.

- `DocxEditorToolbarNamespace.TableBorderTarget` (and `.TableBorderColor`, `.TableBorderStyle`, `.TableBorderWidth`, `.TableCellFill`)
- `TableBorderTargetNamespace`
- `TableBorderColorNamespace`
- `TableBorderStyleNamespace`
- `TableBorderWidthNamespace`
- `TableCellFillNamespace`
- `TableChromePartProps`
- `TableChromePartComponent`
- `TableChromeItemProps`
- `useTableBorderTargetLabel`
- `ContextMenuTableRowProps`
- `ContextMenuInsertRowAbove`
- `ContextMenuInsertRowBelow`
- `ContextMenuInsertColumnLeft`
- `ContextMenuInsertColumnRight`
- `ContextMenuDeleteTableRow`
- `ContextMenuDeleteTableColumn`
- `ContextMenuDeleteTable`
- `ContextMenuCellVerticalAlignment`

The font-substitution notice is React-first chrome over the shared engine font
availability state; Vue does not yet expose an equivalent part.

- `DocxEditorFontNotice`
- `DocxEditorFontNoticeProps`

### Opening a document

`useDocxSource` is a React hook, and its Vue twin is a composable — the same capability in
the other framework's idiom, landing with the rest of the provider/hooks layer. Nothing about
it is engine-side: it fetches bytes, resolves whatever font loader the host passed, composes
the fragment through the SHARED `composeFontConfiguration`, and cancels both on unmount.

- `useDocxSource`
- `DocxSource` — a URL or bytes.
- `DocxFontsSource` — a font value, promise, or loader thunk. The thunk form is why
  `@docx-editor.dev/fonts` is not a dependency of this package: font BYTES stay out of the
  bundle of a consumer who brings their own faces.
- `DocxFontsInput`
- `UseDocxSourceOptions`
- `UseDocxSourceResult`

### Image authoring (React only)

DrawingML picture authoring landed React-first on the composition layer. The ENGINE half
is adapter-neutral — `SelectedImageState`, `executeImageCommand`, `setImageWrapType`, wrap
value state, and the contextual `image.*` chrome slots all live in core and Vue's toolbar
already reads `toolbarCommandState` for those slots (disabled until value chrome lands).
Only the insert picker, wrap menu, alt-text panel, properties dialog, selection overlay,
and their hooks/parts defer to `vue-drawing-authoring-parity`.

- `useEditorValueCommand` — value-typed chrome hook for `image.wrap` and `image.altText`.
- `EditorValueCommandState` — the hook's return type.
- `ImageWrapTarget` — re-export of the nine wrap choices from core chrome state.
- `DocxEditorImagePropertiesDialog` — properties dialog part (`DocxEditor.ImagePropertiesDialog`).
- `DocxEditorImagePropertiesDialogProps`
- `ImageInsertProvider` — shared hidden file input + paste/drop dispatch for insert-image.
- `ImageInsertTrigger` — toolbar/menu insert control.
- `ImageWrap` — nine-choice wrap dropdown (`DocxEditorToolbar.ImageWrap`).
- `ImageAltText` — alt-text editor panel (`DocxEditorToolbar.ImageAltText`).
- `ImagePropertiesTrigger` — opens the properties dialog from the toolbar.
- `normalizeImageBytes` — client-side PNG/JPEG/GIF preflight before `executeImageCommand`.
- `NormalizedImagePayload` — preflight result type for insert/replace.
- `useFonts` — stable-identity `fonts` prop out of any number of font origins. A hook, so
  it belongs to the React provider layer; Vue has no twin of that layer yet. The engine
  side it wraps (`FontResolver`, `FontResolutionRequest`, `MAX_RESOLVER_FAMILIES`) IS
  exported from both adapters, so a Vue host can pass a resolver — it just memoizes the
  identity itself.
- `FontsInput` — the hook's accepted-origin type.
- `useZoom` — the zoom lifecycle as one hook (resolved scale, mode, fit/step/reset). A hook,
  so it belongs to the React provider layer that Vue has no twin of. The engine side it wraps
  is not a divergence at all: `Editor.getZoom`/`setZoom`/`getZoomMode`/`setZoomMode`,
  `ZoomMode` and `snapshot().zoomMode` are contract members both adapters reach, and the fit
  itself runs in the engine — a Vue host gets fit-to-viewport zoom with no adapter code.
- `UseZoomResult` — the hook's return type.

## Vue-only

- `DocxEditorShellProps`
- `DocxEditorTitleBar`
- `DocxEditorTitleBarProps`
- `PageIndicatorProps`
- `DocxEditorSidebar`
- `DocxEditorSidebarProps`
- `SidebarPanel`
- `DEFERRED_DIALOGS`
- `DeferredDialogId`
- `runSave`
- `toolbarCommandStates`

(`commandForSlot`, `runToolbarCommand`, `toolbarCommandState`, `ChromeSlotId`, and
`ToolbarCommandState` are no longer divergences: React now re-exports them alongside
Vue for the hooks layer.)
