# Design: Tab Leader Rendering

## Current behavior

Tab leaders are rendered as a pattern (dots, dashes, etc.) filling the space of a tab character. The leader spans the full width from the tab character position to the tab stop position.

## Problem

The leader starts too early (overlapping preceding text) and/or ends too late (overlapping the page number or following text).

## Fix

The leader should only fill the gap between:

- **Start:** the end of the text content before the tab character + small padding (~2px)
- **End:** the start of the text content after the tab character - small padding (~2px)

### Implementation

In the tab rendering code (layout-painter), the leader element should:

1. Be absolutely positioned within the tab span
2. Use CSS `overflow: hidden` to clip to the tab span boundaries
3. Have left/right padding to prevent touching adjacent text
4. Use `text-overflow` or a repeating pattern that fills only the available width

### Leader patterns (CSS)

- **dot:** `content` with repeating `.` characters or `border-bottom: dotted`
- **hyphen:** repeating `-` characters
- **underscore:** `border-bottom: solid 1px`
- **heavy:** `border-bottom: solid 2px`
- **middleDot:** repeating `·` characters

## Key files

| File                                    | Change                   |
| --------------------------------------- | ------------------------ |
| `src/layout-painter/renderParagraph.ts` | Tab and leader rendering |
