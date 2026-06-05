# core-apply-formatting Specification

## Purpose

TBD - created by archiving change unify-orchestration-tier1. Update Purpose after archive.

## Requirements

### Requirement: applyFormatting and setParagraphStyle in core

`@eigenpal/docx-editor-core` SHALL expose `applyFormatting(view, options, deps)` and `setParagraphStyle(view, options, deps)` where `deps` supplies an injected `getStyleResolver`. The mark/style logic (bold, italic, underline, strike, color, highlight, fontSize, fontFamily, and paragraph style application) MUST match the prior byte-for-byte-identical adapter bodies. Both adapters SHALL delegate, passing their own `EditorView` and style resolver.

#### Scenario: Apply character marks to a located range

- **WHEN** `applyFormatting(view, { paraId, search, marks }, deps)` is called
- **THEN** the resolved range receives the requested marks and the function returns `true`; an unresolvable `paraId`/`search` returns `false` without dispatching

#### Scenario: Apply a paragraph style

- **WHEN** `setParagraphStyle(view, { paraId, styleId }, deps)` is called with an injected resolver
- **THEN** the paragraph's style is applied using the resolver and the result matches prior adapter behavior

#### Scenario: Style resolver is injected, not baked in

- **WHEN** React passes its cached resolver and Vue passes a `createStyleResolver`-based one
- **THEN** both produce results identical to their pre-lift implementations using the single core function
