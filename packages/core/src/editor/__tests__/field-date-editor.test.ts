// `fieldDate` on `createDocxEditor`: DATE and TIME fields show it in the body and in footers, the
// saved document keeps its results, and an editor without it shows the saved results. Print and
// PDF export pass it to the PDF handler with the saved bytes.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { runChromeExport, type ChromeExportView } from '../chrome-export.ts';
import { runChromePrint } from '../chrome-print.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { DocxEditorConfig } from '../docx-editor-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
/** Thursday 5 March 2026, 14:07 local time. */
const MOMENT = new Date(2026, 2, 5, 14, 7);

const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
const dateField = (picture: string, cached: string) =>
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve"> DATE \\@ "${picture}" </w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  text(cached) +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function letter(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/footer" Target="footer1.xml"/></Relationships>`
    ),
    'word/footer1.xml': strToU8(
      `<w:ftr xmlns:w="${W}"><w:p>${text('Printed ')}${dateField('dd/MM/yyyy', '01/01/2020')}</w:p></w:ftr>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        `<w:p>${dateField('d MMMM yyyy', '1 January 2020')}</w:p>` +
        '<w:sectPr><w:footerReference w:type="default" r:id="rId1"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
  });
}

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mount(config: Partial<DocxEditorConfig> = {}): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: letter(), ...config });
  editors.push(editor);
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

type Fragments = readonly { kind: string }[];
const textOf = (fragments: Fragments | undefined): string =>
  (fragments ?? [])
    .flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? (fragment as { lines: readonly { spans: readonly { text: string }[] }[] }).lines.flatMap(
            (line) => line.spans.map((span) => span.text)
          )
        : []
    )
    .join('');

function shown(editor: DocxEditorInstance): { body: string; footer: string } {
  const page = editor.surface!.layout().pages[0]!;
  return { body: textOf(page.fragments), footer: textOf(page.footer?.fragments) };
}

describe('fieldDate on createDocxEditor', () => {
  test('the default shows the saved results', () => {
    expect(shown(mount())).toEqual({ body: '1 January 2020', footer: 'Printed 01/01/2020' });
  });

  test('shows the date in the body and the footer', () => {
    expect(shown(mount({ fieldDate: MOMENT }))).toEqual({
      body: '5 March 2026',
      footer: 'Printed 05/03/2026',
    });
  });

  test('keeps the saved result in the document', () => {
    const editor = mount({ fieldDate: MOMENT });
    const xml = serializeOoxmlPart(editor.surface!.session.part());
    expect(xml).toContain('1 January 2020');
    expect(xml).not.toContain('March');
    expect(editor.surface!.session.bodyText()).not.toContain('March');
  });

  test('keeps the date it was created with when the host mutates its Date', () => {
    const date = new Date(MOMENT.getTime());
    const editor = mount({ fieldDate: date });
    date.setFullYear(2031);
    const surface = editor.surface!;
    const point = { paragraphId: surface.session.paragraphIds()[0]!, offset: 0 };
    surface.setSelection({ anchor: point, head: point });
    surface.type('x');
    expect(shown(editor).body).toBe('x5 March 2026');
    expect(shown(editor).footer).toBe('Printed 05/03/2026');
  });

  test('refuses a value that is not a valid date', () => {
    expect(() => mount({ fieldDate: new Date(Number.NaN) })).toThrow(TypeError);
    expect(() => mount({ fieldDate: '2026-03-05' as unknown as Date })).toThrow(TypeError);
  });

  test('refuses a date with editable saved results', () => {
    expect(() => mount({ fieldDate: MOMENT, fieldResults: 'editable' })).toThrow(
      /fieldResults: 'editable'/
    );
  });
});

const PDF = new TextEncoder().encode('%PDF-1.7\n');

/** A PDF handler that records the view and the bytes it receives. */
function recordingHandler() {
  const calls: { source: Uint8Array; view: ChromeExportView | undefined }[] = [];
  return {
    calls,
    handlers: {
      pdf: async (source: Uint8Array, view?: ChromeExportView) => {
        calls.push({ source, view });
        return { bytes: PDF };
      },
    },
  };
}

describe('fieldDate in print and PDF export', () => {
  test('getFieldDate answers a copy of the date, or undefined without one', () => {
    expect(mount().getFieldDate()).toBeUndefined();
    const date = new Date(MOMENT.getTime());
    const editor = mount({ fieldDate: date });
    date.setFullYear(2031);
    const first = editor.getFieldDate()!;
    expect(first.getTime()).toBe(MOMENT.getTime());
    first.setFullYear(2032);
    expect(editor.getFieldDate()!.getTime()).toBe(MOMENT.getTime());
    expect(shown(editor).body).toBe('5 March 2026');
  });

  test('PDF export passes the date in the view and keeps saved results in the bytes', async () => {
    const editor = mount({ fieldDate: MOMENT });
    const { calls, handlers } = recordingHandler();
    await runChromeExport(editor, 'pdf', handlers);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.view?.fieldDate?.getTime()).toBe(MOMENT.getTime());
    const saved = unzipSync(calls[0]!.source);
    const body = strFromU8(saved['word/document.xml']!);
    const footer = strFromU8(saved['word/footer1.xml']!);
    expect(body).toContain('1 January 2020');
    expect(footer).toContain('01/01/2020');
    expect(body + footer).not.toContain('2026');
  });

  test('print passes the date with the chosen print settings', async () => {
    const editor = mount({ fieldDate: MOMENT });
    const { calls, handlers } = recordingHandler();
    const job = await runChromePrint(editor, handlers, document, { comments: false });
    job.dispose();
    expect(calls[0]!.view?.fieldDate?.getTime()).toBe(MOMENT.getTime());
    expect(calls[0]!.view?.comments).toBe(false);
  });

  test('an editor without fieldDate leaves it out of the view', async () => {
    const { calls, handlers } = recordingHandler();
    await runChromeExport(mount(), 'pdf', handlers);
    expect(calls[0]!.view).toBeDefined();
    expect('fieldDate' in calls[0]!.view!).toBe(false);
  });
});
