// Complete DOCX export + reopen equivalence (document-engine task 3.7). Both an OPENED model and a
// newly-CREATED-from-scratch model must export to a package that reopens to an EQUIVALENT authored
// state (same content, modulo volatile identity/preservation/revision bookkeeping), and the
// from-scratch export must carry the required content types + relationships to be a valid package.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { parseDocx } from '../src/package/docx/read.ts';
import { writeDocx } from '../src/package/docx/write.ts';
import { authoredStateDigest } from '../src/package/authored-digest.ts';
import { compareZipContainers } from '../src/package/package-comparator.ts';
import { createEmptyModel, bodyStoryId, type PackageModel, type Story } from '../src/model/index.ts';

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

  test('modeled paragraph props (styleId/numPr) + docDefaults round-trip (sol #3)', () => {
    const base = createEmptyModel();
    const sid = bodyStoryId(base);
    const model: PackageModel = {
      ...base,
      docDefaults: { runProps: { bold: true } },
      stories: new Map(base.stories).set(sid, {
        id: sid,
        kind: 'body',
        blocks: [
          { kind: 'paragraph', id: 'p-1', props: { styleId: 'Heading1' }, runs: [{ text: 'Title' }] },
          { kind: 'paragraph', id: 'p-2', props: { numId: '3', ilvl: 1 }, runs: [{ text: 'item' }] },
        ],
      }),
    };
    const reopened = reopenModeled(writeDocx(model));
    // The style link, numbering, and document defaults all survive export + reopen.
    expect(authoredStateDigest(reopened)).toBe(authoredStateDigest(model));
    const body = [...reopened.stories.values()].find((s) => s.kind === 'body')!;
    const p0 = body.blocks[0] as Extract<(typeof body.blocks)[number], { kind: 'paragraph' }>;
    expect(p0.props?.styleId).toBe('Heading1');
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
});
