/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import type { AutomationHost, AutomationBatchRequest } from '@docx-editor.dev/core/automation';
import { createRuntime } from '../runtime.ts';
import { openHost } from './support/hosts.ts';

test('writes queued while read prerequisites await stay in the next sync', async () => {
  const inner = openHost();
  let reached!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const requests: AutomationBatchRequest[] = [];
  const host: AutomationHost = {
    ...inner,
    async prepare(request) {
      if (!held && request.operations.some((operation) => operation.op === 'getParagraphs')) {
        held = true;
        reached();
        await gate;
      }
    },
    execute(request) {
      requests.push(request);
      return inner.execute(request);
    },
  };
  const runtime = createRuntime({ host, save: true });
  try {
    await runtime.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      const font = paragraph.font;
      font.bold = true;
      paragraph.alignment = 'Centered';
      const first = context.sync();
      await entered;
      font.italic = true;
      paragraph.spaceAfter = 12;
      release();
      await first;
      const firstWrites = requests.flatMap((request) => request.operations);
      expect(firstWrites.find((operation) => operation.op === 'setFont')).toMatchObject({
        font: { bold: true },
      });
      expect(firstWrites.find((operation) => operation.op === 'setFont')).not.toMatchObject({
        font: { italic: true },
      });
      const format = firstWrites.find((operation) => operation.op === 'setParagraphFormat');
      expect(format).not.toMatchObject({ format: { spaceAfter: 12 } });

      // Planning the first batch must not detach the second batch's coalescers.
      font.underline = 'Single';
      paragraph.spaceBefore = 6;
      await context.sync();
      font.load('bold,italic,underline');
      paragraph.load('alignment,spaceBefore,spaceAfter');
      await context.sync();
      expect([font.bold, font.italic, font.underline]).toEqual([true, true, 'Single']);
      expect([paragraph.alignment, paragraph.spaceBefore, paragraph.spaceAfter]).toEqual([
        'Centered',
        6,
        12,
      ]);
    });
  } finally {
    runtime.dispose();
  }
});
