// The header/footer layer of a painted sheet.
//
// Header and footer content forms one layer UNDER the main document. A drawing in a
// header or footer is ordered against the header or footer text by its own `behindDoc`, and
// never against the body: the whole layer, its in-front drawings included, paints before the
// body's behind-text drawings, the body text and the body's in-front drawings. A shaded
// letterhead rectangle set in front of text that reaches into the body therefore stays
// behind every body line it crosses.
//
// The sheet's child order is the paint order, so this module appends the layer where the
// page painter calls it and hands back the edit pills, which belong on top of the sheet.

import type {
  BlockFragmentRecord,
  HeaderFooterStoryRecord,
  LayoutBox,
  PageRecord,
} from '../layout/semantic-records.ts';
import type { AnchoredDrawingRecord } from '../layout/drawing-layout.ts';
import { headerFooterAnchoredDrawingOrigin } from '../layout/header-footer-drawing-origin.ts';
import {
  compareDrawingStackOrder,
  paintLayerOf,
  shiftAnchoredDrawing,
} from '../layout/drawing-overlap.ts';
import {
  appendHeaderFooterHoverChrome,
  headerFooterBandHeightPt,
  headerFooterBandIsActive,
  type HeaderFooterPaintChrome,
} from './semantic-paint-hf-chrome.ts';

/** What the layer needs from the page painter, bound to its paint context. */
export interface HeaderFooterLayerPainter {
  readonly chrome: HeaderFooterPaintChrome & { readonly scale: number };
  /** One story fragment painted as inert furniture, tab leaders measured from `tabOriginXPt`. */
  paintFragment(fragment: BlockFragmentRecord, tabOriginXPt: number): HTMLElement;
  /** One anchored drawing layer, appended to `parent` when it has any ink. */
  appendDrawings(
    parent: HTMLElement,
    drawings: readonly AnchoredDrawingRecord[],
    origin: LayoutBox,
    layer: 'behind' | 'inFront',
    interactive: boolean,
    hfFrontKind?: 'header' | 'footer'
  ): void;
}

function isPageRelativeHfAnchor(drawing: AnchoredDrawingRecord): boolean {
  return drawing.horizontalPageLeft !== undefined || drawing.verticalPageTop !== undefined;
}

function hfAnchorOnPageSheet(
  story: HeaderFooterStoryRecord,
  drawing: AnchoredDrawingRecord,
  pageBox: { readonly x: number; readonly y: number }
): AnchoredDrawingRecord {
  // Layout resolves page-frame axes in page-CONTENT coordinates; the record's frame origin is
  // the page edge in that space (−margin), so the sheet position needs the page box, not the
  // story box — a footer story's own Y would double-count most of the page height. Axes on
  // story-relative frames keep the story box base.
  const absoluteOrigin = headerFooterAnchoredDrawingOrigin(drawing, story.box, pageBox);
  // Every geometry field moves together, the corners of a group picture included; a field
  // left behind paints at the story offset.
  return shiftAnchoredDrawing(drawing, absoluteOrigin.x - drawing.x, absoluteOrigin.y - drawing.y);
}

/**
 * Every header/footer BEHIND drawing, lifted onto the sheet and clipped to it.
 *
 * Both frames go through `hfAnchorOnPageSheet`: it resolves a page-frame axis against the
 * page box and a story-relative one against the story box, which is what makes one layer
 * able to carry both. Inert always — furniture behind the body must never take a click
 * meant for the text over it, and the band, not this layer, is what editing activates.
 */
function appendHfBehindDrawingLayer(
  document: Document,
  sheet: HTMLElement,
  story: HeaderFooterStoryRecord,
  painter: HeaderFooterLayerPainter,
  pageOrigin: LayoutBox
): void {
  const drawings = story.anchoredDrawings ?? [];
  if (drawings.length === 0) return;
  const lifted = drawings.map((drawing) => hfAnchorOnPageSheet(story, drawing, pageOrigin));
  // The wrapper spans the sheet exactly, so `overflow: hidden` on it is the paper edge:
  // furniture ink can reach anywhere on this page and nowhere on the next.
  const clip = document.createElement('div');
  clip.className = 'docx-hf-behind-layer';
  clip.dataset.docxHfBehind = story.kind;
  clip.setAttribute('contenteditable', 'false');
  clip.style.position = 'absolute';
  clip.style.inset = '0';
  clip.style.overflow = 'hidden';
  clip.style.pointerEvents = 'none';
  painter.appendDrawings(clip, lifted, pageOrigin, 'behind', false);
  if (clip.childElementCount > 0) sheet.append(clip);
}

/** One run of in-front drawings that share a frame, lowest first. */
interface HfFrontRun {
  readonly pageRelative: boolean;
  readonly drawings: AnchoredDrawingRecord[];
}

/** A story's in-front drawings, split between the band and the sheet. */
interface HfFrontDrawings {
  /** Runs for the band, lowest first: all drawings up to the top story-relative one. */
  readonly band: readonly HfFrontRun[];
  /** The page-frame drawings above all story-relative ones; they paint on the sheet. */
  readonly sheet: readonly AnchoredDrawingRecord[];
}

/**
 * Split a story's in-front drawings between the band and the sheet, and keep their stack
 * order. `relativeHeight` on `wp:anchor` (CT_Anchor; ECMA-376 Part 1, 20.4.2.3) gives the
 * z-order of a drawing among the drawings of its layer, for all position frames. The band
 * paints below the sheet layer, so a page-frame drawing below a story-relative one must
 * paint in the band. Otherwise a full-page header picture covers a text box that the file
 * puts above it.
 */
function splitHfFrontDrawings(story: HeaderFooterStoryRecord): HfFrontDrawings {
  const front = (story.anchoredDrawings ?? [])
    .filter((drawing) => paintLayerOf(drawing) === 'inFront')
    .sort(compareDrawingStackOrder);
  let top = front.length - 1;
  while (top >= 0 && isPageRelativeHfAnchor(front[top]!)) top -= 1;
  const band: HfFrontRun[] = [];
  for (const drawing of front.slice(0, top + 1)) {
    const pageRelative = isPageRelativeHfAnchor(drawing);
    const last = band[band.length - 1];
    if (last && last.pageRelative === pageRelative) last.drawings.push(drawing);
    else band.push({ pageRelative, drawings: [drawing] });
  }
  return { band, sheet: front.slice(top + 1) };
}

/** The band: the story's text and the in-front drawings up to its top story-relative one. */
function appendHfBand(
  document: Document,
  sheet: HTMLElement,
  page: PageRecord,
  story: HeaderFooterStoryRecord,
  painter: HeaderFooterLayerPainter,
  active: boolean,
  split: HfFrontDrawings
): HTMLElement {
  const { scale } = painter.chrome;
  const storyOrigin = Object.freeze({
    x: 0,
    y: 0,
    width: story.box.width,
    height: story.box.height,
  });
  // A lifted drawing holds sheet coordinates; the band's own origin on the sheet removes them.
  const bandOnSheet = Object.freeze({ ...storyOrigin, x: story.box.x, y: story.box.y });
  const container = document.createElement('div');
  container.className = 'docx-hf';
  container.dataset.docxHf = story.kind;
  if (story.rId) container.dataset.docxRId = story.rId;
  if (active) {
    container.dataset.docxHfActive = '';
    container.setAttribute('contenteditable', 'true');
  } else {
    container.setAttribute('contenteditable', 'false');
  }
  container.style.position = 'absolute';
  container.style.left = `${(story.box.x - page.box.x) * scale}px`;
  container.style.top = `${(story.box.y - page.box.y) * scale}px`;
  container.style.width = `${story.box.width * scale}px`;
  // A footer whose only direct content is the empty paragraph hosting a floating shape
  // flows to a hairline, which makes the ACTIVE edit band invisible. Editing extends the
  // band down to the sheet edge — origin unchanged, so fragment and caret geometry stay
  // put, and normal-mode sizing keeps the flow-height rule (#856) intact.
  container.style.height = `${headerFooterBandHeightPt(story, page, active) * scale}px`;
  // VISIBLE, exactly because the box is sized by flow height alone (#856). Header ink
  // lands wherever it is placed — a negative indent hangs into the left margin, an
  // anchored shape offset past the content width sits in the right margin and reaches
  // below the header text. Clipping to the band silently deleted both. The band's
  // GEOMETRY still stops at flow height, so hit-testing and the body's effective top
  // margin are untouched; overflowing drawings stay inert below via `interactive`.
  container.style.overflow = 'visible';
  // BUT NEVER PAST THE PAPER. Ink is clipped at the sheet edge, and the band's own
  // records are story-relative: a footer shape anchored far above its paragraph, or a
  // header one reaching far below, resolves to a paint box that runs off the sheet and
  // would paint across the inter-page gutter onto the neighbouring page. The clip is the
  // SHEET expressed in the band's own coordinates, so ink still escapes the band (the
  // whole point) and still stops at the paper.
  const sheetLeft = (page.box.x - story.box.x) * scale;
  const sheetTop = (page.box.y - story.box.y) * scale;
  const sheetRight = sheetLeft + page.box.width * scale;
  const sheetBottom = sheetTop + page.box.height * scale;
  container.style.clipPath =
    `polygon(${sheetLeft}px ${sheetTop}px, ${sheetRight}px ${sheetTop}px, ` +
    `${sheetRight}px ${sheetBottom}px, ${sheetLeft}px ${sheetBottom}px)`;
  for (const fragment of story.fragments) {
    container.append(painter.paintFragment(fragment, story.box.x - page.box.x));
  }
  // Page-frame drawings that sit below a story-relative one paint here too, in stack order.
  for (const run of split.band) {
    if (run.pageRelative) {
      const lifted = run.drawings.map((drawing) => hfAnchorOnPageSheet(story, drawing, page.box));
      painter.appendDrawings(container, lifted, bandOnSheet, 'inFront', active);
    } else {
      painter.appendDrawings(container, run.drawings, storyOrigin, 'inFront', active);
    }
  }
  sheet.append(container);
  return container;
}

/**
 * Paint the header and footer layer onto `sheet`, and return the edit pills.
 *
 * The caller appends the pills after the body, so a hover invitation is never covered by the
 * body text it sits beside.
 */
export function paintHeaderFooterLayer(
  document: Document,
  sheet: HTMLElement,
  page: PageRecord,
  painter: HeaderFooterLayerPainter
): HTMLElement[] {
  const pageOrigin = Object.freeze({
    x: page.box.x,
    y: page.box.y,
    width: page.box.width,
    height: page.box.height,
  });
  const stories = [page.header, page.footer].filter(
    (story): story is HeaderFooterStoryRecord => !!story
  );
  // Behind-text ink of both stories first, then each story's text and in-front ink.
  for (const story of stories)
    appendHfBehindDrawingLayer(document, sheet, story, painter, pageOrigin);
  const hints: HTMLElement[] = [];
  for (const story of stories) {
    // Furniture ink is inert while the band is not being edited, wherever on the sheet it
    // was lifted to.
    const active = headerFooterBandIsActive(story, page.index, painter.chrome);
    const split = splitHfFrontDrawings(story);
    const band = appendHfBand(document, sheet, page, story, painter, active, split);
    // The hover target goes right before the band; the pill, if any, comes back to the caller.
    const hint = appendHeaderFooterHoverChrome(document, band, page, story, painter.chrome.scale);
    if (hint) hints.push(hint);
    const pageRelative = split.sheet.map((drawing) =>
      hfAnchorOnPageSheet(story, drawing, pageOrigin)
    );
    painter.appendDrawings(sheet, pageRelative, pageOrigin, 'inFront', active, story.kind);
  }
  return hints;
}
