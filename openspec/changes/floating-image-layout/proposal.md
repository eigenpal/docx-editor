# Floating Image Layout & Text Wrapping

## Problem

Floating images with text wrapping don't match Word's rendering. There is a known TODO in `renderParagraph.ts`: "Implement measurement-time floating image support for proper text wrapping." Multiple issues stem from this:

1. **Text doesn't flow around floating images** — text overlaps or ignores image boundaries instead of wrapping around them (square, tight, through wrapping modes)
2. **Images in table cells overlap** — when multiple images are placed in a table-based grid layout, they overlap instead of flowing into proper rows
3. **Behind/in-front-of-text layering** — z-index layering for images with `behindDoc` or in-front-of-text positioning may not be correct

## Scope

- Fix text wrapping calculation for floating images (square, tight, through, topAndBottom)
- Fix image positioning within table cells
- Ensure z-index layering matches Word behavior for behind/in-front-of-text modes

## Out of scope

- Editing image wrapping mode (existing UI handles this)
- Image resize/drag (separate system)
