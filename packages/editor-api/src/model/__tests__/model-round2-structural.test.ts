/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { DocxEditor as BrowserDocxEditor } from '@docx-editor.dev/editor-api/browser';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { WITH_FURNITURE, withNumbering, docx, p, table, row, cell } from './support/documents.ts';

const membership =
  '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId xmlns:x="urn:review:keep" x:val="unrelated" w:val="1"/></w:numPr></w:pPr>';
function sharedList(target: 'main' | 'note', locked: boolean): Uint8Array {
  const parts = unzipSync(withNumbering(WITH_FURNITURE, ['1']));
  for (const name of [
    'word/header1.xml',
    target === 'main' ? 'word/document.xml' : 'word/footnotes.xml',
  ]) {
    parts[name] = strToU8(strFromU8(parts[name]!).replace('<w:p>', '<w:p>' + membership));
  }
  if (locked) {
    const name = target === 'main' ? 'word/document.xml' : 'word/footnotes.xml';
    parts[name] = strToU8(
      strFromU8(parts[name]!)
        .replace(
          '<w:p>',
          '<w:sdt><w:sdtPr><w:id w:val="89"/><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:p>'
        )
        .replace('</w:p>', '</w:p></w:sdtContent></w:sdt>')
    );
  }
  return zipSync(parts);
}

for (const locked of [false, true])
  for (const other of ['main', 'note'] as const) {
    test(`list formatting refuses a shared ${locked ? 'locked ' : ''}${other} story without changing its numbering`, async () => {
      const runtime = await DocxEditor.createServer(sharedList(other, locked));
      try {
        const before = await runtime.save();
        await expect(
          runtime.run(async (context) => {
            const section = context.document.sections.getFirst();
            await context.sync();
            const header = section.getHeader('Primary');
            await context.sync();
            const list = header.lists.getFirst();
            await context.sync();
            list.setLevelStartingNumber(0, 99);
            await context.sync();
          })
        ).rejects.toMatchObject({ code: 'InvalidArgument' });
        expect(await runtime.save()).toEqual(before);
        const reopened = await DocxEditor.createServer(await runtime.save());
        try {
          expect(strFromU8(unzipSync(await reopened.save())['word/numbering.xml']!)).not.toContain(
            'w:val="99"'
          );
        } finally {
          reopened.dispose();
        }
      } finally {
        runtime.dispose();
      }
    });
  }

for (const operation of ['addColumns', 'deleteColumns'] as const) {
  test(`gridless table ${operation} refuses with a stable public error`, async () => {
    const runtime = await DocxEditor.createServer(
      docx(table(row(cell(p('a')), cell(p('b')))) + p('tail'))
    );
    try {
      const before = await runtime.save();
      await expect(
        runtime.run(async (context) => {
          const target = context.document.body.tables.getFirst();
          await context.sync();
          if (operation === 'addColumns') target.addColumns('End', 1);
          else target.deleteColumns(0);
          await context.sync();
        })
      ).rejects.toMatchObject({ code: 'InvalidArgument' });
      expect(await runtime.save()).toEqual(before);
    } finally {
      runtime.dispose();
    }
  });
}

test('list restart preserves foreign override metadata and leaf attributes', async () => {
  const parts = unzipSync(
    withNumbering(docx('<w:p>' + membership + '<w:r><w:t>item</w:t></w:r></w:p>'), ['1'])
  );
  parts['word/numbering.xml'] = strToU8(
    strFromU8(parts['word/numbering.xml']!)
      .replace('<w:numbering ', '<w:numbering xmlns:x="urn:review:keep" ')
      .replace(
        '</w:num>',
        '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/><x:metadata x:keep="yes"/><w:lvl w:ilvl="0"><w:start w:val="7" x:keep="leaf"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:lvlOverride></w:num>'
      )
  );
  const runtime = await DocxEditor.createServer(zipSync(parts));
  try {
    await runtime.run(async (context) => {
      const list = context.document.body.lists.getFirst();
      await context.sync();
      list.setLevelStartingNumber(0, 4);
      await context.sync();
    });
    const reopened = await DocxEditor.createServer(await runtime.save());
    try {
      const xml = strFromU8(unzipSync(await reopened.save())['word/numbering.xml']!);
      expect(xml).toContain('x:keep="yes"');
      expect(xml).toContain('x:keep="leaf"');
      expect(xml).not.toContain('w:startOverride');
      expect(xml).toContain('w:start w:val="4"');
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
for (const kind of ['picture', 'field', 'pageSetup', 'list'] as const) {
  test(`public browser ${kind} edit restores package data through undo and redo`, async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const input =
      kind === 'list'
        ? withNumbering(
            docx('<w:p>' + membership + '<w:r><w:t>anchor</w:t></w:r></w:p>' + p('sentinel')),
            ['1']
          )
        : docx(p('anchor') + p('sentinel'));
    const editor = createDocxEditor({ container, document: input });
    const runtime = BrowserDocxEditor.createBrowser(editor);
    try {
      const before = unzipSync(new Uint8Array(await editor.save()));
      await runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        const section = context.document.sections.getFirst();
        await context.sync();
        if (kind === 'pageSetup') section.pageSetup.orientation = 'Landscape';
        else if (kind === 'list') {
          const list = context.document.body.lists.getFirst();
          await context.sync();
          list.setLevelStartingNumber(0, 4);
        } else {
          const anchor = paragraph.getRange('End');
          await context.sync();
          if (kind === 'picture') anchor.insertInlinePictureFromBase64(png, 'After');
          else anchor.insertField('After', 'NumPages');
        }
        await context.sync();
      });
      const after = unzipSync(new Uint8Array(await editor.save()));
      expect(after).not.toEqual(before);
      editor.exec({ type: 'undo' });
      expect(unzipSync(new Uint8Array(await editor.save()))).toEqual(before);
      editor.exec({ type: 'redo' });
      expect(unzipSync(new Uint8Array(await editor.save()))).toEqual(after);
      const reopened = await DocxEditor.createServer(new Uint8Array(await editor.save()));
      try {
        await reopened.run(async (context) => {
          context.document.body.load('text');
          await context.sync();
          expect(context.document.body.text).toContain('sentinel');
        });
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
      editor.destroy();
      container.remove();
    }
  });
}

test('deleting all columns still removes a gridless table', async () => {
  const runtime = await DocxEditor.createServer(
    docx(table(row(cell(p('a')), cell(p('b')))) + p('sentinel'))
  );
  try {
    await runtime.run(async (context) => {
      const target = context.document.body.tables.getFirst();
      await context.sync();
      target.deleteColumns(0, 2);
      await context.sync();
    });
    const reopened = await DocxEditor.createServer(await runtime.save());
    try {
      await reopened.run(async (context) => {
        context.document.body.tables.load('items');
        context.document.body.load('text');
        await context.sync();
        expect(context.document.body.tables.items).toHaveLength(0);
        expect(context.document.body.text).toContain('sentinel');
      });
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

function styleSharedList(target: 'main' | 'note' | 'same'): Uint8Array {
  const parts = unzipSync(sharedList(target === 'note' ? 'note' : 'main', true));
  const styled = '<w:pPr><w:pStyle w:val="InheritedNumbering"/></w:pPr>';
  const destination = target === 'note' ? 'word/footnotes.xml' : 'word/document.xml';
  parts[destination] = strToU8(
    strFromU8(parts[destination]!).replace(membership, target === 'same' ? '' : styled)
  );
  if (target === 'same') {
    parts['word/header1.xml'] = strToU8(
      strFromU8(parts['word/header1.xml']!).replace(
        '</w:hdr>',
        '<w:sdt><w:sdtPr><w:id w:val="90"/><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:p>' +
          styled +
          '<w:r><w:t>locked style list</w:t></w:r></w:p></w:sdtContent></w:sdt></w:hdr>'
      )
    );
  }
  parts['word/styles.xml'] = strToU8(
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:style w:type="paragraph" w:styleId="NumberingBase"><w:name w:val="Numbering base"/>' +
      membership +
      '</w:style>' +
      '<w:style w:type="paragraph" w:styleId="InheritedNumbering"><w:name w:val="Inherited numbering"/>' +
      '<w:basedOn w:val="NumberingBase"/></w:style></w:styles>'
  );
  parts['[Content_Types].xml'] = strToU8(
    strFromU8(parts['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    )
  );
  parts['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(parts['word/_rels/document.xml.rels']!).replace(
      '</Relationships>',
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
    )
  );
  return zipSync(parts);
}

for (const target of ['main', 'note', 'same'] as const) {
  test(`list formatting refuses locked ${target} content that inherits its numbering through styles`, async () => {
    const runtime = await DocxEditor.createServer(styleSharedList(target));
    try {
      const before = await runtime.save();
      await expect(
        runtime.run(async (context) => {
          const section = context.document.sections.getFirst();
          await context.sync();
          const header = section.getHeader('Primary');
          await context.sync();
          const list = header.lists.getFirst();
          await context.sync();
          list.setLevelStartingNumber(0, 99);
          await context.sync();
        })
      ).rejects.toMatchObject({ code: 'InvalidArgument' });
      expect(await runtime.save()).toEqual(before);
      const reopened = await DocxEditor.createServer(await runtime.save());
      try {
        expect(strFromU8(unzipSync(await reopened.save())['word/numbering.xml']!)).not.toContain(
          'w:val="99"'
        );
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
}

test('styles using other list instances and foreign numbering names do not block direct list formatting', async () => {
  const parts = unzipSync(styleSharedList('main'));
  parts['word/styles.xml'] = strToU8(
    strFromU8(parts['word/styles.xml']!)
      .replace('x:val="unrelated" w:val="1"', 'x:val="1" w:val="2"')
      .replace('</w:styles>', '<x:numId xmlns:x="urn:review:keep" w:val="1"/></w:styles>')
  );
  const runtime = await DocxEditor.createServer(zipSync(parts));
  try {
    await runtime.run(async (context) => {
      const section = context.document.sections.getFirst();
      await context.sync();
      const header = section.getHeader('Primary');
      await context.sync();
      const list = header.lists.getFirst();
      await context.sync();
      list.setLevelStartingNumber(0, 99);
      await context.sync();
    });
    const reopened = await DocxEditor.createServer(await runtime.save());
    try {
      const saved = unzipSync(await reopened.save());
      expect(strFromU8(saved['word/numbering.xml']!)).toContain('w:start w:val="99"');
      expect(strFromU8(saved['word/styles.xml']!)).toContain('w:val="2"');
      expect(strFromU8(saved['word/styles.xml']!)).toContain('x:val="1"');
      expect(strFromU8(saved['word/styles.xml']!)).toContain('x:numId');
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});
