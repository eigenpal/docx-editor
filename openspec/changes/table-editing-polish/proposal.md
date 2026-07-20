# Table Editing Polish

## Problem

Two table editing interaction issues:

1. **Table column resize is difficult/unreliable** — only the last column's border responds to drag. Other column borders rarely move or don't respond at all. Users can't freely resize individual columns. Once moved, columns can't be moved back to original position.

2. **Added rows don't inherit formatting** — when using "Add row below/above", the new row's cells don't inherit text alignment, font size, or font family from the reference row. New cells get default formatting instead of matching the existing table style.

## Scope

- Fix column resize to work on all column borders, not just the last one
- New rows inherit formatting (alignment, font, size) from adjacent row

## Out of scope

- Table creation UI (already works)
- Cell merge/split editing (already works)
- Table auto-fit algorithms (covered in table-rendering-fidelity)
