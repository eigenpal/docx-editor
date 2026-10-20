# Consumer trial feedback

A separate agent built this demo as a client developer.
The agent used package README examples and public built package exports.
The agent did not inspect the feature implementation.

## What the demo builds

Both frameworks render a graphic review card in the unsupported element box.
The card shows the element label, kind, details toggle, and local annotation input.
React uses a TSX component and `renderUnsupportedElement`.
Vue uses ordinary `.vue` files, `ref`, `v-model`, and the `unsupportedElement` scoped slot.
The Vue component needs no render functions or manual event forwarding.

## Verified behavior

The browser trial uses installed Google Chrome through Playwright.
Run `node examples/unsupported-content-trial/browser-trial.mjs` while the server runs.
The executable path targets the installed macOS Chrome application.

The following checks passed in both frameworks:

- The fixture displays one custom graphic card.
- The details button expands the element identifier.
- The annotation field accepts text and native cursor and Backspace keys.
- Zoom changes preserve annotation text and expanded state.
- Zoom changes preserve input focus and selection offsets 7 through 12.
- Typing `Reviewed: ` into the document changes visible document text.
- That document edit preserves annotation text and expanded state.
- Disabling customization restores the visible default graphic placeholder.
- Enabling customization again mounts a fresh component with empty local state.
- No page errors, console errors, or failed network responses occurred.

The Vite production build also passes.
The build warns about a large application bundle containing both frameworks.
Browser results are saved at `/tmp/unsupported-trial-results.json`.
Screenshots are saved at `/tmp/unsupported-trial-interactive-react.png` and `/tmp/unsupported-trial-interactive-vue.png`.

## Feedback

The consumer API supports this use case directly.
React follows the familiar render callback pattern.
Vue follows the familiar scoped slot pattern.
The discriminated element object makes type-specific UI possible.
The native component state works without consumer lifecycle code.

The fixed document box is the main UX constraint.
A rich card needs compact styling, scrolling, or an external details panel.
Consumers must store durable annotations outside the component, keyed by `nodeId`.
The README explains unmounting and the fixed layout box.
The demo has no annotations persistence requirement.

The full Vue editor emits a default-slot warning from its Help menu.
This warning does not identify the unsupported-content scoped slot.
No feature-specific defect appeared during this trial.

This unregistered monorepo example uses aliases to built workspace packages.
That setup is demo infrastructure, not consumer API complexity.
A published-package application resolves these imports through its package manager.

The trial covers the diagram fixture and same-page edits.
It does not prove equation coverage or all pagination and virtualization transitions.
Vite compiles Vue SFCs, but this trial does not run `vue-tsc`.
Runtime success does not establish Vue template type inference quality.
