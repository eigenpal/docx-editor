/**
 * Fill `{{placeholders}}` in a DOCX and write the result out. No browser, no framework.
 *
 *   bun run examples/automation/fill-template.ts in.docx out.docx
 *
 * Three syncs, and which work sits between them is the point of the example:
 *   1. find every match of one placeholder — a read, so it needs its own sync;
 *   2. write over all of them — ONE atomic batch, so a refusal leaves the document untouched;
 *   3. read the story back, to print what the document says now.
 */

import { DocxEditor } from '@docx-editor.dev/editor-api';

const VALUES: Record<string, string> = {
  '{{name}}': 'Ada Lovelace',
  '{{role}}': 'Analytical Engine Programmer',
  '{{date}}': new Date().toISOString().slice(0, 10),
};

const [input, output = 'filled.docx'] = process.argv.slice(2);
if (!input) {
  console.error('usage: fill-template.ts <in.docx> [out.docx]');
  process.exit(1);
}

const runtime = await DocxEditor.createServer(await Bun.file(input).bytes(), {
  author: 'Template filler',
});

try {
  for (const [placeholder, value] of Object.entries(VALUES)) {
    const filled = await runtime.run(async (context) => {
      const matches = context.document.body.search(placeholder, { matchCase: true });
      matches.load();
      await context.sync();

      // Queued against the matches found above, then applied together.
      for (const match of matches.items) match.insertText(value, 'Replace');
      await context.sync();
      return matches.items.length;
    });
    console.log(`${placeholder} → ${value} (${filled} ${filled === 1 ? 'match' : 'matches'})`);
  }

  const text = await runtime.run(async (context) => {
    const body = context.document.body;
    body.load('text');
    await context.sync();
    // Paragraph marks come back as CR, the way the file stores them.
    return body.text;
  });

  await Bun.write(output, await runtime.save());
  console.log(`\nwrote ${output}\n\n${text.replaceAll('\r', '\n')}`);
} finally {
  // Releases the document. Every later run or save fails instead of reaching a freed host.
  runtime.dispose();
}
