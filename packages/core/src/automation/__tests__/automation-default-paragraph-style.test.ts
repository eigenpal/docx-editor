// A styles part with no `w:default` paragraph style: unstyled paragraphs take the paragraph style
// named "Normal". Style reads answer that name, layout and automation agree on the style, and
// editing never writes the resolved default back into the document.

import { describe, expect, test } from 'bun:test';
import {
  docx,
  open,
  p,
  paragraphsOf,
  roots,
  savedMainXml,
  savedPartBytes,
} from './support/protocol.ts';
import { buildStyleCascadeTable } from '../../layout/style-cascade.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { stylesPartOf } from '../../store/package/ooxml-indexes.ts';
import { styleDefinitionsOf } from '../style-definitions.ts';

const UNFLAGGED =
  '<w:style w:type="paragraph" w:styleId="a"><w:name w:val="Normal"/>' +
  '<w:rPr><w:sz w:val="32"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
  '<w:basedOn w:val="a"/></w:style>';

function styleOfFirstParagraph(bytes: Uint8Array): unknown {
  const host = open(bytes);
  const [paragraph] = paragraphsOf(host, roots(host).body);
  const result = host.execute({ operations: [{ op: 'getStyle', span: { paragraph: paragraph! } }] })
    .results[0];
  return result?.status === 'ok' ? result.value : result;
}

describe('the default paragraph style without w:default', () => {
  test('an unstyled paragraph reads the style named "Normal"', () => {
    expect(styleOfFirstParagraph(docx(p('one'), UNFLAGGED))).toEqual({
      kind: 'style',
      name: 'Normal',
    });
  });

  test('a style with w:default keeps precedence over the name', () => {
    const flagged =
      UNFLAGGED +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Body"><w:name w:val="Body"/></w:style>';
    expect(styleOfFirstParagraph(docx(p('one'), flagged))).toEqual({ kind: 'style', name: 'Body' });
  });

  test('layout and automation resolve the same default paragraph style', () => {
    const opened = readOoxmlPackage(docx(p('one'), UNFLAGGED));
    if (!opened.ok) throw new Error('package did not open');
    const part = stylesPartOf(opened.package)!;
    expect(buildStyleCascadeTable(part.root).defaultParagraphStyleId).toBe('a');
    expect(styleDefinitionsOf(part).defaultParagraphId).toBe('a');
  });

  test('editing leaves styles.xml and the unstyled paragraph markup as they were', () => {
    const bytes = docx(p('one'), UNFLAGGED);
    const host = open(bytes);
    const stylesBefore = savedPartBytes(host, 'word/styles.xml');
    const [paragraph] = paragraphsOf(host, roots(host).body);
    const typed = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: paragraph!, offset: 3 }, text: ' two' }],
    });
    expect(typed.ok).toBe(true);
    const [edited] = paragraphsOf(host, roots(host).body);
    const split = host.execute({
      operations: [
        { op: 'insertParagraph', anchor: { paragraph: edited! }, where: 'after', text: 'three' },
      ],
    });
    expect(split.ok).toBe(true);
    expect(savedPartBytes(host, 'word/styles.xml')).toBe(stylesBefore);
    const main = savedMainXml(host);
    expect(main).toContain('one two');
    expect(main).toContain('three');
    expect(main).not.toContain('w:pStyle');
  });
});
