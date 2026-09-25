import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import { applyLineSpacing, type ParagraphLineSpacing } from '../paragraph-style.ts';
import { adjustLineHeightInTable, paragraphSnapsToLineGrid, withLineGrid } from '../line-grid.ts';
import { parseSectionProperties } from '../section-properties.ts';
import { buildStyleCascadeTable, type StyleCascadeTable } from '../style-cascade.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../semantic-layout.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';

// The fixed measurer gives an 11pt line a 14pt box with its baseline at 11.2pt.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const ELEVEN_POINT_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>';

function root(xml: string, name: string): OoxmlElement {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part.root;
}
function documentPart(body: string) {
  const parsed = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const grid = (attributes: string) => `<w:sectPr><w:docGrid ${attributes}/></w:sectPr>`;
const lines360 = grid('w:type="lines" w:linePitch="360"');
const paragraph = (pPr = '', text = 'Sample line') =>
  `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const table = (cellParagraphs: string) =>
  `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>${cellParagraphs}</w:tc></w:tr></w:tbl>`;

type Fragment = ReturnType<typeof layoutSemanticDocument>['pages'][number]['fragments'][number];
function bodyLineHeights(layout: ReturnType<typeof layoutSemanticDocument>): number[] {
  return layout.pages.flatMap((page) =>
    page.fragments.flatMap((fragment: Fragment) =>
      fragment.kind === 'paragraph' ? fragment.lines.map((line) => line.box.height) : []
    )
  );
}
function cellLineHeights(layout: ReturnType<typeof layoutSemanticDocument>): number[] {
  return layout.pages.flatMap((page) =>
    page.fragments.flatMap((fragment: Fragment) =>
      fragment.kind === 'table'
        ? fragment.rows.flatMap((row) =>
            row.cells.flatMap((cell) =>
              cell.blocks.flatMap((block) =>
                block.kind === 'paragraph' ? block.lines.map((line) => line.box.height) : []
              )
            )
          )
        : []
    )
  );
}
function lineBaselines(
  layout: ReturnType<typeof layoutSemanticDocument>,
  inCell: boolean
): number[] {
  return layout.pages.flatMap((page) =>
    page.fragments.flatMap((fragment: Fragment) => {
      const paragraphs =
        fragment.kind === 'paragraph'
          ? inCell
            ? []
            : [fragment]
          : fragment.kind === 'table' && inCell
            ? fragment.rows.flatMap((row) =>
                row.cells.flatMap((cell) =>
                  cell.blocks.filter((block) => block.kind === 'paragraph')
                )
              )
            : [];
      return paragraphs.flatMap((block) => block.lines.map((line) => line.baseline));
    })
  );
}
function settings(compat: string): OoxmlElement {
  return root(
    `<w:settings xmlns:w="${W}"><w:compat>${compat}<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
    '/word/settings.xml'
  );
}
function cascade(styles = '', settingsCompat = ''): StyleCascadeTable {
  return buildStyleCascadeTable(
    root(
      `<w:styles xmlns:w="${W}">${ELEVEN_POINT_DEFAULTS}${styles}</w:styles>`,
      '/word/styles.xml'
    ),
    undefined,
    settings(settingsCompat)
  );
}

describe('line box under an active line grid', () => {
  const single: ParagraphLineSpacing = { rule: 'auto', value: 240, gridPitch: 18 };

  test('a line takes one pitch with its glyphs centred', () => {
    expect(applyLineSpacing(single, 14, 11.2)).toEqual({ height: 18, baseline: 13.2, trailing: 0 });
  });

  test('tall text takes whole pitches and stays centred', () => {
    expect(applyLineSpacing(single, 20, 16)).toEqual({ height: 36, baseline: 24, trailing: 0 });
    // A box that exactly fills its pitch does not take a second one.
    expect(applyLineSpacing(single, 18 + 1e-9, 14).height).toBe(18);
  });

  test('an auto multiple scales the grid line and adds its extra below', () => {
    expect(applyLineSpacing({ ...single, value: 360 }, 14, 11.2)).toEqual({
      height: 27,
      baseline: 13.2,
      trailing: 9,
    });
    // Below single, the grid line is still the smallest line.
    expect(applyLineSpacing({ ...single, value: 120 }, 14, 11.2).height).toBe(18);
  });

  test('atLeast keeps its own rule: no snapping', () => {
    // Measured control: a 20pt atLeast line under an 18pt pitch is 20pt, not two pitches.
    const atLeast = { rule: 'atLeast', gridPitch: 18 } as const;
    expect(applyLineSpacing({ ...atLeast, value: 20 }, 14, 11.2)).toEqual({
      height: 20,
      baseline: 11.2 + 6,
    });
    expect(applyLineSpacing({ ...atLeast, value: 10 }, 14, 11.2)).toEqual({
      height: 14,
      baseline: 11.2,
    });
  });

  test('exact spacing never snaps', () => {
    expect(applyLineSpacing({ rule: 'exact', value: 15, gridPitch: 18 }, 14, 11.2)).toEqual({
      height: 15,
      baseline: 12,
    });
  });
});

describe('which paragraphs snap', () => {
  const spacing: ParagraphLineSpacing = { rule: 'auto', value: 240 };
  const snap = (val?: string) => ({
    localName: 'snapToGrid',
    ...(val === undefined ? {} : { attributes: { val } }),
  });

  test('snapToGrid defaults on and the last cascade entry wins', () => {
    expect(paragraphSnapsToLineGrid([])).toBe(true);
    expect(paragraphSnapsToLineGrid([snap('0')])).toBe(false);
    expect(paragraphSnapsToLineGrid([snap('0'), snap()])).toBe(true);
    expect(paragraphSnapsToLineGrid([snap('1'), snap('false')])).toBe(false);
  });

  test('no pitch, exact or atLeast spacing, an opt-out and a plain cell leave spacing alone', () => {
    expect(withLineGrid(spacing, [], undefined, false, false)).toBe(spacing);
    const exact: ParagraphLineSpacing = { rule: 'exact', value: 15 };
    expect(withLineGrid(exact, [], 18, false, false)).toBe(exact);
    const atLeast: ParagraphLineSpacing = { rule: 'atLeast', value: 20 };
    expect(withLineGrid(atLeast, [], 18, false, false)).toBe(atLeast);
    expect(withLineGrid(spacing, [snap('0')], 18, false, false)).toBe(spacing);
    expect(withLineGrid(spacing, [], 18, true, false)).toBe(spacing);
    expect(withLineGrid(spacing, [], 18, true, true)).toEqual({ ...spacing, gridPitch: 18 });
    expect(withLineGrid(spacing, [], 18, false, false)).toEqual({ ...spacing, gridPitch: 18 });
  });

  test('adjustLineHeightInTable is read from the compatibility settings', () => {
    expect(adjustLineHeightInTable(settings('<w:adjustLineHeightInTable/>'))).toBe(true);
    expect(adjustLineHeightInTable(settings('<w:adjustLineHeightInTable w:val="0"/>'))).toBe(false);
    expect(adjustLineHeightInTable(settings(''))).toBe(false);
    expect(adjustLineHeightInTable(null)).toBe(false);
  });
});

describe('section grid types', () => {
  const pitchOf = (attributes: string) =>
    parseSectionProperties(
      root(`<w:sectPr xmlns:w="${W}"><w:docGrid ${attributes}/></w:sectPr>`, '/x.xml')
    ).gridLinePitchTwips;

  test('every grid type but default activates the line pitch', () => {
    for (const type of ['lines', 'linesAndChars', 'snapToChars'])
      expect(pitchOf(`w:type="${type}" w:linePitch="360"`)).toBe(360);
  });

  test('a pitch without an active type, or without a usable pitch, is no grid', () => {
    expect(pitchOf('w:linePitch="360"')).toBeUndefined();
    expect(pitchOf('w:type="default" w:linePitch="360"')).toBeUndefined();
    expect(pitchOf('w:type="lines" w:linePitch="0"')).toBeUndefined();
    expect(pitchOf('w:type="lines" w:linePitch="bad"')).toBeUndefined();
  });
});

describe('paragraph lines in layout', () => {
  test('body lines snap under an active grid and not under a bare pitch', () => {
    const text = 'word '.repeat(30);
    expect(
      bodyLineHeights(
        layoutSemanticDocument(documentPart(paragraph('', text) + lines360), 1, {
          measurer,
          styleCascade: cascade(),
        })
      )
    ).toEqual([18, 18]);
    expect(
      bodyLineHeights(
        layoutSemanticDocument(documentPart(paragraph('', text) + grid('w:linePitch="360"')), 1, {
          measurer,
          styleCascade: cascade(),
        })
      )
    ).toEqual([14, 14]);
  });

  test('tall text snaps; exact and atLeast spacing keep their own height', () => {
    const tall = '<w:rPr><w:sz w:val="36"/></w:rPr>';
    const body =
      `<w:p><w:r>${tall}<w:t>Tall</w:t></w:r></w:p>` +
      paragraph('<w:spacing w:line="300" w:lineRule="exact"/>') +
      paragraph('<w:spacing w:line="400" w:lineRule="atLeast"/>') +
      paragraph('<w:spacing w:line="200" w:lineRule="atLeast"/>') +
      lines360;
    // 18pt text has a 22.9pt natural box, so it takes two pitches.
    expect(
      bodyLineHeights(
        layoutSemanticDocument(documentPart(body), 1, { measurer, styleCascade: cascade() })
      )
    ).toEqual([36, 15, 20, 14]);
  });

  test('a style opt-out is inherited and a direct setting overrides it', () => {
    const styles =
      '<w:style w:type="paragraph" w:styleId="Loose"><w:pPr><w:snapToGrid w:val="0"/></w:pPr></w:style>';
    const body =
      paragraph('<w:pStyle w:val="Loose"/>') +
      paragraph('<w:pStyle w:val="Loose"/><w:snapToGrid/>') +
      paragraph('<w:snapToGrid w:val="0"/>') +
      // The run-level element is the character grid and does not opt the line out.
      paragraph('<w:rPr><w:snapToGrid w:val="0"/></w:rPr>') +
      lines360;
    const layout = layoutSemanticDocument(documentPart(body), 1, {
      measurer,
      styleCascade: cascade(styles),
    });
    expect(bodyLineHeights(layout)).toEqual([14, 18, 14, 18]);
  });

  test('table cells snap only with adjustLineHeightInTable', () => {
    const body = table(paragraph()) + paragraph() + lines360;
    const plain = layoutSemanticDocument(documentPart(body), 1, {
      measurer,
      styleCascade: cascade(),
    });
    expect(cellLineHeights(plain)).toEqual([14]);
    expect(bodyLineHeights(plain)).toEqual([18]);
    const adjusted = layoutSemanticDocument(documentPart(body), 1, {
      measurer,
      styleCascade: cascade('', '<w:adjustLineHeightInTable/>'),
    });
    expect(cellLineHeights(adjusted)).toEqual([18]);
  });

  test('each section snaps to its own grid', () => {
    const body =
      paragraph(grid('w:type="lines" w:linePitch="400"')) +
      paragraph(`<w:sectPr><w:type w:val="continuous"/></w:sectPr>`) +
      paragraph() +
      lines360;
    expect(
      bodyLineHeights(
        layoutSemanticDocument(documentPart(body), 1, { measurer, styleCascade: cascade() })
      )
    ).toEqual([20, 14, 18]);
  });

  test.each([false, true])(
    'a grid change invalidates reused layout, including a 12pt grid (cell=%s)',
    (inCell) => {
      const content = inCell ? table(paragraph()) : paragraph();
      const styleCascade = cascade('', '<w:adjustLineHeightInTable/>');
      const cache = createParagraphLayoutCache();
      const session = createLayoutSession();
      const heights = inCell ? cellLineHeights : bodyLineHeights;
      const revisions = [
        [content + grid('w:linePitch="240"'), 14],
        [content + grid('w:type="lines" w:linePitch="240"'), 24],
        [content + lines360, 18],
        [content + grid('w:linePitch="240"'), 14],
      ] as const;
      revisions.forEach(([body, expected], index) => {
        const part = documentPart(body);
        const warm = layoutSemanticDocument(part, index + 1, {
          measurer,
          styleCascade,
          cache,
          session,
        });
        const cold = layoutSemanticDocument(part, index + 1, { measurer, styleCascade });
        expect(warm.pages).toEqual(cold.pages);
        expect(heights(warm)).toEqual([expected]);
      });
    }
  );

  test.each([false, true])(
    'shared paragraph nodes follow a section grid change (cell=%s)',
    (inCell) => {
      // Only the section properties change: every paragraph and table node object is reused,
      // so nothing keyed by node identity may keep the previous grid.
      const content = inCell ? table(paragraph()) : paragraph();
      const styleCascade = cascade('', '<w:adjustLineHeightInTable/>');
      const heights = inCell ? cellLineHeights : bodyLineHeights;
      const shared = documentPart(content + lines360);
      const withSection = (sectPr: string) => {
        const donor = documentPart(content + sectPr).root.children.find(
          (child) => child.kind === 'body'
        ) as OoxmlElement;
        const body = shared.root.children.find((child) => child.kind === 'body') as OoxmlElement;
        const children = body.children.map((child) =>
          child.kind !== 'textValue' && child.localName === 'sectPr'
            ? donor.children.find((c) => c.kind !== 'textValue' && c.localName === 'sectPr')!
            : child
        );
        return {
          ...shared,
          root: {
            ...shared.root,
            children: shared.root.children.map((child) =>
              child === body ? { ...body, children } : child
            ),
          },
        };
      };
      const cache = createParagraphLayoutCache();
      const session = createLayoutSession();
      const revisions = [
        [lines360, 18],
        [grid('w:linePitch="360"'), 14],
        [grid('w:type="lines" w:linePitch="240"'), 24],
        [grid('w:linePitch="240"'), 14],
        [lines360, 18],
      ] as const;
      revisions.forEach(([sectPr, expected], index) => {
        const reused = withSection(sectPr) as typeof shared;
        const warm = layoutSemanticDocument(reused, index + 1, {
          measurer,
          styleCascade,
          cache,
          session,
        });
        const fresh = layoutSemanticDocument(documentPart(content + sectPr), index + 1, {
          measurer,
          styleCascade,
        });
        expect(heights(warm)).toEqual([expected]);
        expect(heights(warm)).toEqual(heights(fresh));
        expect(lineBaselines(warm, inCell)).toEqual(lineBaselines(fresh, inCell));
      });
    }
  );
});
