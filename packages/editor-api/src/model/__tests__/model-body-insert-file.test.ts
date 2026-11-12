/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `Body.insertFileFromBase64(base64File, 'Replace')`: the whole document replaced by a DOCX
// file as one undoable edit, on both hosts. Every other location, story, and mode refuses
// with nothing changed.
import { afterAll, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor, InsertLocation, type RequestContext } from '@docx-editor.dev/editor-api';
import { DocxEditor as BrowserDocxEditor } from '@docx-editor.dev/editor-api/browser';
import { reviewModule } from '../../../../pro/src/review/review-module.ts';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { docx, p } from './support/documents.ts';

const ORIGINAL = docx(p('First original paragraph.') + p('Second original paragraph.'));
const REPLACEMENT = docx(p('First original paragraph.') + p('A new closing paragraph.'));

const base64Of = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const bodyXml = (bytes: Uint8Array): string => strFromU8(unzipSync(bytes)['word/document.xml']!);

async function bodyText(run: (batch: (c: RequestContext) => Promise<string>) => Promise<string>) {
  return run(async (context) => {
    const body = context.document.body;
    body.load('text');
    await context.sync();
    return body.text;
  });
}

test('server: Replace installs the file and answers a loadable range over the new body', async () => {
  const runtime = await DocxEditor.createServer(ORIGINAL);
  try {
    const text = await runtime.run(async (context) => {
      const range = context.document.body.insertFileFromBase64(
        base64Of(REPLACEMENT),
        InsertLocation.replace
      );
      range.load('text');
      await context.sync();
      return range.text;
    });
    expect(text).toBe('First original paragraph.\rA new closing paragraph.');
    expect(await bodyText((batch) => runtime.run(batch))).toBe(text);
    expect(bodyXml(await runtime.save())).toContain('A new closing paragraph.');
    expect(bodyXml(await runtime.save())).not.toContain('Second original paragraph.');
  } finally {
    runtime.dispose();
  }
});

test('server: the returned range is editable after the sync', async () => {
  const runtime = await DocxEditor.createServer(ORIGINAL);
  try {
    await runtime.run(async (context) => {
      const range = context.document.body.insertFileFromBase64(base64Of(REPLACEMENT), 'Replace');
      await context.sync();
      range.insertText('Lead. ', 'Start');
      await context.sync();
    });
    expect(await bodyText((batch) => runtime.run(batch))).toBe(
      'Lead. First original paragraph.\rA new closing paragraph.'
    );
  } finally {
    runtime.dispose();
  }
});

test('server: an identical file changes nothing', async () => {
  const runtime = await DocxEditor.createServer(ORIGINAL);
  try {
    const before = await runtime.save();
    await runtime.run(async (context) => {
      context.document.body.insertFileFromBase64(base64Of(ORIGINAL), 'Replace');
      await context.sync();
    });
    expect(await runtime.save()).toEqual(before);
  } finally {
    runtime.dispose();
  }
});

test('server: unsupported locations, stories, modes, and inputs refuse with nothing changed', async () => {
  const runtime = await DocxEditor.createServer(ORIGINAL, { author: 'Agent' });
  try {
    const before = await runtime.save();
    const replacement = base64Of(REPLACEMENT);
    const refusals: [string, string | undefined, (context: RequestContext) => void][] = [
      [
        'NotSupported',
        undefined,
        (c) => c.document.body.insertFileFromBase64(replacement, 'Start'),
      ],
      [
        'NotSupported',
        undefined,
        (c) => c.document.body.insertFileFromBase64(replacement, InsertLocation.end),
      ],
      [
        'InvalidArgument',
        undefined,
        (c) => c.document.body.insertFileFromBase64(replacement, 'After' as 'Replace'),
      ],
      ['InvalidArgument', undefined, (c) => c.document.body.insertFileFromBase64('', 'Replace')],
      [
        'InvalidArgument',
        undefined,
        (c) => c.document.body.insertFileFromBase64(42 as unknown as string, 'Replace'),
      ],
      [
        'InvalidArgument',
        'edit.invalid-argument',
        (c) => c.document.body.insertFileFromBase64('not base64 at all!', 'Replace'),
      ],
      [
        'InvalidArgument',
        'edit.invalid-argument',
        (c) => c.document.body.insertFileFromBase64(`${replacement}\n`, 'Replace'),
      ],
      [
        'InvalidArgument',
        'edit.invalid-argument',
        (c) => c.document.body.insertFileFromBase64(base64Of(new Uint8Array([1, 2, 3])), 'Replace'),
      ],
      [
        'NotSupported',
        'edit.tracked-operation-unsupported',
        (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          c.document.body.insertFileFromBase64(replacement, 'Replace');
        },
      ],
      [
        'ConflictingChanges',
        undefined,
        (c) => {
          c.document.body.insertParagraph('Also.', 'End');
          c.document.body.insertFileFromBase64(replacement, 'Replace');
        },
      ],
    ];
    for (const [code, inner, call] of refusals) {
      let failure: unknown;
      await runtime
        .run(async (context) => {
          call(context);
          await context.sync();
        })
        .catch((error: unknown) => {
          failure = error;
        });
      expect(failure, `${code} ${inner ?? ''}`).toMatchObject({ code });
      if (inner) expect(failure).toMatchObject({ debugInfo: { innerError: { code: inner } } });
      expect(await runtime.save()).toEqual(before);
    }
  } finally {
    runtime.dispose();
  }
});

test('server: a header body refuses', async () => {
  const runtime = await DocxEditor.createServer(
    buildDocx({
      body: p('Body text.'),
      headers: { default: p('Header text.'), first: undefined, even: undefined },
    })
  );
  try {
    const before = await runtime.save();
    const sections = runtime.run(async (context) => {
      const section = context.document.sections.getFirst();
      await context.sync();
      const header = section.getHeader('Primary');
      await context.sync();
      header.insertFileFromBase64(base64Of(REPLACEMENT), 'Replace');
      await context.sync();
    });
    await expect(sections).rejects.toMatchObject({ code: 'NotSupported' });
    expect(await runtime.save()).toEqual(before);
  } finally {
    runtime.dispose();
  }
});

test('server: enforced protection refuses', async () => {
  const runtime = await DocxEditor.createServer(
    buildDocx({
      body: p('Locked text.'),
      settings: '<w:documentProtection w:edit="readOnly" w:enforcement="1"/>',
    })
  );
  try {
    const before = await runtime.save();
    await expect(
      runtime.run(async (context) => {
        context.document.body.insertFileFromBase64(base64Of(REPLACEMENT), 'Replace');
        await context.sync();
      })
    ).rejects.toMatchObject({
      code: 'NotImplemented',
      debugInfo: { innerError: { code: 'edit.protected-content' } },
    });
    expect(await runtime.save()).toEqual(before);
  } finally {
    runtime.dispose();
  }
});

function mount(options: { mode?: 'view' | 'suggesting'; document?: Uint8Array } = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: options.document ?? ORIGINAL,
    author: 'Writer',
    // Suggesting needs the review module; without it the editor opens for editing.
    modules: [reviewModule()],
    ...(options.mode ? { mode: options.mode } : {}),
  });
  const runtime = BrowserDocxEditor.createBrowser(editor, { author: 'Writer' });
  return {
    editor,
    runtime,
    dispose() {
      runtime.dispose();
      editor.destroy();
      container.remove();
    },
  };
}

test('browser: Replace is one undo step and one redo step', async () => {
  const { editor, runtime, dispose } = mount();
  try {
    const before = bodyXml(new Uint8Array(await editor.save()));
    expect(editor.snapshot().canUndo).toBe(false);
    const text = await runtime.run(async (context) => {
      const range = context.document.body.insertFileFromBase64(base64Of(REPLACEMENT), 'Replace');
      range.load('text');
      await context.sync();
      return range.text;
    });
    expect(text).toBe('First original paragraph.\rA new closing paragraph.');
    const after = bodyXml(new Uint8Array(await editor.save()));
    expect(after).toContain('A new closing paragraph.');
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(bodyXml(new Uint8Array(await editor.save()))).toBe(before);
    expect(editor.snapshot().canUndo).toBe(false);
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    expect(bodyXml(new Uint8Array(await editor.save()))).toBe(after);
  } finally {
    dispose();
  }
});

test('browser: a refusal leaves the document and the undo history unchanged', async () => {
  const { editor, runtime, dispose } = mount();
  try {
    const before = bodyXml(new Uint8Array(await editor.save()));
    for (const call of [
      (c: RequestContext) => c.document.body.insertFileFromBase64(base64Of(REPLACEMENT), 'End'),
      (c: RequestContext) =>
        c.document.body.insertFileFromBase64(base64Of(new Uint8Array([1, 2, 3])), 'Replace'),
      (c: RequestContext) => {
        c.document.changeTrackingMode = 'TrackMineOnly';
        c.document.body.insertFileFromBase64(base64Of(REPLACEMENT), 'Replace');
      },
    ]) {
      await expect(
        runtime.run(async (context) => {
          call(context);
          await context.sync();
        })
      ).rejects.toBeDefined();
      expect(bodyXml(new Uint8Array(await editor.save()))).toBe(before);
      expect(editor.snapshot().canUndo).toBe(false);
    }
  } finally {
    dispose();
  }
});

test('browser: viewing and suggesting modes refuse', async () => {
  for (const [mode, expected] of [
    ['view', { code: 'GeneralException', debugInfo: { innerError: { code: 'edit.read-only' } } }],
    ['suggesting', { code: 'NotSupported' }],
  ] as const) {
    const { editor, runtime, dispose } = mount({ mode });
    try {
      const before = bodyXml(new Uint8Array(await editor.save()));
      await expect(
        runtime.run(async (context) => {
          context.document.body.insertFileFromBase64(base64Of(REPLACEMENT), 'Replace');
          await context.sync();
        })
      ).rejects.toMatchObject(expected);
      expect(bodyXml(new Uint8Array(await editor.save()))).toBe(before);
      expect(editor.snapshot().canUndo).toBe(false);
    } finally {
      dispose();
    }
  }
});

test('browser: a run inside a history group refuses', async () => {
  const { editor, runtime, dispose } = mount();
  try {
    const before = bodyXml(new Uint8Array(await editor.save()));
    const group = editor.beginHistoryGroup();
    await expect(
      runtime.run({ historyGroup: group }, async (context) => {
        context.document.body.insertFileFromBase64(base64Of(REPLACEMENT), 'Replace');
        await context.sync();
      })
    ).rejects.toMatchObject({
      code: 'NotSupported',
      debugInfo: { innerError: { code: 'edit.operation-unsupported' } },
    });
    group.end();
    expect(bodyXml(new Uint8Array(await editor.save()))).toBe(before);
  } finally {
    dispose();
  }
});

test('locked or data-bound content controls refuse with edit.protected-content', async () => {
  const control = (properties: string) =>
    `<w:sdt><w:sdtPr>${properties}</w:sdtPr><w:sdtContent>` +
    p('Inside the control.') +
    '</w:sdtContent></w:sdt>';
  const documents = [
    docx(p('Plain paragraph.') + control('<w:lock w:val="sdtLocked"/>')),
    docx(p('Plain paragraph.') + control('<w:lock w:val="contentLocked"/>')),
    docx(
      p('Plain paragraph.') +
        control(
          '<w:dataBinding w:xpath="/root/a" w:storeItemID="{00000000-0000-0000-0000-000000000001}"/>'
        )
    ),
  ];
  for (const original of documents) {
    const runtime = await DocxEditor.createServer(original);
    try {
      const before = await runtime.save();
      await expect(
        runtime.run(async (context) => {
          context.document.body.insertFileFromBase64(base64Of(REPLACEMENT), 'Replace');
          await context.sync();
        })
      ).rejects.toMatchObject({
        code: 'NotImplemented',
        debugInfo: { innerError: { code: 'edit.protected-content' } },
      });
      expect(await runtime.save()).toEqual(before);
    } finally {
      runtime.dispose();
    }
  }
  // The browser host refuses the same way, and its undo history stays empty.
  const { editor, runtime, dispose } = mount({ document: documents[0]! });
  try {
    const before = bodyXml(new Uint8Array(await editor.save()));
    await expect(
      runtime.run(async (context) => {
        context.document.body.insertFileFromBase64(base64Of(REPLACEMENT), 'Replace');
        await context.sync();
      })
    ).rejects.toMatchObject({
      code: 'NotImplemented',
      debugInfo: { innerError: { code: 'edit.protected-content' } },
    });
    expect(bodyXml(new Uint8Array(await editor.save()))).toBe(before);
    expect(editor.can({ type: 'undo' }).ok).toBe(false);
  } finally {
    dispose();
  }
});

test('an unlocked content control does not block a replacement', async () => {
  const runtime = await DocxEditor.createServer(
    docx(
      p('Plain paragraph.') +
        '<w:sdt><w:sdtPr><w:tag w:val="clause"/></w:sdtPr><w:sdtContent>' +
        p('Inside the control.') +
        '</w:sdtContent></w:sdt>'
    )
  );
  try {
    await runtime.run(async (context) => {
      context.document.body.insertFileFromBase64(base64Of(REPLACEMENT), 'Replace');
      await context.sync();
    });
    expect(await bodyText((batch) => runtime.run(batch))).toContain('A new closing paragraph.');
  } finally {
    runtime.dispose();
  }
});
