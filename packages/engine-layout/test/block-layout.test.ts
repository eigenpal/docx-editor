// Block layout capability registry (comprehensive 3.6/3.7). layoutBody dispatches each block kind
// through its registered handler (no block.kind switch); this proves the built-ins are registered
// and the fingerprints are unchanged (paragraph line-breaking, table pagination, transparent SDT).

import { describe, expect, test } from 'bun:test';
import { layoutBody, type LayoutOptions } from '../src/layout.ts';
import { registerBlockLayout, hasBlockLayout, assertLayoutLaneComplete } from '../src/block-layout.ts';
import { DeterministicMetrics } from '../src/metrics.ts';
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
  return { pageWidth: 12240, pageHeight: 15840, margin: 1440, metrics: new DeterministicMetrics() };
}
function modelWith(blocks: Block[]): PackageModel {
  const base = createEmptyModel();
  const sid = bodyStoryId(base);
  return { ...base, stories: new Map(base.stories).set(sid, { ...base.stories.get(sid)!, blocks }) };
}

describe('layout dispatches blocks through the registry', () => {
  test('a paragraph lays out as positioned text items via its registered handler', () => {
    const model = modelWith([{ kind: 'paragraph', id: 'p', runs: [{ text: 'hello world' }] }]);
    const layout = layoutBody(model, opts());
    const texts = layout.pages.flatMap((pg) => pg.items).filter((i) => i.type === 'text');
    expect(texts.map((t) => (t as { text: string }).text)).toEqual(['hello', 'world']);
    expect(texts.every((t) => (t as { anchor: { paragraphId: string } }).anchor.paragraphId === 'p')).toBe(true);
  });

  test('a transparent SDT lays out its nested blocks in place (recurses through the registry)', () => {
    const model = modelWith([
      { kind: 'sdt', id: 's', props: {}, blocks: [{ kind: 'paragraph', id: 'inner', runs: [{ text: 'nested' }] }] },
    ]);
    const layout = layoutBody(model, opts());
    const texts = layout.pages.flatMap((pg) => pg.items).filter((i) => i.type === 'text');
    expect(texts.map((t) => (t as { text: string }).text)).toEqual(['nested']);
  });

  test('registering a duplicate handler for a kind is rejected', () => {
    expect(() => registerBlockLayout('paragraph', () => {})).toThrow(/duplicate block layout handler/);
  });

  test('an unregistered block kind fails closed rather than being silently skipped', () => {
    const model = modelWith([{ kind: 'mystery' } as unknown as Block]);
    expect(() => layoutBody(model, opts())).toThrow(/no block layout handler registered/);
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
      registerCoreBlockCapability({ kind: 'callout' as Block['kind'], editPolicy: { topLevelEditable: false } });
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
      registerCoreBlockCapability({ kind: 'callout' as Block['kind'], editPolicy: { topLevelEditable: false } });
      const paraOnly = modelWith([{ kind: 'paragraph', id: 'p2', runs: [{ text: 'y' }] }]);
      expect(() => layoutBody(paraOnly, opts())).toThrow(/layout lane incomplete[\s\S]*callout/);
    } finally {
      restoreBlockRegistryForTest(snap);
    }
    expect(() => layoutBody(modelWith([{ kind: 'paragraph', id: 'p3', runs: [{ text: 'z' }] }]), opts())).not.toThrow();
  });
});
