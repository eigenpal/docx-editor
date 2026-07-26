// @docx-editor.dev/engine-output
//
// Outputs: DOM paint, print, native PDF, accessibility projection, and hit-testing. Consumes DisplayItem[] only; never rederives geometry or interprets CSS.
//
// Production placement is fixed by document-engine task 1.4. Responsibilities and
// dependency rules: docs/architecture/production-engine-packages.md. This is a
// greenfield skeleton; capability implementation lands in the sections that own it.
//
// ADR-S9: production modules MUST NOT import from packages/core/spike/**.

/** Stable package identity used by the import-graph / package-authority checks. */
export const ENGINE_OUTPUT_PACKAGE = '@docx-editor.dev/engine-output' as const;

export { renderPdf, inspectPdf } from './pdf.ts';
export { extractReadingOrder } from './semantic.ts';
export { renderToDom, renderPageElement, type InstalledFontMapping } from './dom.ts';
