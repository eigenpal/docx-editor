/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The byte ownership boundary at the public server factory.
//
// A caller commonly reuses an upload buffer as soon as opening finishes, and commonly transfers a
// saved Uint8Array to another thread. Neither action may mutate the runtime's private document.

import { describe, expect, test } from 'bun:test';
import { DocxEditor } from '../../index.ts';
import { docx, p } from './support/docx.ts';

async function bodyText(bytes: Uint8Array): Promise<string> {
  const runtime = await DocxEditor.createServer(bytes);
  try {
    return await runtime.run(async (context) => {
      const body = context.document.body;
      body.load('text');
      await context.sync();
      return body.text;
    });
  } finally {
    runtime.dispose();
  }
}

describe('server byte ownership', () => {
  test('opening finishes consumption of the caller-owned input buffer', async () => {
    const input = docx(p('owned by the runtime'));
    const runtime = await DocxEditor.createServer(input);
    input.fill(0);

    try {
      const text = await runtime.run(async (context) => {
        const body = context.document.body;
        body.load('text');
        await context.sync();
        return body.text;
      });
      expect(text).toBe('owned by the runtime');
    } finally {
      runtime.dispose();
    }
  });

  test('each save returns caller-owned bytes independent of later saves', async () => {
    const runtime = await DocxEditor.createServer(docx(p('fresh save')));
    try {
      const first = await runtime.save();
      first.fill(0);
      const second = await runtime.save();
      expect(second.byteLength).toBeGreaterThan(0);
      expect(await bodyText(second)).toBe('fresh save');
    } finally {
      runtime.dispose();
    }
  });
});
