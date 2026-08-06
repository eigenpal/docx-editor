/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The payload, end to end, through a mounted editor and a real zod schema.
//
// A host declares the shape its node carries, inserts one with a payload far past what 64
// characters of `w:tag` could hold, saves, reopens, and gets the payload back as the type it
// declared. Then the lifecycle: deleting the chip takes the payload with it, a payload whose
// control was deleted in Word is collected on open, and `preserveOnExport` decides what a
// downloaded file carries.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { z } from 'zod';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  customNodeXml,
  customNodesModule,
  defineCustomNode,
  exportCustomNodes,
  insertCustomNode,
  recognizeCustomNodes,
  removeCustomNode,
  updateCustomNode,
  type AnyCustomNodeDefinition,
  type CustomNodeDiagnostic,
} from '../index.ts';
import { customNodePayloadsByControl } from '@docx-editor.dev/core/store';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const Citation = z.object({
  sourceId: z.string().min(1),
  locator: z.string(),
  authors: z.array(z.string()).max(64),
  year: z.number().int().gte(0).lte(3000),
  url: z.url().optional(),
});
type Citation = z.infer<typeof Citation>;

const CITATION: Citation = {
  sourceId: 'src_9f3',
  locator: 'p.42',
  authors: ['Smith, J.', 'Okonkwo, A.'],
  year: 2024,
  url: 'https://example.test/papers/9f3.pdf',
};

const citation = defineCustomNode({ name: 'citation', tagPrefix: 'acme', schema: Citation });
const ephemeral = defineCustomNode({
  name: 'note',
  tagPrefix: 'acme',
  schema: z.object({ body: z.string() }),
  preserveOnExport: 'text',
});
const secret = defineCustomNode({
  name: 'secret',
  tagPrefix: 'acme',
  schema: z.object({ body: z.string() }),
  preserveOnExport: false,
});

function docx(body: string, extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    ...extra,
  });
}

function mount(
  bytes: Uint8Array,
  nodes: readonly AnyCustomNodeDefinition[] = [citation],
  onDiagnostic?: (diagnostic: CustomNodeDiagnostic) => void
): DocxEditorInstance {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    modules: [customNodesModule({ nodes, ...(onDiagnostic ? { onDiagnostic } : {}) })],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

function firstParagraphId(editor: DocxEditorInstance): string {
  const fragment = editor.surface!.layout().pages[0]!.fragments[0]!;
  if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph');
  return fragment.paragraphId;
}

/** Recognition with the payloads the engine resolved, which is what the review rail gets. */
function recognized(
  editor: DocxEditorInstance,
  nodes: readonly AnyCustomNodeDefinition[] = [citation]
) {
  const session = editor.surface!.session;
  return recognizeCustomNodes(
    session.part(),
    nodes,
    customNodePayloadsByControl(session.currentPackage(), session.part().name)
  );
}

describe('a payload larger than w:tag, declared by a schema', () => {
  test('it is written, survives a save and reopen, and comes back typed', async () => {
    const editor = mount(docx('<w:p><w:r><w:t>before after</w:t></w:r></w:p>'));
    const result = insertCustomNode(editor, citation, { sourceId: 'src_9f3' }, '(Smith 2024)', {
      at: { paragraphId: firstParagraphId(editor), offset: 7 },
      data: CITATION,
    });
    expect(result).toEqual({ ok: true, changed: true });

    const saved = new Uint8Array(await editor.save());
    const entries = unzipSync(saved);
    // The store, its properties and the binding that ties them to the body.
    expect(Object.keys(entries)).toContain('customXml/item1.xml');
    expect(Object.keys(entries)).toContain('customXml/itemProps1.xml');
    expect(strFromU8(entries['word/document.xml']!)).toContain('<w:dataBinding');

    const reopened = mount(saved);
    const [node] = recognized(reopened);
    expect(node?.attrs).toEqual({ sourceId: 'src_9f3' });
    // Typed, not `unknown`: the host reads the fields it declared.
    expect(node?.data).toEqual(CITATION);
  });

  test('the payload is far past what the tag could have carried', () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    insertCustomNode(editor, citation, { sourceId: 'src_9f3' }, '(Smith 2024)', {
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    const [node] = recognized(editor);
    expect(JSON.stringify(node?.data).length).toBeGreaterThan(64);
  });

  test('a payload that does not match the schema is refused, and nothing is written', () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    const result = insertCustomNode(editor, citation, { sourceId: 's' }, 'label', {
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      // The `@ts-expect-error` IS the first half of this test: `data` is typed by the
      // definition's schema, so a host writing this gets a compile error. The runtime refusal
      // below is the second half — for the caller who reached here from untyped JavaScript.
      // @ts-expect-error -- year is a number in the schema
      data: { ...CITATION, year: '2024' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('year');
    expect(recognized(editor)).toHaveLength(0);
    expect(editor.surface!.session.bodyText()).toBe('x');
  });

  test('an update writes the label and the payload together', () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    insertCustomNode(editor, citation, { sourceId: 'src_9f3' }, '(Smith 2024)', {
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    const [before] = recognized(editor);
    const updated = updateCustomNode(
      editor,
      citation,
      before!.nodeId,
      { sourceId: 'src_2' },
      '(Jones 2025)',
      { data: { ...CITATION, sourceId: 'src_2', year: 2025 } }
    );
    expect(updated).toEqual({ ok: true, changed: true });
    const [after] = recognized(editor);
    expect(after?.text).toBe('(Jones 2025)');
    expect((after?.data as Citation).year).toBe(2025);
    // One node in the store, not one per edit.
    const session = editor.surface!.session;
    expect(customNodePayloadsByControl(session.currentPackage(), session.part().name).size).toBe(1);
  });
});

describe('a payload the file got wrong', () => {
  test('it is reported and the node still renders', async () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    insertCustomNode(editor, citation, { sourceId: 'src_9f3' }, '(Smith 2024)', {
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    // What a sender who edited the file by hand leaves behind.
    const saved = unzipSync(new Uint8Array(await editor.save()));
    // The payload is XML text, so its quotes arrive escaped.
    const tampered = strFromU8(saved['customXml/item1.xml']!).replace(
      '&quot;year&quot;:2024',
      '&quot;year&quot;:&quot;2024&quot;'
    );
    expect(tampered).toContain('&quot;year&quot;:&quot;2024&quot;');
    saved['customXml/item1.xml'] = strToU8(tampered);

    const seen: CustomNodeDiagnostic[] = [];
    const reopened = mount(zipSync(saved), [citation], (diagnostic) => seen.push(diagnostic));
    const [node] = recognized(reopened);
    // The chip is still there, with its tag attrs — only the payload is withheld.
    expect(node?.attrs).toEqual({ sourceId: 'src_9f3' });
    expect(node?.data).toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.code).toBe('payload-invalid');
    expect(seen[0]?.issues.join(' ')).toContain('year');
  });
});

describe('a payload does not outlive its control', () => {
  test('deleting the chip removes the payload in the same transaction', () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    insertCustomNode(editor, citation, { sourceId: 'src_9f3' }, '(Smith 2024)', {
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    const [node] = recognized(editor);
    expect(removeCustomNode(editor, node!.nodeId)).toEqual({ ok: true, changed: true });
    const session = editor.surface!.session;
    const store = unzipSync(session.save())['customXml/item1.xml'];
    expect(store && strFromU8(store)).not.toContain('src_9f3');
  });

  test('a payload whose control was deleted in Word is collected on open', async () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    insertCustomNode(editor, citation, { sourceId: 'src_9f3' }, '(Smith 2024)', {
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    // Word deletes the control and leaves the node behind — nothing in OOXML asks it not to.
    const saved = unzipSync(new Uint8Array(await editor.save()));
    saved['word/document.xml'] = strToU8(
      strFromU8(saved['word/document.xml']!).replace(/<w:sdt>.*<\/w:sdt>/s, '')
    );
    expect(strFromU8(saved['customXml/item1.xml']!)).toContain('src_9f3');

    const reopened = mount(zipSync(saved));
    const store = unzipSync(reopened.surface!.session.save())['customXml/item1.xml'];
    expect(store && strFromU8(store)).not.toContain('src_9f3');
  });

  test('a store no module claims is left alone', async () => {
    // Word's own Cover Page Properties store rides in most templates. Nothing here claims it.
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    insertCustomNode(editor, citation, { sourceId: 'src_9f3' }, '(Smith 2024)', {
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    const saved = new Uint8Array(await editor.save());
    // Reopened with a definition claiming a DIFFERENT namespace, so the sweep never looks here.
    const other = defineCustomNode({
      name: 'citation',
      tagPrefix: 'acme',
      payloadNamespace: 'urn:example:other',
    });
    const reopened = mount(saved, [other]);
    const store = unzipSync(reopened.surface!.session.save())['customXml/item1.xml'];
    expect(store && strFromU8(store)).toContain('src_9f3');
  });
});

describe('preserveOnExport', () => {
  async function documentWith(definition: AnyCustomNodeDefinition): Promise<Uint8Array> {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'), [definition]);
    insertCustomNode(editor, definition, { k: 'v' }, 'the words', {
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: { body: 'private' },
    });
    return new Uint8Array(await editor.save());
  }

  test("'text' keeps the words and drops the markup, the binding and the payload", async () => {
    const exported = exportCustomNodes(await documentWith(ephemeral), [ephemeral]);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.unwrapped).toBe(1);
    const entries = unzipSync(exported.bytes);
    const xml = strFromU8(entries['word/document.xml']!);
    expect(xml).toContain('the words');
    expect(xml).not.toContain('<w:sdt>');
    expect(xml).not.toContain('acme:note');
    expect(xml).not.toContain('<w:dataBinding');
    // No part, no relationship, no Override.
    expect(Object.keys(entries).filter((name) => /customxml/i.test(name))).toEqual([]);
    expect(strFromU8(entries['[Content_Types].xml']!)).not.toContain('customXml');
    expect(strFromU8(entries['word/_rels/document.xml.rels']!)).not.toContain('customXml');
    // And it is still a document.
    expect(readOoxmlPackage(exported.bytes).ok).toBe(true);
  });

  test('`false` takes the content with it', async () => {
    const exported = exportCustomNodes(await documentWith(secret), [secret]);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.removed).toBe(1);
    const entries = unzipSync(exported.bytes);
    const xml = strFromU8(entries['word/document.xml']!);
    expect(xml).not.toContain('the words');
    expect(Object.keys(entries).filter((name) => /customxml/i.test(name))).toEqual([]);
  });

  test('the default leaves everything where it was', async () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    insertCustomNode(editor, citation, { sourceId: 'src_9f3' }, '(Smith 2024)', {
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    const exported = exportCustomNodes(new Uint8Array(await editor.save()), [citation]);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported).toMatchObject({ unwrapped: 0, removed: 0 });
    const entries = unzipSync(exported.bytes);
    expect(strFromU8(entries['word/document.xml']!)).toContain('<w:dataBinding');
    expect(Object.keys(entries)).toContain('customXml/item1.xml');
  });
});

describe('customNodeXml, for a server with no editor', () => {
  test('it answers the markup AND the store parts a caller has to add', () => {
    const built = customNodeXml(citation, { sourceId: 'src_9f3' }, '(Smith 2024)', {
      data: CITATION,
    });
    expect(built.ok).toBe(true);
    if (!built.ok || !built.store) throw new Error('no store');
    // The one link between the two halves, minted once and written into both.
    expect(built.xml).toContain(`w:storeItemID="${built.store.storeItemId}"`);
    expect(built.store.propsXml).toContain(`ds:itemID="${built.store.storeItemId}"`);
    expect(built.xml).toContain(
      'w:xpath="/ns0:docxEditor/ns0:node[@id=&apos;cx1&apos;]/ns0:label"'
    );
    expect(built.store.itemXml).toContain('<label>(Smith 2024)</label>');
    // CT_SdtPr order: out of sequence, Word refuses the document rather than the element.
    expect(built.xml.indexOf('<w:lock')).toBeLessThan(built.xml.indexOf('<w:dataBinding'));
  });

  test('a payload the schema refuses never becomes markup', () => {
    const built = customNodeXml(citation, { sourceId: 's' }, 'label', {
      // @ts-expect-error -- typed by the schema here too, see the insert above
      data: { ...CITATION, year: '2024' },
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reason).toContain('year');
  });

  test('with no payload it is exactly what it was before', () => {
    const built = customNodeXml(citation, { sourceId: 's' }, 'label');
    expect(built.ok && built.store).toBeUndefined();
    expect(built.ok && built.xml).not.toContain('dataBinding');
  });
});
