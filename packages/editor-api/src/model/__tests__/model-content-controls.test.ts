/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The ContentControl object model, as a consumer meets it.
//
// Two things are proven here that the protocol tests cannot. The first is that the PROXY behaves
// like the rest of the model: one object per navigation property, a property read before its load
// is refused rather than guessed, a collection is the answer as of its batch. The second is that
// the ids a document writes do not decide reachability — a control the file never numbered and two
// carrying the same number are all ordinary objects here.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core-contract/editor';
import { createBrowser } from '../../runtime/browser.ts';
import { isDocxEditorError } from '../../runtime/errors.ts';
import type { DocxEditorRuntime } from '../../runtime/runtime.ts';
import { docx, mainXmlOf, reopen, serverRuntime } from './support/documents.ts';

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

const CONTROLS = docx(
  `<w:sdt><w:sdtPr><w:alias w:val="Client"/><w:tag w:val="client"/><w:id w:val="7"/><w:text/>` +
    `</w:sdtPr><w:sdtContent><w:p><w:r><w:t>Acme</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
    `<w:sdt><w:sdtPr><w:tag w:val="terms"/><w:id w:val="8"/><w:lock w:val="sdtContentLocked"/>` +
    `<w:richText/></w:sdtPr><w:sdtContent>` +
    `<w:p><w:r><w:t>fixed terms</w:t></w:r></w:p></w:sdtContent></w:sdt>`
);

const PROMPT = docx(
  `<w:sdt><w:sdtPr><w:tag w:val="notes"/><w:showingPlcHdr/><w:temporary/><w:text/>` +
    `</w:sdtPr><w:sdtContent>` +
    `<w:p><w:r><w:t>Click here to enter text.</w:t></w:r></w:p></w:sdtContent></w:sdt>`
);

const CHECKBOX = docx(
  `<w:sdt><w:sdtPr><w:tag w:val="agree"/><w14:checkbox xmlns:w14="${W14}">` +
    `<w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
    `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>` +
    `<w:sdtContent><w:p><w:r><w:t>\u2610</w:t></w:r></w:p></w:sdtContent></w:sdt>`
);

const NESTED = docx(
  `<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>` +
    `<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr><w:sdtContent>` +
    `<w:p><w:r><w:t>deep</w:t></w:r></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`
);

const AMBIGUOUS = docx(
  `<w:sdt><w:sdtPr><w:tag w:val="one"/><w:id w:val="5"/></w:sdtPr><w:sdtContent>` +
    `<w:p><w:r><w:t>a</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
    `<w:sdt><w:sdtPr><w:tag w:val="two"/><w:id w:val="5"/></w:sdtPr><w:sdtContent>` +
    `<w:p><w:r><w:t>b</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
    `<w:sdt><w:sdtPr><w:tag w:val="three"/></w:sdtPr><w:sdtContent>` +
    `<w:p><w:r><w:t>c</w:t></w:r></w:p></w:sdtContent></w:sdt>`
);

async function codeOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    if (isDocxEditorError(error)) return error.code;
    throw error;
  }
  throw new Error('the call did not fail');
}

describe('the controls of a story', () => {
  test('are the outermost ones, in document order', async () => {
    const runtime = await serverRuntime(CONTROLS);
    const tags = await runtime.run(async (context) => {
      const controls = context.document.contentControls;
      controls.load();
      await context.sync();
      for (const control of controls.items) control.load('tag');
      await context.sync();
      return controls.items.map((control) => control.tag);
    });
    expect(tags).toEqual(['client', 'terms']);
  });

  test('a nested control is reached through the one that holds it', async () => {
    const runtime = await serverRuntime(NESTED);
    const answer = await runtime.run(async (context) => {
      const outer = context.document.contentControls;
      outer.load();
      await context.sync();
      const inner = outer.items[0]!.contentControls;
      inner.load();
      outer.items[0]!.load('tag');
      await context.sync();
      for (const control of inner.items) control.load('tag');
      await context.sync();
      return { outer: outer.items.map((c) => c.tag), inner: inner.items.map((c) => c.tag) };
    });
    expect(answer).toEqual({ outer: ['outer'], inner: ['inner'] });
  });
});

describe('a control says what the document says about it', () => {
  test('id, tag, title, subtype and text are the file’s own values', async () => {
    const runtime = await serverRuntime(CONTROLS);
    const read = await runtime.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      control.load(['id', 'tag', 'title', 'subtype', 'text']);
      await context.sync();
      return {
        id: control.id,
        tag: control.tag,
        title: control.title,
        subtype: control.subtype,
        text: control.text,
      };
    });
    expect(read).toEqual({
      id: '7',
      tag: 'client',
      title: 'Client',
      subtype: 'plainText',
      text: 'Acme',
    });
  });

  test('the lock is reported as the two flags, from one read', async () => {
    const runtime = await serverRuntime(CONTROLS);
    const flags = await runtime.run(async (context) => {
      const controls = context.document.contentControls;
      controls.load();
      await context.sync();
      for (const control of controls.items) control.load('cannotEdit');
      await context.sync();
      return controls.items.map((control) => ({
        cannotEdit: control.cannotEdit,
        cannotDelete: control.cannotDelete,
      }));
    });
    expect(flags).toEqual([
      { cannotEdit: false, cannotDelete: false },
      { cannotEdit: true, cannotDelete: true },
    ]);
  });

  test('placeholder and temporary are state a caller can ask about', async () => {
    const runtime = await serverRuntime(PROMPT);
    const state = await runtime.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      control.load(['placeholderShown', 'temporary', 'text']);
      await context.sync();
      return {
        shown: control.placeholderShown,
        temporary: control.temporary,
        text: control.text,
      };
    });
    expect(state).toEqual({
      shown: true,
      temporary: true,
      text: 'Click here to enter text.',
    });
  });

  test('a control’s range reads the characters it holds', async () => {
    const runtime = await serverRuntime(CONTROLS);
    const text = await runtime.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      const range = control.getRange();
      await context.sync();
      range.load('text');
      await context.sync();
      return range.text;
    });
    expect(text).toBe('Acme');
  });

  test('a control names the paragraphs it holds', async () => {
    const runtime = await serverRuntime(CONTROLS);
    const texts = await runtime.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      const paragraphs = control.paragraphs;
      paragraphs.load();
      await context.sync();
      for (const paragraph of paragraphs.items) paragraph.load('text');
      await context.sync();
      return paragraphs.items.map((paragraph) => paragraph.text);
    });
    expect(texts).toEqual(['Acme']);
  });
});

describe('a control is reachable however the file numbered it', () => {
  test('getById answers the first control carrying a repeated number', async () => {
    const runtime = await serverRuntime(AMBIGUOUS);
    const tag = await runtime.run(async (context) => {
      const found = context.document.contentControls.getById(5);
      await context.sync();
      found.load('tag');
      await context.sync();
      return found.tag;
    });
    expect(tag).toBe('one');
  });

  test('a control the file never numbered is still listed and still read', async () => {
    const runtime = await serverRuntime(AMBIGUOUS);
    const read = await runtime.run(async (context) => {
      const controls = context.document.contentControls;
      controls.load();
      await context.sync();
      for (const control of controls.items) control.load('id');
      await context.sync();
      return controls.items.map((control) => control.id);
    });
    expect(read).toEqual(['5', '5', '']);
  });

  test('getByTag answers every match', async () => {
    const runtime = await serverRuntime(AMBIGUOUS);
    const tags = await runtime.run(async (context) => {
      const found = context.document.contentControls.getByTag('two');
      found.load();
      await context.sync();
      for (const control of found.items) control.load('text');
      await context.sync();
      return found.items.map((control) => control.text);
    });
    expect(tags).toEqual(['b']);
  });

  test('getByTitle answers every match', async () => {
    const runtime = await serverRuntime(CONTROLS);
    const titles = await runtime.run(async (context) => {
      const found = context.document.contentControls.getByTitle('Client');
      found.load();
      await context.sync();
      for (const control of found.items) control.load('tag');
      await context.sync();
      return found.items.map((control) => control.tag);
    });
    expect(titles).toEqual(['client']);
  });

  test('an id nothing declares fails at the sync rather than answering a neighbour', async () => {
    const runtime = await serverRuntime(CONTROLS);
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const found = context.document.contentControls.getById(99);
        await context.sync();
        found.load('tag');
        await context.sync();
        return found.tag;
      })
    );
    expect(code).not.toBe('');
  });

  test('getFirstOrNullObject says so instead of failing', async () => {
    const runtime = await serverRuntime(docx('<w:p><w:r><w:t>plain</w:t></w:r></w:p>'));
    const isNull = await runtime.run(async (context) => {
      const found = context.document.contentControls.getFirstOrNullObject();
      await context.sync();
      return found.isNullObject;
    });
    expect(isNull).toBe(true);
  });
});

describe('a control is written through the document’s own write path', () => {
  test('setValue writes a plain-text value and it survives a save', async () => {
    const runtime = await serverRuntime(CONTROLS);
    await runtime.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      control.setValue({ kind: 'text', text: 'Globex' });
      await context.sync();
    });
    expect(await mainXmlOf(runtime)).toContain('Globex');
    const again = await reopen(runtime);
    const text = await again.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      control.load('text');
      await context.sync();
      return control.text;
    });
    expect(text).toBe('Globex');
  });

  test('setValue on a checkbox writes the glyph and the flag', async () => {
    const runtime = await serverRuntime(CHECKBOX);
    await runtime.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      control.setValue({ kind: 'checkbox', checked: true });
      await context.sync();
    });
    const xml = await mainXmlOf(runtime);
    expect(xml).toContain('w14:val="1"');
    expect(xml).toContain('\u2612');
  });

  test('writing into a control showing its prompt replaces the whole prompt', async () => {
    const runtime = await serverRuntime(PROMPT);
    const after = await runtime.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      control.insertText('typed', 'Replace');
      await context.sync();
      const body = context.document.body;
      body.load('text');
      await context.sync();
      return body.text;
    });
    expect(after).toBe('typed');
  });

  test('tag and title are authored and read back', async () => {
    const runtime = await serverRuntime(CONTROLS);
    const read = await runtime.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      control.tag = 'customer';
      control.title = 'Customer';
      await context.sync();
      control.load(['tag', 'title']);
      await context.sync();
      return { tag: control.tag, title: control.title };
    });
    expect(read).toEqual({ tag: 'customer', title: 'Customer' });
  });

  test('cannotEdit writes the lock half without clearing the other one', async () => {
    const runtime = await serverRuntime(CONTROLS);
    const xml = await runtime.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      control.load('cannotDelete');
      await context.sync();
      control.cannotEdit = true;
      await context.sync();
      return mainXmlOf(runtime as never);
    });
    expect(xml).toContain('w:lock w:val="contentLocked"');
  });

  test('a locked control refuses the write and the document is unchanged', async () => {
    const runtime = await serverRuntime(CONTROLS);
    const before = await mainXmlOf(runtime);
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const controls = context.document.contentControls;
        controls.load();
        await context.sync();
        controls.items[1]!.setValue({ kind: 'text', text: 'other' });
        await context.sync();
      })
    );
    expect(code).not.toBe('');
    expect(await mainXmlOf(runtime)).toBe(before);
  });

  // The three locations source-compatible code writes. `Replace` takes the control's value path;
  // the edges are insertions at the ends of what it holds. The range that comes back names the
  // TEXT THAT WAS WRITTEN in every case, not the control's whole content.
  test.each([
    ['Replace', 'ACME'],
    ['Start', 'ACMEAcme'],
    ['End', 'AcmeACME'],
  ] as const)('insertText at %s writes and answers what it wrote', async (where, held) => {
    const runtime = await serverRuntime(CONTROLS);
    const read = await runtime.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      const written = control.insertText('ACME', where);
      await context.sync();
      written.load('text');
      control.load('text');
      await context.sync();
      return { written: written.text, held: control.text };
    });
    expect(read).toEqual({ written: 'ACME', held });
  });

  // A WHOLE-VALUE WRITE DELETES WHAT THE CONTROL HELD. Both of these locations rebuild
  // `w:sdtContent`, so a nested control goes with it — lock, binding and text together. Naming the
  // outer control is not consent to destroy the inner one.
  const nested = (properties: string) =>
    docx(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="outer"/><w:richText/></w:sdtPr><w:sdtContent>` +
        `<w:r><w:t>OUT</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="inner"/>${properties}</w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
        `</w:sdtContent></w:sdt></w:p>`
    );

  const NESTED_LOCKED = `<w:lock w:val="sdtContentLocked"/>`;
  const NESTED_BOUND = `<w:dataBinding w:xpath="/root/a" w:storeItemID="{FEED}"/>`;

  test.each([
    ['a locked', NESTED_LOCKED],
    ['a bound', NESTED_BOUND],
  ])('setValue is refused by %s control nested in the one it names', async (_name, properties) => {
    const runtime = await serverRuntime(nested(properties));
    const before = await mainXmlOf(runtime);
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const control = context.document.contentControls.getFirst();
        await context.sync();
        control.setValue({ kind: 'text', text: 'REPLACED' });
        await context.sync();
      })
    );
    expect(code).not.toBe('');
    expect(await mainXmlOf(runtime)).toBe(before);
  });

  test.each([
    ['a locked', NESTED_LOCKED],
    ['a bound', NESTED_BOUND],
  ])('insertText at Replace is refused by %s nested control too', async (_name, properties) => {
    const runtime = await serverRuntime(nested(properties));
    const before = await mainXmlOf(runtime);
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const control = context.document.contentControls.getFirst();
        await context.sync();
        control.insertText('REPLACED', 'Replace');
        await context.sync();
      })
    );
    expect(code).not.toBe('');
    expect(await mainXmlOf(runtime)).toBe(before);
  });

  test('an unlocked nested control is still replaced, so this is not a nesting rule', async () => {
    const runtime = await serverRuntime(nested(''));
    await runtime.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      control.setValue({ kind: 'text', text: 'REPLACED' });
      await context.sync();
    });
    expect(await mainXmlOf(runtime)).toContain('REPLACED');
  });

  test('a location no control has is refused before anything is sent', async () => {
    const runtime = await serverRuntime(CONTROLS);
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const control = context.document.contentControls.getFirst();
        await context.sync();
        control.getRange('Middle' as never);
        await context.sync();
      })
    );
    expect(code).toBe('InvalidArgument');
  });

  test('the range at an edge is empty and the whole range is the content', async () => {
    const runtime = await serverRuntime(CONTROLS);
    const read = await runtime.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      const whole = control.getRange('Whole');
      const start = control.getRange('Start');
      await context.sync();
      whole.load('text');
      start.load('text');
      await context.sync();
      return { whole: whole.text, start: start.text };
    });
    expect(read).toEqual({ whole: 'Acme', start: '' });
  });

  test('delete keeps the content it wrapped', async () => {
    const runtime = await serverRuntime(CONTROLS);
    await runtime.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      control.delete(true);
      await context.sync();
    });
    const xml = await mainXmlOf(runtime);
    expect(xml).toContain('Acme');
    expect(xml).not.toContain('w:tag w:val="client"');
  });

  test('a value the control’s type refuses is an error, not a silent write', async () => {
    const runtime = await serverRuntime(CONTROLS);
    const code = await codeOf(() =>
      runtime.run(async (context) => {
        const control = context.document.contentControls.getFirst();
        await context.sync();
        control.setValue({ kind: 'checkbox', checked: true });
        await context.sync();
      })
    );
    expect(code).not.toBe('');
  });
});

describe('both hosts answer the same document', () => {
  test('the browser host reads the controls the server host reads', async () => {
    const container = globalThis.document.createElement('div');
    const editor = createDocxEditor({ container, document: CONTROLS });
    if (!editor.surface) throw new Error('surface failed to mount');
    const browser: DocxEditorRuntime = createBrowser(editor);
    const server = await serverRuntime(CONTROLS);

    const script = async (runtime: DocxEditorRuntime): Promise<unknown> =>
      runtime.run(async (context) => {
        const controls = context.document.contentControls;
        controls.load();
        await context.sync();
        for (const control of controls.items) {
          control.load(['id', 'tag', 'title', 'subtype', 'text']);
        }
        await context.sync();
        return controls.items.map((control) => ({
          id: control.id,
          tag: control.tag,
          title: control.title,
          subtype: control.subtype,
          text: control.text,
        }));
      });

    expect(await script(browser)).toEqual(await script(server));
  });

  test('a write through the browser host lands in the same place', async () => {
    const container = globalThis.document.createElement('div');
    const editor = createDocxEditor({ container, document: CONTROLS });
    if (!editor.surface) throw new Error('surface failed to mount');
    const browser: DocxEditorRuntime = createBrowser(editor);
    await browser.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      control.setValue({ kind: 'text', text: 'Globex' });
      await context.sync();
    });
    const text = await browser.run(async (context) => {
      const control = context.document.contentControls.getFirst();
      await context.sync();
      control.load('text');
      await context.sync();
      return control.text;
    });
    expect(text).toBe('Globex');
  });
});
