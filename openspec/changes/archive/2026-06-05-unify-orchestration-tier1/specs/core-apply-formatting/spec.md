## ADDED Requirements

### Requirement: applyFormatting and setParagraphStyle in core

`@docx-editor.dev/core` SHALL expose `applyFormatting(view, options, deps)` and `setParagraphStyle(view, options, deps)` where `deps` supplies an injected `getStyleResolver`. The mark/style logic (bold, italic, underline, strike, color, highlight, fontSize, fontFamily, and paragraph style application) MUST satisfy the observable scenarios below for the same document, selection, options, and resolver inputs. Both adapters SHALL delegate, passing their own `EditorView` and style resolver.

#### Scenario: Apply character marks to a located range

- **WHEN** `applyFormatting(view, { paraId, search, marks }, deps)` is called
- **THEN** the resolved range receives the requested marks and the function returns `true`; an unresolvable `paraId`/`search` returns `false` without dispatching

#### Scenario: Apply a paragraph style

- **WHEN** `setParagraphStyle(view, { paraId, styleId }, deps)` is called with an injected resolver
- **THEN** the paragraph's style is applied using the resolver and the result satisfies the documented paragraph-style contract

#### Scenario: Style resolver is injected, not baked in

- **WHEN** React passes its cached resolver and Vue passes a `createStyleResolver`-based one
- **THEN** both produce equivalent results for the same document, selection, options, and resolver inputs using the single core function
