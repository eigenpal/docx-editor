// DOCX parse -> edit -> save -> reopen fidelity (document-engine tasks 2.3, 3.6,
// 3.7; goal gate 5) plus malicious ZIP/XML rejection. Exercises fflate + the
// bounded XML reader against a created model AND a real fixture.

import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strFromU8, strToU8 } from 'fflate';
import { parseDocx, writeDocx, readZip, DocxEditor } from '../src/index.ts';
import { childElements, findElement, readXml } from '../src/package/xml-reader.ts';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  type PackageModel,
  type ParagraphRecord,
  authoredStateDigest,
  setParagraphRuns,
} from '../src/index.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;

/** Normalized body content for comparison (ids differ across a round-trip). */
function bodyContent(model: PackageModel): { runs: unknown[] }[] {
  const story = model.stories.get(bodyStoryId(model))!;
  return story.blocks.map((b) => ({ runs: (b as ParagraphRecord).runs as unknown[] }));
}

describe('create -> edit -> save -> reopen fidelity (gate 5)', () => {
  test('a created + edited model round-trips through DOCX bytes', () => {
    // Build a model with two paragraphs, one with a bold run.
    const model0 = createEmptyModel();
    const storyId = bodyStoryId(model0);
    const p1 = (model0.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
    const store = new DocumentStore(model0);
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'Hello ' }));
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: 'bold', props: { bold: true } }));
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const p2 = r.ok ? r.modelChange.created[0] : '';
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p2, text: 'second para' }));

    const bytes = writeDocx(store.currentModel);
    expect(bytes.length).toBeGreaterThan(0);

    const reopened = parseDocx(bytes);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;

    // Authored body content is equivalent after reopen (text + props preserved).
    expect(bodyContent(reopened.model)).toEqual(bodyContent(store.currentModel));
  });

  test('DocxEditor edits then writeDocx/parseDocx preserve text', () => {
    const doc = DocxEditor.create();
    let pid = '';
    DocxEditor.run(doc, (ctx) => {
      const p = ctx.document.body.insertParagraph('round trip me');
      ctx.sync();
      pid = p.id;
    });
    // Reach the underlying model via a query, then save/reopen.
    const saved = writeDocx((doc as unknown as { internalStore: DocumentStore }).internalStore.currentModel);
    const reopened = parseDocx(saved);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      // insertParagraph appends after the initial empty paragraph; join all body text.
      const text = reopened.model.stories
        .get(bodyStoryId(reopened.model))!
        .blocks.map((b) => (b as ParagraphRecord).runs.map((r) => r.text).join(''))
        .join('');
      expect(text).toBe('round trip me');
    }
    expect(pid).toBeTruthy();
  });
});

describe('reads a real DOCX fixture', () => {
  const fixture = join(import.meta.dir, '..', '..', '..', 'e2e', 'fixtures', 'complex-styles.docx');
  test.if(existsSync(fixture))('parses a real fixture into a body story', () => {
    const bytes = new Uint8Array(readFileSync(fixture));
    const result = parseDocx(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const body = result.model.stories.get(bodyStoryId(result.model));
      expect(body).toBeDefined();
      expect(body!.blocks.length).toBeGreaterThan(0);
    }
  });
});

describe('authored run formatting preservation', () => {
  test('save and reopen retain formatting semantics and untouched source part bytes', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const documentXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>` +
      '<w:p><w:pPr><w:pStyle w:val="BodyStyle"/></w:pPr><w:r><w:rPr>' +
      '<w:rFonts w:ascii="Direct Face" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="majorEastAsia" w:cstheme="minorBidi"/>' +
      '<w:sz w:val="027"/><w:color w:val="a1B2c3"/><w:b w:val="0"/>' +
      '</w:rPr><w:t>formatted</w:t></w:r></w:p></w:body></w:document>';
    const stylesXml =
      `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W}">` +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="majorAscii"/><w:sz w:val="020"/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:styleId="BodyStyle"><w:name w:val="Body Style"/><w:rPr><w:color w:val="010203"/></w:rPr></w:style>' +
      '</w:styles>';
    const themeColors =
      '<a:clrScheme name="Round Trip Colors">' +
      ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']
        .map((name) => `<a:${name}><a:srgbClr val="112233"/></a:${name}>`)
        .join('') +
      '</a:clrScheme>';
    const themeFormat =
      '<a:fmtScheme name="Round Trip Format"><a:fillStyleLst><a:solidFill/><a:solidFill/><a:solidFill/></a:fillStyleLst>' +
      '<a:lnStyleLst><a:ln/><a:ln/><a:ln/></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
      '<a:bgFillStyleLst><a:solidFill/><a:solidFill/><a:solidFill/></a:bgFillStyleLst></a:fmtScheme>';
    const themeXml =
      '<?xml version="1.0" encoding="UTF-8"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements>' +
      themeColors +
      '<a:fontScheme name="Round Trip"><a:majorFont><a:latin typeface="Major Latin"/><a:ea typeface="Major East"/><a:cs typeface="Major Complex"/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Minor Latin"/><a:ea typeface="Minor East"/><a:cs typeface="Minor Complex"/></a:minorFont></a:fontScheme>' +
      themeFormat +
      '</a:themeElements></a:theme>';
    const original = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      'word/document.xml': strToU8(documentXml),
      'word/styles.xml': strToU8(stylesXml),
      'word/theme/theme1.xml': strToU8(themeXml),
      'word/_rels/document.xml.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>'
      ),
    });

    const parsed = parseDocx(original, { preserveAll: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const paragraph = parsed.model.stories.get(bodyStoryId(parsed.model))!
      .blocks[0] as ParagraphRecord;
    expect(paragraph.runs[0].props).toMatchObject({
      fonts: {
        ascii: 'Direct Face',
        hAnsiTheme: 'minorHAnsi',
        eastAsiaTheme: 'majorEastAsia',
        csTheme: 'minorBidi',
      },
      sizeHalfPoints: 27,
      color: 'a1B2c3',
      bold: false,
    });
    expect(paragraph.runs[0].rPrCapsule).toContain('<w:sz w:val="027"/>');

    const saved = writeDocx(parsed.model);
    const before = readZip(original);
    const after = readZip(saved);
    expect(before.ok).toBe(true);
    expect(after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    for (const partName of [
      '/word/document.xml',
      '/word/styles.xml',
      '/word/theme/theme1.xml',
      '/word/_rels/document.xml.rels',
    ]) {
      expect(after.entries.get(partName)).toEqual(before.entries.get(partName));
    }

    const reopened = parseDocx(saved, { preserveAll: true });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    const reopenedParagraph = reopened.model.stories.get(bodyStoryId(reopened.model))!
      .blocks[0] as ParagraphRecord;
    expect(reopenedParagraph.runs[0].props).toEqual(paragraph.runs[0].props);
    expect(reopened.model.themeFonts).toEqual(parsed.model.themeFonts);
  });

  test('from-scratch fonts, size, and color serialize, digest, and reopen equivalently', () => {
    const base = createEmptyModel();
    const storyId = bodyStoryId(base);
    const paragraphId = (base.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
    const withRun = setParagraphRuns(base, paragraphId, [
      {
        text: 'direct',
        props: {
          fonts: {
            ascii: 'Direct ASCII',
            hAnsiTheme: 'minorHAnsi',
            eastAsia: 'Direct East',
            csTheme: 'majorBidi',
          },
          sizeHalfPoints: 27,
          color: 'A1B2C3',
          bold: false,
        },
      },
    ]);
    const model: PackageModel = {
      ...withRun,
      docDefaults: {
        runProps: {
          fonts: { asciiTheme: 'minorAscii' },
          sizeHalfPoints: 20,
          color: '010203',
        },
      },
      styles: [
        ...withRun.styles,
        {
          id: 'Styled',
          name: 'Styled',
          type: 'paragraph',
          runProps: {
            fonts: { hAnsi: 'Style ANSI', csTheme: 'minorBidi' },
            sizeHalfPoints: 32,
            color: '102030',
          },
        },
      ],
    };

    const saved = writeDocx(model);
    const reopened = parseDocx(saved);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(authoredStateDigest(reopened.model)).toBe(authoredStateDigest(model));
    expect(reopened.model.docDefaults).toEqual(model.docDefaults);
    expect(reopened.model.styles.find((style) => style.id === 'Styled')).toEqual(
      model.styles.find((style) => style.id === 'Styled')
    );
    const reopenedRun = reopened.model.stories.get(bodyStoryId(reopened.model))!
      .blocks[0] as ParagraphRecord;
    expect(reopenedRun.runs[0].props).toEqual(
      (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).runs[0].props
    );
  });

  test('a capsule-backed run with changed semantic formatting fails instead of emitting stale bytes', () => {
    const original = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      'word/document.xml': strToU8(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
          '<w:p><w:r><w:rPr><w:rFonts w:ascii="Original"/><w:color w:val="111111"/></w:rPr><w:t>x</w:t></w:r></w:p>' +
          '</w:body></w:document>'
      ),
    });
    const parsed = parseDocx(original, { preserveAll: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const storyId = bodyStoryId(parsed.model);
    const paragraph = parsed.model.stories.get(storyId)!.blocks[0] as ParagraphRecord;
    const edited = setParagraphRuns(parsed.model, paragraph.id, [
      {
        ...paragraph.runs[0],
        props: { ...paragraph.runs[0].props, color: '222222' },
      },
    ]);
    expect(() => writeDocx(edited)).toThrow(/capsule.*semantic formatting/i);
  });

  test('from-scratch themeFonts emit a related theme part and reopen equivalently', () => {
    const model: PackageModel = {
      ...createEmptyModel(),
      themeFonts: {
        majorLatin: 'Aptos Display',
        minorLatin: 'Aptos',
        majorEastAsia: 'Yu Mincho',
        minorComplexScript: 'Arial',
      },
    };
    const saved = writeDocx(model);
    const zip = readZip(saved);
    expect(zip.ok).toBe(true);
    if (!zip.ok) return;
    expect(zip.entries.has('/word/theme/theme1.xml')).toBe(true);
    expect(strFromU8(zip.entries.get('/word/_rels/document.xml.rels')!)).toContain(
      '/relationships/theme'
    );
    expect(strFromU8(zip.entries.get('/[Content_Types].xml')!)).toContain(
      'application/vnd.openxmlformats-officedocument.theme+xml'
    );
    const theme = readXml(strFromU8(zip.entries.get('/word/theme/theme1.xml')!));
    expect(theme.ok).toBe(true);
    if (!theme.ok) return;
    const themeElements = findElement(theme.nodes, 'a:themeElements')!;
    expect(
      themeElements.children
        .filter((node) => node.type === 'element')
        .map((node) => node.name)
    ).toEqual(['a:clrScheme', 'a:fontScheme', 'a:fmtScheme']);
    const colorScheme = childElements(themeElements, 'a:clrScheme')[0];
    expect(
      colorScheme.children.filter((node) => node.type === 'element').map((node) => node.name)
    ).toEqual([
      'a:dk1',
      'a:lt1',
      'a:dk2',
      'a:lt2',
      'a:accent1',
      'a:accent2',
      'a:accent3',
      'a:accent4',
      'a:accent5',
      'a:accent6',
      'a:hlink',
      'a:folHlink',
    ]);
    const fontScheme = childElements(themeElements, 'a:fontScheme')[0];
    for (const collectionName of ['a:majorFont', 'a:minorFont']) {
      const collection = childElements(fontScheme, collectionName)[0];
      expect(childElements(collection, 'a:latin')).toHaveLength(1);
      expect(childElements(collection, 'a:ea')).toHaveLength(1);
      expect(childElements(collection, 'a:cs')).toHaveLength(1);
    }
    const formatScheme = childElements(themeElements, 'a:fmtScheme')[0];
    expect(childElements(formatScheme, 'a:fillStyleLst')[0].children).toHaveLength(3);
    expect(childElements(formatScheme, 'a:lnStyleLst')[0].children).toHaveLength(3);
    expect(childElements(formatScheme, 'a:effectStyleLst')[0].children).toHaveLength(3);
    expect(childElements(formatScheme, 'a:bgFillStyleLst')[0].children).toHaveLength(3);
    const reopened = parseDocx(saved);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.model.themeFonts).toEqual(model.themeFonts);
  });

  test('a changed preserved themeFonts fails instead of reusing stale theme bytes', () => {
    const original = writeDocx({
      ...createEmptyModel(),
      themeFonts: { majorLatin: 'Original Major', minorLatin: 'Original Minor' },
    });
    const parsed = parseDocx(original, { preserveAll: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const changed: PackageModel = {
      ...parsed.model,
      themeFonts: { ...parsed.model.themeFonts, majorLatin: 'Changed Major' },
    };
    expect(() => writeDocx(changed)).toThrow(/themeFonts.*preserved theme/i);
  });
});

describe('malicious ZIP/XML rejection', () => {
  test('a zip entry with path traversal is rejected before use', () => {
    const evil = zipSync({ 'word/../../../etc/passwd': strToU8('x') });
    expect(readZip(evil)).toMatchObject({ ok: false, reason: 'bad-name' });
  });

  test('a DOCX whose document.xml declares a DTD is refused', () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<!DOCTYPE w:document [ <!ENTITY x "y"> ]><w:document><w:body/></w:document>'),
    });
    expect(parseDocx(bytes)).toMatchObject({ ok: false, reason: 'xml-error' });
  });
});
