/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// New table rows look like the row they were made from.
//
// A row added with `addRows` or `insertRows` copies each source cell's paragraph properties,
// paragraph mark included, so values written into it keep the table's font size and alignment.
// A source mark with no formatting borrows the cell's first run formatting. Inside a row the
// author proposed inserting, formatting records nothing of its own: rejecting the row removes it.

import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor, type DocxEditorServerRuntime, type RequestContext } from '../../index.ts';
import { docx } from './support/docx.ts';

const cell = (inner: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${inner}</w:tc>`;
const table = (rows: string) =>
  `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows}</w:tbl><w:p/>`;

/** Runs sized 9.5 pt, with an unformatted paragraph mark: what document generators write. */
const runSized = (text: string) =>
  `<w:p><w:r><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
/** A centered paragraph whose mark carries the formatting, plus revision markers to drop. */
const markFormatted = (text: string) =>
  `<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:ins w:id="1" w:author="Old"/><w:b/><w:sz w:val="28"/><w:rPrChange w:id="2" w:author="Old"><w:rPr/></w:rPrChange></w:rPr><w:pPrChange w:id="3" w:author="Old"><w:pPr/></w:pPrChange></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

async function rowXml(r: DocxEditorServerRuntime, text: string): Promise<string> {
  const xml = strFromU8(unzipSync(await r.save())['word/document.xml']!);
  const at = xml.indexOf(`>${text}<`);
  expect(at).toBeGreaterThan(-1);
  return xml.slice(xml.lastIndexOf('<w:tr', at), xml.indexOf('</w:tr>', at));
}

async function rows(c: RequestContext) {
  const tables = c.document.body.tables;
  tables.load('items');
  await c.sync();
  const collection = tables.items[0]!.rows;
  collection.load('items');
  await c.sync();
  return { table: tables.items[0]!, rows: collection.items };
}

test('rows added below take the source row’s run size when its mark has none', async () => {
  const r = await DocxEditor.createServer(
    docx(table(`<w:tr>${cell(runSized('Name'))}${cell(runSized('Role'))}</w:tr>`)),
    { author: 'Agent' }
  );
  try {
    await r.run(async (c) => {
      (await rows(c)).table.addRows('End', 1, [['Ada', 'Counsel']]);
      await c.sync();
    });
    const added = await rowXml(r, 'Ada');
    expect(added).toContain('<w:sz w:val="19"/>');
    expect(added.match(/<w:sz w:val="19"\/>/g)?.length).toBeGreaterThanOrEqual(4);
  } finally {
    r.dispose();
  }
});

test('inserted rows copy paragraph and mark properties without revision markers', async () => {
  const r = await DocxEditor.createServer(
    docx(table(`<w:tr>${cell(markFormatted('Name'))}${cell(markFormatted('Role'))}</w:tr>`)),
    { author: 'Agent' }
  );
  try {
    await r.run(async (c) => {
      (await rows(c)).rows[0]!.insertRows('After', 1, [['Ada', 'Counsel']]);
      await c.sync();
    });
    const added = await rowXml(r, 'Ada');
    expect(added).toContain('<w:jc w:val="center"/>');
    expect(added).toContain('<w:sz w:val="28"/>');
    expect(added).not.toContain('w:author="Old"');
    expect(added).not.toContain('rPrChange');
    expect(added).not.toContain('pPrChange');
  } finally {
    r.dispose();
  }
});

test('extension properties bound on the source paragraph stay behind', async () => {
  const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
  const extended = (text: string) =>
    `<w:p xmlns:w14="${W14}"><w:pPr><w:rPr><w14:ligatures w14:val="standard"/><w:sz w:val="19"/></w:rPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const r = await DocxEditor.createServer(
    docx(table(`<w:tr>${cell(extended('Name'))}${cell(extended('Role'))}</w:tr>`)),
    { author: 'Agent' }
  );
  try {
    await r.run(async (c) => {
      (await rows(c)).table.addRows('End', 1, [['Ada', 'Counsel']]);
      await c.sync();
    });
    const added = await rowXml(r, 'Ada');
    expect(added).toContain('<w:sz w:val="19"/>');
    expect(added).not.toContain('ligatures');
  } finally {
    r.dispose();
  }
});

test('a leading reference, link, or struck run does not set the new row’s face', async () => {
  const leading =
    '<w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>' +
    '<w:del w:id="5" w:author="Old"><w:r><w:rPr><w:strike/></w:rPr><w:delText>x</w:delText></w:r></w:del>' +
    '<w:r><w:rPr><w:i/></w:rPr><w:t>Name</w:t></w:r></w:p>';
  const r = await DocxEditor.createServer(
    docx(table(`<w:tr>${cell(leading)}${cell(runSized('Role'))}</w:tr>`)),
    { author: 'Agent' }
  );
  try {
    await r.run(async (c) => {
      (await rows(c)).table.addRows('End', 1, [['Ada', 'Counsel']]);
      await c.sync();
    });
    const added = await rowXml(r, 'Ada');
    expect(added).toContain('<w:i/>');
    expect(added).not.toContain('superscript');
    expect(added).not.toContain('<w:strike/>');
  } finally {
    r.dispose();
  }
});

test('formatting inside the author’s own proposed row records no revision of its own', async () => {
  const r = await DocxEditor.createServer(
    docx(table(`<w:tr>${cell(runSized('Name'))}${cell(runSized('Role'))}</w:tr>`)),
    { author: 'Agent' }
  );
  try {
    await r.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      await c.sync();
      (await rows(c)).table.addRows('End', 1, [['Ada', 'Counsel']]);
      await c.sync();
      const { table: t } = await rows(c);
      for (const column of [0, 1]) {
        t.getCell(1, column).body.font.size = 14;
        t.getCell(1, column).body.paragraphs.getFirst().alignment = 'Centered';
      }
      await c.sync();
    });
    const added = await rowXml(r, 'Ada');
    expect(added).toContain('<w:ins ');
    expect(added).toContain('<w:sz w:val="28"/>');
    expect(added).not.toContain('rPrChange');
    expect(added).not.toContain('pPrChange');
    await r.run(async (c) => {
      c.document.body.revisions.rejectAll();
      await c.sync();
      const { rows: left } = await rows(c);
      expect(left.length).toBe(1);
    });
  } finally {
    r.dispose();
  }
});

test('formatting a row another author inserted still records a revision', async () => {
  const other = await DocxEditor.createServer(
    docx(table(`<w:tr>${cell(runSized('Name'))}${cell(runSized('Role'))}</w:tr>`)),
    { author: 'Other' }
  );
  let bytes: Uint8Array;
  try {
    await other.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      await c.sync();
      (await rows(c)).table.addRows('End', 1, [['Ada', 'Counsel']]);
      await c.sync();
    });
    bytes = await other.save();
  } finally {
    other.dispose();
  }
  const r = await DocxEditor.createServer(bytes, { author: 'Agent' });
  try {
    await r.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      await c.sync();
      (await rows(c)).table.getCell(1, 0).body.paragraphs.getFirst().alignment = 'Centered';
      await c.sync();
    });
    expect(await rowXml(r, 'Ada')).toContain('pPrChange');
  } finally {
    r.dispose();
  }
});
