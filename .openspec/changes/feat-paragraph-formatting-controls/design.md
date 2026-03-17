# Design: Paragraph Formatting Controls

## Problem Statement

Two key paragraph formatting features lack UI despite full engine support:

1. **Paragraph spacing (before/after)** — Parsed, stored, rendered, commands exist (`setSpaceBefore`/`setSpaceAfter`), but no way to change it from the UI. Google Docs puts this in the line spacing dropdown.

2. **General paragraph indent** — The indent/outdent toolbar buttons only change list nesting level. Non-list paragraphs cannot be indented from the toolbar. Commands exist (`increaseIndent`/`decreaseIndent`/`setIndentLeft`/etc.).

## Current State

### Paragraph Spacing

- **Parsed**: `w:spacing/@w:before` and `@w:after` → `spaceBefore`/`spaceAfter` (twips)
- **PM Attrs**: On paragraph node
- **Commands**: `ParagraphExtension.setSpaceBefore(twips)`, `setSpaceAfter(twips)`
- **Rendering**: `formatToStyle.ts` → `marginTop`/`marginBottom`
- **SelectionTracker**: Does NOT track `spaceBefore`/`spaceAfter`
- **LineSpacingPicker**: Has a "Paragraph spacing" section header but no controls

### Indentation

- **Parsed**: `w:ind/@w:left`, `@w:right`, `@w:firstLine`, `@w:hanging`
- **PM Attrs**: `indentLeft`, `indentRight`, `indentFirstLine`, `hangingIndent`
- **Commands**: `increaseIndent(amount?)`, `decreaseIndent(amount?)`, `setIndentLeft(twips)`, etc.
- **SelectionTracker**: Already tracks `indentLeft`, `indentRight`, `indentFirstLine`, `hangingIndent`
- **Toolbar**: Indent/outdent buttons only call `increaseListLevel`/`decreaseListLevel`
- **Ruler**: `HorizontalRuler.tsx` exists with draggable indent handles

## Proposed Solution

### Part A: Paragraph spacing in LineSpacingPicker

Extend `LineSpacingPicker` to include before/after spacing toggles below line spacing presets. Follows Google Docs pattern:

```
┌──────────────────────────────────┐
│  Single                        ✓ │
│  1.15                            │
│  1.5                             │
│  Double                          │
│ ──────────────────────────────── │
│  Add space before paragraph      │   ← toggles to "Remove" when > 0
│  Remove space after paragraph    │   ← toggles to "Add" when = 0
└──────────────────────────────────┘
```

"Add" sets default 8pt (160 twips). "Remove" sets to 0.

### Part B: Indent/outdent for non-list paragraphs

When cursor is NOT in a list, the indent/outdent buttons should use `increaseIndent`/`decreaseIndent` (720 twips = 0.5in steps) instead of list-level changes.

### Why this approach

- **Paragraph spacing**: Reuses existing dropdown — no new UI components, familiar location
- **Indent fix**: Minimal logic change — just branching on `inList` in the click handler
- **Both use existing commands**: Zero schema or extension work

## Architecture Impact

- **Low risk**: No schema changes, no serializer changes
- **SelectionTracker**: Add `spaceBefore`/`spaceAfter` extraction (indent already tracked)
- **Files**: selectionTracker.ts, LineSpacingPicker.tsx, FormattingBar.tsx, ListButtons.tsx, toolbarUtils.ts
