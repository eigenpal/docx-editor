# Tasks: List Operations Fidelity

## Investigation

- [ ] Test: select 3 list items → click indent → check if all change
- [ ] Test: select entire list → click list toggle → check if all items un-listed
- [ ] Test: list with hanging indent inside table cell — check indicator position
- [ ] Check if numbering run properties with `w:vanish` are accessible during rendering
- [ ] Check if `contextualSpacing` is parsed and available in paragraph properties

## Multi-select indent/outdent

- [ ] Modify indent command to iterate all paragraphs in selection
- [ ] Apply level change to each list paragraph in a single transaction
- [ ] Same fix for outdent command
- [ ] Test with mixed content (some paragraphs are lists, some aren't)

## Multi-select list toggle

- [ ] Modify toggle command to iterate all paragraphs in selection
- [ ] Remove numId/ilvl from all selected paragraphs when toggling off
- [ ] Apply as single transaction
- [ ] Test toggle on (add list to multiple paragraphs) also works

## List indicator in table cells

- [ ] Fix indicator position relative to cell content edge
- [ ] Position at `max(0, indent.left - indent.hanging)` from cell edge
- [ ] Text starts at `indent.left` from cell edge
- [ ] Test with various hanging indent values

## Hidden list indicators

- [ ] Check numbering definition's run properties for `w:vanish`
- [ ] Skip indicator rendering when vanish is true
- [ ] Test with DOCX that has hidden indicators

## Contextual spacing

- [ ] In layout-painter spacing calculation, check `contextualSpacing` flag
- [ ] Compare current and previous paragraph styles
- [ ] Suppress spaceBefore/spaceAfter when same style and flag is set
- [ ] Test with consecutive list items that have contextualSpacing

## Testing

- [ ] E2E test: multi-select indent changes all items
- [ ] E2E test: multi-select toggle removes all list styling
- [ ] E2E test: list indicator aligned in table cell
- [ ] E2E test: hidden indicators not rendered
- [ ] E2E test: contextual spacing collapses between same-style paragraphs
- [ ] Run `bun run typecheck`
