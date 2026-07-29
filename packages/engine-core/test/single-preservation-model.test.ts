// The tree lane carries ONE model (task 6.7).
//
// The design rejects "a semantic paragraph model plus raw-XML preservation capsules" because
// two representations need ownership arbitration, and edits, ordering and save then diverge.
// The canonical tree keeps unknown content as generic nodes in source order instead.
//
// Nothing in an import graph expresses that: a capsule is a `string` field, so a lane could
// grow one back without any dependency changing. This checks the lane's source for the
// second model's vocabulary, and — because a guard that only ever passes is worthless —
// asserts the legacy lane still has it, so the check is scanning a corpus where those terms
// genuinely appear.
//
// The legacy `PackageModel` path still backs `create-editor`'s display lane, which renders
// tables, SDTs and page furniture the paragraph slice does not reach yet. Retiring it is
// task 11.1's cutover, not something this guard can assert away.

import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOoxmlPackage } from '../src/package/ooxml-package.ts';
import { deriveOoxmlIndexes } from '../src/package/ooxml-indexes.ts';
import { paragraphTextOf } from '../src/store/tree-ops.ts';
import { TreeDocumentStore } from '../src/store/tree-store.ts';
import { zipSync, strToU8 } from 'fflate';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The second model's vocabulary: verbatim bytes and the source ranges that address them. */
const SECOND_MODEL = /\brPrCapsule\b|\bpPrCapsule\b|\bpAttrsCapsule\b|\bblockRanges\b/;

/** Comments here name the very fields they forbid, so they cannot count as occurrences. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Every module that is part of the canonical-tree lane, load through paint. */
const TREE_LANE = [
  'engine-core/src/package/ooxml-package.ts',
  'engine-core/src/package/ooxml-tree.ts',
  'engine-core/src/package/ooxml-edit.ts',
  'engine-core/src/package/ooxml-indexes.ts',
  'engine-core/src/package/ooxml-digest.ts',
  'engine-core/src/package/xml-reader.ts',
  'engine-core/src/store/tree-ops.ts',
  'engine-core/src/store/tree-store.ts',
  'engine-binding/src/tree-schema.ts',
  'engine-binding/src/tree-binding.ts',
  'engine-binding/src/tree-styles.ts',
  'engine-binding/src/tree-session.ts',
  'engine-binding/src/tree-surface.ts',
  'engine-layout/src/semantic-records.ts',
  'engine-layout/src/semantic-layout.ts',
  'engine-layout/src/semantic-interaction.ts',
  'engine-layout/src/run-style.ts',
  'engine-output/src/semantic-paint.ts',
  'engine-editor/src/paginated-surface.ts',
];

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** A paragraph whose formatting and content include elements the typed model does not know. */
function unknownContentDocx(): Uint8Array {
  const body =
    '<w:p><w:r>' +
    '<w:rPr><w:b/><ext:futureRunProp xmlns:ext="urn:test:ext" val="keep"/></w:rPr>' +
    '<w:t>hello</w:t>' +
    '</w:r>' +
    '<w:r><w:drawing><wp:inline xmlns:wp="urn:test:wp"><wp:extent cx="1" cy="1"/></wp:inline></w:drawing></w:r>' +
    '<ext:futureParagraphChild xmlns:ext="urn:test:ext">tail</ext:futureParagraphChild>' +
    '</w:p>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
  });
}

describe('the canonical tree lane keeps ONE model (task 6.7)', () => {
  test('no tree-lane module names a preservation capsule or a source range', () => {
    const offenders: string[] = [];
    for (const relativePath of TREE_LANE) {
      const file = join(PACKAGES, relativePath);
      // A missing entry would silently shrink the corpus, so it is an offence too.
      if (!existsSync(file)) {
        offenders.push(`${relativePath}: not found`);
        continue;
      }
      if (SECOND_MODEL.test(stripComments(readFileSync(file, 'utf8')))) {
        offenders.push(relativePath);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the guard is not vacuous: the legacy lane still uses the second model', () => {
    // If this ever fails, the byte-capsule model is gone repo-wide and this file — not just
    // its expectation — should go with it.
    const legacy = ['engine-core/src/package/wml-preserve.ts', 'engine-core/src/package/docx/read.ts'];
    for (const relativePath of legacy) {
      const code = stripComments(readFileSync(join(PACKAGES, relativePath), 'utf8'));
      expect({ [relativePath]: SECOND_MODEL.test(code) }).toEqual({ [relativePath]: true });
    }
  });

  test('the regex matches the fields it is meant to and not a lookalike', () => {
    expect(SECOND_MODEL.test('const x = run.rPrCapsule;')).toBe(true);
    expect(SECOND_MODEL.test('preservation.blockRanges.get(id)')).toBe(true);
    // Not a capsule: an unrelated identifier that merely contains the word.
    expect(SECOND_MODEL.test('const encapsulated = 1;')).toBe(false);
  });
});

describe('unknown content does not lock a paragraph read-only (task 6.7)', () => {
  const open = (): { store: TreeDocumentStore; paragraphId: string } => {
    const read = readOoxmlPackage(unknownContentDocx());
    if (!read.ok) throw new Error(read.reason);
    const part = read.package.parts.get(read.package.mainDocumentPart)!;
    const indexes = deriveOoxmlIndexes(read.package, 1);
    const paragraphId = [...indexes.paragraphs.values()][0]!.nodeId;
    return { store: new TreeDocumentStore(part), paragraphId };
  };

  test('a paragraph carrying unknown runs, properties and children is still editable', () => {
    const { store, paragraphId } = open();
    const result = store.transact((tx) =>
      tx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'X' })
    );
    expect(result.ok).toBe(true);
    expect(paragraphTextOf(store.part, paragraphId)).toContain('Xhello');
  });

  test('the unknown content is still there afterwards, as nodes rather than bytes', () => {
    const { store, paragraphId } = open();
    store.transact((tx) => tx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'X' }));
    // Its survival is a property of the NODES, not of a retained byte range that a later
    // edit could invalidate.
    const xml = JSON.stringify(store.part);
    expect(xml).toContain('futureRunProp');
    expect(xml).toContain('futureParagraphChild');
    expect(xml).toContain('urn:test:wp');
  });
});
