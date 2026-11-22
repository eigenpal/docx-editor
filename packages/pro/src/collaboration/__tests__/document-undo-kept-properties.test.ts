/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An undo of a first formatting edit keeps the properties another participant added to the
// property containers that edit created, nested containers included.

import { afterAll, afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync } from 'fflate';
import type { Paragraph } from '@docx-editor.dev/editor-api/browser';
import { later, ORDERS, room, type Runtime } from './concurrent-split-room';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});
afterEach(() => setSystemTime());

type Edit = (paragraph: Paragraph) => void;

/** Apply `edit` to the first paragraph without tracking. */
const format = (runtime: Runtime, edit: Edit) =>
  runtime.run(async (context) => {
    context.document.changeTrackingMode = 'Off';
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    edit(paragraphs.items[0]!);
    await context.sync();
  });

/** How often `pattern` occurs in a peer's saved document. */
async function occurrences(editor: { save(): Promise<ArrayBuffer | Uint8Array> }, pattern: RegExp) {
  const saved = unzipSync(new Uint8Array(await editor.save()));
  return strFromU8(saved['word/document.xml']!).match(pattern)?.length ?? 0;
}

const CASES = [
  {
    name: 'paragraph properties',
    first: ((paragraph) => (paragraph.alignment = 'Centered')) as Edit,
    second: ((paragraph) => (paragraph.leftIndent = 36)) as Edit,
    gone: /<w:jc /g,
    kept: /<w:ind /g,
    count: 1,
  },
  {
    // Formatting the whole paragraph formats its mark too: `w:pPr/w:rPr`.
    name: 'paragraph mark run properties',
    first: ((paragraph) => (paragraph.getRange('Whole').font.bold = true)) as Edit,
    second: ((paragraph) => (paragraph.getRange('Whole').font.italic = true)) as Edit,
    gone: /<w:b\/>/g,
    kept: /<w:i\/>/g,
    count: 2,
  },
];

describe('an undo of a first formatting edit', () => {
  for (const { name, first, second, gone, kept, count } of CASES)
    for (const { label, ids } of ORDERS)
      test(`keeps another participant's ${name} (${label})`, async () => {
        const r = await room('a; b; c;', ids);
        try {
          later();
          await format(r.carol.runtime, first);
          r.sync();
          later();
          await format(r.alice.runtime, second);
          r.sync();
          expect(r.carol.room.session.undo()).toBe(true);
          r.sync();
          await r.expectAll(['a; b; c;', 'Signed']);
          expect(await occurrences(r.carol.editor, gone)).toBe(0);
          expect(await occurrences(r.carol.editor, kept)).toBe(count);
          await r.expectJoinerConverges();
          expect(r.carol.room.session.redo()).toBe(true);
          r.sync();
          await r.expectAll(['a; b; c;', 'Signed']);
          expect(await occurrences(r.carol.editor, gone)).toBe(count);
          expect(await occurrences(r.carol.editor, kept)).toBe(count);
        } finally {
          r.close();
        }
      });
});
