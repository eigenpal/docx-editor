// Backspace and Delete at a break whose two sides hold, in the tree, paragraphs a hidden mark
// removed from the flow. The reader sees two neighbours, so the key joins them; the removed
// paragraphs between are absorbed instead of vetoing the join as non-adjacent.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';
import { readOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { hiddenMarkRemovedIds, hiddenParagraphsBetween } from '../hidden-mark-joins.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const STYLES =
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:basedOn w:val="Normal"/><w:pPr><w:contextualSpacing/></w:pPr></w:style></w:styles>`;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const hidden = '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr></w:p>';
const hiddenWithNote =
  '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:r><w:rPr><w:vanish/></w:rPr><w:t>note</w:t></w:r></w:p>';
const inCell = (content: string) =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${content}</w:tc></w:tr></w:tbl>${para('after')}`;

const mounted: { surface: PaginatedSurface; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { surface, container } of mounted.splice(0)) {
    surface.destroy();
    container.remove();
  }
});

function mount(
  body: string,
  author?: string,
  hiddenRevisionAuthors?: readonly string[]
): PaginatedSurface {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(body), {
    scale: 1,
    ...(author ? { author } : {}),
    ...(hiddenRevisionAuthors ? { hiddenRevisionAuthors } : {}),
  });
  if (!opened.ok) throw new Error(opened.reason);
  mounted.push({ surface: opened.surface, container });
  return opened.surface;
}

function idOf(surface: PaginatedSurface, text: string): string {
  for (const id of surface.session.paragraphIds()) {
    if (paragraphTextOf(surface.session.part(), id) === text) return id;
  }
  throw new Error(`no paragraph ${text}`);
}

const texts = (surface: PaginatedSurface) =>
  surface.session.paragraphIds().map((id) => paragraphTextOf(surface.session.part(), id));

function caret(surface: PaginatedSurface, paragraphId: string, offset: number): void {
  surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

describe('Backspace and Delete across removed paragraphs', () => {
  for (const count of [1, 3]) {
    test(`Backspace joins across ${count} removed paragraph(s)`, () => {
      const surface = mount(para('Alpha') + hidden.repeat(count) + para('Beta'));
      caret(surface, idOf(surface, 'Beta'), 0);
      surface.deleteBackward();
      expect(texts(surface)).toEqual(['AlphaBeta']);
      expect(surface.state().lastRejection).toBeFalsy();
      const joined = idOf(surface, 'AlphaBeta');
      expect(surface.state().selection.head).toEqual({ paragraphId: joined, offset: 5 });
    });

    test(`Delete joins across ${count} removed paragraph(s)`, () => {
      const surface = mount(para('Alpha') + hidden.repeat(count) + para('Beta'));
      caret(surface, idOf(surface, 'Alpha'), 5);
      surface.deleteForward();
      expect(texts(surface)).toEqual(['AlphaBeta']);
      expect(surface.state().lastRejection).toBeFalsy();
    });
  }

  test('inside a table cell', () => {
    const surface = mount(inCell(para('Alpha') + hidden + hidden + para('Beta')));
    caret(surface, idOf(surface, 'Beta'), 0);
    surface.deleteBackward();
    expect(texts(surface)).toEqual(['AlphaBeta', 'after']);

    const other = mount(inCell(para('Alpha') + hidden + para('Beta')));
    caret(other, idOf(other, 'Alpha'), 5);
    other.deleteForward();
    expect(texts(other)).toEqual(['AlphaBeta', 'after']);
  });

  test('hidden text in a removed paragraph moves with the join and stays in the tree', () => {
    const surface = mount(para('Alpha') + hiddenWithNote + para('Beta'));
    caret(surface, idOf(surface, 'Beta'), 0);
    surface.deleteBackward();
    expect(texts(surface)).toEqual(['AlphanoteBeta']);
  });

  test('a selection across removed paragraphs deletes into one paragraph', () => {
    const surface = mount(para('Alpha') + hidden + hidden + para('Beta'));
    const alpha = idOf(surface, 'Alpha');
    const beta = idOf(surface, 'Beta');
    surface.setSelection({
      anchor: { paragraphId: alpha, offset: 3 },
      head: { paragraphId: beta, offset: 1 },
    });
    surface.deleteBackward();
    expect(texts(surface)).toEqual(['Alpeta']);
    expect(surface.state().lastRejection).toBeFalsy();
  });

  test('in suggesting mode, every mark on the way is proposed for deletion', async () => {
    const surface = mount(para('Alpha') + hidden + hidden + para('Beta'), 'Ada');
    surface.setEditingMode('suggest');
    caret(surface, idOf(surface, 'Beta'), 0);
    surface.deleteBackward();
    expect(surface.state().lastRejection).toBeFalsy();
    const xml = strFromU8(unzipSync(await surface.save())['word/document.xml']!);
    expect(xml.match(/<w:pPr><w:rPr><w:del /g)).toHaveLength(3);
    expect(texts(surface)).toEqual(['Alpha', '', '', 'Beta']);
  });

  test('a visible empty paragraph between is still its own line', () => {
    const surface = mount(para('Alpha') + '<w:p/>' + para('Beta'));
    caret(surface, idOf(surface, 'Beta'), 0);
    surface.deleteBackward();
    expect(texts(surface)).toEqual(['Alpha', 'Beta']);
  });
});

describe('contextual spacing across removed paragraphs while editing', () => {
  const first = '<w:p><w:pPr><w:spacing w:after="200"/></w:pPr><w:r><w:t>first</w:t></w:r></w:p>';
  const hiddenItem =
    '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:rPr><w:vanish/></w:rPr></w:pPr></w:p>';
  const second =
    '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:spacing w:before="240"/></w:pPr><w:r><w:t>second</w:t></w:r></w:p>';

  function gap(surface: PaginatedSurface): number {
    const lines = surface
      .layout()
      .pages.flatMap((page) =>
        page.fragments.flatMap((fragment) => (fragment.kind === 'paragraph' ? fragment.lines : []))
      );
    const line = (value: string) =>
      lines.find((candidate) => candidate.spans.map((span) => span.text).join('') === value)!.box;
    return Math.round((line('second').y - (line('first').y + line('first').height)) * 100) / 100;
  }

  test('removing the hidden neighbour updates the spacing it suppressed', () => {
    const surface = mount(first + hiddenItem + second);
    const cold = mount(first + second);
    const withHidden = gap(surface);
    expect(withHidden).toBeLessThan(gap(cold));

    const ids = surface.session.paragraphIds();
    const result = surface.session.applyTreeOps([
      { op: 'joinParagraphs', firstId: ids[0]!, secondId: ids[1]! },
    ]);
    expect(result.committed).toBe(true);
    expect(gap(surface)).toBe(gap(cold));
  });
});

describe('a paragraph that only this view removes', () => {
  // Its only content is a tracked change, so whether it shows depends on the view.
  const deletedOnly =
    '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:del w:id="9" w:author="X"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>';
  const insertedOnly =
    '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:ins w:id="9" w:author="X"><w:r><w:t>added</w:t></w:r></w:ins></w:p>';
  const cases = [
    { view: 'proposed', hiddenParagraph: deletedOnly, kept: '<w:delText>gone</w:delText>' },
    { view: 'original', hiddenParagraph: insertedOnly, kept: '<w:t>added</w:t>' },
  ] as const;

  async function savedXml(surface: PaginatedSurface): Promise<string> {
    return strFromU8(unzipSync(await surface.save())['word/document.xml']!);
  }

  for (const { view, hiddenParagraph, kept } of cases) {
    test(`${view}: Backspace, Delete, and a range delete join across it`, async () => {
      const lanes: ((surface: PaginatedSurface) => void)[] = [
        (surface) => {
          caret(surface, idOf(surface, 'Beta'), 0);
          surface.deleteBackward();
        },
        (surface) => {
          caret(surface, idOf(surface, 'Alpha'), 5);
          surface.deleteForward();
        },
        (surface) => {
          surface.setSelection({
            anchor: { paragraphId: idOf(surface, 'Alpha'), offset: 5 },
            head: { paragraphId: idOf(surface, 'Beta'), offset: 0 },
          });
          surface.deleteBackward();
        },
      ];
      for (const lane of lanes) {
        const surface = mount(para('Alpha') + hiddenParagraph + para('Beta'));
        surface.setRevisionDisplayMode(view);
        lane(surface);
        expect(surface.state().lastRejection).toBeFalsy();
        expect(surface.session.paragraphIds()).toHaveLength(1);
        // The tracked content the view hides moves with the join; it is not lost.
        expect(await savedXml(surface)).toContain(kept);
      }
    });
  }

  test('an author filter that resolves its only content removes it, and Delete joins across', async () => {
    const lines = (surface: PaginatedSurface) =>
      surface
        .layout()
        .pages.flatMap((page) =>
          page.fragments.flatMap((fragment) =>
            fragment.kind === 'paragraph' ? fragment.lines : []
          )
        )
        .map((line) => line.spans.map((span) => span.text).join(''));
    const shown = mount(para('Alpha') + deletedOnly + para('Beta'));
    expect(lines(shown)).toEqual(['Alpha', 'gone', 'Beta']);

    // All markup, with author X's changes hidden: X's deletion no longer shows.
    const surface = mount(para('Alpha') + deletedOnly + para('Beta'), undefined, ['X']);
    expect(lines(surface)).toEqual(['Alpha', 'Beta']);
    caret(surface, idOf(surface, 'Alpha'), 5);
    surface.deleteForward();
    expect(surface.state().lastRejection).toBeFalsy();
    expect(surface.session.paragraphIds()).toHaveLength(1);
    expect(await savedXml(surface)).toContain('<w:delText>gone</w:delText>');
  });

  test('all-markup shows it, so Backspace joins into it as an ordinary paragraph', () => {
    const surface = mount(para('Alpha') + deletedOnly + para('Beta'));
    caret(surface, idOf(surface, 'Beta'), 0);
    surface.deleteBackward();
    expect(surface.state().lastRejection).toBeFalsy();
    expect(surface.session.paragraphIds()).toHaveLength(2);
    expect(texts(surface)[0]).toBe('Alpha');
  });
});

describe('hiddenParagraphsBetween', () => {
  const siblings = (body: string) => {
    const result = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!result.ok) throw new Error(result.reason);
    const children = result.part.root.children[0]!.children;
    const ids = children.flatMap((child) => (child.kind === 'textValue' ? [] : [child.id]));
    return { children, ids };
  };

  const allMarkup = { displayMode: 'all-markup', authorFilter: undefined } as const;

  test('lists the removed paragraphs between two siblings', () => {
    const { children, ids } = siblings(para('a') + hidden + hidden + para('b'));
    const removed = () => hiddenMarkRemovedIds(children, allMarkup);
    expect([...removed()]).toEqual([ids[1], ids[2]]);
    expect(hiddenParagraphsBetween(children, ids[0]!, ids[3]!, removed)).toEqual([ids[1], ids[2]]);
    expect(hiddenParagraphsBetween(children, ids[0]!, ids[1]!, removed)).toEqual([]);
  });

  test('asks the view: a paragraph of only a tracked deletion leaves in proposed only', () => {
    const deletedOnly =
      '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:del w:id="9" w:author="X"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>';
    const { children, ids } = siblings(para('a') + deletedOnly + para('b'));
    expect([...hiddenMarkRemovedIds(children, allMarkup)]).toEqual([]);
    expect([
      ...hiddenMarkRemovedIds(children, { displayMode: 'proposed', authorFilter: undefined }),
    ]).toEqual([ids[1]]);
  });

  test('refuses anything else between, and the wrong order', () => {
    const shown = '<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:r><w:t>shown</w:t></w:r></w:p>';
    const { children, ids } = siblings(para('a') + shown + para('b'));
    const removed = () => hiddenMarkRemovedIds(children, allMarkup);
    expect(hiddenParagraphsBetween(children, ids[0]!, ids[2]!, removed)).toBeNull();
    expect(hiddenParagraphsBetween(children, ids[2]!, ids[0]!, removed)).toBeNull();
  });
});
