/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `Paragraph.contentControls` and `Range.contentControls`: the controls a paragraph or a range
// overlaps, so an agent can tell which word ranges touch a locked control before it edits.

import { describe, expect, test } from 'bun:test';
import { DocxEditor } from '../../index.ts';
import { docx, p } from './support/docx.ts';

const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const control = (tag: string, text: string, locked = false) =>
  `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/>${locked ? '<w:lock w:val="contentLocked"/>' : ''}` +
  `</w:sdtPr><w:sdtContent>${t(text)}</w:sdtContent></w:sdt>`;

const INLINE = docx(
  `<w:p>${t('Pay ')}${control('party', 'Acme Corp', true)}${t(' within ')}${control('days', '30')}${t(' days.')}</w:p>` +
    p('Second paragraph.')
);
const BLOCK = docx(
  '<w:sdt><w:sdtPr><w:tag w:val="clause"/></w:sdtPr><w:sdtContent>' +
    `<w:p>${t('Inside ')}${control('inner', 'nested')}</w:p>` +
    '</w:sdtContent></w:sdt>' +
    p('Outside.')
);

describe('Paragraph.contentControls and Range.contentControls', () => {
  test('a paragraph lists its inline controls in document order', async () => {
    const runtime = await DocxEditor.createServer(INLINE);
    try {
      const read = await runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items');
        await context.sync();
        const first = paragraphs.items[0]!.contentControls;
        const second = paragraphs.items[1]!.contentControls;
        first.load('items/tag,items/cannotEdit,items/text');
        second.load('items');
        await context.sync();
        return {
          first: first.items.map((item) => [item.tag, item.cannotEdit, item.text]),
          second: second.items.length,
        };
      });
      expect(read.first).toEqual([
        ['party', true, 'Acme Corp'],
        ['days', false, '30'],
      ]);
      expect(read.second).toBe(0);
    } finally {
      runtime.dispose();
    }
  });

  test('each word range reports the controls it touches, in one sync', async () => {
    const runtime = await DocxEditor.createServer(INLINE);
    try {
      const read = await runtime.run(async (context) => {
        const words = context.document.body.paragraphs.getFirst().getTextRanges([' ']);
        words.load('items/text');
        await context.sync();
        const controls = words.items.map((word) => word.contentControls);
        for (const list of controls) list.load('items/tag,items/cannotEdit');
        await context.sync();
        return words.items.map((word, index) => [
          word.text,
          controls[index]!.items.map((item) => `${item.tag}:${String(item.cannotEdit)}`),
        ]);
      });
      expect(read).toEqual([
        ['Pay ', []],
        ['Acme ', ['party:true']],
        ['Corp ', ['party:true']],
        ['within ', []],
        ['30 ', ['days:false']],
        ['days.', []],
      ]);
    } finally {
      runtime.dispose();
    }
  });

  test('a block control that holds the paragraph counts, with its nested controls', async () => {
    const runtime = await DocxEditor.createServer(BLOCK);
    try {
      const read = await runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items');
        await context.sync();
        const inside = paragraphs.items[0]!.contentControls;
        const outside = paragraphs.items[1]!.contentControls;
        const byTag = paragraphs.items[0]!.contentControls.getByTag('inner');
        inside.load('items/tag');
        outside.load('items');
        byTag.load('items/text');
        await context.sync();
        return {
          inside: inside.items.map((item) => item.tag),
          outside: outside.items.length,
          byTag: byTag.items.map((item) => item.text),
        };
      });
      expect(read).toEqual({ inside: ['clause', 'inner'], outside: 0, byTag: ['nested'] });
    } finally {
      runtime.dispose();
    }
  });

  test('a collapsed range at a control edge reports that control', async () => {
    const runtime = await DocxEditor.createServer(INLINE);
    try {
      const tags = await runtime.run(async (context) => {
        const point = context.document.body.search('Acme').getFirst().getRange('Start');
        const controls = point.contentControls;
        controls.load('items/tag');
        await context.sync();
        return controls.items.map((item) => item.tag);
      });
      expect(tags).toEqual(['party']);
    } finally {
      runtime.dispose();
    }
  });
});
