/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The whole server story, with no DOM anywhere: author a document with payloads, then strip it.
//
// The suite preloads happy-dom for every file, so asserting `typeof document === 'undefined'`
// would prove nothing. `withoutDom` DELETES the globals for the duration of the call instead, so
// anything in this graph that reaches for a browser throws where it does it.
//
// `customNodeXml` and `exportCustomNodes` are the two halves a backend needs — generate a
// contract from a template, strip it before it is emailed — and neither may depend on a browser.

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import { customNodePayloadsByControl } from '@docx-editor.dev/core/store';
import {
  customNodeXml,
  defineCustomNode,
  exportCustomNodes,
  recognizeCustomNodes,
  type CustomNodeXmlStore,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const ClauseData = z.object({
  clauseId: z.string().min(1),
  /** The kind of thing that is the reason a payload exists at all. */
  body: z.string(),
  revision: z.number().int(),
});

/** Survives an export: the reader is meant to keep working with these. */
const Clause = defineCustomNode({
  name: 'clause',
  tagPrefix: 'acme',
  schema: ClauseData,
  tagAttrs: (data) => ({ clauseId: data.clauseId }),
  text: (data) => data.body,
  preserveOnExport: true,
});

/** Unwrapped on export: the words are the point, the markup is ours. */
const Note = defineCustomNode({
  name: 'note',
  tagPrefix: 'acme',
  schema: ClauseData,
  tagAttrs: (data) => ({ clauseId: data.clauseId }),
  text: (data) => data.body,
  preserveOnExport: 'text',
});

/** Removed on export, content and all: internal-only annotation. */
const Internal = defineCustomNode({
  name: 'internal',
  tagPrefix: 'acme',
  schema: ClauseData,
  tagAttrs: (data) => ({ clauseId: data.clauseId }),
  text: (data) => data.body,
  preserveOnExport: false,
});

/**
 * A `.docx` assembled the way a backend would: markup spliced into a template, and the store
 * parts `customNodeXml` handed back added to the zip beside it.
 */
function serverAuthored(
  nodes: readonly { readonly xml: string; readonly store: CustomNodeXmlStore }[]
): Uint8Array {
  const body = nodes.map((node) => `<w:p>${node.xml}</w:p>`).join('');
  const overrides = nodes
    .map(
      (node) =>
        `<Override PartName="${node.store.contentTypeOverride.partName}" ContentType="${node.store.contentTypeOverride.contentType}"/>`
    )
    .join('');
  // Relationships the story owns, and the ones each item part owns, exactly as the result says.
  const storyRels = nodes
    .flatMap((node) => node.store.relationships.filter((rel) => rel.from === '/word/document.xml'))
    .map(
      (rel, index) =>
        `<Relationship Id="rIdCx${String(index)}" Type="${rel.type}" Target="${rel.target}"/>`
    )
    .join('');

  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        overrides +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">${storyRels}</Relationships>`
    ),
  };
  for (const node of nodes) {
    entries[node.store.itemPartName.slice(1)] = strToU8(node.store.itemXml);
    entries[node.store.propsPartName.slice(1)] = strToU8(node.store.propsXml);
    const itemRel = node.store.relationships.find((rel) => rel.from === node.store.itemPartName);
    if (itemRel) {
      const dir = node.store.itemPartName.slice(1, node.store.itemPartName.lastIndexOf('/'));
      const file = node.store.itemPartName.slice(node.store.itemPartName.lastIndexOf('/') + 1);
      entries[`${dir}/_rels/${file}.rels`] = strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${itemRel.type}" Target="${itemRel.target}"/></Relationships>`
      );
    }
  }
  return zipSync(entries);
}

function authored(
  definition: typeof Clause,
  data: z.infer<typeof ClauseData>,
  storeIndex: number,
  nodeId: string
): { readonly xml: string; readonly store: CustomNodeXmlStore } {
  const built = customNodeXml(
    definition,
    { clauseId: data.clauseId },
    data.body,
    // A splice cannot see the package, so the caller picks a free index and a unique node id.
    { data, storeIndex, nodeId, id: storeIndex }
  );
  if (!built.ok) throw new Error(built.reason);
  if (!built.store) throw new Error('no store parts returned');
  return { xml: built.xml, store: built.store };
}

/**
 * Run `body` with the browser globals removed, then put them back.
 *
 * The restore is in a `finally` because leaving a test process without a `document` would take
 * every later file in the same worker down with it.
 */
function withoutDom<T>(body: () => T): T {
  const globals = globalThis as Record<string, unknown>;
  const saved = {
    document: globals['document'],
    window: globals['window'],
    navigator: globals['navigator'],
    HTMLElement: globals['HTMLElement'],
  };
  for (const name of Object.keys(saved)) delete globals[name];
  try {
    return body();
  } finally {
    for (const [name, value] of Object.entries(saved)) globals[name] = value;
  }
}

describe('no DOM is involved', () => {
  test('the globals really are gone inside the harness', () => {
    // Guards the guard: if this ever passes trivially, every test below stops proving anything.
    withoutDom(() => {
      expect(typeof (globalThis as Record<string, unknown>)['document']).toBe('undefined');
      expect(typeof (globalThis as Record<string, unknown>)['window']).toBe('undefined');
    });
    expect(typeof document).toBe('object');
  });
});

describe('a document authored on a server', () => {
  test('it opens, and its payloads resolve through the same reader the editor uses', () => {
    const read = withoutDom(() => {
      const bytes = serverAuthored([
        authored(Clause, { clauseId: 'c-1', body: 'Clause 1 applies.', revision: 3 }, 1, 'cx1'),
      ]);
      return readOoxmlPackage(bytes);
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const story = read.package.parts.get('/word/document.xml');
    expect(story).toBeDefined();
    if (!story) return;
    const [node] = withoutDom(() =>
      recognizeCustomNodes(story, [Clause], {
        payloads: customNodePayloadsByControl(read.package, '/word/document.xml'),
      })
    );
    expect(node?.attrs['clauseId']).toBe('c-1');
    // The payload the server wrote, back through the schema the definition declared.
    expect(node?.data).toEqual({ clauseId: 'c-1', body: 'Clause 1 applies.', revision: 3 });
  });
});

describe('stripping that document, also on a server', () => {
  function threeNodes(): Uint8Array {
    return withoutDom(() =>
      serverAuthored([
        authored(Clause, { clauseId: 'c-1', body: 'Clause 1 applies.', revision: 3 }, 1, 'cx1'),
        authored(Note, { clauseId: 'n-1', body: 'Subject to review.', revision: 1 }, 2, 'cx2'),
        authored(Internal, { clauseId: 'i-1', body: 'DO NOT SEND', revision: 9 }, 3, 'cx3'),
      ])
    );
  }

  test('each flag decides that node, and only that node', () => {
    const exported = withoutDom(() => exportCustomNodes(threeNodes(), [Clause, Note, Internal]));
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported).toMatchObject({ unwrapped: 1, removed: 1 });

    const entries = unzipSync(exported.bytes);
    const xml = strFromU8(entries['word/document.xml']!);

    // preserveOnExport: true — untouched, binding and all.
    expect(xml).toContain('acme:clause');
    expect(xml).toContain('Clause 1 applies.');
    expect(xml).toContain('<w:dataBinding');
    expect(Object.keys(entries)).toContain('customXml/item1.xml');

    // 'text' — the words survive, the markup does not.
    expect(xml).toContain('Subject to review.');
    expect(xml).not.toContain('acme:note');

    // false — node and content both gone.
    expect(xml).not.toContain('DO NOT SEND');
    expect(xml).not.toContain('acme:internal');

    // And the payloads of the two that left are gone from the package entirely.
    const remaining = Object.keys(entries)
      .filter((name) => name.startsWith('customXml/item') && !name.includes('Props'))
      .map((name) => strFromU8(entries[name]!))
      .join('\n');
    expect(remaining).toContain('Clause 1 applies.');
    expect(remaining).not.toContain('Subject to review.');
    expect(remaining).not.toContain('DO NOT SEND');
  });

  test('the stripped document is still a document', () => {
    const exported = withoutDom(() => exportCustomNodes(threeNodes(), [Clause, Note, Internal]));
    if (!exported.ok) throw new Error(exported.reason);
    const reopened = readOoxmlPackage(exported.bytes);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    // Nothing dangling: every relationship the story still declares names a part that exists.
    const story = reopened.package.parts.get('/word/document.xml');
    expect(story).toBeDefined();
    expect(recognizeCustomNodes(story!, [Note, Internal])).toEqual([]);
  });

  test('a definition the caller does not pass is left alone', () => {
    // The export applies a host's policy to a host's own markup. A tag it was not told about is
    // not its business, even when the tag prefix matches.
    const exported = withoutDom(() => exportCustomNodes(threeNodes(), [Clause]));
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported).toMatchObject({ unwrapped: 0, removed: 0 });
    const xml = strFromU8(unzipSync(exported.bytes)['word/document.xml']!);
    expect(xml).toContain('acme:note');
    expect(xml).toContain('DO NOT SEND');
  });

  test("destination 'internal' returns the input untouched", () => {
    const bytes = threeNodes();
    const kept = withoutDom(() =>
      exportCustomNodes(bytes, [Clause, Note, Internal], { destination: 'internal' })
    );
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.bytes).toBe(bytes);
    expect(kept).toMatchObject({ unwrapped: 0, removed: 0 });
  });

  test('bytes that are not a document are refused, not passed through', () => {
    const exported = withoutDom(() => exportCustomNodes(new Uint8Array([1, 2, 3]), [Clause]));
    expect(exported.ok).toBe(false);
    if (!exported.ok) expect(exported.reason).toContain('could not be read');
  });
});

describe('a chip outside the main story', () => {
  test('its payload is stripped too, not shipped', () => {
    // The store hangs off `/word/document.xml`, but the only control binding it lives in a
    // header. Cleaning the stores during the main-part pass answered "still referenced" —
    // because the header had not been unwrapped yet — so the payload shipped with `ok: true`.
    const built = authored(
      Note,
      { clauseId: 'n-1', body: 'SECRET-HEADER-PAYLOAD', revision: 1 },
      1,
      'cx1'
    );
    const entries = unzipSync(withoutDom(() => serverAuthored([built])));
    // Move the chip out of the body and into a header that the package declares.
    entries['word/document.xml'] = strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p></w:body></w:document>`
    );
    entries['word/header1.xml'] = strToU8(`<w:hdr xmlns:w="${W}"><w:p>${built.xml}</w:p></w:hdr>`);
    entries['word/_rels/document.xml.rels'] = strToU8(
      strFromU8(entries['word/_rels/document.xml.rels']!).replace(
        '</Relationships>',
        `<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>`
      )
    );
    entries['[Content_Types].xml'] = strToU8(
      strFromU8(entries['[Content_Types].xml']!).replace(
        '</Types>',
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
      )
    );

    const exported = withoutDom(() => exportCustomNodes(zipSync(entries), [Note]));
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.unwrapped).toBe(1);
    const after = unzipSync(exported.bytes);
    expect(strFromU8(after['word/header1.xml']!)).toContain('SECRET-HEADER-PAYLOAD');
    // The words survive in the header; the payload and its store do not.
    expect(Object.keys(after).filter((name) => /customxml/i.test(name))).toEqual([]);
  });
});
