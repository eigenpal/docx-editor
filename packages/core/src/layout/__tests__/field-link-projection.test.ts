// HYPERLINK fields project a live link onto their cached result.
//
// A complex `HYPERLINK "…"` field or `w:fldSimple` used to paint its cached result as plain
// inert text while a typed `w:hyperlink` was clickable. Layout now parses the instruction and
// asks the INJECTED projector for the sanitized record — the same seam `projectLink` uses —
// so policy stays at the surface trust boundary. An enclosing `w:hyperlink` outranks the
// field's own instruction, and an empty result paints nothing, URL included.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  piecesOfParagraph,
  type FieldLinkProjector,
  type HyperlinkProjector,
} from '../field-projection.ts';
import type { HyperlinkFieldSpec } from '../field-link.ts';
import type { SpanLinkRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function partOf(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphOf(body: string): OoxmlNode {
  const find = (node: OoxmlNode): OoxmlNode | undefined => {
    if (node.kind === 'paragraph') return node;
    if (node.kind === 'textValue') return undefined;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit) return hit;
    }
    return undefined;
  };
  const paragraph = find(partOf(body).root);
  if (!paragraph) throw new Error('no paragraph');
  return paragraph;
}

/**
 * A projector shaped like the surface's: external targets become records, `javascript:`
 * emulates the sanitizer's refusal (anchor fallback, else no link). It also RECORDS the
 * specs it was asked about, so a test can assert the seam was (or was not) crossed.
 */
function projectorStub(seen: HyperlinkFieldSpec[] = []): FieldLinkProjector {
  return (spec) => {
    seen.push(spec);
    const refused = spec.target !== null && spec.target.startsWith('javascript:');
    if (spec.target !== null && !refused) {
      return {
        id: `stub:${spec.target}`,
        kind: 'external',
        href: spec.target,
        ...(spec.tooltip !== null ? { tooltip: spec.tooltip } : {}),
      };
    }
    if (spec.anchor !== null) {
      return {
        id: `stub:#${spec.anchor}`,
        kind: 'internal',
        href: `#${spec.anchor}`,
        anchor: spec.anchor,
        ...(spec.tooltip !== null ? { tooltip: spec.tooltip } : {}),
      };
    }
    return null;
  };
}

/** The typed-`w:hyperlink` projector, for the precedence tests. */
const ENCLOSING: SpanLinkRecord = Object.freeze({
  id: 'enclosing',
  kind: 'external',
  href: 'https://enclosing.example',
});
const projectEnclosing: HyperlinkProjector = () => ENCLOSING;

function project(
  body: string,
  projectFieldLink?: FieldLinkProjector,
  projectLink?: HyperlinkProjector
) {
  return piecesOfParagraph(
    paragraphOf(body),
    [],
    undefined,
    undefined,
    projectLink,
    undefined,
    'all-markup',
    undefined,
    undefined,
    undefined,
    projectFieldLink
  );
}

/** A complete complex field around one instruction, with an optional cached result. */
function complexField(instr: string, result = ''): string {
  return (
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText>${instr}</w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    result +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
  );
}

describe('a complex HYPERLINK field', () => {
  test('its cached result carries the projected record over one atom unit', () => {
    const seen: HyperlinkFieldSpec[] = [];
    const pieces = project(
      '<w:p><w:r><w:t>See </w:t></w:r>' +
        complexField(
          ' HYPERLINK "https://example.com" \\o "Visit" ',
          '<w:r><w:t>the site</w:t></w:r>'
        ) +
        '<w:r><w:t>.</w:t></w:r></w:p>',
      projectorStub(seen)
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['See ', 'the site', '.']);
    const field = pieces[1]!;
    expect(field.projected).toBe(true);
    expect(field.start).toBe(4);
    expect(field.end).toBe(5);
    expect(field.link).toEqual({
      id: 'stub:https://example.com',
      kind: 'external',
      href: 'https://example.com',
      tooltip: 'Visit',
    });
    expect(seen).toEqual([{ target: 'https://example.com', anchor: null, tooltip: 'Visit' }]);
  });

  test('an anchor-only \\l field carries the internal record', () => {
    const pieces = project(
      `<w:p>${complexField(' HYPERLINK \\l "section3" ', '<w:r><w:t>Section 3</w:t></w:r>')}</w:p>`,
      projectorStub()
    );
    expect(pieces[0]!.link).toEqual({
      id: 'stub:#section3',
      kind: 'internal',
      href: '#section3',
      anchor: 'section3',
    });
  });

  test('a refused target projects NO link and the text still paints', () => {
    const pieces = project(
      `<w:p>${complexField(' HYPERLINK "javascript:alert(1)" ', '<w:r><w:t>Click</w:t></w:r>')}</w:p>`,
      projectorStub()
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['Click']);
    expect(pieces[0]!.link).toBeUndefined();
  });

  test('an empty result paints nothing — never the URL', () => {
    const pieces = project(
      `<w:p><w:r><w:t>A</w:t></w:r>${complexField(' HYPERLINK "https://example.com" ')}<w:r><w:t>B</w:t></w:r></w:p>`,
      projectorStub()
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['A', 'B']);
  });

  test('an enclosing w:hyperlink wins over the field instruction', () => {
    const seen: HyperlinkFieldSpec[] = [];
    const pieces = project(
      `<w:p><w:hyperlink w:anchor="a">${complexField(
        ' HYPERLINK "https://field.example" ',
        '<w:r><w:t>linked</w:t></w:r>'
      )}</w:hyperlink></w:p>`,
      projectorStub(seen),
      projectEnclosing
    );
    expect(pieces[0]!.link).toBe(ENCLOSING);
    // The seam is never crossed: the enclosing link is captured before the flush asks.
    expect(seen).toEqual([]);
  });

  test('without a projector the result paints as plain text, exactly as before', () => {
    const pieces = project(
      `<w:p>${complexField(' HYPERLINK "https://example.com" ', '<w:r><w:t>plain</w:t></w:r>')}</w:p>`
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['plain']);
    expect(pieces[0]!.link).toBeUndefined();
  });
});

describe('a simple HYPERLINK field', () => {
  test('its cached result carries the projected record', () => {
    const pieces = project(
      '<w:p><w:fldSimple w:instr=\' HYPERLINK "https://example.com" \'>' +
        '<w:r><w:t>the site</w:t></w:r></w:fldSimple></w:p>',
      projectorStub()
    );
    expect(pieces.map((piece) => piece.text)).toEqual(['the site']);
    expect(pieces[0]!.link).toEqual({
      id: 'stub:https://example.com',
      kind: 'external',
      href: 'https://example.com',
    });
  });

  test('inside a typed w:hyperlink the enclosing record wins', () => {
    const seen: HyperlinkFieldSpec[] = [];
    const pieces = project(
      '<w:p><w:hyperlink w:anchor="a">' +
        '<w:fldSimple w:instr=\' HYPERLINK "https://field.example" \'>' +
        '<w:r><w:t>entry</w:t></w:r></w:fldSimple></w:hyperlink></w:p>',
      projectorStub(seen),
      projectEnclosing
    );
    expect(pieces[0]!.link).toBe(ENCLOSING);
    expect(seen).toEqual([]);
  });

  test('a non-HYPERLINK simple field never crosses the seam', () => {
    const seen: HyperlinkFieldSpec[] = [];
    project(
      '<w:p><w:fldSimple w:instr=" REF x "><w:r><w:t>Section 3</w:t></w:r></w:fldSimple></w:p>',
      projectorStub(seen)
    );
    expect(seen).toEqual([]);
  });
});
