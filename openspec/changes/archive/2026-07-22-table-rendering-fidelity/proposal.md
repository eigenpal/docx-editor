# Table Rendering Fidelity

## Problem

Multiple table rendering issues reduce visual fidelity compared to Word:

1. **Merged cell rendering** — cells merged beyond the first column may render incorrectly (wrong spans, misaligned content)
2. **Table indentation offset** — slight extra padding on the left side of tables compared to Word
3. **Table overlapping text** — table content can render on top of following text content, and documents may show extra blank pages
4. **Table margins not adaptive** — wide tables that exceed page margins don't auto-adjust like Word does
5. **Table pagination** — rows splitting across pages cause text overlapping, misaligned borders, and inconsistent line breaks. Header rows don't repeat on continuation pages
6. **Row splitting visual glitches** — when a single row splits across pages, each fragment independently reflows text, causing inconsistent column widths

## Scope

- Fix merged cell span calculations for non-first-column merges
- Fix table left margin/indentation calculation
- Prevent table content from overlapping following document content
- Handle tables wider than content area (auto-fit or horizontal scroll)
- Improve table pagination: clean row splits, header row repetition
- Fix cross-page row fragment coordination

## Out of scope

- Table creation UI (already works)
- Cell content editing (already works)
