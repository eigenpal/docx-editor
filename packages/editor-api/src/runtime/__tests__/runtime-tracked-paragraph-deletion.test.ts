/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Deleting whole paragraphs while change tracking is on records reviewable deletions: the
// text as deleted runs and each paragraph mark as a deleted paragraph mark. Accept removes the
// paragraphs, reject restores them, and both decisions survive save and reopen.
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import {
  canonicalOoxmlFingerprint,
  readOoxmlPackage,
  semanticDigest,
} from '@docx-editor.dev/core/store';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor, type DocxEditorServerRuntime, type RequestContext } from '../../index.ts';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import { reviewModule } from '../../../../pro/src/review/review-module.ts';
import { docx, p } from './support/docx.ts';
import { createRuntime } from '../runtime.ts';
import { openHost } from './support/hosts.ts';

const three = docx(p('First clause.') + p('Second clause.') + p('Third clause.'));
const open = (bytes: Uint8Array = three) => DocxEditor.createServer(bytes, { author: 'Agent' });

async function markup(r: DocxEditorServerRuntime) {
  return strFromU8(unzipSync(await r.save())['word/document.xml']!);
}

function oracles(bytes: Uint8Array) {
  const opened = readOoxmlPackage(bytes);
  if (!opened.ok) throw new Error(opened.reason);
  const main = opened.package.parts.get(opened.package.mainDocumentPart)!;
  return {
    fingerprint: canonicalOoxmlFingerprint(main),
    digest: JSON.stringify(semanticDigest(opened.package.parts.values())),
  };
}

async function bodyText(r: DocxEditorServerRuntime) {
  return r.run(async (c) => {
    c.document.body.load('text');
    await c.sync();
    return c.document.body.text;
  });
}

async function revisionCount(r: DocxEditorServerRuntime) {
  return r.run(async (c) => {
    const revisions = c.document.body.revisions;
    revisions.load('items');
    await c.sync();
    return revisions.items.length;
  });
}

async function deleteParagraphs(r: DocxEditorServerRuntime, indexes: readonly number[]) {
  await r.run(async (c) => {
    c.document.changeTrackingMode = 'TrackMineOnly';
    const paragraphs = c.document.body.paragraphs;
    paragraphs.load('items');
    await c.sync();
    for (const index of indexes) paragraphs.items[index]!.delete();
    await c.sync();
  });
}

async function deleteMiddle(c: RequestContext) {
  c.document.changeTrackingMode = 'TrackMineOnly';
  const paragraphs = c.document.body.paragraphs;
  paragraphs.load('items');
  await c.sync();
  paragraphs.items[1]!.delete();
  await c.sync();
}

async function decide(r: DocxEditorServerRuntime, action: 'acceptAll' | 'rejectAll') {
  await r.run(async (c) => {
    c.document.body.revisions[action]();
    await c.sync();
  });
}

/** Saved bytes reopen to the same canonical tree and digest, and save again unchanged. */
async function expectStableReopen(r: DocxEditorServerRuntime) {
  const saved = await r.save();
  const reopened = await DocxEditor.createServer(saved);
  try {
    const again = await reopened.save();
    expect(oracles(again)).toEqual(oracles(saved));
  } finally {
    reopened.dispose();
  }
  return saved;
}

test('a tracked paragraph deletion strikes the text and the paragraph mark', async () => {
  const r = await open();
  try {
    await deleteParagraphs(r, [1]);
    const xml = await markup(r);
    expect(xml).toMatch(/<w:pPr><w:rPr><w:del [^>]*w:author="Agent"[^>]*\/><\/w:rPr><\/w:pPr>/);
    expect(xml).toContain('<w:delText>Second clause.</w:delText>');
    // The paragraph stays in the document until a reviewer decides.
    expect(await bodyText(r)).toBe('First clause.\rSecond clause.\rThird clause.');
    expect(await revisionCount(r)).toBeGreaterThan(0);
    await expectStableReopen(r);
  } finally {
    r.dispose();
  }
});

test('accepting a tracked paragraph deletion removes the paragraph and survives reopen', async () => {
  const r = await open();
  try {
    await deleteParagraphs(r, [1]);
    await decide(r, 'acceptAll');
    expect(await bodyText(r)).toBe('First clause.\rThird clause.');
    const saved = await expectStableReopen(r);
    const reopened = await DocxEditor.createServer(saved);
    try {
      expect(await bodyText(reopened)).toBe('First clause.\rThird clause.');
      expect(await revisionCount(reopened)).toBe(0);
    } finally {
      reopened.dispose();
    }
  } finally {
    r.dispose();
  }
});

test('rejecting a tracked paragraph deletion restores the original document', async () => {
  const original = await open();
  const before = oracles(await original.save());
  original.dispose();
  const r = await open();
  try {
    await deleteParagraphs(r, [1]);
    await decide(r, 'rejectAll');
    expect(await bodyText(r)).toBe('First clause.\rSecond clause.\rThird clause.');
    expect(oracles(await expectStableReopen(r))).toEqual(before);
  } finally {
    r.dispose();
  }
});

test('adjacent paragraphs deleted in one sync accept to the remaining paragraph', async () => {
  const r = await open();
  try {
    await deleteParagraphs(r, [0, 1]);
    expect((await markup(r)).match(/<w:pPr><w:rPr><w:del /g)).toHaveLength(2);
    await decide(r, 'acceptAll');
    expect(await bodyText(r)).toBe('Third clause.');
    await expectStableReopen(r);
  } finally {
    r.dispose();
  }
});

test('a tracked deletion over a whole story strikes every mark except the last', async () => {
  const r = await open();
  try {
    await r.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      const range = c.document.body.getRange('Whole');
      await c.sync();
      range.delete();
      await c.sync();
    });
    expect((await markup(r)).match(/<w:pPr><w:rPr><w:del /g)).toHaveLength(2);
    await decide(r, 'acceptAll');
    expect(await bodyText(r)).toBe('');
    await decide(r, 'rejectAll');
    await expectStableReopen(r);
  } finally {
    r.dispose();
  }
});

test('an empty paragraph deletes as its paragraph mark alone', async () => {
  const r = await open(docx(p('First clause.') + '<w:p/>' + p('Third clause.')));
  try {
    await deleteParagraphs(r, [1]);
    const xml = await markup(r);
    expect(xml.match(/<w:del /g)).toHaveLength(1);
    await decide(r, 'acceptAll');
    expect(await bodyText(r)).toBe('First clause.\rThird clause.');
  } finally {
    r.dispose();
  }
});

async function expectRefused(
  r: DocxEditorServerRuntime,
  edit: (c: RequestContext) => void,
  code = 'NotSupported'
) {
  const before = await r.save();
  await r.run(async (c) => {
    c.document.changeTrackingMode = 'TrackMineOnly';
    await c.sync();
    edit(c);
    await expect(c.sync()).rejects.toMatchObject({ code });
  });
  expect(oracles(await r.save())).toEqual(oracles(before));
}

test('the last paragraph of a story refuses a tracked deletion without changing anything', async () => {
  const r = await open();
  try {
    await expectRefused(r, (c) => c.document.body.paragraphs.getLast().delete());
  } finally {
    r.dispose();
  }
});

test('a paragraph before a table and the last paragraph of a cell refuse a tracked deletion', async () => {
  const cell = (body: string) => `<w:tc><w:tcPr/>${body}</w:tc>`;
  const table =
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4680"/></w:tblGrid>' +
    `<w:tr>${cell(p('Cell first') + p('Cell last'))}</w:tr></w:tbl>`;
  const r = await open(docx(p('Before table') + table + p('After table')));
  try {
    await expectRefused(r, (c) => c.document.body.paragraphs.getFirst().delete());
    await expectRefused(r, (c) =>
      c.document.body.tables.getFirst().getCell(0, 0).body.paragraphs.getLast().delete()
    );
    // A paragraph with a next paragraph in the same cell records the deletion.
    await r.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      c.document.body.tables.getFirst().getCell(0, 0).body.paragraphs.getFirst().delete();
      await c.sync();
    });
    await decide(r, 'acceptAll');
    expect(await bodyText(r)).toBe('Before table\rCell last\rAfter table');
    await expectStableReopen(r);
  } finally {
    r.dispose();
  }
});

test('a paragraph whose mark ends a section refuses a tracked deletion', async () => {
  const section =
    '<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr>' +
    '<w:r><w:t>Section end.</w:t></w:r></w:p>';
  const r = await open(docx(section + p('Second clause.') + p('Third clause.')));
  try {
    await expectRefused(r, (c) => c.document.body.paragraphs.getFirst().delete());
  } finally {
    r.dispose();
  }
});

test('another author pending revision in the paragraph refuses with NotImplemented', async () => {
  const pending =
    '<w:p><w:ins w:id="9" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">' +
    '<w:r><w:t>Proposed words</w:t></w:r></w:ins></w:p>';
  const r = await open(docx(pending + p('Second clause.')));
  try {
    await expectRefused(r, (c) => c.document.body.paragraphs.getFirst().delete(), 'NotImplemented');
  } finally {
    r.dispose();
  }
});

test('untracked paragraph deletion still removes the paragraph at once', async () => {
  const r = await open();
  try {
    await r.run(async (c) => {
      c.document.body.paragraphs.getFirst().delete();
      await c.sync();
    });
    expect(await bodyText(r)).toBe('Second clause.\rThird clause.');
    expect(await markup(r)).not.toContain('<w:del ');
  } finally {
    r.dispose();
  }
});

test('in the editor, a tracked paragraph deletion is one undo step', async () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: three,
    modules: [reviewModule()],
  });
  const runtime = DocxEditorBrowser.createBrowser(editor, { author: 'Agent' });
  const saved = async () => oracles(new Uint8Array(await editor.save()));
  try {
    const original = await saved();
    await runtime.run(deleteMiddle);
    const deleted = await saved();
    expect(strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!)).toMatch(
      /<w:pPr><w:rPr><w:del /
    );
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: true, changed: true });
    expect(await saved()).toEqual(original);
    expect(editor.exec({ type: 'redo' })).toMatchObject({ ok: true, changed: true });
    expect(await saved()).toEqual(deleted);
    await runtime.run(async (c) => {
      c.document.revisions.acceptAll();
      await c.sync();
      c.document.body.load('text');
      await c.sync();
      expect(c.document.body.text).toBe('First clause.\rThird clause.');
    });
  } finally {
    runtime.dispose();
    editor.destroy();
  }
});

test('a paragraph deletion refuses an answer that is neither applied nor a span', async () => {
  const inner = openHost(three);
  const runtime = createRuntime({
    host: {
      ...inner,
      execute(request) {
        const response = inner.execute(request);
        return {
          ...response,
          results: response.results.map((result, index) =>
            request.operations[index]?.op === 'deleteParagraph' && result.status === 'ok'
              ? { status: 'ok' as const, value: { kind: 'text' as const, text: 'unexpected' } }
              : result
          ),
        };
      },
    },
    save: true,
  });
  try {
    await runtime.run(async (c) => {
      c.document.body.paragraphs.getFirst().delete();
      await expect(c.sync()).rejects.toMatchObject({ code: 'GeneralException' });
    });
  } finally {
    runtime.dispose();
  }
});

test('after a paragraph deletion, the next paragraph rejects a deletion at its start but takes an insertion', async () => {
  const r = await open();
  try {
    await deleteParagraphs(r, [0]);
    expect(await revisionCount(r)).toBe(1);
    const before = oracles(await r.save());
    await expectRefused(
      r,
      (c) => c.document.body.search('Second').getFirst().delete(),
      'NotImplemented'
    );
    expect(oracles(await r.save())).toEqual(before);
    await r.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      const paragraphs = c.document.body.paragraphs;
      paragraphs.load('items');
      await c.sync();
      paragraphs.items[1]!.insertText('New ', 'Start');
      await c.sync();
    });
    // The insertion is a separate decision from the paragraph deletion.
    expect(await revisionCount(r)).toBe(2);
  } finally {
    r.dispose();
  }
});
