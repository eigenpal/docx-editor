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
import {
  later,
  ORDERS,
  rejectAll,
  revisionCount,
  room,
  type Runtime,
} from './concurrent-split-room';

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

/** A peer's saved document body, without revision-save IDs. */
async function savedBody(editor: { save(): Promise<ArrayBuffer | Uint8Array> }) {
  const saved = unzipSync(new Uint8Array(await editor.save()));
  return strFromU8(saved['word/document.xml']!)
    .replace(/.*<w:body>/s, '')
    .replace(/ w:rsid\w*="[^"]*"/g, '');
}

/** Each order of undos and redos ends with both edits undone. */
const SEQUENCES: readonly { name: string; steps: readonly ('carol' | 'alice' | 'redo')[] }[] = [
  { name: 'the first edit, then the second', steps: ['carol', 'alice'] },
  { name: 'the second edit, then the first', steps: ['alice', 'carol'] },
  {
    name: 'both, redoes both, and undoes both again',
    steps: ['carol', 'alice', 'redo', 'redo', 'carol', 'alice'],
  },
];

describe('undoing both of two run formatting edits', () => {
  const { first, second } = CASES[1]!;
  for (const sequence of SEQUENCES)
    for (const { label, ids } of ORDERS)
      test(`${sequence.name} leaves the run without an empty w:rPr (${label})`, async () => {
        const r = await room('a; b; c;', ids);
        try {
          later();
          await format(r.carol.runtime, first);
          r.sync();
          later();
          await format(r.alice.runtime, second);
          r.sync();
          const undone: ('carol' | 'alice')[] = [];
          for (const step of sequence.steps) {
            later();
            if (step === 'redo') {
              // Redo in the order the edits were made: the first undo's last.
              expect(r[undone.shift()!].room.session.redo()).toBe(true);
            } else {
              undone.push(step);
              expect(r[step].room.session.undo()).toBe(true);
            }
            r.sync();
          }
          await r.expectAll(['a; b; c;', 'Signed']);
          await r.expectJoinerConverges();
          expect(await savedBody(r.carol.editor)).not.toContain('<w:r><w:rPr/>');
        } finally {
          r.close();
        }
      });
});

describe('undos that empty paragraph properties', () => {
  const tracked =
    '<w:pPr><w:jc w:val="center"/><w:pPrChange w:id="1" w:author="Dana" ' +
    'w:date="2024-01-01T00:00:00Z"><w:pPr/></w:pPrChange></w:pPr>';
  for (const { label, ids } of ORDERS) {
    test(`bring back the alignment and change that a later undo puts back (${label})`, async () => {
      const r = await room('a; b; c;', ids, tracked);
      try {
        const original = await savedBody(r.alice.editor);
        later();
        await rejectAll(r.alice.runtime);
        r.sync();
        later();
        await format(r.alice.runtime, (paragraph) => (paragraph.leftIndent = 36));
        r.sync();
        for (let step = 0; step < 2; step += 1) {
          later();
          expect(r.alice.room.session.undo()).toBe(true);
          r.sync();
        }
        await r.expectJoinerConverges();
        expect(await savedBody(r.carol.editor)).toBe(original);
        expect(await revisionCount(r.carol.runtime)).toBe(1);
      } finally {
        r.close();
      }
    });

    test(`keep a property another participant adds at the same time (${label})`, async () => {
      const r = await room('a; b; c;', ids, '<w:pPr/>');
      try {
        later();
        await format(r.alice.runtime, (paragraph) => (paragraph.alignment = 'Centered'));
        r.sync();
        r.offline();
        later();
        expect(r.alice.room.session.undo()).toBe(true);
        later();
        await format(r.bob.runtime, (paragraph) => (paragraph.leftIndent = 36));
        r.online();
        r.sync();
        await r.expectJoinerConverges();
        expect(await occurrences(r.carol.editor, /<w:ind /g)).toBe(1);
        expect(await occurrences(r.carol.editor, /<w:jc /g)).toBe(0);
      } finally {
        r.close();
      }
    });
  }
});
