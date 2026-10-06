import { expect, test } from 'bun:test';
import { DocxEditor, type DocxEditorServerRuntime } from '@docx-editor.dev/editor-api';
import { unzipSync, strFromU8 } from 'fflate';
import { seedDocx } from '../seed-document';
import { runWriterTool, type WriterMode } from './run-tool';

interface InspectionRecord {
  id: string;
  text: string;
  font: { bold: boolean; italic: boolean };
  values: string[][];
  cells: { row: number; column: number; paragraphs: { id: string; text: string }[] }[];
  paragraphs: { level: number }[];
  replies: { text: string }[];
  resolved: boolean;
  orientation: string;
}

async function host() {
  return DocxEditor.createServer(seedDocx(), {
    author: 'Writer agent',
    revisionTextView: 'original',
  });
}
async function call(
  runtime: DocxEditorServerRuntime,
  name: string,
  input: Record<string, unknown> = {},
  mode: WriterMode = 'direct'
): Promise<{ items: InspectionRecord[] }> {
  const result = await runWriterTool(runtime, null, name, input, mode);
  expect(result.success, `${name}: ${JSON.stringify(result)}`).toBe(true);
  return JSON.parse(result.output);
}
async function read(
  runtime: DocxEditorServerRuntime,
  area = 'paragraphs',
  extra: Record<string, unknown> = {}
) {
  return (await call(runtime, 'inspect_document', { area, ...extra })).items;
}
async function xml(runtime: DocxEditorServerRuntime) {
  const bytes = await runtime.save();
  const reopened = await DocxEditor.createServer(bytes);
  try {
    return strFromU8(unzipSync(await reopened.save())['word/document.xml']!);
  } finally {
    reopened.dispose();
  }
}

test('clears highlighting through public font writes in both editing modes', async () => {
  for (const mode of ['direct', 'suggest'] as const) {
    const runtime = await host();
    try {
      const paragraphs = await read(runtime);
      const targets = [{ paragraphId: paragraphs[0]!.id }];
      await call(runtime, 'format_document', {
        targets,
        changes: [{ property: 'highlightColor', value: 'Yellow' }],
      });
      await read(runtime);
      await call(
        runtime,
        'format_document',
        {
          targets,
          changes: [{ property: 'highlightColor', value: null }],
        },
        mode
      );
      const bytes = await runtime.save();
      for (const decision of ['acceptAll', 'rejectAll'] as const) {
        const reopened = await DocxEditor.createServer(bytes);
        try {
          await reopened.run(async (context) => {
            context.document.body.revisions[decision]();
            await context.sync();
            const font = context.document.body.paragraphs.getFirst().font;
            font.load('highlightColor');
            await context.sync();
            expect(font.highlightColor).toBe(
              mode === 'suggest' && decision === 'rejectAll' ? '#FFFF00' : null
            );
          });
        } finally {
          reopened.dispose();
        }
      }
    } finally {
      runtime.dispose();
    }
  }
});

test('formats two table headings, edits cells, and changes table structure through public methods', async () => {
  const runtime = await host();
  try {
    const paragraphs = await read(runtime);
    await call(runtime, 'insert_table', {
      beforeParagraphId: paragraphs[0].id,
      rows: [
        ['Milestone', 'Target Date'],
        ['Launch', 'October'],
      ],
    });
    const cells = await read(runtime);
    await call(runtime, 'format_document', {
      targets: ['Milestone', 'Target Date'].map((search) => ({
        paragraphId: cells.find((p: InspectionRecord) => p.text === search)!.id,
        search,
      })),
      changes: [{ property: 'bold', value: true }],
    });
    const formatted = await read(runtime);
    for (const text of ['Milestone', 'Target Date'])
      expect(formatted.find((p: InspectionRecord) => p.text === text)!.font.bold).toBe(true);
    await read(runtime, 'tables');
    await call(runtime, 'edit_table', {
      table: 0,
      operation: {
        action: 'cell',
        row: 1,
        column: 1,
        changes: [
          { property: 'value', value: 'November' },
          { property: 'shadingColor', value: '#EEEEEE' },
          { property: 'verticalAlignment', value: 'Center' },
        ],
      },
    });
    await read(runtime, 'tables');
    await call(runtime, 'edit_table', {
      table: 0,
      operation: { action: 'addRows', location: 'End', count: 1, values: [['Review', 'December']] },
    });
    await read(runtime, 'tables');
    await call(runtime, 'edit_table', {
      table: 0,
      operation: {
        action: 'addColumns',
        location: 'End',
        count: 1,
        values: [['Owner'], ['Team'], ['Client']],
      },
    });
    await read(runtime, 'tables');
    await call(runtime, 'edit_table', {
      table: 0,
      operation: { action: 'deleteColumns', start: 2, count: 1 },
    });
    await read(runtime, 'tables');
    await call(runtime, 'edit_table', {
      table: 0,
      operation: { action: 'deleteRows', start: 2, count: 1 },
    });
    const tables = await read(runtime, 'tables');
    expect(tables[0].values).toEqual([
      ['Milestone', 'Target Date'],
      ['Launch', 'November'],
    ]);
    const saved = await xml(runtime);
    expect(saved).toContain('November');
    expect(saved).not.toContain('**');
    expect(saved).not.toContain('<w:ins ');
  } finally {
    runtime.dispose();
  }
});

test('creates one-item lists, changes levels, and removes list membership without changing text', async () => {
  const runtime = await host();
  try {
    const paragraphs = await read(runtime),
      id = paragraphs[1].id;
    await call(runtime, 'edit_list', {
      paragraphIds: [id],
      operation: { action: 'create', kind: 'bullet' },
    });
    const lists = await read(runtime, 'lists');
    expect(lists).toHaveLength(1);
    expect(lists[0].paragraphs).toHaveLength(1);
    await call(runtime, 'configure_list', {
      list: 0,
      level: 1,
      operations: [
        { action: 'numbering', numbering: 'UpperRoman' },
        { action: 'startingNumber', value: 3 },
        { action: 'indents', textIndent: 36, markerIndent: -18 },
      ],
    });
    await read(runtime);
    await call(runtime, 'edit_list', {
      paragraphIds: [id],
      operation: { action: 'level', level: 1 },
    });
    expect((await read(runtime, 'lists'))[0].paragraphs[0].level).toBe(1);
    await read(runtime);
    await call(runtime, 'edit_list', { paragraphIds: [id], operation: { action: 'detach' } });
    expect((await read(runtime)).map((p: InspectionRecord) => p.text)).toEqual(
      paragraphs.map((p: InspectionRecord) => p.text)
    );
    expect(await xml(runtime)).toContain('Example Client');
  } finally {
    runtime.dispose();
  }
});

test('creates, fills, protects, and unwraps real content controls while preserving labels', async () => {
  const runtime = await host();
  try {
    const paragraphs = await read(runtime);
    const paragraphId = paragraphs.find((p: InspectionRecord) =>
      p.text.includes('Example Client')
    )!.id;
    await call(runtime, 'insert_content_controls', {
      fields: [
        {
          paragraphId,
          search: 'Example Client',
          type: 'RichText',
          tag: 'client',
          title: 'Client name',
        },
      ],
    });
    expect((await read(runtime, 'controls'))[0]).toMatchObject({
      tag: 'client',
      text: 'Example Client',
      subtype: 'richText',
    });
    await call(runtime, 'edit_control', {
      control: 0,
      operation: { action: 'insertText', text: 'Acme', location: 'Replace' },
    });
    await read(runtime, 'controls');
    await call(runtime, 'edit_control', {
      control: 0,
      operation: { action: 'properties', changes: [{ property: 'cannotEdit', value: true }] },
    });
    await read(runtime, 'controls');
    const refused = await runWriterTool(
      runtime,
      null,
      'edit_control',
      { control: 0, operation: { action: 'insertText', text: 'Changed', location: 'Replace' } },
      'direct'
    );
    expect(refused.success).toBe(false);
    await read(runtime, 'controls');
    await call(runtime, 'edit_control', {
      control: 0,
      operation: { action: 'properties', changes: [{ property: 'cannotEdit', value: false }] },
    });
    await read(runtime, 'controls');
    await call(runtime, 'edit_control', {
      control: 0,
      operation: { action: 'delete', keepContent: true },
    });
    expect((await read(runtime)).find((p: InspectionRecord) => p.id === paragraphId)!.text).toBe(
      'Prepared for Acme'
    );
    expect(await read(runtime, 'controls')).toHaveLength(0);
    expect(await xml(runtime)).toContain('Acme');
  } finally {
    runtime.dispose();
  }
});

test('tracks text, refuses edits across pending text revisions, and handles review decisions', async () => {
  const runtime = await host();
  try {
    const paragraphs = await read(runtime),
      target = { paragraphId: paragraphs[1].id, search: 'Example Client' };
    await call(
      runtime,
      'edit_text',
      { edits: [{ action: 'insertText', target, text: 'Acme', location: 'Replace' }] },
      'suggest'
    );
    const refusal = await runWriterTool(
      runtime,
      null,
      'format_document',
      { targets: [target], changes: [{ property: 'bold', value: true }] },
      'suggest'
    );
    expect(refusal.success).toBe(false);
    await runtime.run(async (context) => {
      context.document.load('changeTrackingMode');
      await context.sync();
      expect(context.document.changeTrackingMode).toBe('TrackMineOnly');
    });
    expect(await read(runtime, 'revisions')).toHaveLength(2);
    await call(
      runtime,
      'edit_review',
      { operation: { action: 'rejectRevision', revision: 0 } },
      'suggest'
    );
    await read(runtime, 'revisions');
    await call(
      runtime,
      'edit_review',
      { operation: { action: 'rejectRevision', revision: 0 } },
      'suggest'
    );
    await read(runtime);
    await call(runtime, 'edit_review', {
      operation: { action: 'comment', target, text: 'Confirm this name.' },
    });
    await read(runtime, 'comments');
    await call(runtime, 'edit_review', {
      operation: { action: 'reply', comment: 0, text: 'Confirmed.' },
    });
    expect((await read(runtime, 'comments'))[0].replies[0].text).toBe('Confirmed.');
    await call(runtime, 'edit_review', {
      operation: { action: 'resolveComment', comment: 0, resolved: true },
    });
    expect((await read(runtime, 'comments'))[0].resolved).toBe(true);
    await call(runtime, 'edit_review', {
      operation: { action: 'deleteReply', comment: 0, reply: 0 },
    });
    await read(runtime, 'comments');
    await call(runtime, 'edit_review', { operation: { action: 'deleteComment', comment: 0 } });
    expect(await read(runtime, 'comments')).toHaveLength(0);
    expect(await xml(runtime)).toContain('Example Client');
  } finally {
    runtime.dispose();
  }
});

test('edits page layout, headers, fields, images, and paragraph formatting', async () => {
  const runtime = await host();
  try {
    const paragraphs = await read(runtime),
      target = { paragraphId: paragraphs[1].id, search: 'Example Client' };
    await call(runtime, 'format_document', {
      targets: [target],
      changes: [
        { property: 'italic', value: true },
        { property: 'underline', value: 'Single' },
        { property: 'size', value: 14 },
        { property: 'color', value: '#113355' },
        { property: 'alignment', value: 'Centered' },
        { property: 'spaceAfter', value: 8 },
      ],
      hyperlink: 'https://example.com',
    });
    await read(runtime, 'sections');
    await call(runtime, 'edit_layout', {
      section: 0,
      changes: [
        { property: 'orientation', value: 'Landscape' },
        { property: 'leftMargin', value: 54 },
        { property: 'rightMargin', value: 54 },
      ],
    });
    expect((await read(runtime, 'sections'))[0].orientation).toBe('Landscape');
    await call(runtime, 'write_header_footer', { header: 'Project', footerPrefix: 'Page ' });
    expect((await read(runtime, 'paragraphs', { story: { kind: 'header' } }))[0].text).toBe(
      'Project'
    );
    const footer = { kind: 'footer' };
    expect(await read(runtime, 'fields', { story: footer })).toHaveLength(2);
    await call(runtime, 'edit_field', {
      story: footer,
      operation: { action: 'code', field: 0, code: 'NUMPAGES' },
    });
    await read(runtime, 'fields', { story: footer });
    const cannotCalculate = await runWriterTool(
      runtime,
      null,
      'edit_field',
      { story: footer, operation: { action: 'updateResult', field: 0 } },
      'direct'
    );
    expect(cannotCalculate.success).toBe(false);
    expect(cannotCalculate.code).toBe('NotSupported');
    await read(runtime);
    await call(runtime, 'edit_picture', {
      operation: {
        action: 'insert',
        target,
        location: 'After',
        base64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=',
      },
    });
    expect(await read(runtime, 'pictures')).toHaveLength(1);
    await call(runtime, 'edit_picture', {
      operation: {
        action: 'format',
        picture: 0,
        changes: [
          { property: 'lockAspectRatio', value: false },
          { property: 'width', value: 24 },
          { property: 'height', value: 12 },
          { property: 'altTextDescription', value: 'Test image' },
        ],
      },
    });
    expect((await read(runtime, 'pictures'))[0]).toMatchObject({
      width: 24,
      height: 12,
      altTextDescription: 'Test image',
    });
    await call(runtime, 'edit_picture', { operation: { action: 'delete', picture: 0 } });
    await read(runtime);
    await call(runtime, 'insert_break', {
      target: { paragraphId: paragraphs[3].id },
      type: 'Page',
      location: 'Before',
    });
    const saved = await xml(runtime);
    expect(saved).toContain('landscape');
    expect(saved).toContain('w:type="page"');
  } finally {
    runtime.dispose();
  }
});

test('refuses stale reads and serializes concurrent calls without silently changing unrelated content', async () => {
  const runtime = await host();
  try {
    const paragraphs = await read(runtime),
      target = { paragraphId: paragraphs[1].id, search: 'Example Client' };
    await runtime.run(async (context) => {
      context.document.body.insertParagraph('A user edit', 'End');
      await context.sync();
    });
    const refused = await runWriterTool(runtime, null, 'format_document', {
      targets: [target],
      changes: [{ property: 'bold', value: true }],
    });
    expect(refused.code).toBe('StaleDocument');
    await read(runtime);
    const results = await Promise.all([
      runWriterTool(
        runtime,
        null,
        'format_document',
        { targets: [target], changes: [{ property: 'bold', value: true }] },
        'direct'
      ),
      runWriterTool(
        runtime,
        null,
        'format_document',
        { targets: [target], changes: [{ property: 'italic', value: true }] },
        'direct'
      ),
    ]);
    expect(results.every((result) => result.success)).toBe(true);
    expect((await read(runtime)).at(-1)!.text).toBe('A user edit');
  } finally {
    runtime.dispose();
  }
});

test('creates a compact form with a real table and bold headers in one document tool call', async () => {
  const runtime = await host();
  try {
    const input = {
      title: 'Project form',
      brief: {
        documentType: 'form',
        partiesOrAudience: 'project team',
        purpose: 'collect details',
        jurisdictionOrDomainRules: 'generic',
        tone: 'plain',
        length: 'short',
      },
      blocks: [
        { kind: 'paragraph', text: 'Project form', style: 'Title' },
        { kind: 'paragraph', text: 'Client: [Client name]', style: 'Normal' },
        {
          kind: 'table',
          rows: [
            ['Milestone', 'Target Date'],
            ['Launch', 'October'],
          ],
          headerRowCount: 1,
          headerFont: { bold: true },
        },
      ],
    };
    const first = await runWriterTool(
      runtime,
      null,
      'create_document',
      input,
      'direct',
      'create-once'
    );
    expect(first.success, first.output).toBe(true);
    const saved = await runtime.save();
    expect(
      await runWriterTool(runtime, null, 'create_document', input, 'direct', 'create-once')
    ).toEqual(first);
    expect(await runtime.save()).toEqual(saved);
    const paragraphs = await read(runtime);
    for (const heading of ['Milestone', 'Target Date'])
      expect(paragraphs.find((p) => p.text === heading)!.font.bold).toBe(true);
    expect((await read(runtime, 'tables'))[0].values).toEqual([
      ['Milestone', 'Target Date'],
      ['Launch', 'October'],
    ]);
    await read(runtime);
    const paragraphId = paragraphs.find((p) => p.text === 'Client: [Client name]')!.id;
    await call(runtime, 'insert_content_controls', {
      fields: [
        {
          paragraphId,
          search: '[Client name]',
          tag: 'client',
          title: 'Client name',
          type: 'PlainText',
        },
      ],
    });
    expect((await read(runtime, 'controls'))[0]).toMatchObject({
      tag: 'client',
      text: '[Client name]',
    });
    const persisted = await xml(runtime);
    expect(persisted).toContain('<w:tbl>');
    expect(persisted).toContain('<w:sdt>');
    expect(persisted).not.toContain('Milestone |');
  } finally {
    runtime.dispose();
  }
});

test('changes only explicit formatting properties', async () => {
  const runtime = await host();
  try {
    const rows = await read(runtime);
    const target = { paragraphId: rows[1]!.id };
    await call(runtime, 'format_document', {
      targets: [target],
      changes: [
        { property: 'name', value: 'Arial' },
        { property: 'color', value: '#113355' },
        { property: 'spaceAfter', value: 8 },
      ],
    });
    const before = (await read(runtime))[1]!;
    await call(runtime, 'format_document', {
      targets: [target],
      changes: [
        { property: 'bold', value: true },
        { property: 'italic', value: true },
      ],
    });
    const after = (await read(runtime))[1]!;
    expect(after).toEqual({ ...before, font: { ...before.font, bold: true, italic: true } });
    const invalid = await runWriterTool(
      runtime,
      null,
      'format_document',
      {
        targets: [target],
        changes: [{ property: 'lineSpacing', value: 0 }],
      },
      'direct'
    );
    expect(invalid.success).toBe(false);
  } finally {
    runtime.dispose();
  }
});

test('creates spaced drafts with real lists and multiple controls in one paragraph', async () => {
  const runtime = await host();
  try {
    await call(runtime, 'create_document', {
      brief: {
        documentType: 'Agreement',
        partiesOrAudience: 'Two companies',
        purpose: 'Project planning',
        jurisdictionOrDomainRules: 'Internal',
        tone: 'Neutral',
        length: 'One page',
      },
      title: 'Project agreement',
      blocks: [
        { text: 'Project agreement', style: 'Title' },
        { text: 'Parties', style: 'Heading 1' },
        { text: '[Party A] and [Party B]', style: 'Normal' },
        {
          kind: 'list',
          listType: 'bullet',
          items: ['Protect shared information.', 'Limit access to authorized staff.'],
        },
        { kind: 'list', listType: 'numbered', items: ['Confirm scope.', 'Approve delivery.'] },
        { kind: 'paragraph', text: 'Timeline', style: 'Heading 1' },
        {
          kind: 'table',
          rows: [
            ['Milestone', 'Date'],
            ['Kickoff', 'TBD'],
          ],
        },
        { kind: 'list', listType: 'bullet', items: ['Final check.'] },
        {
          kind: 'table',
          rows: [
            ['Owner', 'Status'],
            ['Team', 'Ready'],
          ],
        },
      ],
    });
    const paragraphs = await read(runtime);
    const party = paragraphs.find((p) => p.text === '[Party A] and [Party B]')!;
    await call(runtime, 'insert_content_controls', {
      fields: ['A', 'B'].map((partyName) => ({
        paragraphId: party.id,
        search: `[Party ${partyName}]`,
        tag: `party-${partyName}`,
        title: `Party ${partyName}`,
        type: 'PlainText',
      })),
    });
    expect(await read(runtime, 'controls')).toHaveLength(2);
    const lists = await read(runtime, 'lists');
    expect(lists).toHaveLength(3);
    expect(lists.map((list) => list.paragraphs.length)).toEqual([2, 2, 1]);
    const persisted = await xml(runtime);
    expect(persisted).toContain('w:after="160"');
    expect(persisted).toContain('w:before="240"');
    expect(persisted).toContain('w:numPr');
    expect(persisted.match(/<w:sdt>/g)).toHaveLength(2);
  } finally {
    runtime.dispose();
  }
});

test('suggests actual font and paragraph formatting through the writer tools', async () => {
  const runtime = await host();
  try {
    const rows = await read(runtime);
    await call(
      runtime,
      'format_document',
      {
        targets: [{ paragraphId: rows[3]!.id }],
        changes: [
          { property: 'bold', value: true },
          { property: 'italic', value: true },
          { property: 'spaceAfter', value: 12 },
        ],
      },
      'suggest'
    );
    const saved = await xml(runtime);
    expect(saved).toContain('rPrChange');
    expect(saved).toContain('pPrChange');
    await read(runtime, 'revisions');
    await call(runtime, 'edit_review', { operation: { action: 'rejectAll' } }, 'suggest');
    expect(await xml(runtime)).not.toContain('PrChange');
  } finally {
    runtime.dispose();
  }
});

test('suggests a real numbered list without adding or changing text', async () => {
  const runtime = await host();
  try {
    const rows = await read(runtime);
    await call(
      runtime,
      'edit_list',
      {
        paragraphIds: [rows[1]!.id, rows[2]!.id],
        operation: { action: 'create', kind: 'numbered' },
      },
      'suggest'
    );
    expect(await xml(runtime)).toContain('pPrChange');
    expect(await read(runtime, 'lists')).toHaveLength(1);
    await read(runtime, 'revisions');
    await call(runtime, 'edit_review', { operation: { action: 'rejectAll' } }, 'suggest');
    expect(await read(runtime, 'lists')).toHaveLength(0);
    expect((await read(runtime)).map((p) => p.text)).toEqual(rows.map((p) => p.text));
  } finally {
    runtime.dispose();
  }
});

test('refuses unchanged text replacements instead of creating false formatting suggestions', async () => {
  const runtime = await host();
  try {
    const rows = await read(runtime);
    const before = await runtime.save();
    const result = await runWriterTool(
      runtime,
      null,
      'edit_text',
      {
        edits: [
          {
            action: 'insertText',
            target: { paragraphId: rows[0]!.id },
            text: rows[0]!.text,
            location: 'Replace',
          },
        ],
      },
      'suggest'
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe('InvalidArgument');
    expect(await runtime.save()).toEqual(before);
  } finally {
    runtime.dispose();
  }
});

test('formats an inserted paragraph within the same suggestion tool', async () => {
  const runtime = await host();
  try {
    const rows = await read(runtime);
    await call(
      runtime,
      'edit_text',
      {
        edits: [
          {
            action: 'insertParagraph',
            target: { paragraphId: rows[3]!.id },
            text: 'Approval required.',
            location: 'After',
            style: 'Normal',
            format: [
              { property: 'bold', value: false },
              { property: 'italic', value: true },
              { property: 'spaceAfter', value: 10 },
            ],
          },
        ],
      },
      'suggest'
    );
    expect(await xml(runtime)).toContain('Approval required.');
    expect(await xml(runtime)).toContain('w:after="200"');
    await runtime.run(async (context) => {
      context.document.body.revisions.rejectAll();
      await context.sync();
    });
    expect(await xml(runtime)).not.toContain('Approval required.');
  } finally {
    runtime.dispose();
  }
});

test('writer tools suggest populated table rows and reject them without losing original rows', async () => {
  const runtime = await host();
  try {
    const paragraphs = await read(runtime);
    await call(runtime, 'insert_table', {
      beforeParagraphId: paragraphs[0]!.id,
      rows: [
        ['Milestone', 'Target date'],
        ['Launch', 'October'],
        ['Review', 'November'],
      ],
    });
    await read(runtime, 'tables');
    await call(
      runtime,
      'edit_table',
      {
        table: 0,
        operation: {
          action: 'addRows',
          location: 'End',
          count: 1,
          values: [['Approval', 'December']],
        },
      },
      'suggest'
    );
    await read(runtime, 'tables');
    await call(
      runtime,
      'edit_table',
      {
        table: 0,
        operation: { action: 'deleteRows', start: 1, count: 1 },
      },
      'suggest'
    );
    const saved = await xml(runtime);
    expect(saved).toMatch(/<w:trPr[^>]*>.*?<w:ins/s);
    expect(saved).toMatch(/<w:trPr[^>]*>.*?<w:del/s);
    await read(runtime, 'revisions');
    await call(runtime, 'edit_review', { operation: { action: 'rejectAll' } }, 'suggest');
    expect((await read(runtime, 'tables'))[0]!.values).toEqual([
      ['Milestone', 'Target date'],
      ['Launch', 'October'],
      ['Review', 'November'],
    ]);
  } finally {
    runtime.dispose();
  }
});

test('table inspection supplies current cell paragraph targets for rich formatting', async () => {
  const runtime = await host();
  try {
    const paragraphs = await read(runtime);
    await call(runtime, 'insert_table', {
      beforeParagraphId: paragraphs[0]!.id,
      rows: [
        ['Milestone', 'Target date'],
        ['Launch', 'November'],
      ],
    });
    const tables = await read(runtime, 'tables');
    const headers = tables[0]!.cells.filter((cell) => cell.row === 0);
    expect(headers).toHaveLength(2);
    await call(
      runtime,
      'format_document',
      {
        targets: headers.map((cell) => ({
          paragraphId: cell.paragraphs[0]!.id,
          search: cell.paragraphs[0]!.text,
        })),
        changes: [
          { property: 'italic', value: true },
          { property: 'color', value: '#0000FF' },
        ],
      },
      'suggest'
    );
    const saved = await xml(runtime);
    expect(saved).toContain('<w:rPrChange');
    const formatted = await read(runtime);
    for (const text of ['Milestone', 'Target date'])
      expect(formatted.find((paragraph) => paragraph.text === text)?.font.italic).toBe(true);
    expect(saved).toContain('0000FF');
  } finally {
    runtime.dispose();
  }
});

for (const mode of ['direct', 'suggest'] as const) {
  test(`fresh list inspection supplies safe targets for ${mode} level edits`, async () => {
    const runtime = await host();
    try {
      await runtime.run(async (context) => {
        context.document.body.paragraphs.getFirst().startNewList();
        await context.sync();
      });
      // No paragraph inspection precedes this list inspection.
      const lists = await read(runtime, 'lists');
      const paragraphId = (lists[0]!.paragraphs[0] as unknown as { id: string }).id;
      await call(
        runtime,
        'edit_list',
        {
          paragraphIds: [paragraphId],
          operation: { action: 'level', level: 1 },
        },
        mode
      );
      expect((await read(runtime, 'lists'))[0]!.paragraphs[0]!.level).toBe(1);
      if (mode === 'suggest') {
        await read(runtime, 'revisions');
        await call(runtime, 'edit_review', { operation: { action: 'rejectAll' } }, mode);
        expect((await read(runtime, 'lists'))[0]!.paragraphs[0]!.level).toBe(0);
      }
    } finally {
      runtime.dispose();
    }
  });
}
