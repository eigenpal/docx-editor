# Header/Footer Rendering Fidelity

## Problem

Header and footer rendering has two categories of issues:

1. **Content clipping** — header images that are taller than the default header area get clipped or hidden underneath the main document body. Word allows header content to overflow into the margin area and adjusts accordingly.
2. **Alignment distortion** — header/footer content alignment (left/center/right sections, tab stops for positioning) doesn't match Word, especially with images, logos, and multi-column header layouts.

## Scope

- Fix header/footer height calculation to accommodate oversized content (especially images)
- Fix alignment within headers/footers (tab-stop-based 3-section layout)
- Ensure header/footer images don't clip into the document body

## Out of scope

- Header/footer editing UI
- Different first page / even-odd page headers (already supported)
