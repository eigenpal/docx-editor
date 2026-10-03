// Word clipboard Office Math pastes as editable equations.
//
// fixtures/word-mac-equations.html is a Word for Mac clipboard capture of one inline
// and one display equation, with the preview pictures replaced by a 1x1 PNG.
//
// The clipboard shapes and the Mac Word equation sample come from the wordpaste
// test suite (https://github.com/smrifat1411/wordpaste, test/omml-to-latex.test.ts
// and test/word-paste-cleaner.test.ts at commit 8efd286).
// Copyright (c) 2026 Rifat Hossain. Used under the MIT License; the full license
// text is in fixtures/wordpaste-LICENSE.txt.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import {
  OFFICE_MATH_NAMESPACE_URI,
  equationExpressionToLinearMath,
  projectOmmlEquation,
  readOoxmlPackage,
  serializeOoxmlPart,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { projectExternalHtml } from '../clipboard-html-read.ts';
import { mount, paragraph, putCaret } from './paginated-surface-fixtures.ts';

const PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const FALLBACK = `<![if !msEquation]><span><img width=40 height=20 src="${PNG}"></span><![endif]>`;

/** The real Mac Word clipboard equation: fraction plus sub/superscripts, no `m:t`. */
const MAC_WORD_EQUATION =
  '<m:oMath>' +
  '<m:sSub><m:e><m:r>Z</m:r></m:e><m:sub><m:r>A</m:r></m:sub></m:sSub>' +
  '<m:r>-</m:r>' +
  '<m:sSub><m:e><m:r>Z</m:r></m:e><m:sub><m:r>B</m:r></m:sub></m:sSub>' +
  '<m:r>=f</m:r>' +
  '<m:f><m:num><m:r>L</m:r>' +
  '<m:sSup><m:e><m:r>V</m:r></m:e><m:sup><m:r>2</m:r></m:sup></m:sSup>' +
  '</m:num><m:den><m:r>2gD</m:r></m:den></m:f>' +
  '</m:oMath>';

function wordHtml(body: string): string {
  return (
    '<html xmlns:m="http://schemas.microsoft.com/office/2004/12/omml">' +
    '<head><meta name=ProgId content=Word.Document></head><body>' +
    `${body}</body></html>`
  );
}

function project(body: string): { xml: string; imageCount: number; equations: OoxmlNode[] } {
  const projected = projectExternalHtml(wordHtml(body));
  if (!projected.ok) throw new Error(projected.reason);
  const read = readOoxmlPackage(projected.fragmentBytes);
  if (!read.ok) throw new Error(read.reason);
  const part = read.package.parts.get(read.package.mainDocumentPart)!;
  const equations: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.namespaceUri === OFFICE_MATH_NAMESPACE_URI && node.localName === 'oMath') {
      equations.push(node);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return { xml: serializeOoxmlPart(part), imageCount: projected.imageCount, equations };
}

function linearOf(equation: OoxmlNode): string {
  const projection = projectOmmlEquation(equation);
  if (projection === null) throw new Error('not an equation');
  return equationExpressionToLinearMath(projection.expression);
}

describe('Word clipboard equations', () => {
  test('recovers both equations from a Word for Mac capture', () => {
    const html = readFileSync(
      new URL('./fixtures/word-mac-equations.html', import.meta.url),
      'utf8'
    );
    const projected = projectExternalHtml(html);
    if (!projected.ok) throw new Error(projected.reason);
    expect(projected.imageCount).toBe(0);
    const read = readOoxmlPackage(projected.fragmentBytes);
    if (!read.ok) throw new Error(read.reason);
    const part = read.package.parts.get(read.package.mainDocumentPart)!;
    const xml = serializeOoxmlPart(part);
    const equations: OoxmlNode[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.namespaceUri === OFFICE_MATH_NAMESPACE_URI && node.localName === 'oMath') {
        equations.push(node);
        return;
      }
      for (const child of node.children) walk(child);
    };
    walk(part.root);
    expect(equations.map(linearOf)).toEqual(['{a}/{b}+x^{2}', '√{y}=∑[i=1]^[n]{i}']);
    expect(xml).toContain('<m:degHide m:val="on"/>');
    expect(xml).toContain('Inline ');
    expect(xml).toContain('after.');
    expect(xml).toContain('End.');
    expect(xml).not.toContain('<w:drawing>');
  });

  test('reads all three run-text shapes into canonical m:t', () => {
    for (const run of ['<m:r><m:t>Z</m:t></m:r>', '<m:r>Z</m:r>', '<m:r><i>Z</i></m:r>']) {
      const { xml, equations } = project(
        `<p class=MsoNormal><m:oMath><m:sSub><m:e>${run}</m:e>` +
          '<m:sub><m:r><i>A</i></m:r></m:sub></m:sSub></m:oMath></p>'
      );
      expect(equations).toHaveLength(1);
      expect(xml).toContain('<m:sSub><m:e><m:r><m:t xml:space="preserve">Z</m:t></m:r></m:e>');
      expect(linearOf(equations[0]!)).toBe('Z_{A}');
    }
  });

  test('keeps the structure of the Mac Word sample', () => {
    const { equations } = project(`<p class=MsoNormal>${MAC_WORD_EQUATION}${FALLBACK}</p>`);
    expect(equations).toHaveLength(1);
    expect(linearOf(equations[0]!)).toBe('Z_{A}-Z_{B}=f{LV^{2}}/{2gD}');
  });

  test('drops the paired fallback picture of a recovered equation', () => {
    const { imageCount, xml } = project(
      `<p class=MsoNormal>before ${MAC_WORD_EQUATION}${FALLBACK} after</p>`
    );
    expect(imageCount).toBe(0);
    expect(xml).not.toContain('<w:drawing>');
    expect(xml).toContain('before ');
    expect(xml).toContain(' after');
  });

  test('drops a fallback with nested VML conditionals', () => {
    const { imageCount, equations } = project(
      `<p class=MsoNormal>${MAC_WORD_EQUATION}<![if !msEquation]>` +
        `<![if !vml]><img src="${PNG}"><![endif]><![endif]></p>`
    );
    expect(equations).toHaveLength(1);
    expect(imageCount).toBe(0);
  });

  test('unwraps OMML from the msEquation conditional comment', () => {
    const { equations, imageCount } = project(
      '<p class=MsoNormal><!--[if gte msEquation 12]><m:oMathPara><m:oMath>' +
        '<m:f><m:num><m:r><i>a</i></m:r></m:num><m:den><m:r><i>b</i></m:r></m:den></m:f>' +
        `</m:oMath></m:oMathPara><![endif]-->${FALLBACK}</p>`
    );
    expect(equations).toHaveLength(1);
    expect(linearOf(equations[0]!)).toBe('{a}/{b}');
    expect(imageCount).toBe(0);
  });

  test('keeps the fallback picture when the comment holds only MathML', () => {
    const { equations, imageCount } = project(
      '<p class=MsoNormal><!--[if gte msEquation 12]><math><mi>x</mi></math><![endif]-->' +
        `${FALLBACK}</p>`
    );
    expect(equations).toHaveLength(0);
    expect(imageCount).toBe(1);
  });

  test('keeps the fallback picture when the equation is empty', () => {
    const { equations, imageCount } = project(
      `<p class=MsoNormal><m:oMath><m:r><o:p></o:p></m:r></m:oMath>${FALLBACK}</p>`
    );
    expect(equations).toHaveLength(0);
    expect(imageCount).toBe(1);
  });

  test('reads NBSP and o:p marks inside a run as math text', () => {
    const { equations } = project(
      '<p class=MsoNormal><m:oMath><m:r><m:t>x&nbsp;=&nbsp;1</m:t><o:p></o:p></m:r></m:oMath></p>'
    );
    expect(equations).toHaveLength(1);
    expect(linearOf(equations[0]!)).toBe('x = 1');
  });

  test('a paragraph with only an equation still projects as a paragraph', () => {
    const { xml, equations } = project(
      `<p class=MsoNormal>${MAC_WORD_EQUATION}</p><p class=MsoNormal>next</p>`
    );
    expect(equations).toHaveLength(1);
    expect((xml.match(/<w:p[ >]/g) ?? []).length).toBe(2);
  });

  test('escapes values and drops names outside the OMML schema', () => {
    const { xml, equations } = project(
      '<p class=MsoNormal><m:oMath><m:d><m:dPr><m:begChr m:val="&quot;&gt;&lt;x"/></m:dPr>' +
        '<m:e><m:script><m:r>y</m:r></m:script></m:e></m:d></m:oMath></p>'
    );
    expect(equations).toHaveLength(1);
    expect(xml).toContain('m:val="&quot;&gt;&lt;x"');
    expect(xml).not.toContain('m:script');
    expect(xml).toContain('<m:e><m:r><m:t xml:space="preserve">y</m:t></m:r></m:e>');
  });

  test('a nested equation flood stays bounded', () => {
    const depth = 200;
    const nested = '<m:e><m:d>'.repeat(depth) + '<m:r>x</m:r>' + '</m:d></m:e>'.repeat(depth);
    const projected = projectExternalHtml(
      wordHtml(`<p class=MsoNormal><m:oMath><m:d>${nested}</m:d></m:oMath>tail</p>`)
    );
    expect(projected.ok).toBe(true);
  });
});

describe('pasting Word equations into the editor', () => {
  test('lands an editable equation that survives save and reopen', async () => {
    const target = mount(paragraph('ab'));
    putCaret(target.surface, 1);
    target.surface.pasteRich(
      'Z',
      wordHtml(`<p class=MsoNormal>${MAC_WORD_EQUATION}${FALLBACK}</p>`)
    );
    const markup = serializeOoxmlPart(target.surface.session.part());
    expect(markup).toContain('<m:oMath');
    expect(markup).not.toContain('<w:drawing>');
    const saved = strFromU8(unzipSync(await target.surface.save())['word/document.xml']!);
    expect(saved).toContain('<m:f>');
    const reopened = readOoxmlPackage(await target.surface.save());
    expect(reopened.ok).toBe(true);
    target.container.remove();
  });
});
