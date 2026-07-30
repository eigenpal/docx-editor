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
- `useEditorState` — `useSyncExternalStore` selector hook over the version-cached
  snapshot; Vue twin is a reactivity-based composable, future task.
- `useEditorCommand` — chrome-slot command binding hook; Vue twin is a composable,
  future task.
- `EditorCommandState` — the result type of `useEditorCommand`.
- `useEditorEvent` — typed facade event subscription hook; Vue twin is a composable,
  future task.
- `CHROME_GROUPS` — core chrome registry re-exported for hook-built toolbars; Vue
  re-exports it when its composable layer lands.

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
- `ToolbarTranslate` — the toolbar's optional i18n resolver type.
- `useFontFamily` — the font-picker behavior hook (value / options / setValue /
  isEnabled) over `Editor.getDocumentFonts` + `commandForSlotValue`.
- `UseFontFamilyResult`
- `FontFamilyProps` — the compound FontFamily root's props.
- `FontFamilyPartProps` — shared Trigger/Content sub-part props.
- `FontFamilyItemProps`
- `FontFamilyNamespace` — FontFamily with `.Trigger`/`.Content`/`.Item` statics.

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
