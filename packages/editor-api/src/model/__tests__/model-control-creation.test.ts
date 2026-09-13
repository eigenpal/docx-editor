/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { test, expect } from 'bun:test';
import { docx, p, serverRuntime, mainXmlOf, reopen } from './support/documents.ts';

test('create tagged control, fill it, and preserve surrounding text after reopen', async () => {
  const runtime = await serverRuntime(docx(p('Before CLIENT After') + p('Untouched')));
  await runtime.run(async (context) => {
    const matches = context.document.body.search('CLIENT');
    matches.load();
    await context.sync();
    const control = matches.items[0]!.insertContentControl('PlainText');
    await context.sync();
    control.tag = 'client';
    control.title = 'Client name';
    await context.sync();
    control.insertText('Acme', 'Replace');
    await context.sync();
    control.cannotEdit = true;
    await context.sync();
  });
  expect(await mainXmlOf(runtime)).toContain('w:sdt');
  const next = await reopen(runtime);
  await next.run(async (context) => {
    const controls = context.document.contentControls.getByTag('client');
    controls.load();
    context.document.body.load('text');
    await context.sync();
    expect(controls.items).toHaveLength(1);
    expect(context.document.body.text).toContain('Before Acme After');
    expect(context.document.body.text).toContain('Untouched');
    controls.items[0]!.insertText('Forbidden', 'Replace');
    await expect(context.sync()).rejects.toBeDefined();
  });
  runtime.dispose();
  next.dispose();
});

test('control creation refuses unsupported types and spans across paragraphs', async () => {
  const runtime = await serverRuntime(docx(p('First') + p('Second')));
  const before = await mainXmlOf(runtime);
  await runtime.run(async (context) => {
    const range = context.document.body.getRange();
    await context.sync();
    expect(() => range.insertContentControl('Picture')).toThrow();
    range.insertContentControl();
    await expect(context.sync()).rejects.toBeDefined();
  });
  expect(await mainXmlOf(runtime)).toBe(before);
  runtime.dispose();
});

test('a control can unlock its own flags but cannot bypass an ancestor lock', async () => {
  const control = (tag: string, content: string, locked = true) =>
    `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/>${locked ? '<w:lock w:val="sdtContentLocked"/>' : ''}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
  const runtime = await serverRuntime(
    docx(control('editable', p('Template')) + control('parent', control('child', p('Protected'))))
  );
  await runtime.run(async (context) => {
    const own = context.document.contentControls.getByTag('editable').getFirst();
    own.cannotEdit = false;
    own.cannotDelete = false;
    await context.sync();
    own.insertText('Filled', 'Replace');
    await context.sync();
    own.load('cannotEdit,cannotDelete');
    await context.sync();
    expect(own.cannotEdit).toBe(false);
    expect(own.cannotDelete).toBe(false);
    const child = context.document.contentControls.getByTag('child').getFirst();
    child.cannotEdit = false;
    await expect(context.sync()).rejects.toBeDefined();
  });
  const saved = await reopen(runtime);
  const xml = await mainXmlOf(saved);
  expect(xml).toContain('Filled');
  expect(xml).toContain('Protected');
  expect(xml).toContain('w:val="sdtContentLocked"');
  runtime.dispose();
  saved.dispose();
});

test('distinct control aliases combine lock axes in queue order and preserve ancestor protection', async () => {
  const control = (tag: string, content: string) =>
    `<w:sdt><w:sdtPr><w:tag w:val="${tag}"/><w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
  for (const reverse of [false, true]) {
    const runtime = await serverRuntime(
      docx(control('own', p('Template')) + control('parent', control('child', p('Protected'))))
    );
    try {
      await runtime.run(async (context) => {
        const a = context.document.contentControls.getByTag('own').getFirst();
        const b = context.document.contentControls.getByTag('own').getFirst();
        expect(a).not.toBe(b);
        if (reverse) {
          b.cannotDelete = false;
          a.cannotEdit = false;
        } else {
          a.cannotEdit = false;
          b.cannotDelete = false;
        }
        await context.sync();
        a.load('cannotEdit,cannotDelete');
        b.load('cannotEdit,cannotDelete');
        await context.sync();
        expect([a.cannotEdit, a.cannotDelete, b.cannotEdit, b.cannotDelete]).toEqual([
          false,
          false,
          false,
          false,
        ]);
        a.insertText('Filled through aliases', 'Replace');
        await context.sync();
        a.cannotEdit = true;
        b.cannotDelete = true;
        await context.sync();
        a.load('cannotEdit,cannotDelete');
        await context.sync();
        expect([a.cannotEdit, a.cannotDelete]).toEqual([true, true]);
        a.cannotEdit = false;
        b.cannotDelete = false;
        await context.sync();
        const childA = context.document.contentControls.getByTag('child').getFirst();
        const childB = context.document.contentControls.getByTag('child').getFirst();
        childA.cannotEdit = false;
        childB.cannotDelete = false;
        await expect(context.sync()).rejects.toBeDefined();
      });
      const reopened = await reopen(runtime);
      try {
        await reopened.run(async (context) => {
          const own = context.document.contentControls.getByTag('own').getFirst();
          own.load('text,cannotEdit,cannotDelete');
          const child = context.document.contentControls.getByTag('child').getFirst();
          child.load('text,cannotEdit,cannotDelete');
          await context.sync();
          expect(own.text).toBe('Filled through aliases');
          expect([own.cannotEdit, own.cannotDelete]).toEqual([false, false]);
          expect(child.text).toBe('Protected');
          expect([child.cannotEdit, child.cannotDelete]).toEqual([true, true]);
        });
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  }
});
