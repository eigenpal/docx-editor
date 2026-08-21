// Header/footer edit chrome applied to already-painted pages.
//
// Opening a header used to fold rId + page index into the paint-reuse key, which rebuilt
// every visible sheet even though the body ink had not moved. Dimming is CSS on
// `.docx-pages--hf-editing`. This module moves `data-docx-hf-active`, contenteditable, the
// active-band height, and drawing hit-testing onto the nodes the painter already has —
// the same in-place pattern as TOC hover.

import type { HeaderFooterStoryRecord, PageRecord } from '../layout/semantic-records.ts';

export type HeaderFooterPaintChrome = {
  readonly scale: number;
  readonly activeHeaderFooterRId?: string;
  readonly activeHeaderFooterPageIndex?: number;
};

export type HeaderFooterPaintTarget = {
  readonly record: PageRecord;
  readonly element: HTMLElement;
  readonly materialized: boolean;
};

export function headerFooterBandIsActive(
  story: HeaderFooterStoryRecord,
  pageIndex: number,
  chrome: HeaderFooterPaintChrome
): boolean {
  return (
    !!chrome.activeHeaderFooterRId &&
    !!story.rId &&
    chrome.activeHeaderFooterRId === story.rId &&
    (chrome.activeHeaderFooterPageIndex === undefined ||
      chrome.activeHeaderFooterPageIndex === pageIndex)
  );
}

export function headerFooterBandHeightPt(
  story: HeaderFooterStoryRecord,
  page: PageRecord,
  active: boolean
): number {
  if (!active) return story.box.height;
  return story.kind === 'footer'
    ? Math.max(story.box.height, page.box.y + page.box.height - story.box.y)
    : Math.max(story.box.height, page.contentBox.y - story.box.y);
}

/** Retint furniture chrome on retained pages. Newly painted pages go through the same path. */
export function applyHeaderFooterPaintChrome(
  pages: readonly HeaderFooterPaintTarget[],
  chrome: HeaderFooterPaintChrome
): void {
  for (const { record: page, element, materialized } of pages) {
    if (!materialized) continue;
    const content = element.querySelector<HTMLElement>(':scope > .docx-page-content');
    if (content) {
      if (chrome.activeHeaderFooterRId) content.setAttribute('contenteditable', 'false');
      else content.removeAttribute('contenteditable');
    }
    for (const band of element.querySelectorAll<HTMLElement>(
      ':scope > .docx-hf:not(.docx-hf--placeholder)'
    )) {
      const story = storyOfBand(page, band);
      if (!story) continue;
      const active = headerFooterBandIsActive(story, page.index, chrome);
      applyBandChrome(band, page, story, active, chrome.scale);
    }
    for (const layer of element.querySelectorAll<HTMLElement>(':scope > [data-docx-hf-front]')) {
      const story = storyOfKind(page, layer.dataset.docxHfFront);
      setDrawingInteractivity(
        layer,
        !!story && headerFooterBandIsActive(story, page.index, chrome)
      );
    }
  }
}

function storyOfBand(page: PageRecord, band: HTMLElement): HeaderFooterStoryRecord | undefined {
  return storyOfKind(page, band.dataset.docxHf);
}

function storyOfKind(
  page: PageRecord,
  kind: string | undefined
): HeaderFooterStoryRecord | undefined {
  if (kind === 'header') return page.header;
  if (kind === 'footer') return page.footer;
  return undefined;
}

function applyBandChrome(
  band: HTMLElement,
  page: PageRecord,
  story: HeaderFooterStoryRecord,
  active: boolean,
  scale: number
): void {
  if (active) {
    band.dataset.docxHfActive = '';
    band.setAttribute('contenteditable', 'true');
  } else {
    delete band.dataset.docxHfActive;
    band.setAttribute('contenteditable', 'false');
  }
  band.style.height = `${headerFooterBandHeightPt(story, page, active) * scale}px`;
  setDrawingInteractivity(band, active);
}

function setDrawingInteractivity(root: ParentNode, interactive: boolean): void {
  const nodes = root.querySelectorAll<HTMLElement>(
    root instanceof Element && root.classList.contains('docx-drawing-layer')
      ? ':scope > *'
      : ':scope > .docx-drawing-layer > *'
  );
  for (const node of nodes) {
    node.style.pointerEvents = interactive ? 'auto' : 'none';
    for (const nested of node.querySelectorAll<HTMLElement>('.docx-drawing')) {
      nested.style.pointerEvents = interactive ? 'auto' : 'none';
    }
  }
}
