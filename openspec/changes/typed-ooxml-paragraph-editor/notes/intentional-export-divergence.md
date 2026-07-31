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

## Vue-only

- `DocxEditorShellProps`
- `DocxEditorTitleBar`
- `DocxEditorTitleBarProps`
- `DocxEditorToolbar`
- `DocxEditorToolbarProps`
- `PageIndicatorProps`
- `DocxEditorSidebar`
- `DocxEditorSidebarProps`
- `SidebarPanel`
- `DEFERRED_DIALOGS`
- `DeferredDialogId`
- `runSave`
- `runToolbarCommand`
- `toolbarCommand`
- `toolbarCommandState`
- `toolbarCommandStates`
- `ToolbarCommandId`
- `ToolbarCommandState`
