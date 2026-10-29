/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Applying listed styles through the style setters, and what a refused style write reports.
//
// A NAME READ IS A NAME THAT WRITES. Every listed paragraph or table style applies through its
// setter by its nameLocal, and a refusal names its cause: a name the document does not define, or
// a document with no styles part at all.

import { describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { isDocxEditorError } from '../../runtime/errors.ts';
import { createServer } from '../../runtime/server.ts';
import { internalsOf } from '../../runtime/internals.ts';
import { docx, mainXmlOf, orNull, p } from './support/documents.ts';
import { STYLED, W, withStyles } from './support/style-documents.ts';

test('the guide example offers only visible paragraph styles and applies one', async () => {
  // packages/editor-api/OFFICE_JS_GUIDE.md, "Apply a style the document defines".
  const runtime = await createServer(
    withStyles(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
        '<w:uiPriority w:val="0"/><w:qFormat/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>' +
        '<w:uiPriority w:val="29"/><w:qFormat/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
        '<w:uiPriority w:val="9"/></w:style>' +
        // As a default template marks headings 2 to 9: hidden until used.
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>' +
        '<w:uiPriority w:val="9"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/>' +
        '<w:uiPriority w:val="39"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Old"><w:name w:val="Old"/><w:hidden w:val="1"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Shown"><w:name w:val="Shown"/><w:semiHidden w:val="0"/></w:style>' +
        '<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/></w:style>'
    )
  );
  try {
    const offered = await runtime.run(async (context) => {
      const styles = context.document.getStyles();
      styles.load(
        'items/nameLocal,items/type,items/visibility,items/unhideWhenUsed,items/priority'
      );
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();

      // Offer an agent the paragraph styles a reader would see, in gallery order.
      // Keep hidden styles that unhide once used, such as heading 2, so they can be applied too.
      const names = styles.items
        .filter((style) => style.type === 'Paragraph' && (style.visibility || style.unhideWhenUsed))
        .sort((a, b) => a.priority - b.priority || a.nameLocal.localeCompare(b.nameLocal))
        .map((style) => style.nameLocal);
      const chosen = names.find((name) => name.toLowerCase() === 'quote');
      if (chosen === undefined) return names;
      paragraph.style = chosen;
      await context.sync();
      return names;
    });
    expect(offered).toEqual(['Normal', 'heading 1', 'heading 2', 'Quote', 'toc 1', 'Shown']);
    expect(await mainXmlOf(runtime)).toContain('<w:pStyle w:val="Quote"/>');

    const flags = await runtime.run(async (context) => {
      const styles = context.document.getStyles();
      styles.load('items/nameLocal,items/quickStyle,items/unhideWhenUsed,items/visibility');
      await context.sync();
      return styles.items.map((style) => [
        style.nameLocal,
        style.quickStyle,
        style.unhideWhenUsed,
        style.visibility,
      ]);
    });
    expect(flags).toEqual([
      ['Normal', true, false, true],
      ['Quote', true, false, true],
      ['heading 1', false, false, true],
      ['heading 2', false, true, false],
      ['toc 1', false, true, false],
      ['Old', false, false, false],
      ['Shown', false, false, true],
      ['Strong', false, false, true],
    ]);
  } finally {
    runtime.dispose();
  }
});

test('a heading hidden until used is offered and applies', async () => {
  const runtime = await createServer(
    withStyles(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>' +
        '<w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
    )
  );
  try {
    const read = await runtime.run(async (context) => {
      const styles = context.document.getStyles();
      styles.load();
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      const offered = styles.items.filter(
        (style) => style.type === 'Paragraph' && (style.visibility || style.unhideWhenUsed)
      );
      const heading = offered.find((style) => style.nameLocal === 'heading 2')!;
      paragraph.style = heading.nameLocal;
      await context.sync();
      paragraph.load('style');
      await context.sync();
      return [heading.visibility, heading.unhideWhenUsed, paragraph.style];
    });
    expect(read).toEqual([false, true, 'heading 2']);
  } finally {
    runtime.dispose();
  }
});

test('Table.style accepts the nameLocal of a listed table style', async () => {
  const runtime = await createServer(
    withStyles(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>'
    )
  );
  try {
    const style = await runtime.run(async (context) => {
      const styles = context.document.getStyles();
      styles.load('items/nameLocal,items/type');
      const table = context.document.body.getRange('Start').insertTable(1, 1, 'Before', [['A']]);
      await context.sync();
      const tableStyle = styles.items.find((item) => item.type === 'Table')!;
      table.style = tableStyle.nameLocal;
      await context.sync();
      table.load('style');
      await context.sync();
      return table.style;
    });
    expect(style).toBe('Table Grid');
  } finally {
    runtime.dispose();
  }
});

test('a paragraph style that repeats an earlier name reads null, as the setter applies the earlier', async () => {
  const bytes = zipSync({
    ...Object.fromEntries(
      Object.entries(
        unzipSync(
          withStyles(
            '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
              '<w:style w:type="paragraph" w:styleId="Body1"><w:name w:val="Body"/></w:style>' +
              '<w:style w:type="paragraph" w:styleId="Body2"><w:name w:val="body"/></w:style>'
          )
        )
      )
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:pPr><w:pStyle w:val="Body2"/></w:pPr><w:r><w:t>later</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="Body1"/></w:pPr><w:r><w:t>earlier</w:t></w:r></w:p>' +
        '</w:body></w:document>'
    ),
  });
  const runtime = await createServer(bytes);
  try {
    const read = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items/style');
      const styles = context.document.getStyles();
      styles.load('items/nameLocal');
      await context.sync();
      return {
        styles: paragraphs.items.map((paragraph) => orNull(paragraph.style)),
        listed: styles.items.map((style) => style.nameLocal),
      };
    });
    expect(read).toEqual({ styles: [null, 'Body'], listed: ['Normal', 'Body'] });
  } finally {
    runtime.dispose();
  }
});

test('a style name of 150 characters reads, lists, and applies', async () => {
  const long = `Long ${'x'.repeat(145)}`;
  expect(long.length).toBe(150);
  const runtime = await createServer(
    withStyles(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        `<w:style w:type="paragraph" w:styleId="Long"><w:name w:val="${long}"/></w:style>`
    )
  );
  try {
    const read = await runtime.run(async (context) => {
      const styles = context.document.getStyles();
      styles.load('items/nameLocal');
      const found = styles.getByNameOrNullObject(long);
      found.load('nameLocal');
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      paragraph.style = long;
      await context.sync();
      paragraph.load('style');
      await context.sync();
      return {
        listed: styles.items.map((style) => style.nameLocal),
        found: found.isNullObject ? null : found.nameLocal,
        style: paragraph.style,
      };
    });
    expect(read).toEqual({ listed: ['Normal', long], found: long, style: long });
  } finally {
    runtime.dispose();
  }
});

test('a refused style name says so and points to getStyles()', async () => {
  const runtime = await createServer(STYLED);
  try {
    const refusal = await runtime.run(async (context) => {
      context.document.body.paragraphs.getFirst().style = 'Missing Style';
      try {
        await context.sync();
        return null;
      } catch (error) {
        if (!isDocxEditorError(error)) throw error;
        return { code: error.code, inner: error.debugInfo.innerError };
      }
    });
    expect(refusal?.code).toBe('InvalidArgument');
    expect(refusal?.inner?.code).toBe('edit.style-not-defined');
    expect(refusal?.inner?.message).toContain('not defined');
    expect(refusal?.inner?.message).toContain('document.getStyles()');
  } finally {
    runtime.dispose();
  }
});

async function refusalOf(
  bytes: Uint8Array,
  write: (context: import('../../runtime/request-context.ts').RequestContext) => Promise<void>
): Promise<{ code: string; inner: string | undefined; message: string | undefined } | null> {
  const runtime = await createServer(bytes);
  try {
    return await runtime.run(async (context) => {
      try {
        await write(context);
        return null;
      } catch (error) {
        if (!isDocxEditorError(error)) throw error;
        return {
          code: error.code,
          inner: error.debugInfo.innerError?.code,
          message: error.debugInfo.innerError?.message,
        };
      }
    });
  } finally {
    runtime.dispose();
  }
}

test('a refused table style name reports edit.style-not-defined', async () => {
  const refusal = await refusalOf(STYLED, async (context) => {
    const table = context.document.body.getRange('Start').insertTable(1, 1, 'Before', [['A']]);
    await context.sync();
    table.style = 'Missing Table Style';
    await context.sync();
  });
  expect(refusal?.inner).toBe('edit.style-not-defined');
  expect(refusal?.message).toContain('document.getStyles()');
});

test('a table style name too long for any style is refused before it is compared', async () => {
  const refusal = await refusalOf(STYLED, async (context) => {
    const table = context.document.body.getRange('Start').insertTable(1, 1, 'Before', [['A']]);
    await context.sync();
    table.style = 'x'.repeat(256);
    await context.sync();
  });
  expect(refusal?.code).toBe('InvalidArgument');
  expect(refusal?.inner).not.toBe('edit.style-not-defined');
});

test('a document with no styles part says no style name applies, for paragraphs and tables', async () => {
  const paragraph = await refusalOf(docx(p('plain')), async (context) => {
    context.document.body.paragraphs.getFirst().style = 'Normal';
    await context.sync();
  });
  expect(paragraph?.code).toBe('InvalidArgument');
  expect(paragraph?.inner).toBe('edit.no-styles-defined');
  expect(paragraph?.message).toContain('no style name applies');
  expect(paragraph?.message).not.toContain('getStyles');

  const table = await refusalOf(docx(p('plain')), async (context) => {
    const inserted = context.document.body.getRange('Start').insertTable(1, 1, 'Before', [['A']]);
    await context.sync();
    inserted.style = 'Table Grid';
    await context.sync();
  });
  expect(table?.inner).toBe('edit.no-styles-defined');
});

describe('a style read always writes back', () => {
  const tableWith = (styleId: string) =>
    `<w:tbl><w:tblPr><w:tblStyle w:val="${styleId}"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>` +
    '<w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const paragraphWith = (styleId: string, text: string) =>
    `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const DOCUMENT = withStyles(
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Body1"><w:name w:val="Body"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Body2"><w:name w:val="body"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Blank"><w:name w:val="   "/></w:style>' +
      '<w:style w:type="table" w:styleId="Grid1"><w:name w:val="Grid"/></w:style>' +
      '<w:style w:type="table" w:styleId="Grid2"><w:name w:val="GRID"/></w:style>' +
      '<w:style w:type="table" w:styleId="BlankTable"><w:name w:val=" "/></w:style>',
    paragraphWith('Body1', 'earlier') +
      paragraphWith('Body2', 'later') +
      paragraphWith('Blank', 'blank') +
      tableWith('Grid1') +
      tableWith('Grid2') +
      tableWith('BlankTable') +
      '<w:p><w:r><w:t>end</w:t></w:r></w:p>'
  );

  test('paragraph and table reads answer only names their setters accept, and those write back', async () => {
    const runtime = await createServer(DOCUMENT);
    try {
      const read = await runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items/style,items/text');
        const tables = context.document.body.tables;
        tables.load('items/style');
        await context.sync();
        const paragraphStyles = paragraphs.items
          .filter((paragraph) => ['earlier', 'later', 'blank'].includes(paragraph.text))
          .map((paragraph) => orNull(paragraph.style));
        const tableStyles = tables.items.map((table) => table.style);
        // Write every non-empty read back to the object it came from.
        for (const paragraph of paragraphs.items) {
          if (paragraph.text === 'earlier' && paragraph.style !== null)
            paragraph.style = paragraph.style;
        }
        const first = tables.items[0]!;
        first.style = first.style;
        await context.sync();
        return { paragraphStyles, tableStyles };
      });
      // A later same-name style and a blank name have no name that writes back: null for a
      // paragraph, an empty string for a table.
      expect(read).toEqual({
        paragraphStyles: ['Body', null, null],
        tableStyles: ['Grid', '', ''],
      });
      const xml = await mainXmlOf(runtime);
      expect(xml).toContain('<w:pStyle w:val="Body1"/>');
      expect(xml).toContain('<w:tblStyle w:val="Grid1"/>');
    } finally {
      runtime.dispose();
    }
  });

  test('the listing agrees with the reads on the same names', async () => {
    const runtime = await createServer(DOCUMENT);
    try {
      const listed = await runtime.run(async (context) => {
        const styles = context.document.getStyles();
        styles.load('items/nameLocal,items/type');
        await context.sync();
        return styles.items.map((style) => [style.nameLocal, style.type]);
      });
      expect(listed).toEqual([
        ['Normal', 'Paragraph'],
        ['Body', 'Paragraph'],
        ['Grid', 'Table'],
      ]);
    } finally {
      runtime.dispose();
    }
  });
});

describe('hyperlinks take the hyperlink character style', () => {
  test('an inserted link gets the character style, never a same-name paragraph style', async () => {
    const runtime = await createServer(
      withStyles(
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="LinkParagraph"><w:name w:val="Hyperlink"/></w:style>' +
          '<w:style w:type="character" w:styleId="LinkCharacter"><w:name w:val="Hyperlink"/></w:style>'
      )
    );
    try {
      await runtime.run(async (context) => {
        const found = context.document.body.search('first', { matchCase: true });
        found.load('items');
        await context.sync();
        found.items[0]!.hyperlink = 'https://example.com/';
        await context.sync();
      });
      const xml = await mainXmlOf(runtime);
      expect(xml).toContain('<w:rStyle w:val="LinkCharacter"/>');
      expect(xml).not.toContain('LinkParagraph');
    } finally {
      runtime.dispose();
    }
  });

  test('a paragraph style named Hyperlink alone never lands in a run style', async () => {
    const runtime = await createServer(
      withStyles(
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="LinkParagraph"><w:name w:val="Hyperlink"/></w:style>'
      )
    );
    try {
      await runtime.run(async (context) => {
        const found = context.document.body.search('first', { matchCase: true });
        found.load('items');
        await context.sync();
        found.items[0]!.hyperlink = 'https://example.com/';
        await context.sync();
      });
      expect(await mainXmlOf(runtime)).not.toContain('LinkParagraph');
    } finally {
      runtime.dispose();
    }
  });
});

describe('a looked-up style after its lookup was sent', () => {
  test('a load during an in-flight lookup queues its own read for the next sync', async () => {
    const runtime = await createServer(STYLED);
    try {
      const read = await runtime.run(async (context) => {
        const found = context.document.getStyles().getByNameOrNullObject('Clause Text');
        const sent = context.sync();
        // The sync has taken the lookup: this load must not wait on it.
        found.load('nameLocal');
        expect(internalsOf(context).queue.size).toBe(1);
        await sent;
        await context.sync();
        return found.nameLocal;
      });
      expect(read).toBe('Clause Text');
    } finally {
      runtime.dispose();
    }
  });

  test('a load during a lookup whose sync fails is not dropped', async () => {
    const runtime = await createServer(STYLED);
    try {
      const outcome = await runtime.run(async (context) => {
        const found = context.document.getStyles().getByNameOrNullObject('Clause Text');
        // A write the document refuses fails the whole batch, the lookup included.
        context.document.body.paragraphs.getFirst().style = 'Missing Style';
        const sent = context.sync();
        found.load('nameLocal');
        const failed = await sent.then(
          () => null,
          (error: unknown) => (isDocxEditorError(error) ? error.code : 'unknown')
        );
        // The load is still queued, rather than silently waiting on the failed lookup.
        return { failed, queued: internalsOf(context).queue.size };
      });
      expect(outcome.failed).not.toBe(null);
      expect(outcome.queued).toBe(1);
    } finally {
      runtime.dispose();
    }
  });
});
