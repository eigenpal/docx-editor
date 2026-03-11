# Design: List Operations Fidelity

## Multi-select indent/outdent

The `ListExtension` commands for indent/outdent likely operate on the current paragraph only. Need to iterate over all paragraphs in the current selection range and apply the level change to each.

**Fix:** In the indent/outdent command, use `state.doc.nodesBetween(from, to)` to find all list paragraphs in selection, then create a single transaction that updates all their levels.

## Multi-select list toggle

Same pattern as indent: the toggle command should iterate all paragraphs in selection. When toggling off, remove `numId`/`ilvl` from all selected paragraphs, not just the first.

## List indicator in table cells

Word's behavior: list indicator (bullet/number) sits at the paragraph's left margin, and the text starts at the hanging indent position. Inside a table cell, the left margin is the cell's content edge.

Our rendering may be offsetting the indicator by the hanging indent amount. Fix: position the indicator at `max(0, indent.left - indent.hanging)` relative to the cell content edge, and start text at `indent.left`.

## Hidden list indicators

Check `w:rPr/w:vanish` on the numbering definition's run properties. If `vanish` is true, don't render the list indicator for that level.

Check: `ListExtension` or list rendering code — where indicators are generated.

## Contextual spacing

`w:contextualSpacing` (17.3.1.9): when true, suppress `spaceBefore` and `spaceAfter` between consecutive paragraphs of the same style.

In the layout-painter, when calculating paragraph spacing:

1. Check if current paragraph has `contextualSpacing` enabled
2. Check if the previous paragraph has the same `pStyle`
3. If both true, set `spaceBefore` to 0
4. Similarly for `spaceAfter` when the next paragraph has the same style

## Key files

| File                                                   | Change                                    |
| ------------------------------------------------------ | ----------------------------------------- |
| `src/prosemirror/extensions/features/ListExtension.ts` | Multi-select indent/toggle                |
| `src/layout-painter/renderParagraph.ts`                | Indicator positioning, contextual spacing |
| `src/layout-painter/renderListIndicator.ts`            | Hidden indicator check                    |
