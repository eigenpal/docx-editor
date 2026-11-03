/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterAll, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { CompareTarget, DocxEditor } from '@docx-editor.dev/editor-api';
import { DocxEditor as BrowserDocxEditor } from '@docx-editor.dev/editor-api/browser';
import { reviewModule } from '../../../../pro/src/review/review-module.ts';
import { compareDocuments } from '../../../../pro/src/compare/index.ts';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { docx, p } from './support/documents.ts';

const ORIGINAL = docx(p('The quick brown fox jumps.') + p('Second paragraph stays.'));
const REVISED = docx(p('The quick red fox jumps far.') + p('Second paragraph stays.'));

function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function bodyXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml']!);
}

test('server compare writes the differences as tracked revisions by the given author', async () => {
  const runtime = await DocxEditor.createServer(ORIGINAL, { modules: [reviewModule()] });
  try {
    await runtime.run(async (context) => {
      context.document.compareFromBase64(base64Of(REVISED), {
        authorName: 'Legal',
        compareTarget: CompareTarget.compareTargetCurrent,
        addToRecentFiles: false,
        ignoreAllComparisonWarnings: true,
      });
      await context.sync();
      const revisions = context.document.body.revisions;
      revisions.load('items/type,items/author');
      await context.sync();
      const ranges = revisions.items.map((item) => item.range.load('text'));
      await context.sync();
      const entries = revisions.items.map((item, i) => [
        item.type,
        item.author,
        ranges[i]!.text.trim(),
      ]);
      expect(entries).toContainEqual(['Delete', 'Legal', 'brown']);
      expect(entries).toContainEqual(['Insert', 'Legal', 'red']);
      expect(entries.every((entry) => entry[1] === 'Legal')).toBe(true);
    });
    const saved = await runtime.save();
    const xml = bodyXml(saved);
    expect(xml).toContain('<w:delText');
    expect(xml).toContain('w:author="Legal"');
    const reopened = await DocxEditor.createServer(saved);
    try {
      await reopened.run(async (context) => {
        const body = context.document.body.getRange('Whole');
        const original = body.getReviewedText('Original');
        const current = body.getReviewedText('Current');
        await context.sync();
        expect(original.value).toContain('quick brown fox jumps.');
        expect(current.value).toContain('quick red fox jumps far.');
      });
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

test('compare syncs when it inserts or deletes whole paragraphs', async () => {
  const cases: [string, Uint8Array, string][] = [
    [
      'insert',
      docx(p('New first.') + p('The quick brown fox jumps.') + p('Second paragraph stays.')),
      'New first.',
    ],
    ['delete', docx(p('Second paragraph stays.')), 'The quick brown fox jumps.'],
  ];
  for (const [name, revised, changed] of cases) {
    const runtime = await DocxEditor.createServer(ORIGINAL, { modules: [reviewModule()] });
    try {
      // A paragraph an earlier batch created gives the compare's own paragraphs fresh ids too.
      await runtime.run(async (context) => {
        context.document.body.insertParagraph('Added earlier.', 'End');
        await context.sync();
      });
      await runtime.run(async (context) => {
        context.document.compareFromBase64(base64Of(revised), { authorName: 'Legal' });
        await context.sync();
        const revisions = context.document.body.revisions;
        revisions.load('items/type');
        await context.sync();
        const ranges = revisions.items.map((item) => item.range.load('text'));
        await context.sync();
        expect(ranges.map((range) => range.text).join('|'), name).toContain(changed);
      });
    } finally {
      runtime.dispose();
    }
  }
});

test('removeDateAndTime writes revisions without dates', async () => {
  const runtime = await DocxEditor.createServer(ORIGINAL, { modules: [reviewModule()] });
  try {
    await runtime.run(async (context) => {
      context.document.compareFromBase64(base64Of(REVISED), {
        authorName: 'Legal',
        removeDateAndTime: true,
      });
      await context.sync();
    });
    const xml = bodyXml(await runtime.save());
    expect(xml).toContain('<w:ins ');
    expect(xml).not.toContain('w:date=');
  } finally {
    runtime.dispose();
  }
});

test('an identical document compares to no revisions', async () => {
  const runtime = await DocxEditor.createServer(ORIGINAL, { modules: [reviewModule()] });
  try {
    await runtime.run(async (context) => {
      context.document.compareFromBase64(base64Of(ORIGINAL));
      await context.sync();
      const revisions = context.document.body.revisions;
      revisions.load('items');
      await context.sync();
      expect(revisions.items.length).toBe(0);
    });
  } finally {
    runtime.dispose();
  }
});

test('compare refuses without the review module and leaves the document unchanged', async () => {
  const runtime = await DocxEditor.createServer(ORIGINAL);
  try {
    const before = await runtime.save();
    await expect(
      runtime.run(async (context) => {
        context.document.compareFromBase64(base64Of(REVISED));
        await context.sync();
      })
    ).rejects.toMatchObject({
      code: 'NotSupported',
      debugInfo: { innerError: { code: 'edit.review-module-required' } },
    });
    expect(await runtime.save()).toEqual(before);
  } finally {
    runtime.dispose();
  }
});

test('each compare refusal names its cause in innerError', async () => {
  const runtime = await DocxEditor.createServer(ORIGINAL, { modules: [reviewModule()] });
  const protectedDocument = buildDocx({
    body: p('Locked text.'),
    settings: '<w:documentProtection w:edit="readOnly" w:enforcement="1"/>',
  });
  const locked = await DocxEditor.createServer(protectedDocument, { modules: [reviewModule()] });
  try {
    const refusal = (target: typeof runtime, base64: string) =>
      target.run(async (context) => {
        context.document.compareFromBase64(base64);
        await context.sync();
      });
    await expect(refusal(runtime, base64Of(new Uint8Array([1, 2, 3])))).rejects.toMatchObject({
      code: 'InvalidArgument',
      debugInfo: { innerError: { code: 'edit.invalid-argument' } },
    });
    await expect(refusal(locked, base64Of(REVISED))).rejects.toMatchObject({
      code: 'NotImplemented',
      debugInfo: { innerError: { code: 'edit.protected-content' } },
    });
  } finally {
    runtime.dispose();
    locked.dispose();
  }
});

test('unsupported options, file paths and bad input refuse at sync', async () => {
  const runtime = await DocxEditor.createServer(ORIGINAL, { modules: [reviewModule()] });
  try {
    const before = await runtime.save();
    const refusals: Array<
      [string, (document: import('@docx-editor.dev/editor-api').Document) => void]
    > = [
      [
        'NotSupported',
        (d) => d.compareFromBase64(base64Of(REVISED), { compareTarget: 'CompareTargetNew' }),
      ],
      [
        'NotSupported',
        (d) =>
          d.compareFromBase64(base64Of(REVISED), {
            compareTarget: CompareTarget.compareTargetSelected,
          }),
      ],
      [
        'NotSupported',
        (d) => d.compareFromBase64(base64Of(REVISED), { removePersonalInformation: true }),
      ],
      ['NotSupported', (d) => d.compare('/tmp/revised.docx')],
      ['InvalidArgument', (d) => d.compareFromBase64('')],
      ['InvalidArgument', (d) => d.compareFromBase64('not base64 at all!')],
      ['InvalidArgument', (d) => d.compareFromBase64(base64Of(new Uint8Array([1, 2, 3, 4])))],
      [
        'InvalidArgument',
        (d) =>
          d.compareFromBase64(base64Of(REVISED), {
            detectFormatChanges: 'false' as unknown as boolean,
          }),
      ],
      [
        'InvalidArgument',
        (d) =>
          d.compareFromBase64(base64Of(REVISED), {
            removeDateAndTime: 1 as unknown as boolean,
          }),
      ],
      [
        'InvalidArgument',
        (d) =>
          d.compareFromBase64(base64Of(REVISED), {
            compareTarget: 'Elsewhere' as unknown as 'CompareTargetCurrent',
          }),
      ],
    ];
    for (const [code, call] of refusals) {
      await expect(
        runtime.run(async (context) => {
          call(context.document);
          await context.sync();
        })
      ).rejects.toMatchObject({ code });
      expect(await runtime.save()).toEqual(before);
    }
  } finally {
    runtime.dispose();
  }
});

test('browser compare applies as one undoable edit', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: ORIGINAL, modules: [reviewModule()] });
  const runtime = BrowserDocxEditor.createBrowser(editor);
  try {
    const before = bodyXml(new Uint8Array(await editor.save()));
    await runtime.run(async (context) => {
      context.document.compareFromBase64(base64Of(REVISED), { authorName: 'Legal' });
      await context.sync();
    });
    const compared = bodyXml(new Uint8Array(await editor.save()));
    expect(compared).toContain('<w:delText');
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(bodyXml(new Uint8Array(await editor.save()))).toBe(before);
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(bodyXml(new Uint8Array(await editor.save()))).toBe(compared);
  } finally {
    runtime.dispose();
    editor.destroy();
    container.remove();
  }
});

test('browser compare refuses without the review module', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: ORIGINAL });
  const runtime = BrowserDocxEditor.createBrowser(editor);
  try {
    await expect(
      runtime.run(async (context) => {
        context.document.compareFromBase64(base64Of(REVISED));
        await context.sync();
      })
    ).rejects.toMatchObject({ code: 'NotSupported' });
  } finally {
    runtime.dispose();
    editor.destroy();
    container.remove();
  }
});

// `revisionCount` counts what a reviewer decides, so it equals the number of items
// `document.revisions` lists for the same compare.
test('the compare revision count equals the listed revisions', async () => {
  const moved = 'This paragraph moves to the end of the document.';
  const bold = (text: string) =>
    `<w:p><w:r><w:t xml:space="preserve">Two </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const cases: [Uint8Array, Uint8Array][] = [
    [ORIGINAL, REVISED],
    [docx(p('One.') + p('Three.')), docx(p('One.') + bold('bold and more.') + p('Three.'))],
    [
      docx(p(moved) + p('First kept.') + p('Second kept.') + p('Last.')),
      docx(p('First kept.') + p('Second kept.') + p(moved) + p('Last.')),
    ],
  ];
  for (const [original, revised] of cases) {
    const result = compareDocuments(original, revised, { authorName: 'Legal' });
    if (!result.ok) throw new Error(result.message);
    const runtime = await DocxEditor.createServer(result.bytes);
    try {
      const listed = await runtime.run(async (context) => {
        const revisions = context.document.revisions;
        revisions.load('items/type');
        await context.sync();
        return revisions.items.length;
      });
      expect(result.revisionCount).toBeGreaterThan(0);
      expect(result.revisionCount).toBe(listed);
    } finally {
      runtime.dispose();
    }
  }
});
