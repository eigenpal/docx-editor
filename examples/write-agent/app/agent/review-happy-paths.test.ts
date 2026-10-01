import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor, type DocxEditorServerRuntime } from '@docx-editor.dev/editor-api';
import { seedDocx } from '../seed-document';
import { runWriterTool, type WriterMode } from './run-tool';

async function call(
  runtime: DocxEditorServerRuntime,
  name: string,
  input: Record<string, unknown> = {},
  mode: WriterMode = 'direct'
) {
  const result = await runWriterTool(runtime, null, name, input, mode);
  expect(result.success, `${name}: ${JSON.stringify(result)}`).toBe(true);
  return JSON.parse(result.output);
}
async function inspect(runtime: DocxEditorServerRuntime, area: string) {
  return (await call(runtime, 'inspect_document', { area })).items;
}
async function markup(runtime: DocxEditorServerRuntime) {
  return strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
}

for (const type of ['PlainText', 'RichText', 'DatePicker'] as const) {
  test(`${type} fields preserve labels through formatting suggestions and reopen`, async () => {
    const runtime = await DocxEditor.createServer(seedDocx(), { author: 'Writer agent' });
    try {
      await runtime.run(async (c) => {
        c.document.body.insertText('Field: [Value]', 'Replace');
        await c.sync();
      });
      const paragraph = (await inspect(runtime, 'paragraphs'))[0];
      await call(runtime, 'insert_content_controls', {
        fields: [
          { paragraphId: paragraph.id, search: '[Value]', type, tag: 'field', title: 'Field' },
        ],
      });
      await inspect(runtime, 'controls');
      const value = type === 'DatePicker' ? '[Value]' : 'Updated value';
      if (type !== 'DatePicker')
        await call(runtime, 'edit_control', {
          control: 0,
          operation: { action: 'insertText', text: value, location: 'Replace' },
        });
      else {
        const before = await runtime.save();
        for (const location of ['Replace', 'Start', 'End']) {
          await inspect(runtime, 'controls');
          const refused = await runWriterTool(
            runtime,
            null,
            'edit_control',
            {
              control: 0,
              operation: { action: 'insertText', text: '2026-10-01', location },
            },
            'direct'
          );
          expect(refused.code).toBe('NotSupported');
          expect(await runtime.save()).toEqual(before);
        }
      }
      await inspect(runtime, 'paragraphs');
      await call(
        runtime,
        'format_document',
        {
          targets: [{ paragraphId: paragraph.id, search: value }],
          changes: [
            { property: 'bold', value: true },
            { property: 'color', value: '#113355' },
          ],
        },
        'suggest'
      );
      const bytes = await runtime.save();
      for (const decision of ['acceptAll', 'rejectAll'] as const) {
        const reopened = await DocxEditor.createServer(bytes);
        try {
          await reopened.run(async (c) => {
            c.document.body.revisions[decision]();
            await c.sync();
            c.document.body.load('text');
            c.document.body.contentControls.load('items');
            await c.sync();
            expect(c.document.body.text).toBe(`Field: ${value}`);
            expect(c.document.body.contentControls.items).toHaveLength(1);
            const field = c.document.body.contentControls.items[0]!;
            field.load(['subtype', 'tag', 'title', 'text']);
            const range = c.document.body.search(value).getFirst();
            range.font.load(['bold', 'color']);
            await c.sync();
            expect(field.tag).toBe('field');
            expect(field.title).toBe('Field');
            expect(field.text).toBe(value);
            expect(field.subtype).toBe(
              type === 'DatePicker' ? 'date' : type === 'PlainText' ? 'plainText' : 'richText'
            );
            expect(range.font.bold === true).toBe(decision === 'acceptAll');
            if (decision === 'acceptAll') expect(range.font.color).toBe('#113355');
          });
          expect(await markup(reopened)).not.toContain('PrChange');
        } finally {
          reopened.dispose();
        }
      }
    } finally {
      runtime.dispose();
    }
  });
}

for (const decision of ['acceptAll', 'rejectAll'] as const) {
  test(`existing bullet list conversion survives saved ${decision}`, async () => {
    const runtime = await DocxEditor.createServer(seedDocx(), { author: 'Writer agent' });
    try {
      await runtime.run(async (c) => {
        const list = c.document.body.paragraphs.getFirst().startNewList();
        await c.sync();
        list.setLevelBullet(0, 'Square');
        await c.sync();
      });
      const original = (await inspect(runtime, 'lists'))[0];
      await call(
        runtime,
        'edit_list',
        {
          paragraphIds: original.paragraphs.map((p: { id: string }) => p.id),
          operation: { action: 'create', kind: 'numbered' },
        },
        'suggest'
      );
      await inspect(runtime, 'lists');
      await call(
        runtime,
        'configure_list',
        {
          list: 0,
          level: 0,
          operations: [
            { action: 'numbering', numbering: 'UpperRoman', formatString: [0, ')'] },
            { action: 'startingNumber', value: 3 },
            { action: 'indents', textIndent: 36, markerIndent: -18 },
          ],
        },
        'suggest'
      );
      const reopened = await DocxEditor.createServer(await runtime.save());
      try {
        await reopened.run(async (c) => {
          c.document.body.revisions[decision]();
          await c.sync();
          c.document.body.lists.load('items');
          await c.sync();
          expect(c.document.body.lists.items).toHaveLength(1);
          const list = c.document.body.lists.items[0]!;
          list.load('id');
          await c.sync();
          expect(list.id === original.id).toBe(decision === 'rejectAll');
          // Read the persisted definition for the active list; no level-read API exists.
          const entries = unzipSync(await reopened.save());
          const numbering = strFromU8(entries['word/numbering.xml']!);
          const num = numbering.match(
            new RegExp(`<w:num w:numId="${list.id}"[^>]*>(.*?)</w:num>`, 's')
          )![1]!;
          const abstractId = num.match(/<w:abstractNumId w:val="([^"]+)"/)![1]!;
          const definition = num.includes('<w:lvl ')
            ? num
            : numbering.match(
                new RegExp(
                  `<w:abstractNum w:abstractNumId="${abstractId}"[^>]*>(.*?)</w:abstractNum>`,
                  's'
                )
              )![1]!;
          expect(definition).toContain(
            `w:val="${decision === 'acceptAll' ? 'upperRoman' : 'bullet'}"`
          );
        });
        expect(await markup(reopened)).not.toContain('pPrChange');
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
}

test('creates an anonymous agreement with justified text, nested clauses, and signature cells', async () => {
  const runtime = await DocxEditor.createServer(seedDocx(), { author: 'Writer agent' });
  try {
    await call(runtime, 'create_document', {
      brief: {
        documentType: 'Agreement',
        partiesOrAudience: 'Two fictional parties',
        purpose: 'Example formatting',
        jurisdictionOrDomainRules: 'Generic',
        tone: 'Formal',
        length: 'One page',
      },
      title: 'Sample agreement',
      blocks: [
        {
          text: 'SAMPLE AGREEMENT',
          style: 'Title',
          format: [
            { property: 'alignment', value: 'Centered' },
            { property: 'name', value: 'Arial' },
            { property: 'size', value: 10 },
          ],
        },
        {
          text: 'The parties agree to the following terms.',
          style: 'Normal',
          format: [{ property: 'alignment', value: 'Justified' }],
        },
        {
          kind: 'list',
          listType: 'numbered',
          items: ['Scope', 'First obligation', 'Second obligation'],
        },
        { text: 'Signatures', style: 'Heading 1' },
        {
          kind: 'table',
          headerRowCount: 0,
          rows: [
            ['Party A', 'Party B'],
            ['[Name A]', '[Name B]'],
            ['[Signature A]', '[Signature B]'],
            ['[Date A]', '[Date B]'],
          ],
        },
      ],
    });
    const paragraphs = await inspect(runtime, 'paragraphs');
    expect(paragraphs[0]).toMatchObject({
      alignment: 'Centered',
      font: { name: 'Arial', size: 10 },
    });
    expect(paragraphs[1].alignment).toBe('Justified');
    expect(paragraphs.filter((p: { text: string }) => p.text === 'SAMPLE AGREEMENT')).toHaveLength(
      1
    );
    await call(runtime, 'format_document', {
      targets: paragraphs.map((p: { id: string }) => ({ paragraphId: p.id })),
      changes: [
        { property: 'name', value: 'Arial' },
        { property: 'size', value: 10 },
        { property: 'lineSpacing', value: 12 },
      ],
    });
    await inspect(runtime, 'paragraphs');
    await call(runtime, 'format_document', {
      targets: [{ paragraphId: paragraphs[0].id }],
      changes: [{ property: 'alignment', value: 'Centered' }],
    });
    await inspect(runtime, 'paragraphs');
    await call(runtime, 'format_document', {
      targets: paragraphs
        .filter((p: { text: string }) =>
          [
            'The parties agree to the following terms.',
            'Scope',
            'First obligation',
            'Second obligation',
          ].includes(p.text)
        )
        .map((p: { id: string }) => ({ paragraphId: p.id })),
      changes: [{ property: 'alignment', value: 'Justified' }],
    });
    const lists = await inspect(runtime, 'lists');
    await call(runtime, 'configure_list', {
      list: 0,
      level: 0,
      operations: [{ action: 'indents', textIndent: 36, markerIndent: -36 }],
    });
    await inspect(runtime, 'lists');
    await call(runtime, 'configure_list', {
      list: 0,
      level: 1,
      operations: [
        { action: 'numbering', numbering: 'Arabic', formatString: [0, '.', 1, '.'] },
        { action: 'indents', textIndent: 72, markerIndent: -36 },
      ],
    });
    await inspect(runtime, 'lists');
    await call(runtime, 'edit_list', {
      paragraphIds: lists[0].paragraphs.slice(1).map((p: { id: string }) => p.id),
      operation: { action: 'level', level: 1 },
    });
    await inspect(runtime, 'sections');
    await call(runtime, 'edit_layout', {
      section: 0,
      changes: [
        { property: 'pageWidth', value: 595.45 },
        { property: 'pageHeight', value: 841.7 },
        { property: 'leftMargin', value: 72 },
        { property: 'rightMargin', value: 72 },
        { property: 'topMargin', value: 92.1 },
        { property: 'bottomMargin', value: 72 },
      ],
    });
    const reopened = await DocxEditor.createServer(await runtime.save());
    try {
      const savedParagraphs = await inspect(reopened, 'paragraphs');
      expect(savedParagraphs[0]).toMatchObject({
        alignment: 'Centered',
        font: { name: 'Arial', size: 10 },
      });
      expect(savedParagraphs[1]).toMatchObject({ alignment: 'Justified', lineSpacing: 12 });
      expect(
        (await inspect(reopened, 'lists'))[0].paragraphs.map((p: { level: number }) => p.level)
      ).toEqual([0, 1, 1]);
      expect((await inspect(reopened, 'tables'))[0].values).toEqual([
        ['Party A', 'Party B'],
        ['[Name A]', '[Name B]'],
        ['[Signature A]', '[Signature B]'],
        ['[Date A]', '[Date B]'],
      ]);
      expect(await markup(reopened)).toContain('w:left="1440"');
      expect(strFromU8(unzipSync(await reopened.save())['word/numbering.xml']!)).toContain(
        'w:val="%1.%2."'
      );
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

for (const mode of ['direct', 'suggest'] as const) {
  test(`rich font and paragraph changes preserve explicit properties in ${mode}`, async () => {
    const runtime = await DocxEditor.createServer(seedDocx(), { author: 'Writer agent' });
    try {
      const paragraph = (await inspect(runtime, 'paragraphs'))[1];
      const changes = [
        { property: 'bold', value: true },
        { property: 'italic', value: true },
        { property: 'underline', value: 'Double' },
        { property: 'strikeThrough', value: true },
        { property: 'name', value: 'Arial' },
        { property: 'size', value: 16 },
        { property: 'color', value: '#123456' },
        { property: 'highlightColor', value: 'Yellow' },
        { property: 'superscript', value: true },
        { property: 'alignment', value: 'Right' },
        { property: 'leftIndent', value: 18 },
        { property: 'firstLineIndent', value: -9 },
        { property: 'lineSpacing', value: 18 },
        { property: 'spaceBefore', value: 6 },
        { property: 'spaceAfter', value: 12 },
      ];
      await call(
        runtime,
        'format_document',
        { targets: [{ paragraphId: paragraph.id }], changes },
        mode
      );
      const reopened = await DocxEditor.createServer(await runtime.save());
      try {
        if (mode === 'suggest') {
          await reopened.run(async (c) => {
            c.document.body.revisions.acceptAll();
            await c.sync();
          });
        }
        const updated = (await inspect(reopened, 'paragraphs'))[1];
        for (const change of changes) {
          const owner = change.property in updated.font ? updated.font : updated;
          expect(owner[change.property]).toBe(
            change.property === 'highlightColor' ? '#FFFF00' : change.value
          );
        }
        expect(updated.text).toBe(paragraph.text);
        expect(await markup(reopened)).not.toContain('PrChange');
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
}
