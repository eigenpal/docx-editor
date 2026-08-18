// A list marker is DERIVED — from `numbering.xml` and the counter state, never from the
// paragraph — so a renumber leaves every paragraph subtree byte-identical. The break-cache key
// holds the marker's LENGTH on purpose, because only the length can move a line break, which
// left `1.` becoming `2.` moving no key at all: the unchanged-document exit returned the
// previous pages whole and the reader kept the old numbering.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession, type LayoutSession } from '../layout-session.ts';
import { resolveStoryListItems } from '../list-resolve.ts';
import { buildNumberingIndex } from '../numbering-index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function load(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const item = (text: string) =>
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

const document = () =>
  load(
    `<w:document xmlns:w="${W}"><w:body>${item('first')}${item('second')}</w:body></w:document>`,
    '/word/document.xml'
  );

/** `w:start` is the one Word writes when a list is told to begin elsewhere (§17.9.25). */
const numbering = (start: string) =>
  load(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">` +
      `<w:start w:val="${start}"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
      '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
    '/word/numbering.xml'
  );

function markersOf(
  part: OoxmlPart,
  start: string,
  session?: LayoutSession
): (string | undefined)[] {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  )!;
  const paragraphs = body.children.filter(
    (child): child is OoxmlElement => child.kind === 'paragraph'
  );
  const listItems = resolveStoryListItems(
    paragraphs,
    buildNumberingIndex(numbering(start).root as OoxmlElement),
    undefined
  );
  const layout = layoutSemanticDocument(part, 1, {
    measurer,
    listItems,
    ...(session ? { session } : {}),
  });
  return layout.pages
    .flatMap((page) => page.fragments)
    .map((fragment) => (fragment.kind === 'paragraph' ? fragment.marker?.text : undefined));
}

describe('a renumbered list is re-placed, not reused', () => {
  test('a w:start change reaches an incremental pass', () => {
    const part = document();
    const session = createLayoutSession();
    expect(markersOf(part, '1', session)).toEqual(['1.', '2.']);
    expect(markersOf(part, '2', session)).toEqual(markersOf(part, '2'));
    expect(markersOf(part, '2')).toEqual(['2.', '3.']);
  });

  test('an unchanged list still reuses its pages', () => {
    // The flow key carries the marker text; it must not carry anything that varies per pass,
    // or every keystroke in a list document becomes a full pass.
    const part = document();
    const session = createLayoutSession();
    markersOf(part, '1', session);
    markersOf(part, '1', session);
    expect(session.stats.placed).toBe(0);
    expect(session.stats.reusedPages).toBeGreaterThan(0);
  });
});
