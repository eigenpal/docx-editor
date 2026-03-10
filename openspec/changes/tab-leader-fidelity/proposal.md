# Tab Leader Rendering Fidelity

## Problem

Tab leaders in Tables of Contents (and other tab-stop-based layouts) overlap with text content. The dotted, dashed, or solid leader lines extend into:

- Section title text on the left side
- Page numbers on the right side

Instead, leaders should be bounded between the end of the text content and the tab stop position, with proper spacing on both sides.

## Scope

- Fix tab leader rendering to start after text content ends (with small gap)
- Fix tab leader rendering to stop before the tab stop content begins (with small gap)
- Handle all leader types: dot, hyphen, underscore, heavy, middleDot

## Out of scope

- TOC generation/parsing (already works)
- Tab stop creation/editing
