import { expect, test } from 'bun:test';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { seedDocx } from '../seed-document';
import { anonymousStories } from './paragraph-targets.fixture';
import { runWriterTool } from './run-tool';

for (const mode of ['direct', 'suggest'] as const)
  for (const location of ['Before', 'After'] as const)
    for (const imported of [false, true]) {
      test(`mixed replacement and ${location} paragraphs preserve order: ${mode}, imported=${imported}`, async () => {
        const runtime = await DocxEditor.createServer(imported ? anonymousStories() : seedDocx(), {
          author: 'Writer',
          revisionTextView: 'original',
        });
        const story = { kind: imported ? 'header' : 'body', section: 0, variant: 'Primary' };
        try {
          const read = await runWriterTool(runtime, null, 'inspect_document', {
            area: 'paragraphs',
            story,
          });
          const target = JSON.parse(read.output).items[0];
          const result = await runWriterTool(
            runtime,
            null,
            'edit_text',
            {
              story,
              edits: [
                {
                  action: 'insertText',
                  target: { paragraphId: target.id, search: 'Draft' },
                  location: 'Replace',
                  text: 'Final',
                  font: { bold: true },
                },
                ...['A', 'B'].map((text) => ({
                  action: 'insertParagraph',
                  target: { paragraphId: target.id },
                  location,
                  text,
                  style: 'Heading 1',
                })),
              ],
            },
            mode
          );
          expect(result.success, JSON.stringify(result)).toBe(true);
          await runtime.run(async (context) => {
            const body = imported
              ? context.document.sections.getFirst().getHeader('Primary')
              : context.document.body;
            await context.sync();
            if (mode === 'suggest') {
              body.revisions.acceptAll();
              await context.sync();
            }
            body.load('text');
            await context.sync();
            const final = imported ? 'Final header' : 'Final project proposal';
            expect(
              body.text.startsWith(location === 'After' ? `${final}\rA\rB` : `A\rB\r${final}`)
            ).toBe(true);
          });
        } finally {
          runtime.dispose();
        }
      });
    }

for (const mode of ['direct', 'suggest'] as const) {
  test(`mixed batch reports earlier commits after later refusal in ${mode}`, async () => {
    const runtime = await DocxEditor.createServer(seedDocx(), {
      author: 'Writer',
      revisionTextView: 'original',
    });
    try {
      const read = await runWriterTool(runtime, null, 'read_document', {});
      const target = JSON.parse(read.output).items[0];
      const result = await runWriterTool(
        runtime,
        null,
        'edit_text',
        {
          edits: [
            {
              action: 'insertParagraph',
              target: { paragraphId: target.id },
              location: 'After',
              text: 'Committed paragraph',
            },
            {
              action: 'insertText',
              target: { paragraphId: target.id },
              location: 'Replace',
              text: target.text,
            },
            {
              action: 'insertParagraph',
              target: { paragraphId: target.id },
              location: 'After',
              text: 'Must not appear',
            },
          ],
        },
        mode
      );
      expect(result.success).toBe(false);
      expect(result.code).toBe('InvalidArgument');
      expect(result.completedSteps).toEqual(['insert paragraph']);
      expect(result.recovery?.instruction).toContain('Earlier steps remain saved');
      await runtime.run(async (context) => {
        if (mode === 'suggest') {
          context.document.body.revisions.acceptAll();
          await context.sync();
        }
        context.document.body.load('text');
        await context.sync();
        expect(context.document.body.text).toStartWith(
          'Draft project proposal\rCommitted paragraph'
        );
        expect(context.document.body.text).not.toContain('Must not appear');
      });
    } finally {
      runtime.dispose();
    }
  });
}

for (const mode of ['direct', 'suggest'] as const) {
  test(`two replacements in one paragraph complete without atomic conflicts in ${mode}`, async () => {
    const runtime = await DocxEditor.createServer(seedDocx(), {
      author: 'Writer',
      revisionTextView: 'original',
    });
    try {
      const read = await runWriterTool(runtime, null, 'read_document', {});
      const id = JSON.parse(read.output).items[0].id;
      const result = await runWriterTool(
        runtime,
        null,
        'edit_text',
        {
          edits: [
            {
              action: 'insertText',
              target: { paragraphId: id, search: 'Draft' },
              location: 'Replace',
              text: 'Final',
            },
            {
              action: 'insertText',
              target: { paragraphId: id, search: 'proposal' },
              location: 'Replace',
              text: 'plan',
            },
          ],
        },
        mode
      );
      expect(result.success, JSON.stringify(result)).toBe(true);
      await runtime.run(async (context) => {
        if (mode === 'suggest') {
          context.document.body.revisions.acceptAll();
          await context.sync();
        }
        context.document.body.load('text');
        await context.sync();
        expect(context.document.body.text).toStartWith('Final project plan');
      });
    } finally {
      runtime.dispose();
    }
  });
}
