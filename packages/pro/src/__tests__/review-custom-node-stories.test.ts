/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A review card for a chip in a header carries the chip's data.
//
// The queue lists cards from every story, so it needs the payloads of every story. It asked for
// the body's, which meant a chip in a header produced a card with `data: undefined` — and that
// is indistinguishable from a chip that genuinely carries none, so a host had no way to tell a
// missing payload from an absent one.
//
// Payload ids are part-qualified, so one merged map serves every story without collision. That
// is what makes the fix safe, and this asserts both halves: the header chip has its data, and
// the body chip beside it still has its own.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { z } from 'zod';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { customNodesModule, customNodesOf, defineCustomNode, insertCustomNode } from '../index.ts';
import { reviewModule } from '../review/review-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const HEADER_R_ID = 'rId10';

const Citation = z.object({ sourceId: z.string().min(1), year: z.number().int() });
const citation = defineCustomNode({ name: 'citation', tagPrefix: 'acme', schema: Citation });

const BODY_DATA = { sourceId: 'src_body', year: 2024 };
const HEADER_DATA = { sourceId: 'src_header', year: 1999 };

function docx(): Uint8Array {
  const para = '<w:p><w:r><w:t>before after</w:t></w:r></w:p>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.' +
        'relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.wordprocessingml.header+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        '</Relationships>'
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="${HEADER_R_ID}" Type="${R}/header" Target="header1.xml"/>` +
        '</Relationships>'
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${para}</w:hdr>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${para}` +
        `<w:sectPr><w:headerReference w:type="default" r:id="${HEADER_R_ID}"/></w:sectPr>` +
        '</w:body></w:document>'
    ),
  });
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function mount(bytes: Uint8Array): DocxEditorInstance {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createDocxEditor({
    document: bytes,
    author: 'Parity',
    modules: [customNodesModule({ nodes: [citation] }), reviewModule()],
  });
  cleanup = () => {
    editor.destroy();
    host.remove();
    document.getSelection()?.removeAllRanges();
  };
  editor.attach(host);
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

describe('a review card carries its chip’s data, in every story', () => {
  test('a header chip and a body chip each keep their own payload', async () => {
    const editor = mount(docx());
    const surface = editor.surface!;

    const bodyParagraph = surface.state().selection.head.paragraphId;
    expect(
      insertCustomNode(editor, citation, {
        attrs: { sourceId: BODY_DATA.sourceId },
        text: '(Body)',
        at: { paragraphId: bodyParagraph, offset: 7 },
        data: BODY_DATA,
      })
    ).toMatchObject({ ok: true });

    expect(surface.enterHeaderFooter({ rId: HEADER_R_ID })).toBe(true);
    const headerParagraph = surface.state().selection.head.paragraphId;
    expect(
      insertCustomNode(editor, citation, {
        attrs: { sourceId: HEADER_DATA.sourceId },
        text: '(Header)',
        at: { paragraphId: headerParagraph, offset: 7 },
        data: HEADER_DATA,
      })
    ).toMatchObject({ ok: true });

    // Reopened, because a payload only has to be RESOLVED on the way back in — writing it and
    // reading back the value still in hand proves nothing about the store.
    const reopened = mount(new Uint8Array(await editor.save()));
    // The card's `data` rides on the ITEM the placement carries, not on the placement itself.
    const cards = reopened
      .getReviewItems()
      .filter((placement) => placement.kind === 'custom')
      .map((placement) => placement.item as { readonly data?: unknown });
    const dataFor = (sourceId: string): unknown =>
      cards.find((item) => (item.data as { sourceId?: string } | undefined)?.sourceId === sourceId)
        ?.data;

    expect(cards.length, 'one card per chip').toBe(2);
    expect(dataFor(HEADER_DATA.sourceId), 'the header card lost its data').toEqual(HEADER_DATA);
    // The merged map is keyed by part-qualified control id, so the body chip is untouched.
    expect(dataFor(BODY_DATA.sourceId), 'the body card lost its data').toEqual(BODY_DATA);
  });
});

describe('customNodesOf lists the whole document', () => {
  test('a chip in a header is in the list', async () => {
    const editor = mount(docx());
    const surface = editor.surface!;

    insertCustomNode(editor, citation, {
      attrs: { sourceId: BODY_DATA.sourceId },
      text: '(Body)',
      at: { paragraphId: surface.state().selection.head.paragraphId, offset: 7 },
      data: BODY_DATA,
    });
    expect(surface.enterHeaderFooter({ rId: HEADER_R_ID })).toBe(true);
    insertCustomNode(editor, citation, {
      attrs: { sourceId: HEADER_DATA.sourceId },
      text: '(Header)',
      at: { paragraphId: surface.state().selection.head.paragraphId, offset: 7 },
      data: HEADER_DATA,
    });

    const reopened = mount(new Uint8Array(await editor.save()));
    const found = customNodesOf(reopened)
      .map((node) => node.attrs.sourceId)
      .sort();
    // Reading only the body reported a document with one chip in it, while the review queue
    // beside it reported two. A host building a picker from this could not offer the chip the
    // reader was looking at.
    expect(found).toEqual([BODY_DATA.sourceId, HEADER_DATA.sourceId].sort());
    // And each keeps its own payload: ids are part-qualified, so one merged map cannot collide.
    const dataOf = (sourceId: string): unknown =>
      customNodesOf(reopened).find((node) => node.attrs.sourceId === sourceId)?.data;
    expect(dataOf(HEADER_DATA.sourceId)).toEqual(HEADER_DATA);
    expect(dataOf(BODY_DATA.sourceId)).toEqual(BODY_DATA);
  });
});
