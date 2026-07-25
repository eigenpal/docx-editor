# Intentional React/Vue export divergence

`bun run check:export-parity` enforces that the two published adapters export the same
named symbols. Every entry below is a divergence this change accepts **for a stated
window, with a stated closing task**. An entry without both does not belong here.

> This file also repairs the gate. Its opt-out previously pointed at a single path
> inside `openspec/changes/vue-editor-robust-implementation/`, a change that has since
> been archived — so `existsSync` was false, no divergence could ever be registered,
> and the check still printed "0 documented divergences". An independent architecture
> review flagged that as a dead escape hatch. The script now reads every opt-out path
> that exists, including the archived one.

## Open until 10V.1

M6V.1 ports the retired React chrome, React ONLY, by owner direction; **10V.1**
mechanically ports the finished result to Vue. Between those two tasks React exports
chrome components Vue does not have. 10V.1 MUST delete this section.

These are the LEGACY components themselves, implemented under their retired names. The
entries here used to name `DocxEditorMenuBar`/`DocxEditorMenuBarProps` — hand-written
equivalents that have since been deleted in favour of the implemented originals, per the
port rule that two versions of one control is how they drift.

- `Toolbar` — the retired toolbar band.
- `ToolbarButton` — its button primitive, also used by the comments and agent toggles.
- `ToolbarGroup` — its grouping wrapper.
- `ToolbarProps` — the toolbar's prop type.
- `TitleBar` — the retired title row (compound: logo / name / menus / right slot).
- `Logo` — its left slot.
- `DocumentName` — the editable document-name field.
- `MenuBar` — the menu region (File / Format / Insert / Help).
- `TitleBarRight` — its right slot.

## Vue-side names, open until the same task

PRE-EXISTING and untouched by the React port: Vue's shell/toolbar/sidebar API was
built adapter-first and names things React does not export. Several of these now have
a React counterpart under its LEGACY name (`DocxEditorToolbar` exists in React too,
`PageIndicator` likewise), so the closing task is a rename-and-export pass, not new
components. Listed rather than silently tolerated, because the gate was already red on
these before the port began.

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

## Closing condition

At 10V.1, Vue gains the same components from the same shared
`LEGACY_CHROME_MENUS` / `LEGACY_CHROME_GROUPS` metadata and the same i18n keys, this
section is removed, and `check:export-parity` returns to full equality with no
documented divergences.
