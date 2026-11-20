// A long document with tracked changes, one of them a property change that changes nothing,
// and a comparison of a live layout with the layout of the same document opened again.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { measuredParagraphTestRecorder } from '../../layout/paragraph-break-request.ts';
import { collectReviewItems, findNode, revisionItemsOf } from '../../store/index.ts';
import type { ReviewDisplayMode } from '../../contracts/editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const STAMP = 'w:author="Ada" w:date="2026-03-01T10:00:00Z"';

/** A property change that changes nothing: the queue lists no card for it. */
export const INERT = `<w:pPr><w:jc w:val="left"/><w:pPrChange w:id="1" ${STAMP}><w:pPr/></w:pPrChange></w:pPr>`;
/** A property change with a card. */
export const CENTERED = `<w:pPr><w:jc w:val="center"/><w:pPrChange w:id="2" ${STAMP}><w:pPr/></w:pPrChange></w:pPr>`;
const inserted = (id: number) =>
  `<w:ins w:id="${id}" ${STAMP}><w:r><w:t>An inserted sentence. </w:t></w:r></w:ins>`;

/** What stands at an index of the body: paragraph properties, leading content, or a block. */
export type Special = ReadonlyMap<number, { properties?: string; lead?: string; block?: string }>;

/**
 * One record with no card and six changes with a card, in seven paragraphs: more than a
 * decision patches one by one, so accepting them derives the whole queue again, and that queue
 * leaves no record out.
 */
export const CHANGES: Special = new Map([
  [60, { properties: INERT }],
  [62, { lead: inserted(3) }],
  [64, { lead: inserted(4) }],
  [66, { lead: inserted(5) }],
  [68, { lead: inserted(6) }],
  [70, { lead: inserted(7) }],
  [72, { properties: CENTERED }],
]);

/**
 * Two paragraphs that share one run-property record, with `text` in the second. The first
 * site turns bold off where nothing set it, which changes nothing. The second turns bold on,
 * so the record has a card until that run goes.
 */
export const SPLIT_RECORD_TEXT = 'second';
const sharedRun = (bold: string, text: string) =>
  `<w:r><w:rPr>${bold}<w:rPrChange w:id="9" ${STAMP}><w:rPr/></w:rPrChange></w:rPr><w:t>${text}</w:t></w:r>`;
export const SPLIT_RECORD: Special = new Map([
  [30, { block: `<w:p>${sharedRun('<w:b w:val="0"/>', 'first')}</w:p>` }],
  [
    32,
    {
      block: `<w:p><w:r><w:t xml:space="preserve">lead </w:t></w:r>${sharedRun('<w:b/>', SPLIT_RECORD_TEXT)}</w:p>`,
    },
  ],
]);

/** A table whose one cell holds a paragraph with the same record that changes nothing. */
export const TABLE_WITH_RECORD =
  '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>' +
  `<w:tr><w:tc><w:p><w:pPr><w:jc w:val="left"/><w:pPrChange w:id="8" ${STAMP}><w:pPr/></w:pPrChange></w:pPr>` +
  '<w:r><w:t>A paragraph in a table cell.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

export const PARAGRAPHS = 80;

export function docx(special: Special): Uint8Array {
  const body = Array.from({ length: PARAGRAPHS }, (_, index) => {
    const own = special.get(index);
    return (
      own?.block ??
      `<w:p>${own?.properties ?? ''}${own?.lead ?? ''}<w:r><w:t>Paragraph ${index} with enough words of text to fill more than one line of the page, so that its lines are worth keeping.</w:t></w:r></w:p>`
    );
  }).join('');
  const override = (part: string, type: string) =>
    `<Override PartName="/word/${part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `${override('document', 'document.main')}${override('styles', 'styles')}</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}/styles" Target="styles.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/styles.xml': strToU8(
      `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`
    ),
  });
}

export function mountBytes(bytes: Uint8Array) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    author: 'Ada',
    document: bytes,
    modules: [
      {
        id: 'review',
        review: {
          displayModes: ['all-markup', 'simple-markup', 'proposed', 'original'],
          collectReviewItems,
          revisionItemsOfParagraph: (part, id) => {
            const paragraph = findNode(part, id);
            return paragraph?.kind === 'paragraph'
              ? revisionItemsOf({ ...part, root: paragraph })
              : [];
          },
        },
      },
    ],
  });
  const surface = editor.surface;
  if (!surface) throw new Error('surface failed to mount');
  surface.layout();
  return {
    editor,
    surface,
    container,
    ids: surface.session.paragraphIds(),
    listed: () => editor.getReviewItems({ pairReplacements: false, placement: false }).length,
    acceptAll() {
      this.run({ type: 'resolveAllReviewChanges', action: 'accept' });
    },
    /** Select `start` to `end` in the paragraph at `index`; a caret at its start by default. */
    select(index: number, start = 0, end = start) {
      const paragraphId = this.ids[index]!;
      surface.setSelection({
        anchor: { paragraphId, offset: start },
        head: { paragraphId, offset: end },
      });
    },
    /** Run a command that must succeed, then lay out. */
    run(command: Parameters<typeof editor.exec>[0]) {
      expect(editor.exec(command).ok).toBe(true);
      surface.layout();
    },
    [Symbol.dispose]: () => {
      editor.destroy();
      container.remove();
    },
  };
}

export type View = ReturnType<typeof mountBytes>;

export const mount = (special: Special): View => mountBytes(docx(special));

/**
 * The ids of the paragraphs that `run` broke into lines again, without those at `allowed`
 * indexes. The recorder covers every step of `run`, so a step that lays the whole document out
 * shows here whichever step it is.
 */
export function measuredOutside(
  view: View,
  allowed: Iterable<number>,
  run: () => void
): readonly string[] {
  const expected = new Set([...allowed].map((index) => view.ids[index]!));
  const measured = measuredParagraphTestRecorder();
  try {
    run();
    view.surface.layout();
    return [...new Set(measured.paragraphIds.filter((id) => !expected.has(id)))];
  } finally {
    measured.dispose();
  }
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** Keys that name a node or a record. A document opened again gives its nodes other ids. */
const NAMES = /^(id|range|revision|date|key)$|Id$|Ids$|Key$/;

/**
 * Everything a layout places: each box, baseline, and offset to 0.01 pt, each piece of text,
 * and the markup each piece carries, in page order.
 */
function geometryOf(value: unknown, out: string[], depth = 0): void {
  if (depth > 64 || value === null || value === undefined) return;
  if (typeof value === 'number') out.push(String(round(value)));
  else if (typeof value === 'string' || typeof value === 'boolean') out.push(String(value));
  else if (Array.isArray(value)) for (const item of value) geometryOf(item, out, depth + 1);
  else if (typeof value === 'object') {
    // By key: an attribute list reads back in the order its file has, which is no geometry.
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [key, item] of entries) {
      if (NAMES.test(key)) continue;
      out.push(key);
      geometryOf(item, out, depth + 1);
    }
  }
}

/** What the page paints as markup: the change bars and the text of each marked run. */
function markupOf(container: HTMLElement): { bars: number; marked: string[] } {
  return {
    bars: container.querySelectorAll('.docx-change-bar').length,
    marked: [...container.querySelectorAll<HTMLElement>('.docx-revision')].map(
      (element) => element.textContent ?? ''
    ),
  };
}

export interface FreshComparison {
  /** Lines the live layout holds. */
  readonly lines: number;
  readonly bars: number;
  readonly marked: readonly string[];
}

/**
 * Expect the live layout of `view` to be the layout of its saved document opened again, in
 * the same view and with the same authors hidden: the same geometry and the same markup.
 */
export function compareFresh(
  view: View,
  options: { mode?: ReviewDisplayMode; hidden?: readonly string[] } = {}
): FreshComparison {
  const live = view.surface.layout();
  using fresh = mountBytes(view.surface.save());
  if (options.mode && options.mode !== 'all-markup')
    expect(fresh.editor.exec({ type: 'setReviewDisplayMode', mode: options.mode }).ok).toBe(true);
  for (const author of options.hidden ?? []) fresh.editor.setReviewAuthorVisible(author, false);
  const again = fresh.surface.layout();
  const liveGeometry: string[] = [];
  const freshGeometry: string[] = [];
  geometryOf(live.pages, liveGeometry);
  geometryOf(again.pages, freshGeometry);
  const lines = liveGeometry.filter((entry) => entry === 'baseline').length;
  // The comparison holds real content: at least one line for each paragraph, on several pages.
  expect(lines).toBeGreaterThanOrEqual(PARAGRAPHS);
  expect(live.pages.length).toBeGreaterThan(1);
  expect(liveGeometry.join('\n')).toBe(freshGeometry.join('\n'));
  const markup = markupOf(view.container);
  expect(markup).toEqual(markupOf(fresh.container));
  return { lines, ...markup };
}
