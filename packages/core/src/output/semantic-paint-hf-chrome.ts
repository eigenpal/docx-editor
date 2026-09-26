// Header/footer edit chrome applied to already-painted pages.
//
// Opening a header used to fold rId + page index into the paint-reuse key, which rebuilt
// every visible sheet even though the body ink had not moved. Dimming is CSS on
// `.docx-pages--hf-editing`. This module moves `data-docx-hf-active`, contenteditable, the
// active-band height, and drawing hit-testing onto the nodes the painter already has —
// the same in-place pattern as TOC hover.

import type { HeaderFooterStoryRecord, LayoutBox, PageRecord } from '../layout/semantic-records.ts';

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

/**
 * The part of a header or footer box outside the page's content box, or `null` if none.
 *
 * A negative `w:top` or `w:bottom` measures the body from the page edge, so a tall story
 * reaches into the content box and paints over body lines.
 */
function headerFooterMarginPart(
  page: PageRecord,
  story: HeaderFooterStoryRecord
): LayoutBox | null {
  const { box } = story;
  const content = page.contentBox;
  const top = story.kind === 'header' ? box.y : Math.max(box.y, content.y + content.height);
  const bottom =
    story.kind === 'header' ? Math.min(box.y + box.height, content.y) : box.y + box.height;
  return bottom > top ? { x: box.x, y: top, width: box.width, height: bottom - top } : null;
}

/** Whether a header or footer box reaches into the page's content box. */
function headerFooterOverlapsBody(page: PageRecord, story: HeaderFooterStoryRecord): boolean {
  const a = story.box;
  const b = page.contentBox;
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Hover chrome for a painted header or footer band: the tint target and the edit pill.
 *
 * A band that stays in its margin tints its own box on hover. The pill sits just outside the
 * box and shows through `.docx-hf:hover + .docx-hf-edit-hint`, so it must follow the band.
 *
 * A band over body lines is marked `data-docx-hf-over-body`. While it is closed, the
 * stylesheet makes it and every descendant transparent to the pointer. Body links, note
 * citations, pictures and form fields then get their own events, and the pointer geometry
 * decides when the story opens. The hover target is a separate box over the margin part
 * only, painted before the band so the tint stays under the story ink and never covers body
 * text. With no margin part there is no hover chrome; the activation band still opens it.
 */
export function appendHeaderFooterHoverChrome(
  document: Document,
  sheet: HTMLElement,
  band: HTMLElement,
  page: PageRecord,
  story: HeaderFooterStoryRecord,
  scale: number
): void {
  let anchor: LayoutBox = story.box;
  if (headerFooterOverlapsBody(page, story)) {
    band.dataset.docxHfOverBody = '';
    const margin = headerFooterMarginPart(page, story);
    if (!margin) return;
    const hover = document.createElement('div');
    hover.className = 'docx-hf-hover';
    hover.dataset.docxHfHover = story.kind;
    hover.setAttribute('contenteditable', 'false');
    hover.style.position = 'absolute';
    hover.style.left = `${(margin.x - page.box.x) * scale}px`;
    hover.style.top = `${(margin.y - page.box.y) * scale}px`;
    hover.style.width = `${margin.width * scale}px`;
    hover.style.height = `${margin.height * scale}px`;
    band.before(hover);
    anchor = margin;
  }
  const hint = document.createElement('div');
  hint.className = 'docx-hf-edit-hint';
  hint.dataset.docxHfHint = story.kind;
  hint.setAttribute('contenteditable', 'false');
  hint.style.position = 'absolute';
  hint.style.left = `${(anchor.x - page.box.x) * scale}px`;
  hint.style.width = `${anchor.width * scale}px`;
  hint.style.top =
    story.kind === 'header'
      ? `${(anchor.y + anchor.height - page.box.y) * scale}px`
      : `${(anchor.y - page.box.y) * scale}px`;
  if (story.kind === 'footer') hint.style.transform = 'translateY(-100%)';
  sheet.append(hint);
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
    // The sheet names the band being edited, so the stylesheet can dim the change bars of
    // every OTHER story alongside the content they stand beside (the overlay is a sibling
    // of the bands, not a child, so no band selector can reach it).
    delete element.dataset.docxHfActiveKind;
    for (const band of element.querySelectorAll<HTMLElement>(
      ':scope > .docx-hf:not(.docx-hf--placeholder)'
    )) {
      const story = storyOfBand(page, band);
      if (!story) continue;
      const active = headerFooterBandIsActive(story, page.index, chrome);
      if (active) element.dataset.docxHfActiveKind = story.kind;
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
