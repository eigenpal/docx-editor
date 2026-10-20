# Consumer trial feedback

A separate agent built this example as a client developer.
This revision uses the compound `DocxEditor.UnsupportedElement` API in React and Vue.
It replaces the earlier callback and named-slot consumer trial.

## What the example builds

A generated DOCX contains two opaque XML elements in namespace `urn:consumer-review`.
One block stores an approval title and status. One inline stores a reference token.
The original unsupported DrawingML stays in the document.

Both frameworks register three renderers through the public built package exports.
The approval uses a 420 × 118 point layout box.
The reference uses a 112 × 22 point layout box.
The drawing renderer retains its authored box.
The source position determines block or inline placement.

Components read the title, status, and token from `element.source`.
The approval card includes details and a local annotation input.
The inline component shows `LEGAL-42` as a reference chip.
All source values render as escaped text.
Annotations stay in component state. They do not change saved source XML.

React uses a TSX component and render-function children.
Vue uses ordinary SFCs, `ref`, `v-model`, and a default scoped slot.
Vue needs no render functions or manual event forwarding.

## Verified results

The browser trial uses installed Google Chrome through Playwright.
Run `node examples/unsupported-content-trial/browser-trial.mjs` while the server runs.
The executable path targets the installed macOS Chrome application.

The final trial repeats after all core, React, and Vue builds finish.
The example server restarts before that final trial.

These checks passed in both frameworks:

- The opaque block, opaque inline, and unsupported drawing render custom components.
- Components display metadata and values from canonical source.
- The details toggle expands the source part and element identifier.
- The annotation field accepts text, cursor movement, and Backspace.
- Zoom preserves annotation text, expanded state, focus, and selection offsets 7 through 12.
- Typing `Reviewed: ` changes visible document text and preserves component state.
- Returning `null` or empty Vue slot content restores the built-in placeholder.
- Restoring component content creates fresh local state after fallback unmounting.
- Removing and restoring matched declarations removes and restores custom XML components.
- The public editor ref saves the edited DOCX.
- Saved custom XML matches the original source subtrees after namespace-aware normalization.
- Saved text includes the document edit and excludes local annotation text.
- Reopening saved bytes restores custom components and the document edit.
- No page errors, console errors, or failed network responses occur in the final trial.

The Vite production build passes.
The build warns about a large bundle containing both frameworks.
Scoped ESLint passes.
React consumer strict TypeScript validation passes against the built declaration export.
Vue SFCs compile and run. This trial does not run `vue-tsc`.
Runtime success does not establish Vue template type inference quality.

Results are saved at `/tmp/unsupported-trial-results.json`.
Screenshots are saved at `/tmp/unsupported-trial-interactive-react.png` and `/tmp/unsupported-trial-interactive-vue.png`.

## Candid API feedback

The compound API makes layout registration and custom rendering one declaration.
The namespace and local name avoid a closed list of unsupported element kinds.
Source metadata supports a useful component without engine implementation access.
The native React and Vue patterns need little adapter code.
The layout dimensions use document points, which the documentation must state clearly.

A specific composition trap appeared during this trial.
A persistent catch-all declaration mounted before a restored conditional declaration captures that element.
Returning `null` does not try the next renderer.
This follows the documented first-mounted matching rule, but conditional registration changes priority.
The example now gives the drawing declaration an explicit drawing matcher.
Consumers should use narrow matchers when they add and remove declarations.
The documentation should show this interaction beside any catch-all example.

The fixed document box limits rich interfaces, especially authored drawing boxes.
Use compact content, scrolling, or an external panel.
Use application state keyed by `nodeId` for annotations that must survive unmounting.
The library does not persist component state into document source automatically.

The final trial after merging main reports no browser warnings in either framework.
No feature-specific defect remains in the final consumer trial.

## Setup and limits

This unregistered monorepo example uses aliases to built workspace packages.
That setup is example infrastructure, not consumer API complexity.
A published application resolves imports through its package manager.
Rebuilding packages during a browser run invalidates Vite's cached chunk paths.
Restart the example server after package rebuilds and wait for compiled CSS before testing.

This trial covers one custom block, one custom run child, and one drawing fallback.
It does not prove every Word element, equations, pagination, or virtualization behavior.
