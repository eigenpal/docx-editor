import { expect, test } from 'bun:test';
import {
  readOoxmlPackage,
  readOoxmlPart,
  type ImageResourceLookup,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { zipSync, strToU8 } from 'fflate';
import {
  createInlineDrawingLayoutBundle,
  drawingAtomIdentities,
  drawingTokenForTableBlock,
  drawingTokenForTableBlockMemo,
} from '../inline-drawing-source.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

test('part-wide drawing identity scan does not fail closed after 4k elements', () => {
  const prefix = Array.from({ length: 5_000 }, () => '<w:p/>').join('');
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}"><w:body>${prefix}<w:p><w:r><w:drawing>` +
      '<wp:inline><wp:extent cx="1" cy="1"/></wp:inline></w:drawing></w:r></w:p>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);

  const atoms = drawingAtomIdentities(result.part);

  expect(atoms).not.toBeNull();
});

test('a slot hit resolves no package; a substrate change through sync still does', () => {
  const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  let pkg = loaded.package;
  let revision = 0;
  let packageReads = 0;
  const session = {
    packageRevision: () => revision,
    currentPackage: () => {
      packageReads += 1;
      return pkg;
    },
    part: () => pkg.parts.get(pkg.mainDocumentPart)!,
  };
  const resourceLookup: ImageResourceLookup = {
    resolveEmbedded: async () => Object.freeze({ kind: 'missing' as const }),
    resolveLinked: () => Object.freeze({ kind: 'missing' as const }),
    resolveForProjection: async () => Object.freeze({ kind: 'missing' as const }),
    liveReferenceCount: () => 0,
    dispose: () => {},
  };
  const bundle = createInlineDrawingLayoutBundle({
    session,
    decodePort: Object.freeze({
      decode: async () => {
        throw new Error('unused');
      },
    }),
    resourceLookup,
    onResourcesChanged: () => {},
  });
  const paragraph = session
    .part()
    .root.children.find((node) => node.kind !== 'textValue' && node.localName === 'body')!;
  const body = paragraph.kind === 'textValue' ? null : paragraph;
  const firstParagraph = body!.children.find((node) => node.kind === 'paragraph')!;
  if (firstParagraph.kind === 'textValue') throw new Error('unexpected text node');

  bundle.drawingTokenForParagraph(firstParagraph, session.part().name);
  const afterFirst = packageReads;
  bundle.drawingTokenForParagraph(firstParagraph, session.part().name);
  bundle.drawingTokenForParagraph(firstParagraph, session.part().name);
  // The slot map answers repeat lookups; layout keys every paragraph through here, so a
  // hit must not pay a package snapshot per call.
  expect(packageReads).toBe(afterFirst);

  pkg = Object.freeze({ ...pkg, parts: new Map(pkg.parts) });
  revision += 1;
  bundle.sync(session);
  // Compatibility after a package move stays resetPackage's job — sync must still read.
  expect(packageReads).toBeGreaterThan(afterFirst);
});

// ── drawingTokenForTableBlockMemo ─────────────────────────────────────────────────────────
// The table token exists to VALIDATE the table's prepared-block memo, so it used to be
// recomputed (a full row/cell walk) before every hit. The memo keys on (immutable table
// node, drawingLayoutEpoch); an undefined epoch means the caller cannot see resource moves,
// so that path must stay a recompute.

/** A table whose first cell paragraph carries an inline drawing; the second is plain text. */
function tableWithDrawing(): OoxmlNode {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}"><w:body><w:tbl>` +
      '<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:drawing>' +
      '<wp:inline><wp:extent cx="914400" cy="914400"/></wp:inline></w:drawing></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>plain</w:t></w:r></w:p></w:tc></w:tr>' +
      '</w:tbl></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  const body = result.part.root.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'body'
  );
  if (!body || body.kind === 'textValue') throw new Error('no body');
  const table = body.children.find((node) => node.kind === 'table');
  if (!table) throw new Error('no table');
  return table;
}

/** Whether a paragraph subtree contains a `w:drawing` — the shape a real token fn keys on. */
function paragraphHasDrawing(paragraph: OoxmlNode): boolean {
  if (paragraph.kind === 'textValue') return false;
  if (paragraph.localName === 'drawing') return true;
  return paragraph.children.some((child) => paragraphHasDrawing(child));
}

function countedTokenFn(): { fn: (paragraph: OoxmlNode) => string; calls: () => number } {
  let calls = 0;
  return {
    fn: (paragraph) => {
      calls += 1;
      return paragraphHasDrawing(paragraph) ? `drawing@${paragraph.id}` : '';
    },
    calls: () => calls,
  };
}

test('memoized table drawing token equals a direct recompute under a fixed epoch', () => {
  const table = tableWithDrawing();
  const memoSide = countedTokenFn();
  const directSide = countedTokenFn();

  const memoized = drawingTokenForTableBlockMemo(table, 'epoch-1', memoSide.fn);
  const direct = drawingTokenForTableBlock(table, directSide.fn);
  expect(memoized).toBe(direct);
  expect(memoized).toContain('drawing@');
  // Both sides walked every paragraph of the subtree exactly once.
  expect(memoSide.calls()).toBe(directSide.calls());
});

test('same node and same epoch answers from the cache without re-walking', () => {
  const table = tableWithDrawing();
  const counted = countedTokenFn();

  const first = drawingTokenForTableBlockMemo(table, 'epoch-1', counted.fn);
  const walkCost = counted.calls();
  expect(walkCost).toBeGreaterThan(0);

  const second = drawingTokenForTableBlockMemo(table, 'epoch-1', counted.fn);
  expect(second).toBe(first);
  expect(counted.calls()).toBe(walkCost);
});

test('an epoch change recomputes', () => {
  const table = tableWithDrawing();
  const counted = countedTokenFn();

  const first = drawingTokenForTableBlockMemo(table, 'epoch-1', counted.fn);
  const walkCost = counted.calls();

  const second = drawingTokenForTableBlockMemo(table, 'epoch-2', counted.fn);
  expect(second).toBe(first);
  expect(counted.calls()).toBe(walkCost * 2);

  // The recompute re-armed the cache under the new epoch.
  drawingTokenForTableBlockMemo(table, 'epoch-2', counted.fn);
  expect(counted.calls()).toBe(walkCost * 2);
});

test('an undefined epoch always recomputes and never reads or arms the cache', () => {
  const table = tableWithDrawing();
  const counted = countedTokenFn();

  drawingTokenForTableBlockMemo(table, undefined, counted.fn);
  const walkCost = counted.calls();
  drawingTokenForTableBlockMemo(table, undefined, counted.fn);
  expect(counted.calls()).toBe(walkCost * 2);

  // Nothing was armed: the first epoch-carrying call still pays a walk.
  drawingTokenForTableBlockMemo(table, 'epoch-1', counted.fn);
  expect(counted.calls()).toBe(walkCost * 3);

  // A warm epoch entry does not leak into the epoch-free path either.
  drawingTokenForTableBlockMemo(table, undefined, counted.fn);
  expect(counted.calls()).toBe(walkCost * 4);
});
