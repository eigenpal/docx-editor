/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The All Markup page with comments: each page shrinks to make room for a markup pane on its
// right, where every comment shows as a balloon tied to its range by a dotted connector.
//
// Measurements, in page points before the page shrinks:
// - The pane starts 9.1pt right of the text area's right edge (or of wider content) and is
//   257.3pt wide. It covers the full page height.
// - The scale fits the page and pane, with 10.5pt to spare, into the sheet's width. It is
//   rounded down to a third of a percent. The shrunk page is centered vertically and starts
//   0.96pt from the sheet's left edge.
// - A balloon spans from 22.3pt inside the pane to 4.6pt before its right edge. Its top is
//   level with the top of its range, below the balloon before it.
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFonts,
  rgb,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import type { ExportSemanticLayout } from '@docx-editor.dev/core/export';
import type { LayoutBox, SemanticCommentArtifactRecord } from '@docx-editor.dev/core/layout';
import { onDeviceGrid, type Work } from './context.ts';
import { AUTHOR_PALETTE } from './revision-markup.ts';

const PANE_GAP = 9.1;
const PANE_WIDTH = 257.3;
const SPARE = 10.5;
const SHEET_LEFT = 0.96;
const BALLOON_INSET = 22.3;
const BALLOON_END = 4.6;
const CONNECTOR_TURN = 4.4;
const FONT_SIZE = 9;
const LINE_HEIGHT = 11.04;
const PAD_Y = 1.92;
const PAD_X = 4.5;
const BALLOON_GAP = 0.96;
/** A balloon starts this far above the line it sits beside. */
const BALLOON_RISE = 0.6;
/** From a balloon's top to its first baseline. */
const FIRST_BASELINE = 10.7;
const PANE_GRAY = '0.949 0.949 0.949';
const MAX_BALLOON_LINES = 40;
/** Characters of comment text a balloon reads; 40 lines hold far fewer. */
const MAX_BALLOON_TEXT = 4096;

/** How one page is placed on its sheet. */
export interface MarkupPanePlacement {
  readonly scale: number;
  /** Sheet-space offsets of the page's top-left corner. */
  readonly left: number;
  readonly top: number;
  /** The pane's left edge in page points. */
  readonly paneLeft: number;
}

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function parseHex(hex: string): Rgb {
  const n = Number.parseInt(hex, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function mix(color: Rgb, weight: number): Rgb {
  const toward = (c: number) => c * weight + (1 - weight);
  return { r: toward(color.r), g: toward(color.g), b: toward(color.b) };
}

const op = (c: Rgb): string => `${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}`;
const n = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : '0');

/**
 * Whether the export draws the markup pane: All Markup with comments shown, and a comment in
 * the body to show. A comment only in a header, a footer, or a note keeps its annotation.
 */
export function hasMarkupPane(layout: ExportSemanticLayout, includeComments: boolean): boolean {
  return (
    includeComments &&
    layout.displayMode === 'all-markup' &&
    layout.reviewArtifacts.some(
      (artifact) =>
        artifact.kind === 'comment' &&
        artifact.occurrences.some(
          (occurrence) =>
            occurrence.rootStory === 'body' &&
            (occurrence.geometry?.pageStack ?? []).some(isAnchorBox)
        )
    )
  );
}

/** The right edge the pane is placed against on one page: the text area, or a wider table. */
function pageContentRight(page: ExportSemanticLayout['pages'][number]): number {
  const width = page.box.width;
  let right = page.contentBox.x + page.contentBox.width - page.box.x;
  for (const fragment of page.fragments) {
    if (fragment.kind !== 'table') continue;
    const edge = fragment.box.x + fragment.box.width - page.box.x;
    if (edge > right && edge <= width) right = edge;
  }
  return right;
}

/** Placement of every page, or null when the export draws no markup pane. */
export function markupPanePlacements(
  layout: ExportSemanticLayout,
  includeComments: boolean
): readonly MarkupPanePlacement[] | null {
  if (!hasMarkupPane(layout, includeComments)) return null;
  // Pages of one width share one pane position, so a landscape section's wider text area
  // does not shrink the portrait pages around it.
  const rightByWidth = new Map<number, number>();
  for (const page of layout.pages) {
    const key = Math.round(page.box.width * 100);
    rightByWidth.set(key, Math.max(rightByWidth.get(key) ?? 0, pageContentRight(page)));
  }
  return layout.pages.map((page) => {
    const width = page.box.width;
    // The sheet height the page stream uses, so the pane and the page share one origin.
    const height = onDeviceGrid(page.box.height);
    const paneLeft = rightByWidth.get(Math.round(width * 100))! + PANE_GAP;
    // A page with room for the pane beside it keeps its size: it never grows.
    const scale = Math.min(1, Math.floor((300 * width) / (paneLeft + PANE_WIDTH + SPARE)) / 300);
    return { scale, left: SHEET_LEFT, top: (height - scale * height) / 2, paneLeft };
  });
}

/** The `cm` operator that draws page content into its shrunk place on the sheet. */
export function markupPaneMatrix(placement: MarkupPanePlacement, sheetHeight: number): string {
  const { scale, left, top } = placement;
  // Six places: balloon text and annotations use the exact scale, and three would move them
  // by up to a third of a point against the page.
  const f = (v: number) => v.toFixed(6);
  return `${f(scale)} 0 0 ${f(scale)} ${f(left)} ${f(sheetHeight - top - scale * sheetHeight)} cm`;
}

/** A page point, in sheet space, on a shrunk page. */
export function sheetPoint(
  placement: MarkupPanePlacement,
  sheetHeight: number,
  x: number,
  y: number
): [number, number] {
  const { scale, left, top } = placement;
  return [left + scale * x, sheetHeight - top - scale * sheetHeight + scale * y];
}

interface Balloon {
  readonly comment: SemanticCommentArtifactRecord;
  readonly label: string;
  readonly boxes: readonly LayoutBox[];
  readonly mark: Rgb;
  readonly fill: Rgb;
}

/** One commented range on one page: every page a range crosses shows its marks. */
interface RangeMark {
  readonly boxes: readonly LayoutBox[];
  readonly mark: Rgb;
  readonly fill: Rgb;
  /** This part opens the whole range: a tick marks its left edge. */
  readonly opens: boolean;
  /** This part closes the whole range: a tick marks its right edge. */
  readonly closes: boolean;
}

interface PageComments {
  readonly balloons: Balloon[];
  readonly ranges: RangeMark[];
}

/** Text a standard PDF font can encode; other characters become `?` and are counted. */
function encodable(font: PDFFont, text: string, missing: { count: number }): string {
  let out = '';
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
      missing.count += 1;
    }
  }
  return out;
}

function wrap(
  words: readonly { text: string; font: PDFFont }[],
  width: number
): { text: string; font: PDFFont; x: number; line: number }[] {
  const placed: { text: string; font: PDFFont; x: number; line: number }[] = [];
  let x = 0;
  let line = 0;
  // A word wider than the balloon breaks between its characters.
  const pieces = words.flatMap((word) =>
    word.font.widthOfTextAtSize(word.text, FONT_SIZE) > width
      ? Array.from(word.text, (text) => ({ text, font: word.font }))
      : [word]
  );
  for (const word of pieces) {
    const w = word.font.widthOfTextAtSize(word.text, FONT_SIZE);
    if (x > 0 && x + w > width) {
      line += 1;
      x = 0;
      if (line >= MAX_BALLOON_LINES) break;
      if (word.text === ' ') continue;
    }
    placed.push({ ...word, x, line });
    x += w;
  }
  return placed;
}

/**
 * Comment range marks in page points: the range's tint on every line it covers, and a thin
 * tick where the whole range starts and where it ends.
 */
export function commentRangeCommands(
  layout: ExportSemanticLayout,
  pageIndex: number,
  sheetHeight: number,
  authorSlots: ReadonlyMap<string, number>
): string[] {
  const record = layout.pages[pageIndex];
  if (!record) return [];
  const out: string[] = [];
  for (const balloon of commentsOn(layout, pageIndex, authorSlots).ranges) {
    const y = (box: LayoutBox) => sheetHeight - (box.y - record.box.y);
    for (const box of balloon.boxes) {
      if (box.width <= 0) continue;
      const x = box.x - record.box.x;
      out.push(
        `${op(balloon.fill)} rg ${n(x)} ${n(y(box) - box.height)} ${n(box.width)} ${n(box.height)} re f`
      );
    }
    const first = balloon.boxes[0]!;
    const last = balloon.boxes[balloon.boxes.length - 1]!;
    const ticks: [LayoutBox, number][] = [];
    if (balloon.opens) ticks.push([first, first.x - record.box.x]);
    if (balloon.closes) ticks.push([last, last.x + last.width - record.box.x]);
    if (ticks.length) out.push(`${op(balloon.mark)} RG 0.24 w`);
    for (const [box, x] of ticks)
      out.push(`${n(x)} ${n(y(box) - box.height)} m ${n(x)} ${n(y(box))} l S`);
  }
  // Painted over the page with a multiply blend: cell shading cannot hide the tint, and the
  // text over it stays as dark as it was.
  return out.length ? ['q', `/${MULTIPLY} gs`, ...out, 'Q'] : [];
}

const MULTIPLY = 'DocxMarkupMultiply';

/** Adds the blend state that comment range marks use to a page's resources. */
export function addRangeBlend(page: PDFPage): void {
  page.node.setExtGState(
    PDFName.of(MULTIPLY),
    page.doc.context.obj({ Type: 'ExtGState', BM: 'Multiply' })
  );
}

type CommentRecord = Extract<ExportSemanticLayout['reviewArtifacts'][number], { kind: 'comment' }>;

const hundredths = (value: number) => Math.round(value * 100) / 100;

/**
 * Comments in the order their ranges end in the body, where each comment's reference mark
 * stands; that is the order they are numbered in. A range nested in another ends first, so it
 * comes first. Comments that end at the same place follow the order of their reference marks
 * in the body, and otherwise keep the order they are listed in. A reply without a range of
 * its own keeps its place after its parent, and a comment outside the body keeps its place
 * after the rest.
 */
export function commentsInOrder(layout: ExportSemanticLayout): CommentRecord[] {
  type Key = readonly [page: number, y: number, x: number];
  const later = (a: Key, b: Key) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const keys = new Map<string, Key>();
  const comments: CommentRecord[] = [];
  for (const artifact of layout.reviewArtifacts) {
    if (artifact.kind !== 'comment') continue;
    comments.push(artifact);
    // Occurrences come in document order, so the last one holds the end of the range, also
    // when a split table row carries an earlier cell onto a later page.
    for (const occurrence of artifact.occurrences) {
      if (occurrence.rootStory !== 'body') continue;
      const boxes = (occurrence.geometry?.pageStack ?? []).filter(isAnchorBox);
      const last = boxes[boxes.length - 1];
      if (!last) continue;
      // Rounded, so two ranges that end at the same character tie despite float noise.
      keys.set(artifact.id, [
        occurrence.pageIndex,
        hundredths(last.y),
        hundredths(last.x + last.width),
      ]);
    }
  }
  for (const artifact of comments) {
    if (keys.has(artifact.id) || !artifact.parentId) continue;
    const parent = keys.get(artifact.parentId);
    if (parent) keys.set(artifact.id, parent);
  }
  const none: Key = [Infinity, 0, 0];
  // A comment with no mark sorts after the marked ones, so the order stays consistent.
  const byMark = ({ referenceOrder: a }: CommentRecord, { referenceOrder: b }: CommentRecord) =>
    a === undefined ? (b === undefined ? 0 : 1) : b === undefined ? -1 : a - b;
  // `sort` is stable: comments that end together with no marks to tell them apart keep their
  // order, and a reply without a range or a mark stays after its parent.
  return comments.sort(
    (a, b) => later(keys.get(a.id) ?? none, keys.get(b.id) ?? none) || byMark(a, b)
  );
}

/**
 * A box a comment can stand beside: a line it covers, or the point a comment without a range
 * marks, which has no width.
 */
function isAnchorBox(box: LayoutBox): boolean {
  return box.height > 0 && box.width >= 0;
}

/** Comments by page, per paint: one paint's author slots color its revisions and comments. */
const commentCache = new WeakMap<ReadonlyMap<string, number>, Map<number, PageComments>>();

/**
 * The comments on one page: a balloon beside the end of each range, and the range marks on
 * every page its range crosses. Comments, replies included, are numbered in one sequence in
 * the order their ranges end, after the initials the document declares (`[AB2]`, or `[2]`
 * without initials), and their balloons stack down the pane in that order. A reply without a
 * range of its own follows its parent. An author's comments take the color of that author's
 * revisions.
 */
function commentsOn(
  layout: ExportSemanticLayout,
  pageIndex: number,
  authorSlots: ReadonlyMap<string, number>
): PageComments {
  let byPage = commentCache.get(authorSlots);
  if (!byPage) {
    const pages = new Map<number, PageComments>();
    byPage = pages;
    commentCache.set(authorSlots, pages);
    const on = (index: number): PageComments => {
      let entry = pages.get(index);
      if (!entry) pages.set(index, (entry = { balloons: [], ranges: [] }));
      return entry;
    };
    const anchors = new Map<string, { pageIndex: number; boxes: readonly LayoutBox[] }>();
    let number = 0;
    for (const artifact of commentsInOrder(layout)) {
      number += 1;
      const label = `Commented [${artifact.declaredInitials ?? ''}${number}]: `;
      const slot = authorSlots.get(artifact.author) ?? 0;
      const [markHex, fillHex] = AUTHOR_PALETTE[slot % AUTHOR_PALETTE.length]!;
      const base = { mark: parseHex(markHex), fill: parseHex(fillHex) };
      // A resolved comment is drawn faded.
      const colors = artifact.resolved
        ? { mark: mix(base.mark, 0.25), fill: mix(base.mark, 0.06) }
        : base;
      // The balloon sits beside the end of the range, on the page where the range ends: the
      // page of its last occurrence in document order.
      let end: { pageIndex: number; boxes: readonly LayoutBox[] } | undefined;
      const parts = artifact.occurrences.flatMap((occurrence) => {
        const boxes = (occurrence.geometry?.pageStack ?? []).filter(isAnchorBox);
        return boxes.length && occurrence.rootStory === 'body'
          ? [{ pageIndex: occurrence.pageIndex, boxes }]
          : [];
      });
      for (const [index, occurrence] of parts.entries()) {
        const { boxes } = occurrence;
        on(occurrence.pageIndex).ranges.push({
          boxes,
          ...colors,
          opens: index === 0,
          closes: index === parts.length - 1,
        });
        end = {
          pageIndex: occurrence.pageIndex,
          boxes: end?.pageIndex === occurrence.pageIndex ? [...end.boxes, ...boxes] : boxes,
        };
      }
      // A reply usually has no range: its balloon follows its parent's.
      end ??= artifact.parentId ? anchors.get(artifact.parentId) : undefined;
      if (end) {
        on(end.pageIndex).balloons.push({ comment: artifact, label, boxes: end.boxes, ...colors });
        anchors.set(artifact.id, end);
      }
    }
  }
  return byPage.get(pageIndex) ?? { balloons: [], ranges: [] };
}

/** Fonts for balloon text, embedded once per document. */
export interface BalloonFonts {
  readonly label: PDFFont;
  readonly body: PDFFont;
}

export async function embedBalloonFonts(doc: PDFDocument): Promise<BalloonFonts> {
  return {
    label: await doc.embedFont(StandardFonts.TimesRomanBold),
    body: await doc.embedFont(StandardFonts.Helvetica),
  };
}

/**
 * The pane, its balloons and their connectors for one page. Shapes come back as page-point
 * operators for the shrunk page's stream; balloon text is drawn on the sheet directly.
 */
export function paintMarkupPane(
  layout: ExportSemanticLayout,
  pageIndex: number,
  placement: MarkupPanePlacement,
  fonts: BalloonFonts,
  work: Work,
  authorSlots: ReadonlyMap<string, number>
): {
  /** The pane itself, painted under the page so margin content stays visible on it. */
  readonly under: string;
  readonly shapes: string[];
  readonly paintText: (page: PDFPage) => void;
} {
  const texts: ((page: PDFPage) => void)[] = [];
  const paintText = (page: PDFPage) => texts.forEach((draw) => draw(page));
  const record = layout.pages[pageIndex];
  if (!record) return { under: '', shapes: [], paintText };
  const height = onDeviceGrid(record.box.height);
  const { paneLeft, scale, left, top } = placement;
  const under = `${PANE_GRAY} rg ${n(paneLeft)} 0 ${n(PANE_WIDTH)} ${n(height)} re f`;
  const out: string[] = [];
  const missing = { count: 0 };
  let dropped = 0;
  const x0 = paneLeft + BALLOON_INSET;
  const x1 = paneLeft + PANE_WIDTH - BALLOON_END;
  const inner = x1 - x0 - 2 * PAD_X;
  let floor = 0;
  for (const balloon of commentsOn(layout, pageIndex, authorSlots).balloons) {
    work.tick();
    const words = [
      ...balloon.label
        .split(/(\s+)/)
        .filter(Boolean)
        .map((text) => ({ text: encodable(fonts.label, text, missing), font: fonts.label })),
      ...balloon.comment.text
        .slice(0, MAX_BALLOON_TEXT)
        .replace(/\s+/g, ' ')
        .trim()
        .split(/(\s+)/)
        .filter(Boolean)
        .map((text) => ({ text: encodable(fonts.body, text, missing), font: fonts.body })),
    ];
    const placed = wrap(words, inner);
    const lines = placed.reduce((count, word) => Math.max(count, word.line + 1), 1);
    const last = balloon.boxes[balloon.boxes.length - 1]!;
    const anchorTop = last.y - record.box.y;
    const boxTop = Math.max(anchorTop - BALLOON_RISE, floor);
    const boxHeight = lines * LINE_HEIGHT + 2 * PAD_Y;
    // A balloon that would run off the sheet is left out; its annotation keeps the comment.
    if (boxTop + boxHeight > height) {
      dropped += 1;
      continue;
    }
    floor = boxTop + boxHeight + BALLOON_GAP;
    const pdfY = (y: number) => height - y;
    // Dotted connector: along the foot of the range's last line, then to the balloon.
    const footY = last.y - record.box.y + last.height;
    const endX = last.x + last.width - record.box.x;
    const turnX = paneLeft - PANE_GAP + CONNECTOR_TURN;
    out.push(
      `${op(balloon.mark)} RG 0.24 w [0.72 0.72] 0 d`,
      `${n(endX)} ${n(pdfY(footY))} m ${n(turnX)} ${n(pdfY(footY))} l ${n(x0)} ${n(pdfY(boxTop + 6.1))} l S`,
      '[] 0 d'
    );
    // The balloon: a rounded box in the author's tint with an outline in the author's mark.
    const r = 3;
    const yTop = pdfY(boxTop);
    const yBottom = pdfY(boxTop + boxHeight);
    const k = r * 0.5523;
    const path =
      `${n(x0 + r)} ${n(yTop)} m ${n(x1 - r)} ${n(yTop)} l ` +
      `${n(x1 - r + k)} ${n(yTop)} ${n(x1)} ${n(yTop - r + k)} ${n(x1)} ${n(yTop - r)} c ` +
      `${n(x1)} ${n(yBottom + r)} l ` +
      `${n(x1)} ${n(yBottom + r - k)} ${n(x1 - r + k)} ${n(yBottom)} ${n(x1 - r)} ${n(yBottom)} c ` +
      `${n(x0 + r)} ${n(yBottom)} l ` +
      `${n(x0 + r - k)} ${n(yBottom)} ${n(x0)} ${n(yBottom + r - k)} ${n(x0)} ${n(yBottom + r)} c ` +
      `${n(x0)} ${n(yTop - r)} l ` +
      `${n(x0)} ${n(yTop - r + k)} ${n(x0 + r - k)} ${n(yTop)} ${n(x0 + r)} ${n(yTop)} c h`;
    out.push(`${op(balloon.fill)} rg ${op(balloon.mark)} RG 0.48 w ${path} B`);
    // Text goes straight onto the sheet, in sheet coordinates.
    const color = balloon.comment.resolved ? rgb(0.749, 0.749, 0.749) : rgb(0, 0, 0);
    for (const word of placed) {
      if (word.text.trim() === '') continue;
      const baseline = boxTop + FIRST_BASELINE + word.line * LINE_HEIGHT;
      texts.push((page) =>
        page.drawText(word.text, {
          x: left + scale * (x0 + PAD_X + word.x),
          y: page.getHeight() - (top + scale * baseline),
          size: FONT_SIZE * scale,
          font: word.font,
          color,
        })
      );
    }
  }
  if (dropped)
    work.report(
      'comment-balloon-overflow',
      `${dropped} comment balloon(s) do not fit beside the page; the comments remain annotations`,
      pageIndex,
      'information'
    );
  if (missing.count)
    work.report(
      'comment-balloon-text',
      'Comment balloons show characters outside Latin-1 as ?; the annotations keep the full text',
      pageIndex,
      'information'
    );
  return { under, shapes: out, paintText };
}

/** Move every annotation on a shrunk page to where its target now sits on the sheet. */
export function placeOnSheet(
  page: PDFPage,
  placement: MarkupPanePlacement,
  shown: ReadonlySet<string>
): void {
  const sheetHeight = page.getHeight();
  const { scale, left, top } = placement;
  const bottom = sheetHeight - top - scale * sheetHeight;
  // Tiling patterns live in the page's default space, not under the content's `cm`: give each
  // one the same transform, so its tiles shrink and move with the shape they fill.
  const patterns = page.node.Resources()?.lookupMaybe(PDFName.of('Pattern'), PDFDict);
  for (const [, ref] of patterns?.entries() ?? []) {
    const pattern = page.doc.context.lookup(ref);
    const dict = pattern instanceof PDFDict ? pattern : (pattern as { dict?: PDFDict })?.dict;
    if (dict && !dict.has(PDFName.of('Matrix')))
      dict.set(PDFName.of('Matrix'), page.doc.context.obj([scale, 0, 0, scale, left, bottom]));
  }
  const annots = page.node.Annots();
  if (!annots) return;
  for (let i = 0; i < annots.size(); i++) {
    const annot = annots.lookup(i, PDFDict);
    // A comment with a balloon shows there; its annotation keeps the text and the thread for
    // readers, without a second tint over the range or a note icon. A comment without one,
    // in a header, a footer, or a note, stays visible as it is.
    const name = annot.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString)?.decodeText();
    const id = name?.match(/^comment-(.*)-\d+$/)?.[1];
    if (id !== undefined && shown.has(id)) {
      const subtype = annot.get(PDFName.of('Subtype'));
      if (subtype === PDFName.of('Highlight')) annot.set(PDFName.of('CA'), PDFNumber.of(0));
      if (subtype === PDFName.of('Text')) {
        annot.set(PDFName.of('CA'), PDFNumber.of(0));
        const empty = page.doc.context.stream('', {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 0, 0],
        });
        annot.set(PDFName.of('AP'), page.doc.context.obj({ N: page.doc.context.register(empty) }));
      }
    }
    for (const key of ['Rect', 'QuadPoints']) {
      const array = annot.lookupMaybe(PDFName.of(key), PDFArray);
      if (!array) continue;
      for (let j = 0; j < array.size(); j++) {
        const value = array.lookupMaybe(j, PDFNumber);
        if (!value) continue;
        const v = value.asNumber();
        array.set(j, PDFNumber.of(j % 2 === 0 ? left + scale * v : bottom + scale * v));
      }
    }
  }
}

/** The ids of the comments the pane shows as balloons. */
export function commentsWithBalloons(
  layout: ExportSemanticLayout,
  authorSlots: ReadonlyMap<string, number>
): ReadonlySet<string> {
  const ids = new Set<string>();
  layout.pages.forEach((_, index) => {
    for (const balloon of commentsOn(layout, index, authorSlots).balloons)
      ids.add(balloon.comment.id);
  });
  return ids;
}
