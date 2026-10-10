## Why

The editor preserves Office Math Markup Language (OMML), but it does not display or edit equations. The equations in `sample.docx` therefore disappear from the editable page.

## What Changes

- Project bounded OMML equation trees into layout-owned inline equation atoms.
- Display fractions, radicals, scripts, and n-ary operators used by `sample.docx`.
- Keep unsupported OMML content visible through a bounded text fallback.
- Let users select an equation and edit it with a compact linear-math syntax.
- Apply or delete an equation as one document transaction.
- Preserve unedited OMML during save and reopen.

## Capabilities

### New Capabilities

- `mathematical-equations`: Defines bounded OMML projection, equation display, selection, editing, deletion, and save fidelity.

### Modified Capabilities

None.

## Impact

This change affects the canonical tree operation vocabulary, semantic layout records, semantic paint, editor surface interaction, React and Vue chrome, and shared styles. It adds no runtime dependency.
