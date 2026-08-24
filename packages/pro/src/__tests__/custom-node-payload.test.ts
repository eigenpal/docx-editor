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
  prepareForExport,
  insertCustomNode,
  recognizeCustomNodes,
  removeCustomNode,
  customNodesOf,
  saveForExport,
  updateCustomNode,
  type AnyCustomNodeDefinition,
  type CustomNodeDiagnostic,
} from '../index.ts';
import { customNodePayloadsByControl } from '@docx-editor.dev/core/store';
import { customItemsOf } from '../review/review-model.ts';
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
  return recognizeCustomNodes(session.part(), nodes, {
    payloads: customNodePayloadsByControl(session.currentPackage(), session.part().name),
  });
}

describe('a payload larger than w:tag, declared by a schema', () => {
  test('it is written, survives a save and reopen, and comes back typed', async () => {
    const editor = mount(docx('<w:p><w:r><w:t>before after</w:t></w:r></w:p>'));
    const result = insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
      at: { paragraphId: firstParagraphId(editor), offset: 7 },
      data: CITATION,
    });
    expect(result).toMatchObject({ ok: true, changed: true });

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
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    const [node] = recognized(editor);
    expect(JSON.stringify(node?.data).length).toBeGreaterThan(64);
  });

  test('a payload that does not match the schema is refused, and nothing is written', () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    const result = insertCustomNode(editor, citation, {
      attrs: { sourceId: 's' },
      text: 'label',
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
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    const [before] = recognized(editor);
    const updated = updateCustomNode(editor, citation, before!.nodeId, {
      attrs: { sourceId: 'src_2' },
      text: '(Jones 2025)',
      data: { ...CITATION, sourceId: 'src_2', year: 2025 },
    });
    expect(updated).toMatchObject({ ok: true, changed: true });
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
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
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
    // Through the EDITOR, because that is what carries the listener now — the module is
    // registered on this instance and nothing else hears it.
    const [node] = customNodesOf(reopened, { onDiagnostic: (d) => seen.push(d) });
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
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    const [node] = recognized(editor);
    expect(removeCustomNode(editor, node!.nodeId)).toMatchObject({ ok: true, changed: true });
    const session = editor.surface!.session;
    const store = unzipSync(session.save())['customXml/item1.xml'];
    expect(store && strFromU8(store)).not.toContain('src_9f3');
  });

  test('a payload whose control was deleted in Word is collected on open', async () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
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
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
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
    insertCustomNode(editor, definition, {
      attrs: { k: 'v' },
      text: 'the words',
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: { body: 'private' },
    });
    return new Uint8Array(await editor.save());
  }

  test("'text' keeps the words and drops the markup, the binding and the payload", async () => {
    const exported = prepareForExport(await documentWith(ephemeral), [ephemeral]);
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
    const exported = prepareForExport(await documentWith(secret), [secret]);
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
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    const exported = prepareForExport(new Uint8Array(await editor.save()), [citation]);
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

describe('the failures a payload store can hide', () => {
  const shared = defineCustomNode({
    name: 'figure',
    tagPrefix: 'acme',
    schema: z.object({ n: z.string() }),
    preserveOnExport: true,
  });

  test('exporting a removed node does not ship its payload beside a surviving one', async () => {
    // `secret` and `shared` share a tagPrefix, so they share ONE store. Dropping the whole
    // store only when nothing binds it meant the surviving figure kept the removed node's
    // payload alive — the export said ok and shipped the data it was called to remove.
    const editor = mount(docx('<w:p><w:r><w:t>xy</w:t></w:r></w:p>'), [secret, shared]);
    insertCustomNode(editor, shared, {
      attrs: { n: '1' },
      text: 'Figure 1',
      at: { paragraphId: firstParagraphId(editor), offset: 0 },
      data: { n: '1' },
    });
    insertCustomNode(editor, secret, {
      attrs: { k: 'v' },
      text: 'classified',
      at: { paragraphId: firstParagraphId(editor), offset: 9 },
      data: { body: 'SHOULD-NOT-SHIP' },
    });

    const exported = prepareForExport(new Uint8Array(await editor.save()), [secret, shared]);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.removed).toBe(1);
    const entries = unzipSync(exported.bytes);
    const store = strFromU8(entries['customXml/item1.xml']!);
    expect(store).not.toContain('SHOULD-NOT-SHIP');
    // The figure the host asked to keep is untouched.
    expect(store).toContain('Figure 1');
    expect(strFromU8(entries['word/document.xml']!)).toContain('<w:dataBinding');
  });

  test('a payload a header binds is not swept away when the document opens', async () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    // Move the whole chip into a header, which Word permits — the data store is enumerated from
    // the main part, but nothing stops a control elsewhere quoting its `w:storeItemID`.
    const saved = unzipSync(new Uint8Array(await editor.save()));
    const body = strFromU8(saved['word/document.xml']!);
    const chip = /<w:sdt>.*<\/w:sdt>/s.exec(body)?.[0];
    if (!chip) throw new Error('no chip to move');
    saved['word/document.xml'] = strToU8(body.replace(chip, ''));
    saved['word/header1.xml'] = strToU8(`<w:hdr xmlns:w="${W}"><w:p>${chip}</w:p></w:hdr>`);
    saved['word/_rels/document.xml.rels'] = strToU8(
      strFromU8(saved['word/_rels/document.xml.rels']!).replace(
        '</Relationships>',
        `<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>`
      )
    );
    saved['[Content_Types].xml'] = strToU8(
      strFromU8(saved['[Content_Types].xml']!).replace(
        '</Types>',
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
      )
    );

    const reopened = mount(zipSync(saved));
    const store = unzipSync(reopened.surface!.session.save())['customXml/item1.xml'];
    // Reading the body alone made the open-time sweep collect this — with no undo entry.
    expect(store && strFromU8(store)).toContain('src_9f3');
  });

  test('an update in a HEADER keeps the payload the chip already binds', () => {
    // The store hangs off the MAIN part and the control lives in the header: two different
    // parts. Reading both from the body answered `undefined`, which the update contract reads
    // as "no payload" — so a rewrite naming only `text` dropped the data it was meant to carry
    // and orphaned the node for the next open-time sweep to delete.
    // No header authored: entering one creates the part, which is the ordinary way a user
    // gets here and keeps the fixture to the one thing under test.
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    expect(editor.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
    // The scope the editor actually opened, rather than one the test assumes: entering a
    // header creates the part when the section declares none.
    const scope = editor.getActiveScope();
    expect(scope.kind).toBe('headerFooter');
    const headerParagraph = editor.surface!.session.paragraphIdsIn(
      scope as { kind: 'headerFooter'; rId: string }
    )[0]!;

    const inserted = insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
      at: { paragraphId: headerParagraph, offset: 0 },
      data: CITATION,
    });
    expect(inserted).toMatchObject({ ok: true });
    if (!inserted.ok || inserted.nodeId === undefined) return;

    const updated = updateCustomNode(editor, citation, inserted.nodeId, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024, p. 42)',
    });
    expect(updated).toMatchObject({ ok: true, changed: true });

    const saved = unzipSync(editor.surface!.session.save());
    const headerPart = Object.keys(saved).find((name) => /^word\/header\d+\.xml$/.test(name))!;
    expect(strFromU8(saved[headerPart]!)).toContain('(Smith 2024, p. 42)');

    // REOPENED, because that is where the loss showed. An update that was handed no payload
    // still leaves the old node in the store, so an in-session save looks intact; the node is
    // simply no longer bound, and the open-time sweep collects it the next time the file is
    // opened. Asserting on this save alone passed with the defect in place.
    const reopened = mount(zipSync(saved));
    const store = unzipSync(reopened.surface!.session.save())['customXml/item1.xml'];
    expect(store && strFromU8(store)).toContain('src_9f3');
  });

  test('an update that only changes the label keeps the payload', () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    const [before] = recognized(editor);
    // The commonest update there is, and the one shape that used to delete the payload.
    const updated = updateCustomNode(editor, citation, before!.nodeId, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024, p. 42)',
    });
    expect(updated).toMatchObject({ ok: true, changed: true });
    const [after] = recognized(editor);
    expect(after?.text).toBe('(Smith 2024, p. 42)');
    expect(after?.data).toEqual(CITATION);
  });

  test('passing data: null removes the payload deliberately', () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    const [before] = recognized(editor);
    expect(
      updateCustomNode(editor, citation, before!.nodeId, {
        attrs: { sourceId: 's' },
        text: 'plain',
        data: null,
      }).ok
    ).toBe(true);
    const [after] = recognized(editor);
    expect(after?.data).toBeUndefined();
    const session = editor.surface!.session;
    expect(customNodePayloadsByControl(session.currentPackage(), session.part().name).size).toBe(0);
  });

  test('a definition with no reviewCard still gets its payload on a chip activation', () => {
    // The item exists so the chip's own surfaces can read it; the rail leaves it out.
    const bare = defineCustomNode({ name: 'citation', tagPrefix: 'acme', schema: Citation });
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'), [bare]);
    insertCustomNode(editor, bare, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    const [node] = recognized(editor, [bare]);
    expect(node?.data).toEqual(CITATION);
    // And through the review derivation, which is what the chip's click and hover read: the
    // item is there, saying it wants no card.
    const items = customItemsOf(
      editor.surface!.session.part(),
      [bare],
      customNodePayloadsByControl(
        editor.surface!.session.currentPackage(),
        editor.surface!.session.part().name
      )
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.carded).toBe(false);
    expect(items[0]?.data).toEqual(CITATION);
  });

  test('a binding naming a node the store lost is reported, not silent', async () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    const saved = unzipSync(new Uint8Array(await editor.save()));
    // What a half-stripped export or a hand edit leaves: the control still binds `cx1`.
    saved['customXml/item1.xml'] = strToU8(
      strFromU8(saved['customXml/item1.xml']!).replace(/<node id="cx1">.*<\/node>/s, '')
    );

    const seen: CustomNodeDiagnostic[] = [];
    // Reopened with a namespace nobody claims, so the sweep does not tidy it away first.
    const other = defineCustomNode({
      name: 'citation',
      tagPrefix: 'acme',
      schema: Citation,
      payloadNamespace: 'urn:example:unclaimed',
    });
    const reopened = mount(zipSync(saved), [other], (diagnostic) => seen.push(diagnostic));
    customNodesOf(reopened, { onDiagnostic: (d) => seen.push(d) });
    expect(seen.map((entry) => entry.code)).toContain('payload-missing');
  });

  test('two root names for one namespace is refused, not bound to nothing', () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    const session = editor.surface!.session;
    const paragraphId = firstParagraphId(editor);
    expect(
      session.insertCustomNode({
        paragraphId,
        offset: 1,
        tag: 'acme:a',
        text: 'A',
        payload: {
          namespaceUri: 'urn:x',
          rootLocalName: 'storeA',
          nodeId: 'cx1',
          label: 'A',
          data: '{}',
        },
      }).ok
    ).toBe(true);
    // A second root name for the same namespace would have authored an xpath naming an element
    // the store does not have — Word resolves that to nothing and paints an empty control.
    const second = session.insertCustomNode({
      paragraphId,
      offset: 0,
      tag: 'acme:b',
      text: 'B',
      payload: {
        namespaceUri: 'urn:x',
        rootLocalName: 'storeB',
        nodeId: 'cx2',
        label: 'B',
        data: '{}',
      },
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('store-not-authored');
      expect(second.detail).toContain('storeB');
    }
  });
});

describe('one payload, derived into the document', () => {
  const Derived = defineCustomNode({
    name: 'citation',
    tagPrefix: 'acme',
    schema: Citation,
    // What the document shows, computed from the payload — so the two cannot disagree.
    text: (data) => `(${data.authors[0] ?? 'Anon'} ${String(data.year)})`,
    tagAttrs: (data) => ({ sourceId: data.sourceId }),
  });

  test('an insert takes the payload alone', () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'), [Derived]);
    const result = insertCustomNode(editor, Derived, {
      data: CITATION,
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    const [node] = recognized(editor, [Derived]);
    expect(node?.text).toBe('(Smith, J. 2024)');
    expect(node?.attrs['sourceId']).toBe('src_9f3');
    expect(node?.data).toEqual(CITATION);
  });

  test('an update re-derives the text from the new payload', () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'), [Derived]);
    insertCustomNode(editor, Derived, {
      data: CITATION,
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
    });
    const [before] = recognized(editor, [Derived]);
    expect(
      updateCustomNode(editor, Derived, before!.nodeId, {
        data: { ...CITATION, authors: ['Jones, P.'], year: 2025 },
      }).ok
    ).toBe(true);
    const [after] = recognized(editor, [Derived]);
    // The document text moved with the payload — nothing had to be passed twice.
    expect(after?.text).toBe('(Jones, P. 2025)');
  });

  test('an explicit text overrides the derivation', () => {
    // A label a user edited by hand must not be recomputed out from under them.
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'), [Derived]);
    insertCustomNode(editor, Derived, {
      data: CITATION,
      attrs: { sourceId: 'src_9f3' },
      text: 'ibid.',
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
    });
    expect(recognized(editor, [Derived])[0]?.text).toBe('ibid.');
  });

  test('a definition with no `text` hook and no `text` value is refused, and says which', () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    const result = insertCustomNode(editor, citation, { data: CITATION });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('text');
  });
});

describe('a refused payload names the field, not just the sentence', () => {
  test('the issues carry the path an edit form needs', () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    const result = insertCustomNode(editor, citation, {
      attrs: { sourceId: 's' },
      text: 'label',
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      // @ts-expect-error -- year is a number in the schema
      data: { ...CITATION, year: '2024', authors: [1] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalidArgs');
    const pointers = (result.issues ?? []).map((issue) => issue.pointer);
    // A form highlights `year` and `authors.0` from these — no string parsing.
    expect(pointers).toContain('year');
    expect(pointers).toContain('authors.0');
    expect(result.issues?.[0]?.path[0]).toBeDefined();
  });
});

describe('the copy you keep and the copy that leaves', () => {
  test('an internal destination answers the bytes untouched', async () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'), [ephemeral]);
    insertCustomNode(editor, ephemeral, {
      attrs: { k: 'v' },
      text: 'the words',
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: { body: 'private' },
    });
    const saved = new Uint8Array(await editor.save());

    const kept = prepareForExport(saved, [ephemeral], { destination: 'internal' });
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    // Byte-identical: an internal save must be what the editor produced, not a re-serialization.
    expect(kept.bytes).toBe(saved);
    expect(kept).toMatchObject({ unwrapped: 0, removed: 0 });
    // And it still opens with its chips, which is the point of keeping it.
    expect(recognized(mount(kept.bytes, [ephemeral]), [ephemeral])).toHaveLength(1);

    const leaving = prepareForExport(saved, [ephemeral], { destination: 'external' });
    expect(leaving.ok && leaving.unwrapped).toBe(1);
  });
});

describe('dataOf: the payload, typed, wherever it turns up', () => {
  test('it validates against this definition and narrows the type', () => {
    const survey = citation.dataOf({ name: 'citation', data: CITATION });
    expect(survey).toEqual(CITATION);
    // Typed, not `unknown` — reading a field needs no cast and no guard.
    expect(survey?.year).toBe(2024);
  });

  test("another definition's node answers undefined rather than a wrong type", () => {
    expect(secret.dataOf({ name: 'citation', data: CITATION })).toBeUndefined();
  });

  test('a payload the schema rejects answers undefined', () => {
    expect(citation.dataOf({ name: 'citation', data: { ...CITATION, year: 'x' } })).toBeUndefined();
  });

  test('an object carrying only a payload works — a name is checked, never required', () => {
    // The shape a host's own popover or form state has: it kept the payload, not the identity.
    expect(citation.dataOf({ data: CITATION })).toEqual(CITATION);
    expect(citation.dataOf({})).toBeUndefined();
    expect(citation.dataOf(null)).toBeUndefined();
  });

  test('with no schema it hands back what the file held, unchecked', () => {
    const bare = defineCustomNode({ name: 'bare', tagPrefix: 'acme' });
    expect(bare.dataOf({ data: { anything: 1 } })).toEqual({ anything: 1 });
  });
});

describe('diagnostics belong to the editor that registered them', () => {
  /** A document whose control binds a store node the file no longer holds. */
  async function withBrokenBinding(): Promise<Uint8Array> {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    insertCustomNode(editor, citation, {
      attrs: { sourceId: 'src_9f3' },
      text: '(Smith 2024)',
      at: { paragraphId: firstParagraphId(editor), offset: 1 },
      data: CITATION,
    });
    const saved = unzipSync(new Uint8Array(await editor.save()));
    saved['customXml/item1.xml'] = strToU8(
      strFromU8(saved['customXml/item1.xml']!).replace(/<node id="cx1">.*<\/node>/s, '')
    );
    return zipSync(saved);
  }

  test('a second editor does not hear about the first editor’s document', async () => {
    const broken = await withBrokenBinding();
    const clean = docx('<w:p><w:r><w:t>nothing here</w:t></w:r></w:p>');
    // The namespace nobody claims keeps the open-time sweep from tidying the orphan away first.
    const unclaimed = defineCustomNode({
      name: 'citation',
      tagPrefix: 'acme',
      schema: Citation,
      payloadNamespace: 'urn:example:unclaimed',
    });

    const heardByClean: string[] = [];
    const heardByBroken: string[] = [];
    const cleanEditor = mount(clean, [unclaimed], (d) => heardByClean.push(d.code));
    const brokenEditor = mount(broken, [unclaimed], (d) => heardByBroken.push(d.code));

    customNodesOf(brokenEditor);
    expect(heardByBroken).toContain('payload-missing');
    // The listener was module-level once, so this editor was told about a document it never
    // opened — and the diagnostic carries no editor id, so it could not have filtered it out.
    expect(heardByClean).toEqual([]);

    customNodesOf(cleanEditor);
    expect(heardByClean).toEqual([]);
  });

  test('a detached editor stops hearing anything', async () => {
    const broken = await withBrokenBinding();
    const unclaimed = defineCustomNode({
      name: 'citation',
      tagPrefix: 'acme',
      schema: Citation,
      payloadNamespace: 'urn:example:unclaimed',
    });
    const heard: string[] = [];
    const gone = mount(broken, [unclaimed], (d) => heard.push(d.code));
    gone.destroy();

    // A fresh editor with its own listener. Nothing routes to the destroyed one's closure.
    const live: string[] = [];
    const editor = mount(broken, [unclaimed], (d) => live.push(d.code));
    customNodesOf(editor);
    expect(live).toContain('payload-missing');
    expect(heard).toEqual([]);
  });
});

// `saveForExport` is `prepareForExport` with the definition list taken off the editor instead of
// out of the call. That difference IS the feature: the list argument is the one a host gets wrong,
// and getting it wrong ships a node it meant to withhold, silently and with `ok: true`.
describe('saveForExport', () => {
  test('applies a registered definition the caller never named', async () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'), [citation, secret]);
    insertCustomNode(editor, secret, {
      attrs: { k: 'v' },
      text: 'classified',
      at: { paragraphId: firstParagraphId(editor), offset: 0 },
      data: { body: 'SHOULD-NOT-SHIP' },
    });

    const exported = await saveForExport(editor);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.removed).toBe(1);
    const entries = unzipSync(exported.bytes);
    expect(strFromU8(entries['word/document.xml']!)).not.toContain('classified');
    expect(Object.keys(entries).filter((name) => /customxml/i.test(name))).toEqual([]);
  });

  test('leaves the editor and its saved copy alone', async () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'), [ephemeral]);
    insertCustomNode(editor, ephemeral, {
      attrs: { k: 'v' },
      text: 'the words',
      at: { paragraphId: firstParagraphId(editor), offset: 0 },
      data: { body: 'internal' },
    });

    const exported = await saveForExport(editor);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.unwrapped).toBe(1);
    expect(strFromU8(unzipSync(exported.bytes)['word/document.xml']!)).not.toContain(
      '<w:dataBinding'
    );

    // The copy you keep is unchanged: same editor, saved after the export, chips intact.
    const kept = unzipSync(new Uint8Array(await editor.save()));
    expect(strFromU8(kept['word/document.xml']!)).toContain('<w:dataBinding');
    expect(customNodesOf(editor)).toHaveLength(1);
  });

  test('destination internal answers the saved bytes untouched', async () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'), [secret]);
    insertCustomNode(editor, secret, {
      attrs: { k: 'v' },
      text: 'classified',
      at: { paragraphId: firstParagraphId(editor), offset: 0 },
      data: { body: 'kept' },
    });

    const exported = await saveForExport(editor, { destination: 'internal' });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported).toMatchObject({ unwrapped: 0, removed: 0 });
    expect(strFromU8(unzipSync(exported.bytes)['word/document.xml']!)).toContain('classified');
  });

  test('an explicit nodes list narrows what is applied', async () => {
    const editor = mount(docx('<w:p><w:r><w:t>x</w:t></w:r></w:p>'), [citation, secret]);
    insertCustomNode(editor, secret, {
      attrs: { k: 'v' },
      text: 'classified',
      at: { paragraphId: firstParagraphId(editor), offset: 0 },
      data: { body: 'kept' },
    });

    // `secret` is registered but not listed, so its policy does not run and the node travels.
    const exported = await saveForExport(editor, { nodes: [citation] });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported).toMatchObject({ unwrapped: 0, removed: 0 });
    expect(strFromU8(unzipSync(exported.bytes)['word/document.xml']!)).toContain('classified');
  });
});
