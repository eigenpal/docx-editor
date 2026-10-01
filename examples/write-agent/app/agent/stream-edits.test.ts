import { expect, test } from 'bun:test';
import { ReadableStream as ServerReadableStream } from 'node:stream/web';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { strFromU8, unzipSync } from 'fflate';
import { seedDocx } from '../seed-document';
import { runWriterTool, type ToolResult } from './run-tool';
import { WriterInputStream, type WriterPart } from './stream-input';
import { streamWriterParts } from './stream-response';
import { WriterStreamEdits } from './stream-edits';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule, reviewModule } from '@docx-editor.dev/pro';
import { createPeerHarness } from '../../../../packages/pro/src/collaboration/__tests__/document-peer-support';
import { createWriterRuntime } from './run-tool';

const metadata = {
  brief: {
    documentType: 'Example form',
    partiesOrAudience: 'Fictional users',
    purpose: 'Example',
    jurisdictionOrDomainRules: 'Generic',
    tone: 'Plain',
    length: 'One page',
  },
  title: 'Example form',
};
const blocks = [
  {
    kind: 'paragraph',
    text: 'EXAMPLE FORM',
    style: 'Title',
    format: [
      { property: 'alignment', value: 'Centered' },
      { property: 'color', value: '#0000FF' },
      { property: 'underline', value: 'Single' },
      { property: 'highlightColor', value: 'Yellow' },
      { property: 'strikeThrough', value: true },
      { property: 'superscript', value: true },
    ],
  },
  { kind: 'list', listType: 'bullet', items: ['First requirement', 'Second requirement'] },
  { kind: 'paragraph', text: 'Details', style: 'Heading 1' },
  {
    kind: 'table',
    rows: [
      ['Field', 'Value'],
      ['Name', '[Name]'],
    ],
    headerRowCount: 1,
    headerFont: { bold: true },
  },
  { kind: 'paragraph', text: 'Effective date: [Select date]', style: 'Normal' },
];
const draft = { ...metadata, blocks };

test('stopping an active draft prevents its remaining document batches', async () => {
  const runtime = await DocxEditor.createServer(seedDocx());
  const input = { ...metadata, blocks: [blocks[1]] };
  const stream = new WriterStreamEdits((name, data, id, appendDraft, draftPreviousList, signal) =>
    runWriterTool(runtime, null, name, data, 'direct', id, {
      appendDraft,
      draftPreviousList,
      signal,
    })
  );
  const run = runtime.run.bind(runtime);
  let stopped = false;
  runtime.run = (async (
    callback: (context: import('@docx-editor.dev/editor-api').RequestContext) => Promise<unknown>
  ) =>
    run(async (context) => {
      const sync = context.sync.bind(context);
      let count = 0;
      context.sync = async () => {
        await sync();
        // Initial read, then body clear. Stop before any list item can be added.
        if (++count === 2 && !stopped) {
          stopped = true;
          stream.stop();
        }
      };
      return callback(context);
    })) as typeof runtime.run;
  try {
    stream.push({ toolCallId: 'stop-active', toolName: 'create_document', index: 0, input });
    const result = await stream.finish('stop-active', 'create_document', input);
    expect(stopped).toBe(true);
    expect(result).toMatchObject({
      success: false,
      code: 'Cancelled',
      completedSteps: ['clear body'],
    });
    await run(async (context) => {
      context.document.body.load('text');
      await context.sync();
      expect(context.document.body.text).toBe('');
    });
  } finally {
    runtime.dispose();
  }
});

test('reads only complete validated objects across every character boundary', () => {
  const parser = new WriterInputStream('create_document');
  const tricky = {
    ...draft,
    blocks: [{ text: 'Text with } ] { " \\ and unicode: ✓', style: 'Normal' }, ...blocks],
  };
  const inputs = [...JSON.stringify(tricky)].flatMap((char) => parser.push(char));
  expect(inputs).toHaveLength(6);
  expect((inputs[0]!.blocks as { text: string }[])[0]!.text).toBe(
    'Text with } ] { " \\ and unicode: ✓'
  );
  expect(parser.push('extra')).toEqual([]);
  const incomplete = new WriterInputStream('create_document');
  expect(incomplete.push(JSON.stringify(draft).split('EXAMPLE FORM')[0]!)).toEqual([]);
});

test('refuses unfinished and invalid objects and falls back when metadata follows blocks', () => {
  const parser = new WriterInputStream('create_document');
  expect(parser.push(JSON.stringify({ blocks, ...metadata }))).toEqual([]);
  const invalid = new WriterInputStream('create_document');
  expect(
    invalid.push(
      JSON.stringify({ ...metadata, blocks: [{ kind: 'table', rows: [['A'], ['B', 'C']] }] })
    )
  ).toEqual([]);
  const bounded = new WriterInputStream('create_document');
  expect(bounded.push(' '.repeat(1_048_577))).toEqual([]);
});

test('SDK stream publishes parts before the complete tool input', async () => {
  const WebReadableStream = ServerReadableStream as unknown as typeof ReadableStream;
  const json = JSON.stringify(draft);
  const split = json.indexOf('},{') + 1;
  const chunks: import('ai').UIMessageChunk[] = [
    { type: 'tool-input-start', toolCallId: 'draft', toolName: 'create_document' },
    { type: 'tool-input-delta', toolCallId: 'draft', inputTextDelta: json.slice(0, split) },
    { type: 'tool-input-delta', toolCallId: 'draft', inputTextDelta: json.slice(split) },
    {
      type: 'tool-input-available',
      toolCallId: 'draft',
      toolName: 'create_document',
      input: draft,
    },
  ];
  const output = await Array.fromAsync(
    new WebReadableStream<import('ai').UIMessageChunk>({
      start(c) {
        chunks.forEach((chunk) => c.enqueue(chunk));
        c.close();
      },
    }).pipeThrough(streamWriterParts())
  );
  expect(output.filter((chunk) => chunk.type === 'data-writer-part')).toHaveLength(5);
  expect(output.findIndex((chunk) => chunk.type === 'data-writer-part')).toBeLessThan(
    output.findIndex((chunk) => chunk.type === 'tool-input-available')
  );
});

test('shows styled draft parts before completion and does not duplicate them on final input', async () => {
  const runtime = await DocxEditor.createServer(seedDocx());
  let visible!: () => void;
  const first = new Promise<void>((resolve) => {
    visible = resolve;
  });
  const stream = new WriterStreamEdits(
    (name, input, id, appendDraft, draftPreviousList) =>
      runWriterTool(runtime, null, name, input, 'direct', id, { appendDraft, draftPreviousList }),
    (_, count) => {
      if (count === 1) visible();
    }
  );
  try {
    const parser = new WriterInputStream('create_document');
    const firstJSON = JSON.stringify({ ...metadata, blocks: [blocks[0]] });
    const firstInput = parser.push(firstJSON.slice(0, -2))[0]!;
    stream.push({ toolCallId: 'draft', toolName: 'create_document', index: 0, input: firstInput });
    await first;
    await runtime.run(async (c) => {
      c.document.body.load('text');
      const title = c.document.body.paragraphs.getFirst();
      title.load('alignment');
      await c.sync();
      expect(c.document.body.text).toBe('EXAMPLE FORM');
      expect(title.alignment).toBe('Centered');
    });
    for (let i = 1; i < blocks.length; i++)
      stream.push({
        toolCallId: 'draft',
        toolName: 'create_document',
        index: i,
        input: { ...metadata, blocks: [blocks[i]] },
      });
    const result = await stream.finish('draft', 'create_document', draft);
    expect(result?.success, result?.output).toBe(true);
    stream.push({ toolCallId: 'draft', toolName: 'create_document', index: 0, input: firstInput });
    expect(await stream.finish('draft', 'create_document', draft)).toEqual(result);
    const reopened = await DocxEditor.createServer(await runtime.save());
    try {
      await reopened.run(async (c) => {
        c.document.body.load('text');
        c.document.body.tables.load('items');
        c.document.body.lists.load('items');
        await c.sync();
        expect(c.document.body.text.split('EXAMPLE FORM')).toHaveLength(2);
        expect(c.document.body.text).toContain('Effective date: [Select date]');
        expect(c.document.body.tables.items).toHaveLength(1);
        expect(c.document.body.lists.items).toHaveLength(1);
        const listParagraphs = c.document.body.lists.getFirst().paragraphs;
        listParagraphs.load('items');
        await c.sync();
        expect(listParagraphs.items).toHaveLength(2);
        const paragraphs = c.document.body.paragraphs;
        paragraphs.load('items');
        await c.sync();
        for (const paragraph of paragraphs.items) {
          paragraph.load(['text', 'alignment']);
          paragraph.font.load([
            'italic',
            'color',
            'underline',
            'highlightColor',
            'strikeThrough',
            'superscript',
          ]);
        }
        await c.sync();
        const details = paragraphs.items.find((p) => p.text === 'Details')!;
        expect(details.alignment).toBe('Left');
        expect(details.font.italic).toBe(false);
        expect(details.font.color).toBe('#000000');
        expect(details.font.underline).toBe('None');
        expect(details.font.highlightColor).toBe(null);
        expect(details.font.strikeThrough).toBe(false);
        expect(details.font.superscript).toBe(false);
      });
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

test('streams independent native suggestions and preserves accept and reject results', async () => {
  const runtime = await DocxEditor.createServer(seedDocx(), {
    author: 'Writer agent',
    revisionTextView: 'original',
  });
  try {
    const read = await runWriterTool(runtime, null, 'read_document', {});
    const paragraphs = JSON.parse(read.output).items;
    const edits = [
      {
        action: 'insertText',
        target: { paragraphId: paragraphs[1].id, search: 'Example Client' },
        text: 'Fictional Client',
        location: 'Replace',
      },
      {
        action: 'insertParagraph',
        target: { paragraphId: paragraphs[3].id },
        text: 'Proposed heading',
        location: 'After',
        format: [
          { property: 'bold', value: true },
          { property: 'size', value: 14 },
        ],
      },
    ];
    const stream = new WriterStreamEdits((name, input, id, appendDraft) =>
      runWriterTool(runtime, null, name, input, 'suggest', id, { appendDraft })
    );
    const parser = new WriterInputStream('edit_text');
    parser
      .push(JSON.stringify({ edits }).slice(0, -2))
      .forEach((input, index) =>
        stream.push({ toolCallId: 'edits', toolName: 'edit_text', index, input })
      );
    const result = await stream.finish('edits', 'edit_text', { edits });
    expect(result?.success, result?.output).toBe(true);
    expect(JSON.parse(result!.output).edited).toBe(2);
    const bytes = await runtime.save();
    expect(strFromU8(unzipSync(bytes)['word/document.xml']!)).toContain('w:author="Writer agent"');
    for (const decision of ['acceptAll', 'rejectAll'] as const) {
      const reopened = await DocxEditor.createServer(bytes);
      try {
        await reopened.run(async (c) => {
          c.document.body.revisions[decision]();
          await c.sync();
          c.document.body.load('text');
          await c.sync();
          expect(c.document.body.text.includes('Fictional Client')).toBe(decision === 'acceptAll');
          expect(c.document.body.text.includes('Proposed heading')).toBe(decision === 'acceptAll');
        });
      } finally {
        reopened.dispose();
      }
    }
  } finally {
    runtime.dispose();
  }
});

test('stops on external edits and keeps completed parts without replay', async () => {
  const runtime = await DocxEditor.createServer(seedDocx());
  let visible!: () => void;
  const first = new Promise<void>((resolve) => {
    visible = resolve;
  });
  const stream = new WriterStreamEdits(
    (name, input, id, appendDraft, draftPreviousList) =>
      runWriterTool(runtime, null, name, input, 'direct', id, { appendDraft, draftPreviousList }),
    () => visible()
  );
  try {
    stream.push({
      toolCallId: 'draft',
      toolName: 'create_document',
      index: 0,
      input: { ...metadata, blocks: [blocks[0]] },
    });
    await first;
    await runtime.run(async (c) => {
      c.document.body.insertParagraph('User edit', 'End');
      await c.sync();
    });
    stream.push({
      toolCallId: 'draft',
      toolName: 'create_document',
      index: 1,
      input: { ...metadata, blocks: [blocks[1]] },
    });
    const result = await stream.finish('draft', 'create_document', {
      ...metadata,
      blocks: blocks.slice(0, 2),
    });
    expect(result?.code).toBe('StaleDocument');
    expect(result?.completedSteps?.length).toBeGreaterThan(0);
    await runtime.run(async (c) => {
      c.document.body.load('text');
      await c.sync();
      expect(c.document.body.text.split(/[\r\n\u2028\u2029]/)).toEqual([
        'EXAMPLE FORM',
        'User edit',
      ]);
    });
  } finally {
    runtime.dispose();
  }
});

test('cancellation prevents queued writes and final input cannot change an applied prefix', async () => {
  let release!: (result: ToolResult) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const writes: WriterPart['input'][] = [];
  const stream = new WriterStreamEdits(async (_, input) => {
    writes.push(input);
    started();
    return new Promise<ToolResult>((resolve) => {
      release = resolve;
    });
  });
  stream.push({
    toolCallId: 'draft',
    toolName: 'create_document',
    index: 0,
    input: { ...metadata, blocks: [blocks[0]] },
  });
  stream.push({
    toolCallId: 'draft',
    toolName: 'create_document',
    index: 1,
    input: { ...metadata, blocks: [blocks[1]] },
  });
  await ready;
  stream.stop();
  release({ success: true, output: '{}', completedSteps: ['paragraph'] });
  const result = await stream.finish('draft', 'create_document', draft);
  expect(result?.code).toBe('Cancelled');
  expect(writes).toHaveLength(1);
  expect(result?.completedSteps).toEqual(['paragraph']);
  const changed = new WriterStreamEdits(async () => ({ success: true, output: '{}' }));
  changed.push({
    toolCallId: 'changed',
    toolName: 'create_document',
    index: 0,
    input: { ...metadata, blocks: [blocks[0]] },
  });
  expect(
    (
      await changed.finish('changed', 'create_document', {
        ...metadata,
        blocks: [{ text: 'Different' }],
      })
    )?.code
  ).toBe('InvalidArgument');
});

test('refuses invalid streamed indexes before execution', async () => {
  for (const index of [-1, 0.5, Number.NaN, 1]) {
    let writes = 0;
    const stream = new WriterStreamEdits(async () => {
      writes++;
      return { success: true, output: '{}' };
    });
    stream.push({
      toolCallId: 'invalid',
      toolName: 'create_document',
      index,
      input: { ...metadata, blocks: [blocks[0]] },
    });
    expect((await stream.finish('invalid', 'create_document', draft))?.code).toBe(
      'InvalidArgument'
    );
    expect(writes).toBe(0);
  }
});

test('streamed blocks reach a real collaboration peer before the final tool input', async () => {
  const harness = createPeerHarness('writer-stream', { offlineEditing: true });
  const peers = await harness.pair(seedDocx());
  const mounted = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    return { editor, runtime: createWriterRuntime(editor), container, room: peer.room };
  });
  const [alice, bob] = mounted;
  let visible!: () => void;
  let update = new Promise<void>((resolve) => {
    visible = resolve;
  });
  const stream = new WriterStreamEdits(
    (name, input, id, appendDraft, draftPreviousList) =>
      runWriterTool(alice!.runtime, alice!.editor, name, input, 'direct', id, {
        appendDraft,
        draftPreviousList,
      }),
    () => visible()
  );
  const bodyText = (peer: typeof alice) =>
    peer!.runtime.run(async (c) => {
      c.document.body.load('text');
      await c.sync();
      return c.document.body.text;
    });
  try {
    stream.push({
      toolCallId: 'draft',
      toolName: 'create_document',
      index: 0,
      input: { ...metadata, blocks: [blocks[0]] },
    });
    await update;
    mounted.forEach((p) => p.room.session.flushPendingJournals());
    expect(await bodyText(bob)).toBe('EXAMPLE FORM');
    for (const [peer, decision] of [
      [alice, 'acceptAll'],
      [bob, 'rejectAll'],
    ] as const) {
      await peer!.runtime.run(async (context) => {
        context.document.body.revisions[decision]();
        await context.sync();
      });
    }
    mounted.forEach((p) => p.room.session.flushPendingJournals());
    expect(await bodyText(alice)).toBe('EXAMPLE FORM');
    expect(await bodyText(bob)).toBe('EXAMPLE FORM');
    update = new Promise<void>((resolve) => {
      visible = resolve;
    });
    stream.push({
      toolCallId: 'draft',
      toolName: 'create_document',
      index: 1,
      input: { ...metadata, blocks: [blocks[1]] },
    });
    await update;
    mounted.forEach((p) => p.room.session.flushPendingJournals());
    expect(await bodyText(bob)).toBe(await bodyText(alice));
    await bob!.runtime.run(async (c) => {
      c.document.body.paragraphs.getFirst().insertText('Peer title', 'Replace');
      await c.sync();
    });
    mounted.forEach((p) => p.room.session.flushPendingJournals());
    stream.push({
      toolCallId: 'draft',
      toolName: 'create_document',
      index: 2,
      input: { ...metadata, blocks: [blocks[2]] },
    });
    expect(
      (await stream.finish('draft', 'create_document', { ...metadata, blocks: blocks.slice(0, 3) }))
        ?.code
    ).toBe('StaleDocument');
    expect(await bodyText(alice)).toBe(await bodyText(bob));
    expect(await bodyText(alice)).toContain('Peer title');
    expect((await runWriterTool(alice!.runtime, alice!.editor, 'read_document', {})).success).toBe(
      true
    );
    const cancelled = new WriterStreamEdits(
      (name, input, id, appendDraft, draftPreviousList, signal) =>
        runWriterTool(alice!.runtime, alice!.editor, name, input, 'direct', id, {
          appendDraft,
          draftPreviousList,
          signal,
        })
    );
    const unsubscribe = alice!.editor.on('change', () => cancelled.stop());
    try {
      const input = { ...metadata, blocks: [blocks[1]] };
      cancelled.push({ toolCallId: 'cancel-room', toolName: 'create_document', index: 0, input });
      expect(await cancelled.finish('cancel-room', 'create_document', input)).toMatchObject({
        success: false,
        code: 'Cancelled',
        completedSteps: ['clear body'],
      });
    } finally {
      unsubscribe();
    }
    mounted.forEach((p) => p.room.session.flushPendingJournals());
    expect(await bodyText(alice)).toBe('');
    expect(await bodyText(bob)).toBe('');
    expect(alice!.editor.exec({ type: 'undo' }).ok).toBe(true);
    mounted.forEach((p) => p.room.session.flushPendingJournals());
    expect(await bodyText(alice)).toBe(await bodyText(bob));
    // The session can group preceding writer batches into the same undo item.
    expect(await bodyText(alice)).not.toBe('');
    expect(alice!.editor.exec({ type: 'redo' }).ok).toBe(true);
    mounted.forEach((p) => p.room.session.flushPendingJournals());
    expect(await bodyText(alice)).toBe('');
    expect(await bodyText(bob)).toBe('');
    for (const peer of mounted) {
      const reopened = await DocxEditor.createServer(new Uint8Array(await peer.editor.save()));
      try {
        expect(
          await reopened.run(async (c) => {
            c.document.body.load('text');
            await c.sync();
            return c.document.body.text;
          })
        ).toBe(await bodyText(peer));
      } finally {
        reopened.dispose();
      }
    }
  } finally {
    mounted.forEach((p) => {
      p.runtime.dispose();
      p.editor.destroy();
      p.container.remove();
    });
    harness.cleanup();
  }
});
