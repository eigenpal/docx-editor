// The rich clipboard, end to end on the painted surface (rich-clipboard-fidelity 3.3/4.2).
//
// Copy assembles both flavours from the live selection; paste routes the embedded
// fragment through the bounded package read, the resource merge, and one atomic
// `insertFragment` commit — and undo takes the whole landing back. Suggesting mode and
// force-plain land on the tracked/plain lanes instead.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { docx, mount, paragraph, putCaret } from './paginated-surface-fixtures.ts';

afterEach(() => {
  document.getSelection()?.removeAllRanges();
});

const RICH_BODY =
  '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
  '<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>plain</w:t></w:r></w:p>';

function copyRichFlavours(): { text: string; html: string | null } {
  const source = mount(RICH_BODY);
  putCaret(source.surface, 0);
  source.surface.selectAll();
  return source.surface.copyFlavours();
}

describe('rich copy', () => {
  test('copyFlavours writes plain text plus interop HTML carrying the fragment', () => {
    const flavours = copyRichFlavours();
    expect(flavours.text).toBe('bold\nplain');
    expect(flavours.html).not.toBeNull();
    expect(flavours.html!).toContain('data-docx-fragment="');
    expect(flavours.html!).toContain('data-docx-fragment-end="covered"');
    // The visible half keeps the resolved formatting for external receivers.
    expect(flavours.html!).toContain('font-weight');
    expect(flavours.html!).toContain('text-align');
  });

  test('a collapsed selection has nothing to copy', () => {
    const { surface } = mount(paragraph('hello'));
    putCaret(surface, 2);
    expect(surface.copyFlavours()).toEqual({ text: '', html: null });
  });
});

describe('full-document fidelity through the real surface', () => {
  // The store-level oracle builds coverage from the part tree; THIS test goes through
  // `fragmentCoverageOf` against the real layout, which omits paragraphs the reader
  // cannot select (TOC field machinery, `w:vMerge` continuation cells). Judging block
  // coverage against the raw tree flattened every vertically merged table and unwrapped
  // the TOC SDT on a real select-all copy - exactly what this pins.
  const SAMPLE = `${import.meta.dir}/../../../../../examples/vite/public/sample.docx`;

  test('select-all copy of the sample keeps merged tables, the TOC SDT, and numbering', () => {
    const bytes = new Uint8Array(readFileSync(SAMPLE));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const mounted = mountPaginatedSurface(container, bytes, { scale: 1 });
    if (!mounted.ok) throw new Error(mounted.reason);
    const source = mounted.surface;
    source.selectAll();
    const flavours = source.copyFlavours();
    expect(flavours.html).not.toBeNull();
    const sourceXml = serializeOoxmlPart(source.session.part());

    const container2 = document.createElement('div');
    document.body.appendChild(container2);
    const mounted2 = mountPaginatedSurface(container2, docx('<w:p/>'), { scale: 1 });
    if (!mounted2.ok) throw new Error(mounted2.reason);
    const target = mounted2.surface;
    target.pasteRich(flavours.text, flavours.html);
    const pastedXml = serializeOoxmlPart(target.session.part());

    const count = (xml: string, re: RegExp): number => (xml.match(re) ?? []).length;
    // Structure parity with the source part, through the PRODUCTION coverage path.
    expect(count(pastedXml, /<w:tbl>/g)).toBe(count(sourceXml, /<w:tbl>/g));
    expect(count(pastedXml, /<w:sdt>/g)).toBe(count(sourceXml, /<w:sdt>/g));
    expect(count(pastedXml, /<w:numPr>/g)).toBe(count(sourceXml, /<w:numPr>/g));
    expect(count(pastedXml, /vMerge/g)).toBe(count(sourceXml, /vMerge/g));
    expect(count(pastedXml, /gridSpan/g)).toBe(count(sourceXml, /gridSpan/g));

    // Every pasted list resolves against the target's numbering part.
    const pastedPkg = target.session.currentPackage();
    const numbering = pastedPkg.parts.get('/word/numbering.xml');
    expect(numbering).toBeDefined();
    const numberingXml = serializeOoxmlPart(numbering!);
    const usedNumIds = new Set(
      [...pastedXml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]!)
    );
    const definedNumIds = new Set(
      [...numberingXml.matchAll(/<w:num w:numId="(\d+)"/g)].map((m) => m[1]!)
    );
    for (const id of usedNumIds) expect(definedNumIds.has(id)).toBe(true);

    source.destroy();
    target.destroy();
    container.remove();
    container2.remove();
  });
});

describe('rich paste', () => {
  test('the embedded fragment lands structure and formatting, one undo unit', () => {
    const flavours = copyRichFlavours();
    const target = mount(paragraph(''));
    putCaret(target.surface, 0);
    target.surface.pasteRich(flavours.text, flavours.html);

    expect(target.surface.session.bodyText()).toContain('bold');
    expect(target.surface.session.bodyText()).toContain('plain');
    const markup = serializeOoxmlPart(target.surface.session.part());
    expect(markup).toContain('w:jc w:val="center"');
    expect(markup).toContain('<w:b/>');

    target.surface.undo();
    expect(target.surface.session.bodyText()).not.toContain('bold');
    const reverted = serializeOoxmlPart(target.surface.session.part());
    expect(reverted.includes('center')).toBe(false);
  });

  test('suggesting mode degrades the rich payload to the tracked plain lane', () => {
    const flavours = copyRichFlavours();
    const container = document.createElement('div');
    const mounted = mountPaginatedSurface(container, docx(paragraph('')), {
      scale: 1,
      author: 'Reviewer',
      editingMode: 'suggest',
    });
    if (!mounted.ok) throw new Error(mounted.reason);
    const surface = mounted.surface;
    putCaret(surface, 0);
    surface.pasteRich(flavours.text, flavours.html);

    const markup = serializeOoxmlPart(surface.session.part());
    expect(surface.session.bodyText()).toContain('bold');
    // Plain lane: the text arrives tracked, the structure does not travel.
    expect(markup).toContain('w:ins');
    expect(markup.includes('w:jc w:val="center"')).toBe(false);
  });

  test('an armed force-plain paste skips the rich lanes once', () => {
    const flavours = copyRichFlavours();
    const target = mount(paragraph(''));
    putCaret(target.surface, 0);
    target.surface.armForcePlainPaste();
    target.surface.pasteRich(flavours.text, flavours.html);

    const markup = serializeOoxmlPart(target.surface.session.part());
    expect(target.surface.session.bodyText()).toContain('bold');
    expect(markup.includes('w:jc w:val="center"')).toBe(false);

    // The flag is consumed: the NEXT paste routes rich again.
    target.surface.selectAll();
    target.surface.pasteRich(flavours.text, flavours.html);
    expect(serializeOoxmlPart(target.surface.session.part())).toContain('w:jc w:val="center"');
  });

  test('external HTML without a fragment projects through the bounded parse', () => {
    const target = mount(paragraph(''));
    putCaret(target.surface, 0);
    // TWO paragraphs: the last one merges into the host and takes the HOST's mark (the
    // documented rule), so the paragraph formatting under test rides the first.
    target.surface.pasteRich(
      'fallback',
      '<p style="text-align:right"><b>ext</b>bold</p><p>tail</p>'
    );
    const markup = serializeOoxmlPart(target.surface.session.part());
    expect(target.surface.session.bodyText()).toContain('ext');
    expect(markup).toContain('w:jc');
    expect(markup).toContain('<w:b/>');
  });

  test('external block paste at a paragraph end keeps the final paragraph alignment', () => {
    const target = mount(paragraph(''));
    putCaret(target.surface, 0);
    target.surface.pasteRich(
      'image\ncaption',
      '<p style="text-align:center">image</p>' +
        '<p class="MsoCaption" style="text-align:center">caption</p>'
    );
    const markup = serializeOoxmlPart(target.surface.session.part());
    expect(markup.match(/w:jc w:val="center"/g)).toHaveLength(2);
  });

  test('external block paste within text keeps the host final paragraph mark', () => {
    const target = mount(paragraph('host'));
    putCaret(target.surface, 2);
    target.surface.pasteRich(
      'image\ncaption',
      '<p style="text-align:center">image</p>' +
        '<p class="MsoCaption" style="text-align:center">caption</p>'
    );
    const markup = serializeOoxmlPart(target.surface.session.part());
    const captionParagraph = markup.split('</w:p>').find((entry) => entry.includes('caption'));
    expect(captionParagraph).toBeDefined();
    expect(captionParagraph).not.toContain('w:jc w:val="center"');
    expect(target.surface.session.bodyText()).toContain('st');
  });

  test('a Word heading pasted within text keeps its heading paragraph', () => {
    const bytes = new Uint8Array(
      readFileSync(`${import.meta.dir}/../../../../../examples/vite/public/sample.docx`)
    );
    const container = document.createElement('div');
    const mounted = mountPaginatedSurface(container, bytes, { scale: 1 });
    if (!mounted.ok) throw new Error(mounted.reason);
    const target = mounted.surface;
    putCaret(target, 2);
    target.pasteRich(
      'Word heading',
      '<html xmlns:w="urn:schemas-microsoft-com:office:word"><body>' +
        '<h2>Word heading</h2></body></html>'
    );
    const markup = serializeOoxmlPart(target.session.part());
    const headingParagraph = markup.split('</w:p>').find((entry) => entry.includes('Word heading'));
    expect(headingParagraph).toContain('<w:pStyle w:val="Heading2"/>');
    const headingRun = headingParagraph!
      .split('</w:r>')
      .find((entry) => entry.includes('Word heading'));
    expect(headingRun).not.toContain('w:sz w:val="52"');
    expect(headingRun).not.toContain('<w:b/>');
    target.destroy();
    container.remove();
  });
});
