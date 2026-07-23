// Framework-agnostic, READ-ONLY DOCX preview — the SINGLE projection path shared by
// the React and Vue demos (queue item 2). It runs the production pipeline
// bytes -> parseDocx -> layoutBody -> renderToDom into a container element, so neither
// framework duplicates any layout/paint logic. It is strictly read-only: there is no
// editing or saving. It imports ONLY the production engine — no ProseMirror, no legacy
// core implementation, no spike.
import { parseDocx, type PackageModel } from '@docx-editor.dev/engine-core';
import { layoutBody, HelveticaMetrics } from '@docx-editor.dev/engine-layout';
import { renderToDom } from '@docx-editor.dev/engine-output';

export interface PreviewResult {
  /** Whether the file parsed and rendered. */
  readonly ok: boolean;
  /** Number of laid-out pages (0 on failure). */
  readonly pageCount: number;
  /** A short reason when `ok` is false (also shown in the container). */
  readonly error?: string;
}

export interface PreviewOptions {
  readonly pageWidth?: number; // twips; default US Letter 8.5in
  readonly pageHeight?: number; // twips; default 11in
  readonly margin?: number; // twips; default 1in
}

/** US Letter page defaults, in twips. */
const DEFAULTS = { pageWidth: 12240, pageHeight: 15840, margin: 1440 } as const;

/**
 * Render a canonical `PackageModel` into `container` as paginated pages (layout ->
 * display list -> DOM). The container is cleared first so re-rendering is idempotent —
 * this is the paginated display the editor repaints from `store.model` after every edit.
 */
export function renderModelPreview(
  model: PackageModel,
  container: HTMLElement,
  options: PreviewOptions = {},
  doc: Document = container.ownerDocument ?? document,
): PreviewResult {
  while (container.firstChild) container.removeChild(container.firstChild);
  const layout = layoutBody(model, {
    pageWidth: options.pageWidth ?? DEFAULTS.pageWidth,
    pageHeight: options.pageHeight ?? DEFAULTS.pageHeight,
    margin: options.margin ?? DEFAULTS.margin,
    metrics: new HelveticaMetrics(),
  });
  renderToDom(layout, container, doc);
  return { ok: true, pageCount: layout.pages.length };
}

/**
 * Render a DOCX (as bytes) into `container` as a read-only preview. Invalid input is
 * surfaced as a visible error element (never thrown), and the container is cleared
 * first so re-rendering is idempotent. Returns the outcome for the host UI/tests.
 */
export function renderDocxPreview(
  bytes: Uint8Array,
  container: HTMLElement,
  options: PreviewOptions = {},
  doc: Document = container.ownerDocument ?? document,
): PreviewResult {
  while (container.firstChild) container.removeChild(container.firstChild);

  const parsed = parseDocx(bytes);
  if (!parsed.ok) {
    const err = doc.createElement('div');
    err.setAttribute('class', 'docx-preview-error');
    err.textContent = `This file could not be opened (${parsed.reason}).`;
    container.appendChild(err);
    return { ok: false, pageCount: 0, error: parsed.reason };
  }
  return renderModelPreview(parsed.model, container, options, doc);
}
