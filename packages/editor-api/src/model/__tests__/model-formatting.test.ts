/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Formatting through the object model: `font` on the three things that have one, and a paragraph's
// own paragraph formatting.
//
// TWO CLAIMS ABOUT READS. A formatting read is a question about AGREEMENT — every run the range
// covers says bold, or the answer is `null` — and `null` is ALSO the answer when nothing in range
// authors the property at all. The second half is the deliberate one: this lane reads what the
// document AUTHORS rather than what the style cascade computes, so a heading whose bold comes from
// `styles.xml` reads `null` here. A read that answered the cascade would hand a caller a value that
// writing it straight back would freeze into the paragraph as direct formatting.
//
// ONE CLAIM ABOUT WRITES: several properties set on one object in one `sync()` are ONE operation.
// Not an optimisation — the host refuses two formatting writes to a paragraph in one batch, because
// each carries the paragraph's whole property bag and the second was built from the tree the first
// had already changed. `font.bold = true; font.size = 12` is the shape every Office.js sample is
// written in, so it has to be one write, and the accumulation is what makes it one.

import { describe, expect, test } from 'bun:test';
import { isDocxEditorError } from '../../runtime/errors.ts';
import { docx, mainXmlOf, orNull, p, reopen, serverRuntime } from './support/documents.ts';

/** Two runs that disagree, then one that does not. */
const MIXED = docx(
  '<w:p><w:r><w:rPr><w:b/><w:i/><w:sz w:val="28"/><w:color w:val="FF0000"/>' +
    '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr><w:t>bold</w:t></w:r>' +
    '<w:r><w:t xml:space="preserve"> plain</w:t></w:r></w:p>' +
    '<w:p><w:r><w:rPr><w:b/><w:i/><w:sz w:val="28"/><w:color w:val="FF0000"/>' +
    '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr><w:t>all of it</w:t></w:r></w:p>'
);

const SPACED = docx(
  '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/>' +
    '<w:ind w:left="720" w:right="360" w:firstLine="240"/></w:pPr><w:r><w:t>spaced</w:t></w:r></w:p>' +
    p('plain')
);

/** A heading whose bold lives in `styles.xml`, so nothing in the paragraph authors it. */
const INHERITED = docx(
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>heading</w:t></w:r></w:p>'
);

describe('reading a font', () => {
  test('a paragraph whose runs agree answers the value', async () => {
    const runtime = await serverRuntime(MIXED);
    const read = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const font = paragraphs.items[1]!.font;
      font.load();
      await context.sync();
      return {
        bold: font.bold,
        italic: font.italic,
        name: font.name,
        size: font.size,
        color: font.color,
      };
    });
    expect(read).toEqual({
      bold: true,
      italic: true,
      name: 'Georgia',
      size: 14,
      color: '#FF0000',
    });
    runtime.dispose();
  });

  test('a paragraph whose runs disagree answers null for every mixed property', async () => {
    const runtime = await serverRuntime(MIXED);
    const read = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const font = paragraphs.items[0]!.font;
      font.load();
      await context.sync();
      return {
        bold: orNull(font.bold),
        italic: orNull(font.italic),
        name: orNull(font.name),
        size: orNull(font.size),
        color: orNull(font.color),
      };
    });
    expect(read).toEqual({
      bold: null,
      italic: null,
      name: null,
      size: null,
      color: null,
    });
    runtime.dispose();
  });

  test('a range narrows the question to the characters it covers', async () => {
    const runtime = await serverRuntime(MIXED);
    const read = await runtime.run(async (context) => {
      const found = context.document.body.search('bold', { matchCase: true });
      found.load();
      await context.sync();
      const font = found.items[0]!.font;
      font.load('bold');
      await context.sync();
      return font.bold;
    });
    expect(read).toBe(true);
    runtime.dispose();
  });

  test('a whole story answers what all of it agrees on', async () => {
    const runtime = await serverRuntime(MIXED);
    const read = await runtime.run(async (context) => {
      const font = context.document.body.font;
      font.load('bold');
      await context.sync();
      return orNull(font.bold);
    });
    expect(read).toBe(null);
    runtime.dispose();
  });

  test('a property no run authors is null, never the value a style would compute', async () => {
    const runtime = await serverRuntime(INHERITED);
    const read = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const font = paragraphs.items[0]!.font;
      font.load();
      await context.sync();
      return {
        bold: orNull(font.bold),
        italic: orNull(font.italic),
        name: orNull(font.name),
        size: orNull(font.size),
        color: orNull(font.color),
      };
    });
    expect(read).toEqual({
      bold: null,
      italic: null,
      name: null,
      size: null,
      color: null,
    });
    runtime.dispose();
  });
});

describe('writing a font', () => {
  test('several properties set in one sync are one write, and they all land', async () => {
    const runtime = await serverRuntime(MIXED);
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const font = paragraphs.items[0]!.font;
      font.bold = true;
      font.size = 11;
      font.color = '#0000FF';
      await context.sync();
    });

    const reopened = await reopen(runtime);
    const read = await reopened.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const font = paragraphs.items[0]!.font;
      font.load();
      await context.sync();
      return { bold: font.bold, size: font.size, color: font.color };
    });
    expect(read).toEqual({ bold: true, size: 11, color: '#0000FF' });
    runtime.dispose();
    reopened.dispose();
  });

  test('a range writes only the characters it covers', async () => {
    const runtime = await serverRuntime(docx(p('alpha beta')));
    await runtime.run(async (context) => {
      const found = context.document.body.search('beta', { matchCase: true });
      found.load();
      await context.sync();
      found.items[0]!.font.bold = true;
      await context.sync();
    });
    const xml = await mainXmlOf(runtime);
    // The run the range covers gained the property; the one before it did not.
    expect(xml).toContain('<w:t xml:space="preserve">alpha </w:t>');
    expect(xml).toContain('<w:b/>');
    expect(xml.indexOf('<w:b/>')).toBeGreaterThan(xml.indexOf('alpha '));
    runtime.dispose();
  });

  test('a refused value fails the sync and changes nothing', async () => {
    const runtime = await serverRuntime(MIXED);
    const code = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      paragraphs.items[0]!.font.color = 'rebeccapurple';
      try {
        await context.sync();
      } catch (error) {
        return isDocxEditorError(error) ? error.code : 'untyped';
      }
      return 'accepted';
    });
    expect(code).toBe('InvalidArgument');
    const xml = await mainXmlOf(runtime);
    expect(xml).not.toContain('rebeccapurple');
    runtime.dispose();
  });

  test('a value of the wrong type is refused at the assignment, where the mistake was made', async () => {
    const runtime = await serverRuntime(MIXED);
    const code = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      try {
        (paragraphs.items[0]!.font as unknown as { size: unknown }).size = 'large';
      } catch (error) {
        return isDocxEditorError(error) ? error.code : 'untyped';
      }
      return 'accepted';
    });
    expect(code).toBe('InvalidArgument');
    runtime.dispose();
  });

  test('null remains invalid for every setter', async () => {
    const runtime = await serverRuntime(MIXED);
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const font = paragraphs.items[0]!.font as unknown as Record<string, unknown>;
      for (const field of ['bold', 'italic', 'color', 'name', 'size']) {
        expect(() => {
          font[field] = null;
        }).toThrow();
      }
    });
    runtime.dispose();
  });
});

describe("a paragraph's own paragraph formatting", () => {
  test('reads alignment, indents and spacing in points', async () => {
    const runtime = await serverRuntime(SPACED);
    const read = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const paragraph = paragraphs.items[0]!;
      paragraph.load([
        'alignment',
        'firstLineIndent',
        'leftIndent',
        'rightIndent',
        'lineSpacing',
        'spaceBefore',
        'spaceAfter',
      ]);
      await context.sync();
      return {
        alignment: paragraph.alignment,
        firstLineIndent: paragraph.firstLineIndent,
        leftIndent: paragraph.leftIndent,
        rightIndent: paragraph.rightIndent,
        lineSpacing: paragraph.lineSpacing,
        spaceBefore: paragraph.spaceBefore,
        spaceAfter: paragraph.spaceAfter,
      };
    });
    expect(read).toEqual({
      alignment: 'Centered',
      firstLineIndent: 12,
      leftIndent: 36,
      rightIndent: 18,
      lineSpacing: 18,
      spaceBefore: 12,
      spaceAfter: 6,
    });
    runtime.dispose();
  });

  test('a paragraph that authors none answers Unknown and null rather than zero', async () => {
    const runtime = await serverRuntime(SPACED);
    const read = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const paragraph = paragraphs.items[1]!;
      paragraph.load(['alignment', 'leftIndent']);
      await context.sync();
      return { alignment: paragraph.alignment, leftIndent: orNull(paragraph.leftIndent) };
    });
    expect(read).toEqual({ alignment: 'Unknown', leftIndent: null });
    runtime.dispose();
  });

  test('writes land, survive a reopen, and leave the properties nobody asked about alone', async () => {
    const runtime = await serverRuntime(SPACED);
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const paragraph = paragraphs.items[0]!;
      paragraph.alignment = 'Right';
      paragraph.leftIndent = 18;
      await context.sync();
    });

    const reopened = await reopen(runtime);
    const read = await reopened.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const paragraph = paragraphs.items[0]!;
      paragraph.load(['alignment', 'leftIndent', 'spaceBefore', 'lineSpacing']);
      await context.sync();
      return {
        alignment: paragraph.alignment,
        leftIndent: paragraph.leftIndent,
        spaceBefore: paragraph.spaceBefore,
        lineSpacing: paragraph.lineSpacing,
      };
    });
    expect(read).toEqual({
      alignment: 'Right',
      leftIndent: 18,
      spaceBefore: 12,
      lineSpacing: 18,
    });
    runtime.dispose();
    reopened.dispose();
  });

  test('a hanging indent reads as a negative first line, and writes back as one', async () => {
    const runtime = await serverRuntime(
      docx(
        '<w:p><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:r><w:t>hung</w:t></w:r></w:p>'
      )
    );
    const before = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const paragraph = paragraphs.items[0]!;
      paragraph.load('firstLineIndent');
      await context.sync();
      return paragraph.firstLineIndent;
    });
    expect(before).toBe(-18);

    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      paragraphs.items[0]!.firstLineIndent = -9;
      await context.sync();
    });
    const xml = await mainXmlOf(runtime);
    expect(xml).toContain('w:hanging="180"');
    expect(xml).not.toContain('w:firstLine=');
    runtime.dispose();
  });

  test('lineSpacing keeps the line rule the paragraph states, and defaults to multiples of a line', async () => {
    const runtime = await serverRuntime(
      docx(
        '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>exact</w:t></w:r></w:p>' +
          '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="atLeast"/></w:pPr><w:r><w:t>least</w:t></w:r></w:p>' +
          p('none')
      )
    );
    await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      for (const paragraph of paragraphs.items) paragraph.lineSpacing = 18;
      await context.sync();
    });
    const xml = await mainXmlOf(runtime);
    expect(xml).toContain('<w:spacing w:line="360" w:lineRule="exact"/>');
    expect(xml).toContain('<w:spacing w:line="360" w:lineRule="atLeast"/>');
    // 18 points under the `auto` rule is 1.5 lines: one line is 12 points.
    expect(xml).toContain('<w:spacing w:line="360" w:lineRule="auto"/>');
    runtime.dispose();
  });

  test('lineSpacingRule reads and writes the rule as the desktop object model does', async () => {
    const spaced = (line: number, rule: string, text: string): string =>
      `<w:p><w:pPr><w:spacing w:line="${line}" w:lineRule="${rule}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const runtime = await serverRuntime(
      docx(
        spaced(240, 'auto', 'single') +
          spaced(360, 'auto', 'oneAndHalf') +
          spaced(360, 'atLeast', 'atLeast') +
          spaced(360, 'exact', 'exact') +
          spaced(280, 'exact', 'exact14') +
          spaced(300, 'auto', 'multiple') +
          p('none')
      )
    );
    const read = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load('items/lineSpacingRule,items/lineSpacing');
      await context.sync();
      const rules = paragraphs.items.map((paragraph) => paragraph.lineSpacingRule);
      const [single, half, least, exact, exact14, multiple, none] = paragraphs.items;
      single!.lineSpacingRule = 'Exactly'; // keeps 12 points
      half!.lineSpacingRule = 'AtLeast'; // keeps 18 points
      least!.lineSpacingRule = 'Single'; // sets one line
      exact!.lineSpacingRule = 'Multiple'; // keeps 18 points: 1.5 lines
      exact14!.lineSpacingRule = 'Double'; // sets two lines
      multiple!.lineSpacing = 18; // keeps the rule
      none!.lineSpacingRule = 'Exactly';
      none!.lineSpacing = 15; // the rule applies first
      await context.sync();
      return rules;
    });
    expect(read).toEqual([
      'Single',
      'OnePointFive',
      'AtLeast',
      'Exactly',
      'Exactly',
      'Multiple',
      'Single',
    ]);
    const xml = await mainXmlOf(runtime);
    const spacingBefore = (text: string): string | undefined =>
      new RegExp(`<w:spacing [^>]*/></w:pPr><w:r><w:t>${text}</w:t>`).exec(xml)?.[0];
    expect(spacingBefore('single')).toContain('w:line="240" w:lineRule="exact"');
    expect(spacingBefore('oneAndHalf')).toContain('w:line="360" w:lineRule="atLeast"');
    expect(spacingBefore('atLeast')).toContain('w:line="240" w:lineRule="auto"');
    expect(spacingBefore('exact')).toContain('w:line="360" w:lineRule="auto"');
    expect(spacingBefore('exact14')).toContain('w:line="480" w:lineRule="auto"');
    expect(spacingBefore('multiple')).toContain('w:line="360" w:lineRule="auto"');
    expect(spacingBefore('none')).toContain('w:line="300" w:lineRule="exact"');
    runtime.dispose();
  });

  test('a line spacing out of range is refused at the assignment, naming the property', async () => {
    const runtime = await serverRuntime(SPACED);
    const locations = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      return [0, 0.01, -5, 100000].map((value) => {
        try {
          paragraphs.items[0]!.lineSpacing = value;
        } catch (error) {
          return isDocxEditorError(error) ? error.debugInfo.errorLocation : 'untyped';
        }
        return 'accepted';
      });
    });
    for (const location of locations) expect(location).toMatch(/\.lineSpacing$/);
    runtime.dispose();
  });

  test('a line spacing rule this API does not have is refused at the assignment', async () => {
    const runtime = await serverRuntime(SPACED);
    const code = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      try {
        (paragraphs.items[0] as unknown as { lineSpacingRule: string }).lineSpacingRule = 'Triple';
      } catch (error) {
        return isDocxEditorError(error) ? error.code : 'untyped';
      }
      return 'accepted';
    });
    expect(code).toBe('InvalidArgument');
    runtime.dispose();
  });

  test('an alignment this API does not have is refused at the assignment', async () => {
    const runtime = await serverRuntime(SPACED);
    const code = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      try {
        (paragraphs.items[0]! as unknown as { alignment: string }).alignment = 'Sideways';
      } catch (error) {
        return isDocxEditorError(error) ? error.code : 'untyped';
      }
      return 'accepted';
    });
    expect(code).toBe('InvalidArgument');
    runtime.dispose();
  });

  test('formatting a paragraph and restructuring it in one sync is refused', async () => {
    const runtime = await serverRuntime(SPACED);
    const code = await runtime.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      const paragraph = paragraphs.items[0]!;
      paragraph.alignment = 'Right';
      paragraph.delete();
      try {
        await context.sync();
      } catch (error) {
        return isDocxEditorError(error) ? error.code : 'untyped';
      }
      return 'accepted';
    });
    expect(code).toBe('ConflictingChanges');
    runtime.dispose();
  });
});
