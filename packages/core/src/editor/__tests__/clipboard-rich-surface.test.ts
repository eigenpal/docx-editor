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
import { zipSync, strToU8 } from 'fflate';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { fragmentFromHtml, wrapInteropHtml } from '../clipboard-fragment-codec.ts';
import { clipboardPasteLandsContent } from '../clipboard-file-lane.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { docx, mount, paragraph, putCaret } from './paginated-surface-fixtures.ts';

const WML = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

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

  test('select-all copy of the sample pastes back into the sample itself, rich', () => {
    // The user gesture behind the report: Ctrl+A, copy, paste at the end of the SAME
    // document. The host has real paragraphs on both sides of the landing, so the
    // split/join sequence mints node ids MID-transaction — and the fragment carries
    // `xml:space` plus drawing prefixes, which used to rebuild the root, reset the mint
    // frontier, and refuse the whole landing as duplicate ids. The refusal was silent:
    // the router degraded to plain text and every table, list and run format vanished.
    const bytes = new Uint8Array(readFileSync(SAMPLE));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const mounted = mountPaginatedSurface(container, bytes, { scale: 1 });
    if (!mounted.ok) throw new Error(mounted.reason);
    const surface = mounted.surface;
    const sourceXml = serializeOoxmlPart(surface.session.part());
    const count = (xml: string, re: RegExp): number => (xml.match(re) ?? []).length;

    surface.selectAll();
    const flavours = surface.copyFlavours();
    const ids = surface.session.paragraphIds();
    surface.setSelection({
      anchor: { paragraphId: ids[ids.length - 1]!, offset: 0 },
      head: { paragraphId: ids[ids.length - 1]!, offset: 0 },
    });
    surface.pasteRich(flavours.text, flavours.html);

    const pastedXml = serializeOoxmlPart(surface.session.part());
    expect(count(pastedXml, /<w:tbl>/g)).toBe(2 * count(sourceXml, /<w:tbl>/g));
    expect(count(pastedXml, /<w:sdt>/g)).toBe(2 * count(sourceXml, /<w:sdt>/g));
    expect(count(pastedXml, /<w:numPr>/g)).toBe(2 * count(sourceXml, /<w:numPr>/g));
    expect(count(pastedXml, /<w:drawing>/g)).toBe(2 * count(sourceXml, /<w:drawing>/g));
    expect(count(pastedXml, /<w:b\/>/g)).toBe(2 * count(sourceXml, /<w:b\/>/g));

    surface.destroy();
    container.remove();
  });
});

describe('fragment landings that rebuild the host root', () => {
  // A fragment legitimately carries prefixes the TARGET root never bound (`w14:` here).
  // Binding them rebuilds the root, and a rebuilt root starts a fresh id-mint frontier —
  // so the ids minted for the DETACHED block clones collided with the ids the split/join
  // sequence minted afterwards, and the landing was refused as duplicate ids. The clones
  // now mint in their own id family, disjoint from every in-transaction mint.
  const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
  const docxWithW14 = (body: string): Uint8Array =>
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${WML}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`
      ),
    });

  test('a fragment with prefixes the host never bound lands rich mid-paragraph', () => {
    const container = document.createElement('div');
    const mounted = mountPaginatedSurface(
      container,
      docxWithW14(
        '<w:p w14:paraId="1A2B3C4D"><w:r><w:rPr><w:b/></w:rPr>' +
          '<w:t xml:space="preserve">first </w:t></w:r></w:p>' +
          '<w:p w14:paraId="2B3C4D5E"><w:r><w:t>second</w:t></w:r></w:p>'
      ),
      { scale: 1 }
    );
    if (!mounted.ok) throw new Error(mounted.reason);
    const source = mounted.surface;
    putCaret(source, 0);
    source.selectAll();
    const flavours = source.copyFlavours();
    expect(flavours.html).toContain('data-docx-fragment="');
    const embedded = fragmentFromHtml(flavours.html!);
    expect(embedded).not.toBeNull();

    // Mid-text caret in a NON-empty host paragraph: the landing must split and join,
    // which is where the colliding mints happened. The FIRST lane is asserted directly —
    // through `pasteRich` a refusal here degraded down the ladder and could still land
    // something, which is exactly the silence that hid this bug.
    const target = mount(paragraph('host text'));
    putCaret(target.surface, 4);
    const hostId = target.surface.session.paragraphIds()[0]!;
    const landed = target.surface.session.applyFragmentPaste(
      { kind: 'body' },
      {
        paragraphId: hostId,
        offset: 4,
        fragmentBytes: embedded!.bytes,
        lastMarkCovered: embedded!.lastMarkCovered,
        priorOps: [],
      }
    );
    expect(landed.ok).toBe(true);

    const markup = serializeOoxmlPart(target.surface.session.part());
    expect(target.surface.session.bodyText()).toContain('first');
    expect(target.surface.session.bodyText()).toContain('second');
    expect(markup).toContain('<w:b/>');
    // The reserved `xml` prefix is bound by the XML spec; the landing must not declare it.
    expect(markup).not.toContain('xmlns:xml=');

    source.destroy();
    container.remove();
  });
});

describe('the file-lane stand-down against real fragments', () => {
  test('a fragment that reads as a package stands the file lane down without visible text', () => {
    // An engine copy of image-only content: the interop half may carry no visible text,
    // so the predicate must recognize the READABLE fragment itself.
    const html = wrapInteropHtml('', { bytes: docx('<w:p/>'), lastMarkCovered: false });
    const payload = { getData: (type: string) => (type === 'text/html' ? html : '') };
    expect(clipboardPasteLandsContent(payload as unknown as DataTransfer)).toBe(true);
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

  test('Word list markers resolve after a blank document has already laid out', () => {
    const target = mount(paragraph(''));
    target.surface.layout();
    putCaret(target.surface, 0);
    const item = (level: number, marker: string, text: string): string =>
      `<p class="MsoListParagraph" style="margin-left:${level * 0.5}in;` +
      `text-indent:-.25in;mso-list:l0 level${level} lfo2">` +
      `<span style="mso-list:Ignore">${marker} </span>${text}</p>`;
    target.surface.pasteRich('First\nNested', item(1, '•', 'First') + item(2, '○', 'Nested'));

    const paragraphs = target.surface
      .layout()
      .pages.flatMap((page) => page.fragments)
      .filter((fragment) => fragment.kind === 'paragraph' && fragment.marker !== undefined);
    expect(paragraphs.map((fragment) => fragment.marker?.text)).toEqual(['•', 'o']);
    expect(paragraphs.map((fragment) => fragment.indent.left)).toEqual([36, 72]);
    const markup = serializeOoxmlPart(target.surface.session.part());
    expect(markup.match(/<w:numPr>/g)).toHaveLength(2);
  });

  test('external Word footnotes land as referenced note parts', () => {
    const target = mount(paragraph(''));
    putCaret(target.surface, 0);
    target.surface.pasteRich(
      'See[1].\nSource note.',
      '<p>See<a style="mso-footnote-id:ftn1" href="#_ftn1">[1]</a>.</p>' +
        '<div style="mso-element:footnote-list">' +
        '<div style="mso-element:footnote" id="ftn1"><p>' +
        '<a style="mso-footnote-id:ftn1" href="#_ftnref1">[1]</a>Source note.</p>' +
        '</div></div>'
    );
    const documentXml = serializeOoxmlPart(target.surface.session.part());
    expect(documentXml).toContain('<w:footnoteReference ');
    expect(documentXml).not.toContain('Source note.');
    const notes = target.surface.session.currentPackage().parts.get('/word/footnotes.xml');
    expect(notes).toBeDefined();
    expect(serializeOoxmlPart(notes!)).toContain('Source note.');
  });

  test('a Word caption keeps its paragraph alignment at a paragraph end', () => {
    const target = mount(paragraph(''));
    putCaret(target.surface, 0);
    target.surface.pasteRich(
      'image\ncaption',
      '<p style="text-align:center">image</p>' +
        '<p class="MsoCaption" style="text-align:center">caption</p>'
    );
    const markup = serializeOoxmlPart(target.surface.session.part());
    const caption = markup.split('</w:p>').find((entry) => entry.includes('caption'));
    expect(caption).toContain('<w:pStyle w:val="Caption"/>');
    expect(caption).toContain('w:jc w:val="center"');
  });

  test('a Word heading pasted within text remains a heading paragraph', () => {
    const target = mount(paragraph('host'));
    putCaret(target.surface, 2);
    target.surface.pasteRich(
      'Word heading',
      '<html xmlns:w="urn:schemas-microsoft-com:office:word"><body>' +
        '<h2>Word heading</h2></body></html>'
    );
    const markup = serializeOoxmlPart(target.surface.session.part());
    const heading = markup.split('</w:p>').find((entry) => entry.includes('Word heading'));
    expect(heading).toContain('<w:pStyle w:val="Heading2"/>');
    const pastedRun = heading!.split('</w:r>').find((entry) => entry.includes('Word heading'));
    expect(pastedRun).not.toContain('w:sz w:val="52"');
    expect(pastedRun).not.toContain('<w:b/>');
    expect(target.surface.session.bodyText()).toContain('Word heading');
  });
});
