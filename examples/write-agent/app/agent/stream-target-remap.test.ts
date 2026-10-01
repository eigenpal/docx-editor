import { expect, test } from 'bun:test';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { anonymousStories } from './paragraph-targets.fixture';
import { runWriterTool } from './run-tool';
import { WriterStreamEdits } from './stream-edits';

for (const mode of ['direct', 'suggest'] as const)
  for (const next of ['replace', 'delete', 'deleteParagraph', 'opposite', 'duplicate'] as const) {
    test(`stream remaps imported targets after insertion: ${mode}, ${next}`, async () => {
      const runtime = await DocxEditor.createServer(anonymousStories(), {
        author: 'Writer',
        revisionTextView: 'original',
      });
      const story = { kind: 'header', section: 0, variant: 'Primary' };
      try {
        const read = await runWriterTool(runtime, null, 'inspect_document', {
          area: 'paragraphs',
          story,
        });
        const items = JSON.parse(read.output).items;
        const id = items[0].id;
        expect(id).toStartWith('@writer:');
        const edits = [
          {
            action: 'insertParagraph',
            target: { paragraphId: id },
            location: 'After',
            text: 'After original',
          },
          next === 'replace'
            ? {
                action: 'insertText',
                target: { paragraphId: id, search: 'Draft' },
                location: 'Replace',
                text: 'Final',
              }
            : next === 'delete'
              ? { action: 'delete', target: { paragraphId: id, search: 'Draft ' } }
              : next === 'deleteParagraph'
                ? { action: 'deleteParagraph', paragraphId: id }
                : next === 'opposite'
                  ? {
                      action: 'insertParagraph',
                      target: { paragraphId: id },
                      location: 'Before',
                      text: 'Before original',
                    }
                  : {
                      action: 'insertText',
                      target: { paragraphId: items[2].id },
                      location: 'Replace',
                      text: 'Second duplicate changed',
                    },
        ];
        const stream = new WriterStreamEdits((name, input, callId) =>
          runWriterTool(runtime, null, name, input, mode, callId)
        );
        for (const [index, edit] of edits.entries())
          stream.push({
            toolCallId: 'mixed-imported',
            toolName: 'edit_text',
            index,
            input: { story, edits: [edit] },
          });
        const result = await stream.finish('mixed-imported', 'edit_text', { story, edits });
        if (mode === 'suggest' && next === 'deleteParagraph') {
          expect(result?.code).toBe('NotSupported');
          expect(result?.completedSteps).toEqual(['insert paragraph']);
        } else expect(result?.success, JSON.stringify(result)).toBe(true);
        const reopened = await DocxEditor.createServer(await runtime.save());
        try {
          await reopened.run(async (context) => {
            const header = context.document.sections.getFirst().getHeader('Primary');
            await context.sync();
            if (mode === 'suggest') {
              header.revisions.acceptAll();
              await context.sync();
            }
            header.load('text');
            await context.sync();
            const expected =
              next === 'replace'
                ? 'Final header\rAfter original'
                : next === 'delete'
                  ? 'header\rAfter original'
                  : next === 'deleteParagraph'
                    ? mode === 'suggest'
                      ? 'Draft header\rAfter original'
                      : 'After original'
                    : next === 'opposite'
                      ? 'Before original\rDraft header\rAfter original'
                      : 'Draft header\rAfter original\rRepeated\rSecond duplicate changed';
            expect(header.text).toStartWith(expected);
          });
        } finally {
          reopened.dispose();
        }
      } finally {
        runtime.dispose();
      }
    });
  }

test('noninsertion edits do not reload a paragraph deleted in the same batch', async () => {
  const runtime = await DocxEditor.createServer(anonymousStories());
  const story = { kind: 'header', section: 0, variant: 'Primary' };
  try {
    const read = await runWriterTool(runtime, null, 'inspect_document', {
      area: 'paragraphs',
      story,
    });
    const id = JSON.parse(read.output).items[0].id;
    const result = await runWriterTool(
      runtime,
      null,
      'edit_text',
      {
        story,
        edits: [
          {
            action: 'insertText',
            target: { paragraphId: id, search: 'Draft' },
            location: 'Replace',
            text: 'Final',
          },
          { action: 'deleteParagraph', paragraphId: id },
        ],
      },
      'direct'
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
    await runtime.run(async (context) => {
      const header = context.document.sections.getFirst().getHeader('Primary');
      header.load('text');
      await context.sync();
      expect(header.text).toStartWith('Repeated\rRepeated');
      expect(header.text).not.toContain('Final');
    });
  } finally {
    runtime.dispose();
  }
});

for (const mode of ['direct', 'suggest'] as const) {
  test(`remapped imported targets still reject independent changes in ${mode}`, async () => {
    const runtime = await DocxEditor.createServer(anonymousStories(), {
      author: 'Writer',
      revisionTextView: 'original',
    });
    const story = { kind: 'header', section: 0, variant: 'Primary' };
    try {
      const read = await runWriterTool(runtime, null, 'inspect_document', {
        area: 'paragraphs',
        story,
      });
      const id = JSON.parse(read.output).items[0].id;
      const edits = [
        {
          action: 'insertParagraph',
          target: { paragraphId: id },
          location: 'After',
          text: 'Committed paragraph',
        },
        {
          action: 'insertText',
          target: { paragraphId: id },
          location: 'Replace',
          text: 'Must not replace user text',
        },
      ];
      let calls = 0;
      const stream = new WriterStreamEdits(async (name, input, callId) => {
        const result = await runWriterTool(runtime, null, name, input, mode, callId);
        if (++calls === 1) {
          await runtime.run(async (context) => {
            context.document.changeTrackingMode = 'Off';
            const header = context.document.sections.getFirst().getHeader('Primary');
            await context.sync();
            header.paragraphs.getFirst().font.italic = true;
            await context.sync();
          });
        }
        return result;
      });
      for (const [index, edit] of edits.entries())
        stream.push({
          toolCallId: 'stale-imported',
          toolName: 'edit_text',
          index,
          input: { story, edits: [edit] },
        });
      const result = await stream.finish('stale-imported', 'edit_text', { story, edits });
      expect(result?.code).toBe('StaleDocument');
      expect(result?.completedSteps).toEqual(['insert paragraph']);
    } finally {
      runtime.dispose();
    }
  });
}

test('deletion-first streaming remaps surviving imported paragraphs without matching duplicate text', async () => {
  const runtime = await DocxEditor.createServer(anonymousStories());
  const story = { kind: 'header', section: 0, variant: 'Primary' };
  try {
    const read = await runWriterTool(runtime, null, 'inspect_document', {
      area: 'paragraphs',
      story,
    });
    const items = JSON.parse(read.output).items;
    const edits = [
      { action: 'deleteParagraph', paragraphId: items[0].id },
      {
        action: 'insertText',
        target: { paragraphId: items[2].id },
        location: 'Replace',
        text: 'Second duplicate changed',
      },
    ];
    const stream = new WriterStreamEdits((name, input, callId) =>
      runWriterTool(runtime, null, name, input, 'direct', callId)
    );
    for (const [index, edit] of edits.entries())
      stream.push({
        toolCallId: 'delete-first',
        toolName: 'edit_text',
        index,
        input: { story, edits: [edit] },
      });
    const result = await stream.finish('delete-first', 'edit_text', { story, edits });
    expect(result?.success, JSON.stringify(result)).toBe(true);
    await runtime.run(async (context) => {
      const header = context.document.sections.getFirst().getHeader('Primary');
      header.load('text');
      await context.sync();
      expect(header.text).toStartWith('Repeated\rSecond duplicate changed');
    });
  } finally {
    runtime.dispose();
  }
});
