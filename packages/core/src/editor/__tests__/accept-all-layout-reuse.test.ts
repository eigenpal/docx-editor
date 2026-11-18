// Accepting every change lays out only what changed. The queue leaves out property changes
// that change nothing, and its last such record goes with the accept; the paragraphs that held
// no change must keep their measured lines through that.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';
import { measuredParagraphTestRecorder } from '../../layout/paragraph-break-request.ts';
import { collectReviewItems, findNode, revisionItemsOf } from '../../store/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const STAMP = 'w:author="Ada" w:date="2026-03-01T10:00:00Z"';

/** A property change that changes nothing: the queue lists no card for it. */
const INERT = `<w:pPr><w:jc w:val="left"/><w:pPrChange w:id="1" ${STAMP}><w:pPr/></w:pPrChange></w:pPr>`;
/** A property change with a card. */
const CENTERED = `<w:pPr><w:jc w:val="center"/><w:pPrChange w:id="2" ${STAMP}><w:pPr/></w:pPrChange></w:pPr>`;
const inserted = (id: number) =>
  `<w:ins w:id="${id}" ${STAMP}><w:r><w:t>An inserted sentence. </w:t></w:r></w:ins>`;

type Special = ReadonlyMap<number, { properties?: string; lead?: string }>;
/**
 * One record with no card and six changes with a card, in seven paragraphs: more than a
 * decision patches one by one, so accepting them derives the whole queue again, and that queue
 * leaves no record out.
 */
const CHANGES: Special = new Map([
  [60, { properties: INERT }],
  [62, { lead: inserted(3) }],
  [64, { lead: inserted(4) }],
  [66, { lead: inserted(5) }],
  [68, { lead: inserted(6) }],
  [70, { lead: inserted(7) }],
  [72, { properties: CENTERED }],
]);

function docx(special: Special): Uint8Array {
  const body = Array.from({ length: 80 }, (_, index) => {
    const own = special.get(index);
    return `<w:p>${own?.properties ?? ''}${own?.lead ?? ''}<w:r><w:t>Paragraph ${index} with enough words of text to fill more than one line of the page, so that its lines are worth keeping.</w:t></w:r></w:p>`;
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

function mount(special: Special) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    author: 'Ada',
    document: docx(special),
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
    ids: surface.session.paragraphIds(),
    listed: () => editor.getReviewItems({ pairReplacements: false, placement: false }).length,
    [Symbol.dispose]: () => {
      editor.destroy();
      container.remove();
    },
  };
}

test('accept all measures only the paragraphs that held a change', () => {
  using view = mount(CHANGES);
  // The inert record has no card; each other change has one.
  expect(view.listed()).toBe(CHANGES.size - 1);
  const fullPasses = view.surface.state().perf.fullPasses;
  const measured = measuredParagraphTestRecorder();
  try {
    expect(view.editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(true);
    view.surface.layout();
    expect(view.listed()).toBe(0);
    const changed = new Set([...CHANGES.keys()].map((index) => view.ids[index]!));
    expect(measured.paragraphIds.length).toBeGreaterThan(0);
    expect(measured.paragraphIds.filter((id) => !changed.has(id))).toEqual([]);
    // The pass resumed at the first change. It did not lay the document out from the top.
    const perf = view.surface.state().perf;
    expect(perf.fullPasses).toBe(fullPasses);
    expect(perf.placed).toBeLessThan(perf.total / 2);
  } finally {
    measured.dispose();
  }
});

test('undo after accept all measures only the paragraphs that hold a change again', () => {
  using view = mount(CHANGES);
  expect(view.editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(true);
  view.surface.layout();
  const measured = measuredParagraphTestRecorder();
  try {
    expect(view.editor.exec({ type: 'undo' }).ok).toBe(true);
    view.surface.layout();
    expect(view.listed()).toBe(CHANGES.size - 1);
    const changed = new Set([...CHANGES.keys()].map((index) => view.ids[index]!));
    expect(measured.paragraphIds.filter((id) => !changed.has(id))).toEqual([]);
  } finally {
    measured.dispose();
  }
});

test('a left-out record that gets a card lays the document out under a new key', () => {
  using view = mount(new Map([[60, { properties: INERT }]]));
  expect(view.listed()).toBe(0);
  const at = { paragraphId: view.ids[60]!, offset: 0 };
  view.surface.setSelection({ anchor: at, head: at });
  const measured = measuredParagraphTestRecorder();
  try {
    // The recorded change is now a real one: the paragraph was left-aligned and is centered.
    expect(view.editor.exec({ type: 'setAlignment', align: 'center' }).ok).toBe(true);
    view.surface.layout();
    expect(view.listed()).toBe(1);
    // No block that was cached without the record may be served now, so each one is measured.
    expect(new Set(measured.paragraphIds).size).toBe(view.ids.length);
  } finally {
    measured.dispose();
  }
});

test('a property change after accept all lays the document out under the plain key', () => {
  using view = mount(CHANGES);
  expect(view.editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(true);
  view.surface.layout();
  view.surface.setEditingMode('suggest');
  const at = { paragraphId: view.ids[10]!, offset: 0 };
  view.surface.setSelection({ anchor: at, head: at });
  const measured = measuredParagraphTestRecorder();
  try {
    expect(view.editor.exec({ type: 'setAlignment', align: 'center' }).ok).toBe(true);
    view.surface.layout();
    expect(view.listed()).toBe(1);
    // The queue can leave a property change out, so the kept key ends with the first one.
    expect(new Set(measured.paragraphIds).size).toBe(view.ids.length);
  } finally {
    measured.dispose();
  }
});
