---
'@eigenpal/docx-js-editor': patch
---

Fix document outline overlap and ruler behavior

- Outline panel no longer sits on top of the page. On wide viewports the
  page stays where it was (centered, or translated left by the comments
  sidebar) — only the layout's min-width grows so the centered page never
  overlaps the panel. On narrow viewports the page + outline scroll
  horizontally as a unit instead.
- Outline panel header lines up with the doc's top margin and uses a
  transparent background so the page's left-side shadow stays visible when
  the viewport is squeezed.
- Vertical ruler stays pinned to the viewport's left edge during horizontal
  scroll instead of scrolling out of view.
- Horizontal ruler is now sticky inside the scroll container, so it scrolls
  horizontally with the doc and stays put on vertical scroll. Padding tracks
  the outline (right shift) and comments sidebar (left shift) so the ruler
  centers against the same axis as the page.
- Editor surround uses `--doc-bg` uniformly so the over-scroll/rubber-band
  area matches the gutter.
