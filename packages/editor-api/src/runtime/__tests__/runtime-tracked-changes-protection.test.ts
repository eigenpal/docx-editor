/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Enforced tracked-changes protection keeps every change pending: the revision decisions and
// author changes refuse, from a server runtime and from an in-browser one, while tracked edits
// and comments still commit. Read-only, comments-only, and forms protection refuse them too.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../../browser.ts';
import type { RequestContext } from '../../index.ts';
import { docx } from './support/docx.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STAMP = 'w:author="Ada" w:date="2026-10-01T10:00:00Z"';

/** A package whose settings enforce `w:edit` protection, with a pending insertion and deletion. */
function protectedDocument(edit: string): Uint8Array {
  const files = unzipSync(
    docx(
      '<w:p><w:r><w:t xml:space="preserve">Pay in </w:t></w:r>' +
        `<w:ins w:id="1" ${STAMP}><w:r><w:t>30</w:t></w:r></w:ins>` +
        `<w:del w:id="2" ${STAMP}><w:r><w:delText>60</w:delText></w:r></w:del>` +
        '<w:r><w:t xml:space="preserve"> days.</w:t></w:r></w:p>'
    )
  );
  files['word/settings.xml'] = strToU8(
    `<w:settings xmlns:w="${W}"><w:documentProtection w:edit="${edit}" w:enforcement="1"/></w:settings>`
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>'
  );
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'
    )
  );
  return zipSync(files);
}

const PROTECTED = protectedDocument('trackedChanges');
const xml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);
const REFUSED = {
  code: 'GeneralException',
  debugInfo: { innerError: { code: 'edit.protected-content' } },
};

/** Each revision write the protection refuses, as an agent would write it. */
const WRITES: Record<string, (context: RequestContext) => Promise<void>> = {
  'Document.revisions.acceptAll()': async (context) => {
    context.document.revisions.acceptAll();
    await context.sync();
  },
  'Body.revisions.rejectAll()': async (context) => {
    context.document.body.revisions.rejectAll();
    await context.sync();
  },
  'RevisionCollection.resolve()': async (context) => {
    context.document.revisions.resolve('accept');
    await context.sync();
  },
  'Range.revisions.acceptAll()': async (context) => {
    context.document.body.getRange('Whole').revisions.acceptAll();
    await context.sync();
  },
  'Revision.accept()': async (context) => {
    const revisions = context.document.revisions;
    revisions.load('items');
    await context.sync();
    revisions.items[0]!.accept();
    await context.sync();
  },
  'Revision.reject()': async (context) => {
    const revisions = context.document.revisions;
    revisions.load('items');
    await context.sync();
    revisions.items[1]!.reject();
    await context.sync();
  },
  'RevisionCollection.setAuthor()': async (context) => {
    context.document.revisions.setAuthor('Grace');
    await context.sync();
  },
};

for (const [name, write] of Object.entries(WRITES)) {
  test(`a server runtime refuses ${name} under tracked-changes protection`, async () => {
    const runtime = await DocxEditor.createServer(PROTECTED, { author: 'Reviewer' });
    try {
      const before = xml(await runtime.save());
      await expect(runtime.run(write)).rejects.toMatchObject(REFUSED);
      expect(xml(await runtime.save())).toBe(before);
    } finally {
      runtime.dispose();
    }
  });
}

for (const edit of ['readOnly', 'comments', 'forms']) {
  test(`a server runtime refuses revision decisions under ${edit} protection`, async () => {
    const runtime = await DocxEditor.createServer(protectedDocument(edit), { author: 'Reviewer' });
    try {
      const before = xml(await runtime.save());
      for (const name of ['Document.revisions.acceptAll()', 'RevisionCollection.setAuthor()']) {
        await expect(runtime.run(WRITES[name]!)).rejects.toMatchObject(REFUSED);
      }
      expect(xml(await runtime.save())).toBe(before);
    } finally {
      runtime.dispose();
    }
  });
}

test('control: the same decisions run without the protection', async () => {
  const runtime = await DocxEditor.createServer(protectedDocument('none'), { author: 'Reviewer' });
  try {
    await runtime.run(WRITES['Document.revisions.acceptAll()']!);
    expect(xml(await runtime.save())).not.toContain('<w:ins');
  } finally {
    runtime.dispose();
  }
});

test('a server runtime still writes comments and tracked edits under the protection', async () => {
  const runtime = await DocxEditor.createServer(PROTECTED, { author: 'Reviewer' });
  try {
    await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      const days = context.document.body.search('days', { matchCase: true });
      days.load('items');
      await context.sync();
      days.items[0]!.insertComment('Why this term?');
      await context.sync();
      days.items[0]!.insertText('weeks', 'Replace');
      await context.sync();
    });
    const saved = unzipSync(await runtime.save());
    expect(strFromU8(saved['word/comments.xml']!)).toContain('Why this term?');
    expect(xml(await runtime.save())).toContain('w:author="Reviewer"');
  } finally {
    runtime.dispose();
  }
});

test('an in-browser run() refuses acceptAll under the protection, and the editor agrees', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: PROTECTED });
  const runtime = DocxEditor.createBrowser(editor, { author: 'Reviewer' });
  try {
    const before = xml(new Uint8Array(await editor.save()));
    await expect(runtime.run(WRITES['Document.revisions.acceptAll()']!)).rejects.toMatchObject(
      REFUSED
    );
    expect(xml(new Uint8Array(await editor.save()))).toBe(before);
  } finally {
    runtime.dispose();
    editor.destroy();
    container.remove();
  }
});
