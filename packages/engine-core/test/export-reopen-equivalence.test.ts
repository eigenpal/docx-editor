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
});
