// Complete DOCX export + reopen equivalence (document-engine task 3.7). Both an OPENED model and a
// newly-CREATED-from-scratch model must export to a package that reopens to an EQUIVALENT authored
// state (same content, modulo volatile identity/preservation/revision bookkeeping), and the
// from-scratch export must carry the required content types + relationships to be a valid package.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { parseDocx } from '../src/package/docx/read.ts';
import { writeDocx } from '../src/package/docx/write.ts';
import { paragraphXml } from '../src/package/wml-serialize.ts';
import { authoredStateDigest } from '../src/package/authored-digest.ts';
import { compareZipContainers } from '../src/package/package-comparator.ts';
import { createEmptyModel, bodyStoryId, REL_TYPES, type PackageModel, type Story, type Block, type RunProps } from '../src/model/index.ts';

const FIX = `${import.meta.dir}/../../../e2e/fixtures`;

function parse(name: string): PackageModel {
  const r = parseDocx(readFileSync(`${FIX}/${name}`), { preserveAll: true });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(`parse failed: ${r.reason} ${r.detail ?? ''}`);
  return r.model;
}

function reopen(bytes: Uint8Array): PackageModel {
  const r = parseDocx(bytes, { preserveAll: true });
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(`reopen failed: ${r.reason} ${r.detail ?? ''}`);
  return r.model;
}

// A from-scratch model represents formatting with MODELED props (bold/italic), so reopen it in the
// modeling mode (no preserveAll) — preserveAll would re-capture the same formatting as a byte-exact
// rPr capsule, an equally-lossless but different REPRESENTATION that a content digest would flag.
function reopenModeled(bytes: Uint8Array): PackageModel {
  const r = parseDocx(bytes);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(`reopen failed: ${r.reason} ${r.detail ?? ''}`);
  return r.model;
}

describe('opened model: export then reopen preserves authored state (3.7)', () => {
  // Real fixtures spanning styled paragraphs, tables, SDTs, and multi-story headers/footers.
  for (const name of ['complex-styles.docx', 'comprehensive-word-element-test.docx', 'block-level-bookmark.docx']) {
    test(`${name} reopens to an equivalent authored-state hash`, () => {
      const opened = parse(name);
      const exported = writeDocx(opened);
      const reopened = reopen(exported);
      expect(authoredStateDigest(reopened)).toBe(authoredStateDigest(opened));
      // A preserved (opened) package re-emits byte-for-byte, so an unedited export is even STRONGER
      // than digest-equal — the main part is byte-identical.
      expect(strFromU8(unzipSync(exported)['word/document.xml'])).toBe(
        strFromU8(unzipSync(readFileSync(`${FIX}/${name}`))['word/document.xml']),
      );
    });
  }
});

describe('created-from-scratch model: complete export reopens to an equivalent authored state (3.7)', () => {
  // Build a from-scratch model with real authored content: styled runs (bold/italic) across several
  // paragraphs. No preservation index — the writer regenerates a minimal, complete package.
  function scratchModel(): PackageModel {
    const base = createEmptyModel();
    const sid = bodyStoryId(base);
    const body: Story = {
      id: sid,
      kind: 'body',
      blocks: [
        { kind: 'paragraph', id: 'p-1', runs: [{ text: 'Hello ' }, { text: 'bold', props: { bold: true } }, { text: ' world' }] },
        { kind: 'paragraph', id: 'p-2', runs: [{ text: 'italic line', props: { italic: true } }] },
        { kind: 'paragraph', id: 'p-3', runs: [] }, // an empty trailing paragraph
      ],
    };
    return { ...base, stories: new Map(base.stories).set(sid, body) };
  }

  test('the from-scratch export carries the required content types + relationships', () => {
    const bytes = writeDocx(scratchModel());
    const parts = unzipSync(bytes);
    // Required OPC scaffolding for a valid WordprocessingML package.
    expect(parts['[Content_Types].xml']).toBeDefined();
    expect(parts['_rels/.rels']).toBeDefined();
    expect(parts['word/document.xml']).toBeDefined();
    const ct = strFromU8(parts['[Content_Types].xml']);
    expect(ct).toContain('/word/document.xml'); // main document part declared
    expect(ct).toContain('wordprocessingml.document.main+xml');
    const rootRels = strFromU8(parts['_rels/.rels']);
    expect(rootRels).toContain('officeDocument'); // root -> main document relationship
    expect(rootRels).toContain('word/document.xml');
  });

  test('a from-scratch model reopens to an equivalent authored-state hash (content survives)', () => {
    const model = scratchModel();
    const exported = writeDocx(model);
    const reopened = reopenModeled(exported);
    expect(authoredStateDigest(reopened)).toBe(authoredStateDigest(model));
    // Sanity: the reopened body carries the same visible text.
    const body = [...reopened.stories.values()].find((s) => s.kind === 'body')!;
    const text = body.blocks
      .filter((b): b is Extract<typeof b, { kind: 'paragraph' }> => b.kind === 'paragraph')
      .map((p) => p.runs.map((r) => r.text).join(''))
      .join('\n');
    expect(text).toBe('Hello bold world\nitalic line\n');
  });

  test('export -> reopen -> re-export is stable (idempotent authored state on a second round-trip)', () => {
    const model = scratchModel();
    const first = writeDocx(model);
    const reopened = reopenModeled(first);
    const second = writeDocx(reopened);
    // Both round-trips agree on authored state, and the re-export reopens to the same hash again.
    expect(authoredStateDigest(reopenModeled(second))).toBe(authoredStateDigest(model));
  });

  test('modeled paragraph styleId + run styleId/bold/italic + docDefaults round-trip (sol #3)', () => {
    const base = createEmptyModel();
    const sid = bodyStoryId(base);
    const model: PackageModel = {
      ...base,
      docDefaults: { runProps: { bold: true } },
      stories: new Map(base.stories).set(sid, {
        id: sid,
        kind: 'body',
        blocks: [
          { kind: 'paragraph', id: 'p-1', props: { styleId: 'Heading1' }, runs: [{ text: 'Title', props: { styleId: 'Emphasis' } }] },
          { kind: 'paragraph', id: 'p-2', runs: [{ text: 'b', props: { bold: true } }, { text: 'i', props: { italic: true } }] },
        ],
      }),
    };
    const reopened = reopenModeled(writeDocx(model));
    // The paragraph style link, run style link/toggles, and document defaults all survive.
    expect(authoredStateDigest(reopened)).toBe(authoredStateDigest(model));
    const body = [...reopened.stories.values()].find((s) => s.kind === 'body')!;
    const p0 = body.blocks[0] as Extract<(typeof body.blocks)[number], { kind: 'paragraph' }>;
    expect(p0.props?.styleId).toBe('Heading1');
    expect(p0.runs[0].props?.styleId).toBe('Emphasis');
    expect(reopened.docDefaults?.runProps?.bold).toBe(true);
  });

  test('the from-scratch OPC scaffolding is stable across a round-trip (export == re-export; sol #5)', () => {
    // The content digest does not model per-file OPC records, so prove the content types +
    // relationships survive a from-scratch round-trip at the PACKAGE level: export, reopen, re-export,
    // and assert the two packages are semantically identical (every part, uncompressed).
    const model = scratchModel();
    const first = writeDocx(model);
    const second = writeDocx(reopenModeled(first));
    expect(compareZipContainers(first, second).unownedChanged).toEqual([]);
  });

  test('degenerate paragraph props ({} / empty ids / non-integer ilvl) round-trip cleanly (sol edge)', () => {
    const base = createEmptyModel();
    const sid = bodyStoryId(base);
    // A model authored with degenerate props must digest the SAME as one with them absent, and
    // round-trip without drift (the serializer + parser both treat them as absent).
    const degenerate: PackageModel = {
      ...base,
      stories: new Map(base.stories).set(sid, {
        id: sid,
        kind: 'body',
        blocks: [{ kind: 'paragraph', id: 'p-1', props: { styleId: '', numId: '', ilvl: Number.NaN }, runs: [{ text: 'x' }] }],
      }),
    };
    const clean: PackageModel = {
      ...base,
      stories: new Map(base.stories).set(sid, { id: sid, kind: 'body', blocks: [{ kind: 'paragraph', id: 'p-1', runs: [{ text: 'x' }] }] }),
    };
    expect(authoredStateDigest(degenerate)).toBe(authoredStateDigest(clean));
    expect(authoredStateDigest(reopenModeled(writeDocx(degenerate)))).toBe(authoredStateDigest(degenerate));
  });

  test('a literal CR in run text survives export + reopen (escaped as &#xD;, not normalized to LF)', () => {
    const base = createEmptyModel();
    const sid = bodyStoryId(base);
    const model: PackageModel = {
      ...base,
      stories: new Map(base.stories).set(sid, { id: sid, kind: 'body', blocks: [{ kind: 'paragraph', id: 'p-1', runs: [{ text: 'a\rb' }] }] }),
    };
    const doc = strFromU8(unzipSync(writeDocx(model))['word/document.xml']);
    expect(doc).toContain('a&#xD;b'); // CR emitted as a numeric ref, not a literal CR
    const reopened = reopenModeled(writeDocx(model));
    const body = [...reopened.stories.values()].find((s) => s.kind === 'body')!;
    const p0 = body.blocks[0] as Extract<(typeof body.blocks)[number], { kind: 'paragraph' }>;
    expect(p0.runs.map((r) => r.text).join('')).toBe('a\rb'); // CR preserved, not normalized to LF
  });

  test('adjacent equivalent runs and one merged run share a digest (normalization; sol #10)', () => {
    const base = createEmptyModel();
    const sid = bodyStoryId(base);
    const split: PackageModel = {
      ...base,
      stories: new Map(base.stories).set(sid, { id: sid, kind: 'body', blocks: [{ kind: 'paragraph', id: 'p-1', runs: [{ text: 'a' }, { text: 'b' }] }] }),
    };
    const merged: PackageModel = {
      ...base,
      stories: new Map(base.stories).set(sid, { id: sid, kind: 'body', blocks: [{ kind: 'paragraph', id: 'p-1', runs: [{ text: 'ab' }] }] }),
    };
    expect(authoredStateDigest(split)).toBe(authoredStateDigest(merged));
  });
});

describe('from-scratch export fails closed on what it cannot faithfully serialize (sol #5-#8)', () => {
  function withParts(mutate: (m: PackageModel) => PackageModel): PackageModel {
    const base = createEmptyModel();
    return mutate(base);
  }

  test('rejects a declared media part (no authored bytes) rather than dangle its rel', () => {
    const model = withParts((m) => ({
      ...m,
      parts: new Map(m.parts).set('/word/media/image1.png', { kind: 'media', partName: '/word/media/image1.png' }),
    }));
    expect(() => writeDocx(model)).toThrow(/media part/);
  });

  test('rejects a header story from scratch (a part alone is inert without a w:sectPr headerReference; sol #2)', () => {
    const model = withParts((m) => {
      const sid = 'st-hdr';
      return {
        ...m,
        stories: new Map(m.stories).set(sid, { id: sid, kind: 'header', blocks: [] }),
        parts: new Map(m.parts).set('/word/header1.xml', { kind: 'xml', partName: '/word/header1.xml', storyId: sid }),
      };
    });
    expect(() => writeDocx(model)).toThrow(/related story|section references/);
  });

  test('rejects a footnote/comment story kind (needs item wrappers + section refs we do not emit)', () => {
    const model = withParts((m) => {
      const sid = 'st-note';
      return {
        ...m,
        stories: new Map(m.stories).set(sid, { id: sid, kind: 'footnote', blocks: [] }),
        parts: new Map(m.parts).set('/word/footnotes.xml', { kind: 'xml', partName: '/word/footnotes.xml', storyId: sid }),
      };
    });
    expect(() => writeDocx(model)).toThrow(/footnote/);
  });

  test('rejects an invalid XML 1.0 control character in an authored style name', () => {
    const badName = `Bad${String.fromCharCode(1)}Name`; // U+0001 is forbidden in XML 1.0
    const model = withParts((m) => ({ ...m, styles: [{ id: 'Normal', name: badName, type: 'paragraph', isDefault: true }] }));
    expect(() => writeDocx(model)).toThrow(/not valid in XML 1\.0/);
  });

  test('rejects duplicate relationship ids for one owner (invalid OPC)', () => {
    const model = withParts((m) => ({
      ...m,
      relationships: [
        ...m.relationships,
        { ownerPart: '/word/document.xml', id: 'rId1', type: 'urn:x', rawTarget: 'x.xml', targetMode: 'Internal', order: 9 },
      ],
    }));
    expect(() => writeDocx(model)).toThrow(/invalid relationships|duplicate-id/);
  });

  test('rejects a package missing the required root officeDocument relationship', () => {
    const model = withParts((m) => ({ ...m, relationships: m.relationships.filter((r) => r.ownerPart !== '/') }));
    expect(() => writeDocx(model)).toThrow(/root officeDocument relationship/);
  });

  function withBody(blocks: Block[]): PackageModel {
    const base = createEmptyModel();
    const sid = bodyStoryId(base);
    return { ...base, stories: new Map(base.stories).set(sid, { id: sid, kind: 'body', blocks }) };
  }

  test('rejects paragraph numbering (numPr) — the abstract list definition is not modeled (sol #2)', () => {
    expect(() => writeDocx(withBody([{ kind: 'paragraph', id: 'p-1', props: { numId: '3', ilvl: 1 }, runs: [{ text: 'x' }] }]))).toThrow(/numbering/);
  });

  test('rejects a model-level numbering record (no abstractNum definition emitted)', () => {
    const base = createEmptyModel();
    expect(() => writeDocx({ ...base, numbering: [{ numId: '1', abstractId: '0' }] })).toThrow(/numbering/);
  });

  test('rejects a from-scratch run carrying an rPr capsule (verbatim-injection risk; sol #3)', () => {
    const model = withBody([{ kind: 'paragraph', id: 'p-1', runs: [{ text: 'x', rPrCapsule: '<w:rPr/><w:t>INJECTED</w:t>' }] }]);
    expect(() => writeDocx(model)).toThrow(/capsule/);
  });

  test('rejects a main content type that falls through to the generic xml default (sol #5)', () => {
    // Drop the /word/document.xml Override but keep the xml -> application/xml Default: the main part
    // no longer resolves to the wordprocessingml main type.
    const model = withParts((m) => ({
      ...m,
      contentTypes: { defaults: m.contentTypes.defaults, overrides: m.contentTypes.overrides.filter((o) => o.partName !== '/word/document.xml') },
    }));
    expect(() => writeDocx(model)).toThrow(/main document content type/);
  });

  test('rejects an EXTERNAL root officeDocument relationship (must be internal to the main part; sol #6)', () => {
    const model = withParts((m) => ({
      ...m,
      relationships: m.relationships.map((r) =>
        r.ownerPart === '/' && r.type === REL_TYPES.officeDocument ? { ...r, targetMode: 'External' as const, rawTarget: 'http://evil/doc.xml' } : r,
      ),
    }));
    expect(() => writeDocx(model)).toThrow(/must be internal/);
  });

  test('rejects a non-body story present in model.stories even without a backing part (sol #7)', () => {
    const model = withParts((m) => ({
      ...m,
      stories: new Map(m.stories).set('st-hdr', { id: 'st-hdr', kind: 'header', blocks: [] }),
    }));
    expect(() => writeDocx(model)).toThrow(/only a body story/);
  });

  test('rejects MORE THAN ONE body story (only the first would serialize; round-7 #3)', () => {
    const model = withParts((m) => ({
      ...m,
      stories: new Map(m.stories).set('st-body2', { id: 'st-body2', kind: 'body', blocks: [] }),
    }));
    expect(() => writeDocx(model)).toThrow(/exactly one body story/);
  });

  test('rejects a dangling internal relationship targeting a non-emitted part (round-7 #2)', () => {
    const model = withParts((m) => ({
      ...m,
      relationships: [
        ...m.relationships,
        { ownerPart: '/word/document.xml', id: 'rId9', type: 'urn:x/img', rawTarget: 'media/missing.png', targetMode: 'Internal', order: 9 },
      ],
    }));
    expect(() => writeDocx(model)).toThrow(/non-emitted part/);
  });

  test('rejects a relationship owned by a non-existent part (round-7 #2)', () => {
    const model = withParts((m) => ({
      ...m,
      relationships: [
        ...m.relationships,
        { ownerPart: '/word/ghost.xml', id: 'rId1', type: 'urn:x', rawTarget: 'x.xml', targetMode: 'Internal', order: 9 },
      ],
    }));
    expect(() => writeDocx(model)).toThrow(/non-existent owner/);
  });
});

describe('serialization sink rejects forged capsules from ANY path (round-7 #1 security)', () => {
  const run = (rPrCapsule: string, props?: RunProps) => ({
    kind: 'paragraph' as const,
    id: 'p',
    runs: [{ text: 'x', rPrCapsule, ...(props ? { props } : {}) }],
  });
  test('runXml rejects an rPr capsule that is not a lone balanced w:rPr (tag breakout)', () => {
    // The exact injection the review flagged: a self-closing w:rPr followed by sibling OOXML.
    expect(() => paragraphXml(run('<w:rPr/><w:t>INJECTED</w:t>'))).toThrow(/lone balanced w:rPr/);
    expect(() => paragraphXml(run('<w:rPr><w:b/></w:rPr><w:object/>'))).toThrow(/lone balanced w:rPr/);
  });
  test('runXml accepts a genuine lone w:rPr capsule (the parse-origin form)', () => {
    expect(
      paragraphXml(
        run('<w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr>', {
          bold: true,
          color: 'FF0000',
        })
      )
    ).toContain('<w:color w:val="FF0000"/>');
  });
  test('paragraphXml rejects a forged pPr capsule / attrs capsule (tag breakout)', () => {
    expect(() => paragraphXml({ kind: 'paragraph', id: 'p', pPrCapsule: '<w:pPr/><w:r><w:t>x</w:t></w:r>', runs: [] })).toThrow(/lone balanced w:pPr/);
    expect(() => paragraphXml({ kind: 'paragraph', id: 'p', pAttrsCapsule: '><w:evil/>', runs: [] })).toThrow(/well-formed attribute list/);
  });
});

describe('product-reachable data-loss / injection guards (round-9)', () => {
  test('serialize rejects a lenient-but-invalid capsule (bare/unquoted/duplicate attributes)', () => {
    const p = (rPrCapsule: string) => ({ kind: 'paragraph' as const, id: 'p', runs: [{ text: 'x', rPrCapsule }] });
    // readXml accepts these leniently; re-emitting them verbatim would be invalid XML, so the strict
    // sink validation must reject each (product path: a forged setParagraphRuns DocOp).
    expect(() => paragraphXml(p('<w:rPr x/>'))).toThrow(/lone balanced w:rPr/);
    expect(() => paragraphXml(p('<w:rPr a="1" a="2"/>'))).toThrow(/lone balanced w:rPr/);
    expect(() => paragraphXml(p('<w:rPr foo=bar/>'))).toThrow(/lone balanced w:rPr/);
    // A genuine captured capsule still serializes.
    expect(
      paragraphXml({
        kind: 'paragraph',
        id: 'p',
        runs: [{ text: 'x', rPrCapsule: '<w:rPr><w:b/></w:rPr>', props: { bold: true } }],
      })
    ).toContain('<w:b/>');
  });

  test('a header/footer edit is rejected on export (no silent related-story loss)', () => {
    // A real package with a header; edit the header story at the model level; export must fail closed
    // rather than copy the original header part and discard the edit.
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const withHeader = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      'word/_rels/document.xml.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>',
      ),
      'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p></w:body></w:document>`),
      'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>original header</w:t></w:r></w:p></w:hdr>`),
    });
    const parsed = parseDocx(withHeader, { preserveAll: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('parse failed');
    // Unedited export is fine.
    expect(() => writeDocx(parsed.model)).not.toThrow();
    // Edit the header story's paragraph and re-export -> must fail closed.
    const headerStory = [...parsed.model.stories.values()].find((s) => s.kind === 'header')!;
    const editedStories = new Map(parsed.model.stories).set(headerStory.id, {
      ...headerStory,
      blocks: [{ kind: 'paragraph' as const, id: (headerStory.blocks[0] as { id: string }).id, runs: [{ text: 'EDITED HEADER' }] }],
    });
    expect(() => writeDocx({ ...parsed.model, stories: editedStories })).toThrow(/related story|related-story/);
  });

  test('a non-preserving flat parse that dropped unmodeled OOXML is non-exportable from scratch', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    // A paragraph carrying an unmodeled w:jc + a run w:color: the flat parse drops both, so the model
    // is marked lossy and writeDocx fails closed (rather than silently exporting without them).
    const bytes = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>styled</w:t></w:r></w:p></w:body></w:document>`,
      ),
    });
    const parsed = parseDocx(bytes); // NON-preserving (default)
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('parse failed');
    expect(parsed.model.lossyParse).toBe(true);
    expect(() => writeDocx(parsed.model)).toThrow(/dropped unmodeled OOXML/);
    // Whereas a fully-modeled paragraph (only text) flat-parses cleanly and exports fine.
    const plain = parseDocx(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>`) }));
    expect(plain.ok).toBe(true);
    if (plain.ok) {
      expect(plain.model.lossyParse).toBeUndefined();
      expect(() => writeDocx(plain.model)).not.toThrow();
    }
  });
});

describe('degenerate style/docDefaults values digest their canonical form (round-7 #5)', () => {
  test('a style with runProps:{} / isDefault:false / empty basedOn digests as its canonical style', () => {
    const base = createEmptyModel();
    const degenerate: PackageModel = {
      ...base,
      docDefaults: { runProps: {} },
      styles: [{ id: 'Normal', name: 'Normal', type: 'paragraph', isDefault: true, basedOn: '', runProps: {} }],
    };
    const clean: PackageModel = { ...base, styles: [{ id: 'Normal', name: 'Normal', type: 'paragraph', isDefault: true }] };
    expect(authoredStateDigest(degenerate)).toBe(authoredStateDigest(clean));
  });

  test('a run styleId inside a style/docDefaults rPr is dropped (not round-trippable there; round-8)', () => {
    const base = createEmptyModel();
    // rPrXml/parseRPr do not carry w:rStyle inside a style/docDefaults context, so a styleId there
    // must NOT appear in the digest (else it drifts out of the model on reopen).
    const withStyleId: PackageModel = {
      ...base,
      docDefaults: { runProps: { styleId: 'Emphasis', bold: true } },
      styles: [{ id: 'Normal', name: 'Normal', type: 'paragraph', isDefault: true, runProps: { styleId: 'Emphasis', bold: true } }],
    };
    const withoutStyleId: PackageModel = {
      ...base,
      docDefaults: { runProps: { bold: true } },
      styles: [{ id: 'Normal', name: 'Normal', type: 'paragraph', isDefault: true, runProps: { bold: true } }],
    };
    expect(authoredStateDigest(withStyleId)).toBe(authoredStateDigest(withoutStyleId));
    // And it genuinely round-trips: reopen the export and confirm the digest is stable.
    expect(authoredStateDigest(reopenModeled(writeDocx(withStyleId)))).toBe(authoredStateDigest(withStyleId));
  });

  test('an empty-string capsule is treated as absent (no props suppression / digest drift; round-8)', () => {
    const base = createEmptyModel();
    const sid = bodyStoryId(base);
    // A paragraph with an EMPTY pPr capsule AND modeled props: the empty capsule must not suppress
    // the props (both in serialization and digest).
    const emptyCapsule: PackageModel = {
      ...base,
      stories: new Map(base.stories).set(sid, {
        id: sid,
        kind: 'body',
        blocks: [{ kind: 'paragraph', id: 'p-1', pPrCapsule: '', props: { styleId: 'Heading1' }, runs: [{ text: 'x' }] }],
      }),
    };
    const noCapsule: PackageModel = {
      ...base,
      stories: new Map(base.stories).set(sid, {
        id: sid,
        kind: 'body',
        blocks: [{ kind: 'paragraph', id: 'p-1', props: { styleId: 'Heading1' }, runs: [{ text: 'x' }] }],
      }),
    };
    expect(authoredStateDigest(emptyCapsule)).toBe(authoredStateDigest(noCapsule));
    expect(strFromU8(unzipSync(writeDocx(emptyCapsule))['word/document.xml'])).toContain('<w:pStyle w:val="Heading1"/>');
  });
});
