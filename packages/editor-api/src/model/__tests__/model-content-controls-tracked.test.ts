/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// ContentControl writes under change tracking: setValue and insertText propose the change
// inside the control as a strike and an insertion, and never write it directly.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { createServer } from '../../runtime/server.ts';
import { docx, mainXmlOf } from './support/documents.ts';

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

const CHECKBOX = docx(
  `<w:sdt><w:sdtPr><w:tag w:val="agree"/><w14:checkbox xmlns:w14="${W14}">` +
    `<w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
    `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>` +
    `<w:sdtContent><w:p><w:r><w:t>☐</w:t></w:r></w:p></w:sdtContent></w:sdt>`
);

const DROPDOWN = docx(
  `<w:p><w:r><w:t xml:space="preserve">Pick: </w:t></w:r><w:sdt><w:sdtPr><w:tag w:val="pick"/>` +
    `<w:dropDownList w:lastValue="1"><w:listItem w:displayText="One" w:value="1"/>` +
    `<w:listItem w:displayText="Two" w:value="2"/></w:dropDownList></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>One</w:t></w:r></w:sdtContent></w:sdt></w:p>`
);

const TEXT = docx(
  `<w:p><w:sdt><w:sdtPr><w:tag w:val="client"/><w:text/></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>Acme</w:t></w:r></w:sdtContent></w:sdt></w:p>`
);

const controlOf = (xml: string) => xml.slice(xml.indexOf('<w:sdt>'), xml.indexOf('</w:sdt>'));

test('a tracked checkbox setValue is proposed, and rejecting it unchecks the flag too', async () => {
  const runtime = await createServer(CHECKBOX, { author: 'Writer' });
  try {
    await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      const control = context.document.contentControls.getFirst();
      await context.sync();
      control.setValue({ kind: 'checkbox', checked: true });
      await context.sync();
    });
    const proposed = controlOf(await mainXmlOf(runtime));
    expect(proposed).toMatch(/<w:del [^>]*w:author="Writer"[^>]*>.*☐.*<\/w:del>/);
    expect(proposed).toMatch(/<w:ins [^>]*w:author="Writer"[^>]*>.*w:char="2612"/);
    expect(proposed).toContain('<w14:checked w14:val="1"/>');
    await runtime.run(async (context) => {
      context.document.body.revisions.rejectAll();
      await context.sync();
    });
    const rejected = controlOf(await mainXmlOf(runtime));
    expect(rejected).not.toContain('<w:ins ');
    expect(rejected).toContain('<w14:checked w14:val="0"/>');
  } finally {
    runtime.dispose();
  }
});

test('a tracked dropdown setValue is proposed, and accepting it keeps the chosen value', async () => {
  const runtime = await createServer(DROPDOWN, { author: 'Writer' });
  try {
    await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      const control = context.document.contentControls.getFirst();
      await context.sync();
      control.setValue({ kind: 'listItem', value: '2' });
      await context.sync();
    });
    const proposed = controlOf(await mainXmlOf(runtime));
    expect(proposed).toContain('<w:delText>One</w:delText>');
    expect(proposed).toMatch(/<w:ins [^>]*><w:r><w:t>Two<\/w:t>/);
    await runtime.run(async (context) => {
      context.document.body.revisions.acceptAll();
      await context.sync();
    });
    const accepted = controlOf(await mainXmlOf(runtime));
    expect(accepted).toContain('<w:t>Two</w:t>');
    expect(accepted).toContain('w:lastValue="2"');
    expect(accepted).not.toContain('<w:del ');
  } finally {
    runtime.dispose();
  }
});

test('a tracked Replace into a control proposes the text and returns the inserted range', async () => {
  const runtime = await createServer(TEXT, { author: 'Writer' });
  try {
    const text = await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      const control = context.document.contentControls.getFirst();
      const range = control.insertText('Globex', 'Replace');
      range.load('text');
      await context.sync();
      return range.text;
    });
    expect(text).toBe('Globex');
    const proposed = controlOf(await mainXmlOf(runtime));
    expect(proposed).toContain('<w:delText>Acme</w:delText>');
    expect(proposed).toMatch(/<w:ins [^>]*><w:r><w:t>Globex<\/w:t>/);
  } finally {
    runtime.dispose();
  }
});

test('a tracked Replace over a prompt strikes it and returns the inserted range', async () => {
  const prompted = docx(
    `<w:p><w:sdt><w:sdtPr><w:tag w:val="client"/><w:showingPlcHdr/><w:text/></w:sdtPr>` +
      `<w:sdtContent><w:r><w:rPr><w:rStyle w:val="PlaceholderText"/></w:rPr>` +
      `<w:t>Click here to enter text.</w:t></w:r></w:sdtContent></w:sdt></w:p>`
  );
  const runtime = await createServer(prompted, { author: 'Writer' });
  try {
    const text = await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      const range = context.document.contentControls.getFirst().insertText('Globex', 'Replace');
      range.load('text');
      await context.sync();
      return range.text;
    });
    expect(text).toBe('Globex');
    const proposed = controlOf(await mainXmlOf(runtime));
    expect(proposed).toContain('<w:delText>Click here to enter text.</w:delText>');
    expect(proposed).not.toContain('showingPlcHdr');
    await runtime.run(async (context) => {
      context.document.body.revisions.rejectAll();
      await context.sync();
    });
    expect(controlOf(await mainXmlOf(runtime))).toContain('<w:showingPlcHdr/>');
  } finally {
    runtime.dispose();
  }
});

test('a tracked insertText at the end of a control is an insertion inside it', async () => {
  const runtime = await createServer(TEXT, { author: 'Writer' });
  try {
    await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      context.document.contentControls.getFirst().insertText(' Inc.', 'End');
      await context.sync();
    });
    const proposed = controlOf(await mainXmlOf(runtime));
    expect(proposed).toMatch(
      /<w:ins [^>]*w:author="Writer"[^>]*><w:r><w:t xml:space="preserve"> Inc\.<\/w:t>/
    );
    expect(proposed).not.toContain('<w:del ');
  } finally {
    runtime.dispose();
  }
});
