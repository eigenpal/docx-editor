// A paragraph that starts with a `w:pPr` and holds more stays a paragraph: the leading
// `w:pPr` is typed, every later one is kept generic where it stands, and a save writes them
// all back. A paragraph whose properties are not first stays generic, as before.
import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function parse(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    {
      name: '/word/document.xml',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    }
  );
  if (!result.ok) throw new Error(`document read failed: ${result.reason}`);
  return result.part;
}

function paragraphs(part: OoxmlPart): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'p') found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return found;
}

function kinds(node: OoxmlNode): string[] {
  if (node.kind === 'textValue') return [];
  return [`${node.localName}:${node.kind}`, ...node.children.flatMap(kinds)];
}

describe('paragraphs with more than one w:pPr', () => {
  test('the first w:pPr is typed, the second is generic, and the runs show', () => {
    const part = parse(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:pPr><w:jc w:val="right"/></w:pPr>' +
        '<w:r><w:t>Doubled</w:t></w:r></w:p>'
    );
    const [paragraph] = paragraphs(part);
    expect(paragraph!.kind).toBe('paragraph');
    expect(paragraph!.children.map((child) => child.kind)).toEqual([
      'paragraphProperties',
      'generic',
      'run',
    ]);
  });

  test('everything under an extra w:pPr is generic, so its section break is not one', () => {
    const part = parse(
      '<w:p><w:pPr><w:jc w:val="left"/></w:pPr>' +
        '<w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
        '<w:r><w:t>Text</w:t></w:r></w:p>'
    );
    const [paragraph] = paragraphs(part);
    const extra = paragraph!.children[1]!;
    expect(kinds(extra).every((entry) => entry.endsWith(':generic'))).toBe(true);
  });

  test('a paragraph whose only w:pPr is not first stays generic, with its properties kept', () => {
    // Typed, it would show without its alignment and its section break.
    for (const body of [
      '<w:p><w:r><w:t>Late</w:t></w:r><w:pPr><w:jc w:val="right"/></w:pPr></w:p>',
      '<w:p><w:bookmarkStart w:id="1" w:name="b"/><w:pPr><w:jc w:val="center"/><w:sectPr/></w:pPr>' +
        '<w:r><w:t>Marked</w:t></w:r></w:p>',
    ]) {
      const [paragraph] = paragraphs(parse(body));
      expect(paragraph!.kind).toBe('generic');
    }
  });

  test('a save writes every w:pPr back where it stood', () => {
    const body =
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:pPr><w:jc w:val="right"/></w:pPr>' +
      '<w:r><w:t>Doubled</w:t></w:r></w:p>';
    const saved = serializeOoxmlPart(parse(body));
    expect(saved).toContain(
      '<w:pPr><w:jc w:val="center"/></w:pPr><w:pPr><w:jc w:val="right"/></w:pPr>'
    );
  });
});
