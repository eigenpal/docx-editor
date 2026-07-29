// Framework-agnostic, READ-ONLY DOCX preview — the SINGLE projection path shared by
// the React and Vue demos (queue item 2). It runs the production pipeline
// bytes -> parseDocx -> layoutBody -> renderToDom into a container element, so neither
// framework duplicates any layout/paint logic. It is strictly read-only: there is no
// editing or saving. It imports ONLY the production engine — no ProseMirror, no legacy
// core implementation, no spike.
import { parseDocx, type PackageModel } from '@docx-editor.dev/core-contract/store';
import { layoutBody, type LayoutShapingOptions, type Page } from '@docx-editor.dev/core-contract/layout';
import {
  renderToDom,
  renderPageElement,
  type InstalledFontMapping,
} from '@docx-editor.dev/core-contract/output';

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
  /** Task 7 adapter boundary: callers must inject validated font bytes and a shaper. */
  readonly shaping?: LayoutShapingOptions;
  /** Exact installed CSS aliases for the same fonts selected by `shaping`. */
  readonly installedFonts?: InstalledFontMapping;
}

export class PreviewLayoutConfigurationError extends Error {
  readonly code = 'layoutShapingRequired';

  constructor() {
    super(
      'DOCX preview requires explicit font-resource, text-shaper, and installed-font snapshots'
    );
    this.name = 'PreviewLayoutConfigurationError';
  }
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
  doc: Document = container.ownerDocument ?? document
): PreviewResult {
  while (container.firstChild) container.removeChild(container.firstChild);
  if (!options.shaping) throw new PreviewLayoutConfigurationError();
  if (!options.installedFonts) throw new PreviewLayoutConfigurationError();
  const layout = layoutBody(model, {
    pageWidth: options.pageWidth ?? DEFAULTS.pageWidth,
    pageHeight: options.pageHeight ?? DEFAULTS.pageHeight,
    margin: options.margin ?? DEFAULTS.margin,
    shaping: options.shaping,
  });
  renderToDom(layout, container, options.installedFonts, doc);
  return { ok: true, pageCount: layout.pages.length };
}

/** A stable fingerprint of everything renderPageElement paints for a page — its dimensions
 *  AND its display items — so two pages with the same fingerprint produce byte-identical DOM and
 *  an unchanged page can keep its existing element. Dimensions are included so a page that keeps
 *  its items but changes size (a different section page size) is not falsely reused. */
function pageFingerprint(page: Page): string {
  return JSON.stringify({ w: page.width, h: page.height, items: page.items });
}

export interface PagePainter {
  /** Re-layout `model` and patch ONLY the pages whose paint content changed, reusing the DOM
   *  of unchanged pages. Returns the outcome (page count) like renderModelPreview. */
  paint(model: PackageModel): PreviewResult;
}

/**
 * Create a stateful, INCREMENTAL paginated painter bound to `container`. Unlike
 * renderModelPreview (which clears and rebuilds every page on each call), this keeps the prior
 * per-page fingerprints and page elements: on repaint it re-lays-out the model (layout is a
 * fast pure pass) but replaces only the page elements whose display items actually changed, and
 * adds/removes trailing pages as the page count changes. So typing that only touches one page
 * never tears down and recreates the whole document's DOM. The container must hold ONLY page
 * elements (this owns its children).
 */
export function createPagePainter(
  container: HTMLElement,
  doc: Document = container.ownerDocument ?? document,
  options: PreviewOptions = {}
): PagePainter {
  let prints: string[] = [];
  return {
    paint(model: PackageModel): PreviewResult {
      if (!options.shaping) throw new PreviewLayoutConfigurationError();
      if (!options.installedFonts) throw new PreviewLayoutConfigurationError();
      const layout = layoutBody(model, {
        pageWidth: options.pageWidth ?? DEFAULTS.pageWidth,
        pageHeight: options.pageHeight ?? DEFAULTS.pageHeight,
        margin: options.margin ?? DEFAULTS.margin,
        shaping: options.shaping,
      });
      const pages = layout.pages;
      for (let i = 0; i < pages.length; i += 1) {
        const fp = pageFingerprint(pages[i]);
        const existing = container.children[i] as HTMLElement | undefined;
        if (existing && prints[i] === fp) continue; // page unchanged — keep its DOM
        const el = renderPageElement(pages[i], options.installedFonts, doc);
        if (existing) container.replaceChild(el, existing);
        else container.appendChild(el);
        prints[i] = fp;
      }
      // Drop trailing pages the model no longer produces.
      while (container.children.length > pages.length) container.removeChild(container.lastChild!);
      prints = prints.slice(0, pages.length);
      return { ok: true, pageCount: pages.length };
    },
  };
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
  doc: Document = container.ownerDocument ?? document
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
