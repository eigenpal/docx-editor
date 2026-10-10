## Context

OMML elements are preserved as generic canonical nodes. Paragraph projection ignores those nodes, so equations consume no model offset and paint no content. The sample document uses inline `m:oMath` with text runs, fractions, radicals, superscripts, and n-ary operators.

Layout is DOM-free and owns all geometry. Paint cannot measure an equation after layout. The canonical tree remains the only editable authority, and adapters own transient chrome.

## Goals / Non-Goals

**Goals:**

- Display the OMML subset used by `sample.docx` with stable layout geometry.
- Treat each equation as one selectable model atom.
- Preserve unknown OMML and provide a visible bounded fallback.
- Edit and delete equations through one transaction.
- Keep React and Vue behavior equivalent.

**Non-Goals:**

- Implement every OMML element in the first change.
- Execute embedded field codes or external resources.
- Add a full visual equation builder.
- Convert arbitrary LaTeX.

## Decisions

### Keep OMML generic and add a bounded semantic projector

The canonical parser will continue to preserve OMML as generic nodes. A layout projector will recognize the Office Math namespace and produce an immutable equation expression tree. This avoids widening the canonical typed vocabulary before mutation needs stable identities.

The projector will cap node count, nesting depth, and text length. Unsupported structures will flatten their bounded descendant text instead of disappearing.

Typing every OMML element was rejected. It would add a large validation surface without improving the initial display and edit paths.

### Publish equations as one model atom

Each `m:oMath` will contribute one UTF-16 object-replacement unit. Its layout span will carry equation metadata, source identity, and measured geometry. Caret and hit testing will use the atom boundaries.

Treating equation text as ordinary paragraph text was rejected. Internal OMML text is not an editable WordprocessingML run sequence, and exposing its offsets would create invalid tree operations.

### Use a small internal equation layout engine

The layout engine will measure text with the injected `TextMeasurer`. It will compose boxes for rows, fractions, radicals, scripts, and n-ary operators. Paint will consume those boxes without measuring.

MathML or KaTeX was rejected. MathML geometry is browser-owned, while layout must remain DOM-free. KaTeX would add a large runtime and stylesheet dependency.

### Paint safe nested DOM from semantic records

Paint will create equation elements with `createElement`, `textContent`, and inline geometry. It will never insert OMML-derived HTML. The equation root will carry the source node id for selection and popover activation.

### Use explicit equation tree operations

The store will add operations to replace or remove an equation node. A bounded linear-math parser will build the supported OMML subset with fresh canonical ids. Apply and delete will each use one transaction.

Direct adapter mutation was rejected because it would bypass undo, revision tracking, and canonical validation.

### Follow the hyperlink chrome seam

The surface will classify an equation click and publish the equation plus its viewport rectangle. React and Vue will register one equation popover handler and render equivalent default controls. The input will accept `^`, `_`, `{a}/{b}`, `√{x}`, and `∑[n]{x}` forms.

## Risks / Trade-offs

- [The first projector supports only part of OMML] → Preserve all source XML and show bounded descendant text for unsupported structures.
- [Equation metrics can differ from Word] → Use one deterministic point-based composer and add sample geometry tests.
- [Large hostile OMML can consume CPU] → Enforce depth, node, and text budgets before composition.
- [One atom prevents internal caret editing] → Open the linear editor for the complete equation and replace it atomically.
- [Adapter chrome can drift] → Share engine state and add cross-adapter behavior tests.
