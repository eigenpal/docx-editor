/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The revisions a `StaleDocument` refusal reports over the browser host.
//
// The browser host prepares resources before it executes, and the runtime pins that
// preparation to the current revision. The pin is internal: a read-only batch still reports no
// `expectedRevision`, and a write reports the revision the context last read at, as the server
// host does.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import type { RequestContext } from '../../index.ts';
import { docx, p } from './support/docx.ts';

const SAMPLE =
  p('Governed by the State of New York, with courts in New York County.') + p('Other clause.');

async function find(c: RequestContext, text: string) {
  const matches = c.document.body.search(text, { matchCase: true });
  matches.load('items');
  await c.sync();
  return matches.items[0]!;
}

function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(SAMPLE) });
  if (!editor.surface) throw new Error('surface failed to mount');
  return {
    editor,
    dispose() {
      editor.destroy();
      container.remove();
    },
  };
}

test('a stale read-only batch reports no expected revision over the browser host', async () => {
  const mounted = mount();
  const runtime = DocxEditorBrowser.createBrowser(mounted.editor);
  try {
    await runtime.run(async (c) => {
      const county = await find(c, 'New York County');
      (await find(c, 'the State of New York')).insertText('the State of Delaware', 'Replace');
      await c.sync();

      county.load('text');
      const read = await c.sync().catch((caught: unknown) => caught);
      expect(read).toMatchObject({ code: 'StaleDocument' });
      expect((read as { expectedRevision?: number }).expectedRevision).toBeUndefined();

      county.font.bold = true;
      const write = await c.sync().catch((caught: unknown) => caught);
      expect(write).toMatchObject({ code: 'StaleDocument' });
      const { expectedRevision, actualRevision } = write as {
        expectedRevision?: number;
        actualRevision?: number;
      };
      expect(expectedRevision).toBeDefined();
      expect(expectedRevision).toBe(actualRevision);
    });
  } finally {
    runtime.dispose();
    mounted.dispose();
  }
});
