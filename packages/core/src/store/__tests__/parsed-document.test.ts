// A package read on one thread and rebuilt on another is the package read in place.
//
// `structuredClone` stands in for `postMessage`: it is the same algorithm, so what survives it
// is what a worker's answer delivers. The comparison is stricter than deep equality — key
// order, prototypes, which containers are frozen and which objects are shared must all match,
// because the rebuilt read stands in for the reader's own output.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import {
  isParsedDocument,
  parseDocument,
  parsedDocumentRead,
  parsedDocumentTransferables,
  receiveParsedDocument,
  receiveParsedDocumentInSlices,
  type ParsedDocument,
} from '../package/parsed-document.ts';
import {
  decodeValueGraph,
  encodeValueGraph,
  UnencodableValueError,
} from '../package/parsed-document-codec.ts';
import { sameGraph } from './same-graph.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const LINK = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${LINK}" Target="https://example.com/" TargetMode="External"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    'word/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  });
}

const BYTES = docx(
  '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">One </w:t></w:r>' +
    '<w:hyperlink r:id="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>' +
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Two</w:t></w:r></w:p>'
);

/** What a worker's answer is on arrival: the parse, through the structured clone. */
function posted(bytes: Uint8Array): ParsedDocument {
  const parsed = parseDocument(bytes);
  return structuredClone(parsed, { transfer: parsedDocumentTransferables(parsed) });
}

describe('a parsed document', () => {
  test('rebuilds, across the clone, into exactly the read of its bytes', () => {
    const received = posted(BYTES.slice());
    expect(isParsedDocument(received)).toBe(true);
    const read = parsedDocumentRead(received);
    expect(read?.ok).toBe(true);
    expect(sameGraph(read, readOoxmlPackage(BYTES))).toBeNull();
  });

  test('carries a refused file as the same refusal', () => {
    const garbage = strToU8('not a zip at all');
    const read = parsedDocumentRead(posted(garbage.slice()));
    expect(read).toEqual(readOoxmlPackage(garbage));
    expect(read?.ok).toBe(false);
  });

  test('keeps its bytes, and transfers the buffers it holds', () => {
    const bytes = BYTES.slice();
    const parsed = parseDocument(bytes);
    expect(parsed.bytes).toBe(bytes);
    const transfer = parsedDocumentTransferables(parsed);
    expect(transfer).toContain(bytes.buffer as ArrayBuffer);
    expect(new Set(transfer).size).toBe(transfer.length);
    const received = structuredClone(parsed, { transfer });
    expect(bytes.byteLength).toBe(0);
    expect(Array.from(received.bytes)).toEqual(Array.from(BYTES));
  });

  test('is rebuilt once, and its wire form released after', () => {
    const received = posted(BYTES.slice());
    expect(receiveParsedDocument(received)).toBe(received);
    const first = parsedDocumentRead(received);
    expect(parsedDocumentRead(received)).toBe(first);
    expect((received.read as { ops: Int32Array }).ops.length).toBe(0);
  });

  test('of another wire version, or damaged, offers no read, so the bytes are read in place', () => {
    const other = { ...posted(BYTES.slice()), version: 999 };
    expect(parsedDocumentRead(other)).toBeNull();
    const damaged = posted(BYTES.slice());
    const graph = damaged.read as { ops: Int32Array };
    graph.ops = graph.ops.subarray(0, graph.ops.length - 3);
    expect(parsedDocumentRead(damaged)).toBeNull();
  });

  test('rebuilds in slices into the same read, and an open mid-way finishes it', async () => {
    const long = docx('<w:p><w:r><w:t>A paragraph of its own.</w:t></w:r></w:p>'.repeat(300));
    const expected = readOoxmlPackage(long);
    let yields = 0;
    const sliced = posted(long.slice());
    const received = await receiveParsedDocumentInSlices(sliced, {
      sliceMs: 0,
      yieldToHost: async () => {
        yields += 1;
      },
    });
    expect(received).toBe(sliced);
    expect(yields).toBeGreaterThan(3);
    expect(sameGraph(parsedDocumentRead(sliced), expected)).toBeNull();

    const interrupted = posted(long.slice());
    let resume: () => void = () => {};
    const pending = receiveParsedDocumentInSlices(interrupted, {
      sliceMs: 0,
      yieldToHost: () => new Promise<void>((resolve) => (resume = resolve)),
    });
    await Promise.resolve();
    const read = parsedDocumentRead(interrupted);
    expect(sameGraph(read, expected)).toBeNull();
    resume();
    expect(await pending).toBe(interrupted);
    expect(parsedDocumentRead(interrupted)).toBe(read);
  });

  test('is told apart from what is not one', () => {
    expect(receiveParsedDocument({ revision: 3 })).toBeNull();
    expect(receiveParsedDocument('blank')).toBeNull();
    expect(receiveParsedDocument({ kind: 'docx-editor.parsed-document', version: 1 })).toBeNull();
  });
});

describe('the wire codec', () => {
  test('keeps key order, undefined members, prototypes, sharing and frozen state', () => {
    const shared = Object.freeze({ b: 2, a: [1, 'x'] });
    const bare = Object.create(null) as Record<string, unknown>;
    bare.z = 'last';
    const value = {
      second: undefined,
      first: Object.freeze([shared, shared, null, true, false, -0, Number.NaN]),
      map: new Map<unknown, unknown>([
        ['k', shared],
        [7, new Uint8Array([1, 2, 3])],
      ]),
      bare,
      open: { left: 'open' },
    };
    const decoded = decodeValueGraph(structuredClone(encodeValueGraph(value)));
    expect(sameGraph(decoded?.value, value)).toBeNull();
  });

  test('refuses what it cannot carry exactly', () => {
    class Point {
      x = 1;
    }
    for (const value of [
      { run: () => 1 },
      new Point(),
      { [Symbol('s')]: 1 },
      Object.seal({ a: 1 }),
      [1, , 3],
      new Set([1]),
      10n,
    ]) {
      expect(() => encodeValueGraph(value)).toThrow(UnencodableValueError);
    }
  });

  test('refuses a stream it did not write', () => {
    const graph = encodeValueGraph({ a: ['b', 'c'] });
    const tables = { ...graph };
    expect(decodeValueGraph({ ...tables, ops: new Int32Array([99]) })).toBeNull();
    expect(decodeValueGraph({ ...tables, strings: [] })).toBeNull();
    expect(decodeValueGraph({ ...tables, ops: Int32Array.of(...graph.ops, 0) })).toBeNull();
    expect(decodeValueGraph({ ...tables, ops: new Int32Array([9, 1 << 30]) })).toBeNull();
  });
});
