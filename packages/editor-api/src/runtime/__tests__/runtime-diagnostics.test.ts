/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A refused batch explains itself: `debugInfo.innerError` carries a public diagnostic code and
// its fixed hint, in the Office.js `DebugInfo` shape, and a module with `onDiagnostic` hears
// the same refusal anonymously.
import { expect, test } from 'bun:test';
import type { EditorDiagnostic } from '@docx-editor.dev/core/contracts/editor';
import { DocxEditor, isDocxEditorError } from '../../index.ts';
import { docx, p } from './support/docx.ts';

const SECRET = 'Confidential settlement terms';
const sample = docx(p(SECRET) + p('Second clause.'));

function observer() {
  const events: EditorDiagnostic[] = [];
  return {
    events,
    module: { id: 'observer', onDiagnostic: (event: EditorDiagnostic) => events.push(event) },
  };
}

test('an operation tracking cannot record names its cause in debugInfo.innerError', async () => {
  const { events, module } = observer();
  const runtime = await DocxEditor.createServer(sample, { author: 'Agent', modules: [module] });
  try {
    await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      context.document.body.clear();
      const error = await context.sync().catch((caught: unknown) => caught);
      expect(isDocxEditorError(error)).toBe(true);
      if (!isDocxEditorError(error)) return;
      expect(error.code).toBe('NotSupported');
      expect(error.debugInfo).toMatchObject({
        code: 'NotSupported',
        message: error.message,
        innerError: { code: 'edit.tracked-operation-unsupported' },
      });
      expect(error.debugInfo.innerError!.message).toContain('Never switch tracking off');
      // The location is the consumer's own call path, never an engine detail.
      expect(error.debugInfo.errorLocation).toBe('document.body.clear');
    });
    expect(events.map((event) => event.kind)).toEqual(['document.open', 'edit.rejected']);
    expect(events[0]).toMatchObject({ outcome: 'opened', sizeBucket: '0-64KiB' });
    expect(events[0]).not.toHaveProperty('pagesBucket');
    expect(events[1]).toMatchObject({
      code: 'edit.tracked-operation-unsupported',
      origin: 'automation',
      tracked: true,
    });
    expect(JSON.stringify(events)).not.toContain(SECRET);
  } finally {
    runtime.dispose();
  }
});

test('a refusal under a mode the batch set itself counts as tracked', async () => {
  const { events, module } = observer();
  const runtime = await DocxEditor.createServer(sample, { author: 'Agent', modules: [module] });
  try {
    await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      context.document.body.clear();
      await context.sync().catch(() => {});
    });
    const rejected = events.filter((event) => event.kind === 'edit.rejected');
    expect(rejected).toEqual([expect.objectContaining({ tracked: true, origin: 'automation' })]);
  } finally {
    runtime.dispose();
  }
});

test('TrackAll and a missing author each have their own code', async () => {
  const withoutAuthor = await DocxEditor.createServer(sample);
  try {
    await withoutAuthor.run(async (context) => {
      context.document.changeTrackingMode = 'TrackAll';
      await expect(context.sync()).rejects.toMatchObject({
        debugInfo: { innerError: { code: 'edit.tracking-mode-unsupported' } },
      });
      context.document.changeTrackingMode = 'TrackMineOnly';
      await expect(context.sync()).rejects.toMatchObject({
        debugInfo: { innerError: { code: 'edit.tracking-author-required' } },
      });
    });
  } finally {
    withoutAuthor.dispose();
  }
});

test('a refused open names its cause, and an observer hears it', async () => {
  const { events, module } = observer();
  const error = await DocxEditor.createServer(new Uint8Array([1, 2, 3]), {
    modules: [module],
  }).catch((caught: unknown) => caught);
  expect(isDocxEditorError(error)).toBe(true);
  if (!isDocxEditorError(error)) return;
  expect(error.debugInfo.errorLocation).toBe('createServer');
  expect(error.debugInfo.innerError?.code).toMatch(/^open\./);
  expect(events).toEqual([
    expect.objectContaining({
      kind: 'document.open',
      outcome: 'rejected',
      code: error.debugInfo.innerError!.code,
    }),
  ]);
});

test('invalid limits are reported as a refused open', async () => {
  const { events, module } = observer();
  await expect(
    DocxEditor.createServer(sample, { modules: [module], limits: { maxXmlParts: -1 } })
  ).rejects.toMatchObject({ code: 'InvalidArgument' });
  expect(events).toEqual([
    expect.objectContaining({
      kind: 'document.open',
      outcome: 'rejected',
      code: 'open.invalid-limits',
    }),
  ]);
});

test('an error without an engine reason has debugInfo and no innerError', async () => {
  const runtime = await DocxEditor.createServer(sample);
  try {
    await runtime.run(async (context) => {
      const error = (() => {
        try {
          return context.document.changeTrackingMode;
        } catch (caught) {
          return caught;
        }
      })();
      expect(isDocxEditorError(error)).toBe(true);
      if (!isDocxEditorError(error)) return;
      expect(error.debugInfo).toEqual({
        code: 'PropertyNotLoaded',
        message: error.message,
        errorLocation: expect.any(String),
      });
    });
  } finally {
    runtime.dispose();
  }
});

test('a refused open names the engine reason and the part role, never the part', async () => {
  const { events, module } = observer();
  // `q:` has no namespace declaration.
  const malformed = docx(`<w:p><q:x/></w:p>${p(SECRET)}`);
  await expect(DocxEditor.createServer(malformed, { modules: [module] })).rejects.toThrow();
  expect(events).toEqual([
    expect.objectContaining({
      kind: 'document.open',
      outcome: 'rejected',
      code: 'open.xml-malformed',
      cause: 'undeclared-prefix',
      part: 'main-document',
    }),
  ]);
  const text = JSON.stringify(events);
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain('document.xml');
});

test('a refused batch carries the engine reason behind its public code', async () => {
  const { events, module } = observer();
  const runtime = await DocxEditor.createServer(sample, { author: 'Agent', modules: [module] });
  try {
    await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      context.document.body.clear();
      await context.sync().catch(() => {});
    });
    expect(events.find((event) => event.kind === 'edit.rejected')).toMatchObject({
      code: 'edit.tracked-operation-unsupported',
      cause: 'change-tracking-operation-unsupported',
    });
  } finally {
    runtime.dispose();
  }
});
