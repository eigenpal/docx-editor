// Content-control boundary records: geometry identity, inline/block/nested, multi-page
// fragments, and metadata-only invalidation of wrapper chrome without stale page reuse.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core-contract/store';
import {
  contentControlAtPoint,
  createFixedMeasurer,
  createLayoutSession,
  hitTestPage,
  layoutSemanticDocument,
  type PageGeometry,
  type SemanticLayout,
} from '../index.ts';
import { contentControlContextToken } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const GEOMETRY: PageGeometry = {
  width: 300,
  height: 120,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const sdt = (pr: string, content: string) =>
  `<w:sdt><w:sdtPr>${pr}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

function lay(body: string, revision = 1, geometry: PageGeometry = GEOMETRY): SemanticLayout {
  return layoutSemanticDocument(load(body), revision, { measurer, geometry });
}

function geometryShape(layout: SemanticLayout): string {
  return JSON.stringify(
    layout.pages.map((page) =>
      page.fragments.map((fragment) => ({
        kind: fragment.kind,
        box: fragment.box,
        ...(fragment.kind === 'paragraph'
          ? {
              lines: fragment.lines.map((line) => ({
                box: line.box,
                spans: line.spans.map((span) => ({ text: span.text, box: span.box })),
              })),
            }
          : {}),
      }))
    )
  );
}

describe('wrapper geometry identity', () => {
  test('a block control does not change page geometry versus bare content', () => {
    const wrapped = lay(sdt('<w:alias w:val="A"/>', p('same text here')));
    const bare = lay(p('same text here'));
    expect(geometryShape(wrapped)).toBe(geometryShape(bare));
    expect(wrapped.contentControls).toHaveLength(1);
    expect(bare.contentControls ?? []).toHaveLength(0);
  });

  test('an inline control does not change span geometry versus bare runs', () => {
    const wrapped = lay(
      `<w:p>${run('aa')}${sdt('<w:tag w:val="t"/>', run('bb'))}${run('cc')}</w:p>`
    );
    const bare = lay(`<w:p>${run('aa')}${run('bb')}${run('cc')}</w:p>`);
    expect(geometryShape(wrapped)).toBe(geometryShape(bare));
    const control = wrapped.contentControls![0]!;
    expect(control.level).toBe('inline');
    expect(control.tag).toBe('t');
    expect(control.fragments).toHaveLength(1);
    // Mid-run "bb" at 6pt advance starts at x=12 and is 12 wide.
    expect(control.fragments[0]!.box.x).toBe(12);
    expect(control.fragments[0]!.box.width).toBe(12);
  });
});

describe('block, inline, and nested boundaries', () => {
  test('a block control publishes alias, tag, type, lock, placeholder, and bound state', () => {
    const layout = lay(
      sdt(
        `<w:alias w:val="Status"/><w:tag w:val="status"/><w:lock w:val="contentLocked"/>` +
          `<w:showingPlcHdr/><w:dataBinding w:xpath="/a" w:storeItemID="{0}"/>` +
          `<w:dropDownList/>`,
        p('Draft')
      )
    );
    const control = layout.contentControls![0]!;
    expect(control).toMatchObject({
      alias: 'Status',
      tag: 'status',
      controlType: 'dropdown',
      lock: 'contentLocked',
      effectiveLock: 'contentLocked',
      placeholder: true,
      bound: true,
      nestingDepth: 0,
      level: 'block',
    });
    expect(control.fragments).toHaveLength(1);
    expect(layout.pages[0]!.contentControls?.[0]?.id).toBe(control.id);
  });

  test('nested locks union onto the inner effectiveLock', () => {
    const layout = lay(
      sdt(
        `<w:alias w:val="outer"/><w:lock w:val="sdtLocked"/>`,
        sdt(`<w:alias w:val="inner"/><w:lock w:val="contentLocked"/>`, p('x'))
      )
    );
    expect(layout.contentControls).toHaveLength(2);
    const outer = layout.contentControls!.find((c) => c.alias === 'outer')!;
    const inner = layout.contentControls!.find((c) => c.alias === 'inner')!;
    expect(outer.nestingDepth).toBe(0);
    expect(inner.nestingDepth).toBe(1);
    expect(inner.lock).toBe('contentLocked');
    expect(inner.effectiveLock).toBe('sdtContentLocked');
  });

  test('nested hit resolution prefers the innermost control', () => {
    const layout = lay(
      sdt(`<w:alias w:val="outer"/>`, sdt(`<w:alias w:val="inner"/>`, p('hitme')))
    );
    const inner = layout.contentControls!.find((c) => c.alias === 'inner')!;
    const box = inner.fragments[0]!.box;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(contentControlAtPoint(layout, 0, point)?.alias).toBe('inner');
    expect(hitTestPage(layout, 0, point)?.contentControlId).toBe(inner.id);
  });

  test('checkbox type is recognised from the w14 extension', () => {
    const layout = lay(
      sdt(`<w:alias w:val="Agree"/><w14:checkbox><w14:checked w14:val="0"/></w14:checkbox>`, p('☐'))
    );
    expect(layout.contentControls![0]!.controlType).toBe('checkbox');
  });
});

describe('multi-page boundary fragments', () => {
  test('a block control that crosses a page break reports one fragment per page', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const layout = lay(sdt('<w:alias w:val="long"/>', p(words)), 1, {
      width: 200,
      height: 80,
      margin: { top: 8, right: 8, bottom: 8, left: 8 },
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    const control = layout.contentControls![0]!;
    expect(control.fragments.length).toBeGreaterThan(1);
    const pages = new Set(control.fragments.map((f) => f.pageIndex));
    expect(pages.size).toBe(control.fragments.length);
    // No single rectangle covering the inter-page gap.
    for (const fragment of control.fragments) {
      expect(fragment.box.height).toBeGreaterThan(0);
      expect(fragment.box.height).toBeLessThan(layout.pages[0]!.contentBox.height + 1);
    }
  });
});

describe('metadata-only invalidation', () => {
  test('wrapper-only alias change refreshes boundary records and the control-context token', () => {
    const session = createLayoutSession();
    const firstPart = load(sdt('<w:alias w:val="before"/>', p('stable content')));
    const first = layoutSemanticDocument(firstPart, 1, { measurer, geometry: GEOMETRY, session });
    const firstToken = first.controlContextToken!;
    expect(first.contentControls![0]!.alias).toBe('before');

    const secondPart = load(sdt('<w:alias w:val="after"/>', p('stable content')));
    expect(contentControlContextToken(secondPart)).not.toBe(contentControlContextToken(firstPart));
    const second = layoutSemanticDocument(secondPart, 2, { measurer, geometry: GEOMETRY, session });
    expect(second.contentControls![0]!.alias).toBe('after');
    expect(second.controlContextToken).not.toBe(firstToken);
    // Geometry stays identical; only wrapper metadata moved.
    expect(geometryShape(second)).toBe(geometryShape(first));
  });

  test('unchanged wrapper metadata can keep page identity across revisions', () => {
    const session = createLayoutSession();
    const part = load(sdt('<w:alias w:val="same"/>', p('stable content')));
    const first = layoutSemanticDocument(part, 1, { measurer, geometry: GEOMETRY, session });
    const second = layoutSemanticDocument(part, 2, { measurer, geometry: GEOMETRY, session });
    expect(second.pages[0]).toBe(first.pages[0]);
    expect(second.contentControls![0]!.alias).toBe('same');
    expect(second.controlContextToken).toBe(first.controlContextToken);
  });
});
