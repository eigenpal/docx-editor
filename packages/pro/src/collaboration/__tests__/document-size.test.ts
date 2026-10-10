/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Encoded size of shared state, which decides how long a join takes and how much a peer
// holds in memory.
//
// A joiner receives the whole document as one Yjs update. The transport frames an oversize
// update (see webrtc-chunking.ts), so size no longer decides whether a join SUCCEEDS, but it
// still decides how many frames cross the channel and how much each peer retains. The
// representation spike measured edit and materialize TIME, not encoded SIZE, which is why
// this gate exists separately.
//
// The budget counts the nodes of the canonical tree, whatever shared state keeps them as:
// block nodes are records with their own child arrays, and a paragraph's runs, text and
// properties are formatting of one shared text. It was set when every node was a record,
// at 74 bytes per node in the cheapest record shape Yjs can express, so it holds the
// shared text to at least what records cost.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { strToU8, zipSync } from 'fflate';
import { seedPackage, DocumentRegistry, MemoryBlobStore } from '../document/index.ts';
import { loadPackage, walk } from './document-support.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/**
 * Budget per canonical tree node in one full state update.
 *
 * The demo document holds 12,196 nodes, which puts a join at a few megabytes at this budget
 * and a few hundred frames on the wire.
 */
const MAX_BYTES_PER_NODE = 160;

function documentBytes(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  });
}

/** Paragraphs with formatted runs, so the fixture carries attributes and nesting. */
function paragraphs(count: number): string {
  let body = '';
  for (let index = 0; index < count; index += 1) {
    body +=
      '<w:p><w:pPr><w:jc w:val="left"/></w:pPr>' +
      `<w:r><w:rPr><w:b/></w:rPr><w:t>Paragraph ${index}</w:t></w:r>` +
      `<w:r><w:t xml:space="preserve"> tail ${index}</w:t></w:r></w:p>`;
  }
  return body;
}

async function measure(bytes: Uint8Array): Promise<{
  readonly nodes: number;
  readonly updateBytes: number;
  readonly bytesPerNode: number;
}> {
  const doc = new Y.Doc();
  try {
    const registry = new DocumentRegistry(doc);
    const pkg = loadPackage(bytes);
    const seeded = await seedPackage(registry, pkg, new MemoryBlobStore());
    if (!seeded.ok) throw new Error(seeded.code);
    let nodes = 0;
    for (const part of pkg.parts.values()) walk(part.root, () => (nodes += 1));
    const updateBytes = Y.encodeStateAsUpdate(doc).byteLength;
    return { nodes, updateBytes, bytesPerNode: updateBytes / Math.max(1, nodes) };
  } finally {
    doc.destroy();
  }
}

describe('shared state stays small enough to deliver', () => {
  test('one node costs less than the per-node budget', async () => {
    const measured = await measure(documentBytes(paragraphs(400)));
    expect(measured.nodes).toBeGreaterThan(2_000);
    expect(measured.bytesPerNode).toBeLessThan(MAX_BYTES_PER_NODE);
  });

  test('per-node cost does not grow with document size', async () => {
    // Constant cost per node is what makes the budget meaningful: if it grew, a document
    // twice as long would cost more than twice as much to join.
    const small = await measure(documentBytes(paragraphs(50)));
    const large = await measure(documentBytes(paragraphs(400)));
    expect(large.bytesPerNode).toBeLessThan(small.bytesPerNode * 1.25);
  });
});
