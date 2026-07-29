// Block layout capability registry (comprehensive 3.6/3.7). layoutBody dispatches each block kind
// through its registered handler (no block.kind switch); this proves the built-ins are registered
// and the fingerprints are unchanged (paragraph line-breaking, table pagination, transparent SDT).

import { describe, expect, test } from 'bun:test';
import { layoutBody, type LayoutOptions } from '../layout.ts';
import {
  registerBlockLayout,
  hasBlockLayout,
  assertLayoutLaneComplete,
  blockDependencies,
  blockSemanticRole,
  hitOwner,
  hasLayoutMetadata,
} from '../block-layout.ts';
import { keyId } from '../dependency-graph.ts';
import { createDeterministicLayoutShaping } from '../metrics.ts';
import {
  createEmptyModel,
  bodyStoryId,
  registerCoreBlockCapability,
  snapshotBlockRegistryForTest,
  restoreBlockRegistryForTest,
  type Block,
  type PackageModel,
} from '@docx-editor.dev/engine-core';

function opts(): LayoutOptions {
  return {
    pageWidth: 12240,
    pageHeight: 15840,
    margin: 1440,
    shaping: createDeterministicLayoutShaping(),
  };
}
function modelWith(blocks: Block[]): PackageModel {
  const base = createEmptyModel();
  const sid = bodyStoryId(base);
  return {
    ...base,
    stories: new Map(base.stories).set(sid, { ...base.stories.get(sid)!, blocks }),
  };
}

describe('layout dispatches blocks through the registry', () => {
  test('a paragraph lays out as positioned text items via its registered handler', () => {
    const model = modelWith([{ kind: 'paragraph', id: 'p', runs: [{ text: 'hello world' }] }]);
    const layout = layoutBody(model, opts());
    const texts = layout.pages.flatMap((pg) => pg.items).filter((i) => i.type === 'text');
    // One paint run per visual line per style, not one per word: "hello world" is a
    // single unstyled line, so it paints as one item WITH its space.
    expect(texts.map((t) => (t as { text: string }).text)).toEqual(['hello world']);
    expect(
      texts.every((t) => (t as { anchor: { paragraphId: string } }).anchor.paragraphId === 'p')
    ).toBe(true);
  });

  test('a transparent SDT lays out its nested blocks in place (recurses through the registry)', () => {
    const model = modelWith([
      {
        kind: 'sdt',
        id: 's',
        props: {},
        blocks: [{ kind: 'paragraph', id: 'inner', runs: [{ text: 'nested' }] }],
      },
    ]);
    const layout = layoutBody(model, opts());
    const texts = layout.pages.flatMap((pg) => pg.items).filter((i) => i.type === 'text');
    expect(texts.map((t) => (t as { text: string }).text)).toEqual(['nested']);
  });

  test('registering a duplicate handler for a kind is rejected', () => {
    expect(() => registerBlockLayout('paragraph', () => {})).toThrow(
      /duplicate block layout handler/
    );
  });

  test('an unregistered block kind fails closed rather than being silently skipped', () => {
    const model = modelWith([{ kind: 'mystery' } as unknown as Block]);
    expect(() => layoutBody(model, opts())).toThrow(/no block layout handler registered/);
  });
});

describe('layout metadata lanes: resolution dependencies + semantic roles + hit ownership (3.6)', () => {
  test('a paragraph declares docDefaults + its style + numbering + character-style dependencies', () => {
    const p: Block = {
      kind: 'paragraph',
      id: 'p',
      runs: [{ text: 'x', props: { styleId: 'Emphasis' } }],
      props: { styleId: 'Heading1', numId: '3' },
    };
    expect(blockDependencies(p).map(keyId).sort()).toEqual([
      'numbering:3',
      'style:Emphasis',
      'style:Heading1',
      'style:docDefaults',
    ]);
    expect(blockSemanticRole('paragraph')).toBe('paragraph');
  });

  test('a table style is a STYLE key (not a table key) + docDefaults + nested cell dependencies', () => {
    const t: Block = {
      kind: 'table',
      id: 't',
      props: { styleId: 'TableGrid' },
      rows: [
        {
          id: 'r',
          cells: [
            {
              id: 'c',
              blocks: [
                { kind: 'paragraph', id: 'cp', runs: [{ text: 'x' }], props: { styleId: 'Cell' } },
              ],
            },
          ],
        },
      ],
    } as unknown as Block;
    // A table style is a StyleRecord identity -> 'style:TableGrid', not 'table:...'; nested paragraph
    // style is composed so a cached table invalidates when a cell paragraph's style changes.
    expect(blockDependencies(t).map(keyId).sort()).toEqual([
      'style:Cell',
      'style:TableGrid',
      'style:docDefaults',
    ]);
    expect(blockSemanticRole('table')).toBe('table');
    // A transparent SDT reads nothing itself but composes nested block deps.
    const s: Block = {
      kind: 'sdt',
      id: 's',
      props: {},
      blocks: [{ kind: 'paragraph', id: 'sp', runs: [{ text: 'y' }], props: { numId: '9' } }],
    };
    expect(blockDependencies(s).map(keyId).sort()).toEqual(['numbering:9', 'style:docDefaults']);
    expect(blockSemanticRole('sdt')).toBe('group');
  });

  test('the built-in kinds all registered their dependency + semantic-role lanes', () => {
    expect(hasLayoutMetadata('paragraph')).toBe(true);
    expect(hasLayoutMetadata('table')).toBe(true);
    expect(hasLayoutMetadata('sdt')).toBe(true);
  });

  test('hit ownership maps a display anchor to its owning block', () => {
    expect(hitOwner({ paragraphId: 'p-42' })).toBe('p-42');
  });
});

describe('layout lane feature-completeness (comprehensive 3.9)', () => {
  test('the built-in kinds all have a layout handler', () => {
    expect(hasBlockLayout('paragraph')).toBe(true);
    expect(hasBlockLayout('table')).toBe(true);
    expect(hasBlockLayout('sdt')).toBe(true);
    expect(() => assertLayoutLaneComplete()).not.toThrow();
  });

  test('a registered core kind with no layout handler is rejected up front', () => {
    const snap = snapshotBlockRegistryForTest();
    try {
      // A core kind (editable or read-only) that contributes no flow-layout handler would fail
      // closed only mid-render; the lane check surfaces the gap before a document is laid out.
      registerCoreBlockCapability({
        kind: 'callout' as Block['kind'],
        editPolicy: { topLevelEditable: false },
      });
      expect(() => assertLayoutLaneComplete()).toThrow(/layout lane incomplete[\s\S]*callout/);
    } finally {
      restoreBlockRegistryForTest(snap);
    }
    expect(() => assertLayoutLaneComplete()).not.toThrow();
  });

  test('the version-keyed guard catches a late kind with no layout handler through layoutBody', () => {
    layoutBody(modelWith([{ kind: 'paragraph', id: 'p', runs: [{ text: 'x' }] }]), opts()); // latch version
    const snap = snapshotBlockRegistryForTest();
    try {
      // A late core kind with no layout handler bumps blockRegistryVersion, so the NEXT layoutBody
      // re-validates (not skipped by a one-shot latch) and rejects — even for a paragraph-only doc.
      registerCoreBlockCapability({
        kind: 'callout' as Block['kind'],
        editPolicy: { topLevelEditable: false },
      });
      const paraOnly = modelWith([{ kind: 'paragraph', id: 'p2', runs: [{ text: 'y' }] }]);
      expect(() => layoutBody(paraOnly, opts())).toThrow(/layout lane incomplete[\s\S]*callout/);
    } finally {
      restoreBlockRegistryForTest(snap);
    }
    expect(() =>
      layoutBody(modelWith([{ kind: 'paragraph', id: 'p3', runs: [{ text: 'z' }] }]), opts())
    ).not.toThrow();
  });
});
