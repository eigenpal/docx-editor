# List Operations Fidelity

## Problem

Several list-related editing and rendering issues:

1. **Multi-select indent only affects first item** — selecting multiple list items and clicking indent/outdent only changes the first item's level. All selected items should be adjusted.

2. **Multi-select list toggle only removes first item** — selecting an entire list and clicking the list toggle button only removes list styling from the first item. Should remove from all selected items.

3. **List indicator misaligned in table cells** — when a list with hanging indent is inside a table cell, the bullet/number renders at the hanging indent position instead of the left margin. Word keeps the indicator at the left edge.

4. **Hidden list indicators still shown** — list indicators with `w:vanish` (Hidden font property) in the numbering run properties should not be visible. We render them regardless.

5. **Contextual spacing not respected** — `w:contextualSpacing` should suppress space before/after between consecutive paragraphs of the same style (common in lists). We always render full spacing.

## Scope

- Fix multi-item indent/outdent operations
- Fix multi-item list toggle off
- Fix list indicator positioning in table cells with hanging indent
- Respect `w:vanish` on numbering run properties
- Implement `w:contextualSpacing` spacing suppression

## Out of scope

- New list styles or numbering formats
- List continuation from previous sections
