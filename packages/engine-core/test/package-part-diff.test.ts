// Versioned package-part diff fixtures (document-engine task 3.8). Across the supported edit
// classes — localized edit, raw lexical values, unsupported capsules, all supported stories,
// relationship edits, authored omission, and create-from-scratch — assert that every eligible
// UNTOUCHED part stays byte-identical (semantic ZIP comparator) and each CHANGED part is still
// valid XML and semantically correct on reopen.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { parseDocx } from '../src/package/docx/read.ts';
import { readXml } from '../src/package/xml-reader.ts';
import { writeDocx, documentXml } from '../src/package/docx/write.ts';
import { compareZipContainers } from '../src/package/package-comparator.ts';
import { bodyStoryId, createEmptyModel, type PackageModel, type Story, type Block, type ParagraphRecord } from '../src/model/index.ts';

// Bump when the diff-fixture contract changes; pinned so a schema drift is a visible edit.
const DIFF_FIXTURE_VERSION = 1;

const FIX = `${import.meta.dir}/../../../e2e/fixtures`;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function parsePreserved(bytes: Uint8Array): PackageModel {
  const r = parseDocx(bytes, { preserveAll: true });
  if (!r.ok) throw new Error(`parse failed: ${r.reason} ${r.detail ?? ''}`);
  return r.model;
}

function docx(bodyInner: string, extraParts: Record<string, string> = {}): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`),
    ...Object.fromEntries(Object.entries(extraParts).map(([k, v]) => [k, strToU8(v)])),
  });
}

/** Replace the runs of the first plain (capsule-free) body paragraph with a single text run — the
 *  smallest localized edit that regenerates exactly one paragraph's range. */
function editFirstPlainParagraph(model: PackageModel, text: string): PackageModel {
  const bodyId = bodyStoryId(model);
  const body = model.stories.get(bodyId)!;
  let done = false;
  const blocks: Block[] = body.blocks.map((b) => {
    if (!done && b.kind === 'paragraph' && !b.pPrCapsule && !b.runs.some((r) => r.rPrCapsule)) {
      done = true;
      return { ...(b as ParagraphRecord), runs: [{ text }] };
    }
    return b;
  });
  if (!done) throw new Error('no plain paragraph to edit');
  return { ...model, stories: new Map(model.stories).set(bodyId, { ...body, blocks }) };
}

/** True when the part exists and is well-formed XML (actually parsed, not assumed). */
function validXml(part: Uint8Array | undefined): boolean {
  return part !== undefined && readXml(strFromU8(part)).ok;
}

describe(`package-part diff fixtures v${DIFF_FIXTURE_VERSION}: untouched parts byte-identical, changed parts valid`, () => {
  test('localized edit: only /word/document.xml changes; styles + rels stay byte-identical', () => {
    const bytes = readFileSync(`${FIX}/complex-styles.docx`);
    const edited = writeDocx(editFirstPlainParagraph(parsePreserved(bytes), 'LOCALIZED EDIT'));
    const res = compareZipContainers(bytes, edited, { owned: ['/word/document.xml'] });
    expect(res.unownedChanged).toEqual([]); // styles.xml, rels, content-types all verbatim
    // The changed part is valid + carries the edit on reopen.
    const re = parsePreserved(edited);
    expect(strFromU8(unzipSync(edited)['word/document.xml'])).toContain('LOCALIZED EDIT');
    expect([...re.stories.values()].some((s) => s.blocks.length > 0)).toBe(true);
  });

  test('all supported stories: editing the body leaves every header/footer part byte-identical', () => {
    const bytes = readFileSync(`${FIX}/watermark-confidential.docx`);
    const edited = writeDocx(editFirstPlainParagraph(parsePreserved(bytes), 'BODY EDIT'));
    const res = compareZipContainers(bytes, edited, { owned: ['/word/document.xml'] });
    // header1/2 + footer1/2 + styles + rels all survive verbatim.
    expect(res.unownedChanged).toEqual([]);
    for (const p of ['/word/header1.xml', '/word/header2.xml', '/word/footer1.xml', '/word/footer2.xml']) {
      expect(res.changed).not.toContain(p);
    }
  });

  test('relationship edits + media: a body edit leaves rels, media, theme, and notes byte-identical', () => {
    // A controlled multi-part package (rels + media + theme + notes beside a simple editable body):
    // we do not model relationship/media editing, so a content edit must touch NO other part.
    const bytes = docx('<w:p><w:r><w:t>body text</w:t></w:r></w:p>', {
      'word/_rels/document.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="urn:x/image" Target="media/image1.png"/></Relationships>',
      'word/media/image1.png': 'PNGBYTES',
      'word/theme/theme1.xml': '<a:theme xmlns:a="urn:x"/>',
      'word/footnotes.xml': `<w:footnotes xmlns:w="${W}"/>`,
    });
    const edited = writeDocx(editFirstPlainParagraph(parsePreserved(bytes), 'ONLY BODY'));
    const res = compareZipContainers(bytes, edited, { owned: ['/word/document.xml'] });
    expect(res.unownedChanged).toEqual([]); // rels, media, theme, notes all verbatim
    expect(strFromU8(unzipSync(edited)['word/document.xml'])).toContain('ONLY BODY');
  });

  test('raw lexical values: an untouched self-closing/whitespaced paragraph keeps its exact bytes', () => {
    // The SECOND paragraph is self-closing (<w:p/>); editing the FIRST must leave it byte-identical,
    // not expand it to <w:p></w:p>.
    const bytes = docx('<w:p><w:r><w:t>edit me</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>tail</w:t></w:r></w:p>');
    const edited = writeDocx(editFirstPlainParagraph(parsePreserved(bytes), 'CHANGED'));
    const doc = strFromU8(unzipSync(edited)['word/document.xml']);
    expect(doc).toContain('<w:p/>'); // the self-closing paragraph is preserved verbatim
    expect(doc).toContain('CHANGED');
    expect(doc).toContain('<w:t>tail</w:t>'); // the untouched tail paragraph is verbatim
  });

  test('unsupported capsule: editing a plain paragraph preserves a sibling capsule paragraph verbatim', () => {
    // A styled paragraph carrying an unmodeled rPr capsule sits beside a plain one; editing the plain
    // paragraph must leave the capsule paragraph byte-exact.
    const capsulePara = '<w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>styled</w:t></w:r></w:p>';
    const bytes = docx(`<w:p><w:r><w:t>plain</w:t></w:r></w:p>${capsulePara}`);
    const edited = writeDocx(editFirstPlainParagraph(parsePreserved(bytes), 'EDITED'));
    const doc = strFromU8(unzipSync(edited)['word/document.xml']);
    expect(doc).toContain(capsulePara); // the capsule paragraph survives verbatim
    expect(doc).toContain('EDITED');
  });

  test('authored omission: an untouched omission-bearing paragraph does not gain properties', () => {
    // The tail paragraph OMITS all properties (no w:pPr). Editing the first must not materialize a
    // w:pPr on it — its exact <w:p><w:r><w:t>…</w:t></w:r></w:p> form is preserved.
    const bytes = docx('<w:p><w:r><w:t>first</w:t></w:r></w:p><w:p><w:r><w:t>bare</w:t></w:r></w:p>');
    const edited = writeDocx(editFirstPlainParagraph(parsePreserved(bytes), 'X'));
    const doc = strFromU8(unzipSync(edited)['word/document.xml']);
    expect(doc).toContain('<w:p><w:r><w:t>bare</w:t></w:r></w:p>'); // no w:pPr materialized
  });

  test('create-from-scratch: a complete package reopens and re-exports with no unowned drift', () => {
    const base = createEmptyModel();
    const sid = bodyStoryId(base);
    const model: PackageModel = {
      ...base,
      stories: new Map(base.stories).set(sid, {
        id: sid,
        kind: 'body',
        blocks: [{ kind: 'paragraph', id: 'p-1', runs: [{ text: 'from scratch' }] }],
      } as Story),
    };
    const first = writeDocx(model);
    // The from-scratch package MUST reopen (no silent fallback) and re-export with no unowned drift.
    const reopened = parseDocx(first);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw new Error('from-scratch package did not reopen');
    const reExport = writeDocx(reopened.model);
    expect(compareZipContainers(first, reExport).unownedChanged).toEqual([]);
    // Required parts present + actually valid XML.
    const parts = unzipSync(first);
    expect(validXml(parts['[Content_Types].xml'])).toBe(true);
    expect(validXml(parts['word/document.xml'])).toBe(true);
    expect(validXml(parts['_rels/.rels'])).toBe(true);
    expect(strFromU8(parts['word/document.xml'])).toContain('from scratch');
  });
});
