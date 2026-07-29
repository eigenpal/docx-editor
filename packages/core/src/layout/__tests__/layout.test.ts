// Deterministic layout + display-list tests (document-engine section 8 core,
// gate 9). Verifies anchored DisplayItem[] emission, line wrapping, pagination by
// height, and byte-identical output across repeated ("cross-runtime") runs.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  FontResolutionError,
  LayoutOperationRestartError,
  createFontResourceSnapshot,
  createHarfBuzzTextShaper,
  harfBuzzFontValidator,
  layoutBody,
  hitTest,
  type LayoutOptions,
  type TextItem,
} from '../index.ts';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  fingerprint,
  type ParagraphRecord,
} from '@docx-editor.dev/core-contract/store';
import { createHarfBuzzLayoutOptions } from './fixtures/layout-shaping.ts';
import { shapedRunComparatorInputs } from '../shaped-run.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;

function opts(over: Partial<LayoutOptions> = {}): LayoutOptions {
  return { ...createHarfBuzzLayoutOptions(), ...over };
}

function optionsAtResourceEpoch(
  epoch: number,
  options: { changeRegularBytes?: boolean } = {}
): LayoutOptions {
  const base = createHarfBuzzLayoutOptions();
  const regularRequest = { family: 'DejaVu Sans', weight: 400, style: 'normal' as const };
  const boldRequest = { family: 'DejaVu Sans', weight: 700, style: 'normal' as const };
  const regular = base.shaping.fonts.resolve(regularRequest);
  const bold = base.shaping.fonts.resolve(boldRequest);
  if (regular instanceof FontResolutionError || bold instanceof FontResolutionError) {
    throw new Error('expected fixture fonts');
  }
  const regularSource = options.changeRegularBytes ? bold : regular;
  const fonts = createFontResourceSnapshot({
    epoch,
    maxFontBytes: 2_000_000,
    resources: [
      {
        request: regularRequest,
        id: options.changeRegularBytes ? 'dejavu-sans-regular-changed' : regular.id,
        bytes: regularSource.bytes,
        hash: regularSource.hash,
        faceIndex: regularSource.faceIndex,
      },
      {
        request: boldRequest,
        id: bold.id,
        bytes: bold.bytes,
        hash: bold.hash,
        faceIndex: bold.faceIndex,
      },
    ],
    validateFont: harfBuzzFontValidator,
  });
  return {
    ...base,
    shaping: {
      ...base.shaping,
      fonts,
      operation: { ...base.shaping.operation, resourceEpoch: epoch },
    },
  };
}

function modelWith(paragraphs: string[]) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const p1 = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: p1, text: paragraphs[0] }));
  for (let i = 1; i < paragraphs.length; i++) {
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const pid = r.ok ? r.modelChange.created[0] : '';
    store.transact(HUMAN, (c) =>
      c.apply({ op: 'insertText', paragraphId: pid, text: paragraphs[i] })
    );
  }
  return store.currentModel;
}

function modelWithRuns(runs: ParagraphRecord['runs']) {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const paragraphId = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (commands) =>
    commands.apply({ op: 'setParagraphRuns', paragraphId, runs })
  );
  return store.currentModel;
}

describe('display-list emission', () => {
  test('emits anchored text items with fixed-point geometry', () => {
    const result = layoutBody(modelWith(['Hello world']), opts());
    const textItems = result.pages[0]!.items.filter((item) => item.type === 'text');
    // Grouping is per visual line per style, so one unstyled line is ONE item and the
    // space between the words is part of its text rather than a gap between two items.
    expect(textItems).toHaveLength(1);
    expect(textItems[0]).toMatchObject({
      type: 'text',
      text: 'Hello world',
      x: 1440,
      y: 1440,
      line: expect.any(Object),
    });
    expect(textItems[0].anchor).toMatchObject({ paragraphId: expect.any(String), offset: 0 });
    expect(Number.isInteger(textItems[0]!.x)).toBe(true); // integer geometry
    const caretEdges = result.pages[0]!.items.filter((item) => item.type === 'caretEdge');
    expect(caretEdges.length).toBeGreaterThan(0);
  });

  test('long text wraps to new lines within a page', () => {
    // Many words on a narrow page force multiple lines.
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const result = layoutBody(modelWith([words]), opts({ pageWidth: 4000 }));
    const ys = new Set(result.pages[0].items.map((i) => i.y));
    expect(ys.size).toBeGreaterThan(1); // wrapped onto multiple lines
  });

  test('content taller than one page paginates', () => {
    const many = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const result = layoutBody(modelWith(many), opts());
    expect(result.pages.length).toBeGreaterThan(1);
    expect(result.status).toBe('converged');
  });
});

describe('cross-runtime determinism (gate 9)', () => {
  test('the same model + ports yield byte-identical pages every run', () => {
    const model = modelWith(['The quick brown fox', 'jumps over the lazy dog']);
    const a = layoutBody(model, opts());
    const b = layoutBody(model, opts());
    // Exact display-list fingerprints match (this is what browser/worker/server compare).
    expect(fingerprint('paginationFingerprint', a)).toBe(fingerprint('paginationFingerprint', b));
    expect(a).toEqual(b);
  });

  test('geometry is exact — a text change alters the fingerprint', () => {
    const base = fingerprint('paginationFingerprint', layoutBody(modelWith(['abc']), opts()));
    const changed = fingerprint('paginationFingerprint', layoutBody(modelWith(['abcd']), opts()));
    expect(changed).not.toBe(base);
  });
});

describe('hit-testing from the display list (8.9)', () => {
  test('a point over a word resolves to its anchor + refined offset', () => {
    const result = layoutBody(modelWith(['Hello world']), opts());
    const textItems = result.pages[0]!.items.filter((item) => item.type === 'text');
    // Address the WORD, not an item index: "Hello world" is now one grouped item, so
    // "world" is an offset inside it rather than `textItems[1]`.
    const line = textItems[0]!;
    const worldOffset = line.text.indexOf('world');
    const worldCluster = line.shapedRun.clusters.find(
      (cluster) => cluster.textStart === worldOffset
    );
    if (!worldCluster) throw new Error('expected world cluster');
    const worldX =
      line.x +
      line.shapedRun.clusters
        .filter((cluster) => cluster.textEnd <= worldCluster.textStart)
        .reduce((width, cluster) => width + cluster.advance, 0);
    // A point inside "world" resolves back to its paragraph + offset 6.
    const anchor = hitTest(result, 0, worldX + 1, line.y + 10);
    expect(anchor).toMatchObject({ offset: 6 });
    // A point in empty space returns nothing.
    expect(hitTest(result, 0, 100000, 100000)).toBeUndefined();
  });
});

describe('shaped-span production layout', () => {
  test('contains no character-advance production path', () => {
    for (const file of [
      '../metrics.ts',
      '../paragraph-layout.ts',
      '../layout.ts',
      '../horizontal-boundary.ts',
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).not.toMatch(/MetricsPort|HelveticaMetrics|\.advance\s*\(/);
    }
  });

  test('rejects a font snapshot outside the captured operation epoch', () => {
    const options = createHarfBuzzLayoutOptions();
    expect(() =>
      layoutBody(modelWith(['epoch']), {
        ...options,
        shaping: {
          ...options.shaping,
          operation: {
            ...options.shaping.operation,
            resourceEpoch: options.shaping.fonts.epoch + 1,
          },
        },
      })
    ).toThrow(LayoutOperationRestartError);
  });

  test('uses complete-span kerning for item width and carries the exact shaped run', () => {
    const result = layoutBody(modelWith(['AV']), createHarfBuzzLayoutOptions());
    const item = result.pages[0]!.items.find((candidate) => candidate.type === 'text');
    if (item?.type !== 'text') throw new Error('expected text item');

    expect(item.shapedRun.text).toBe('AV');
    expect(item.width).toBe(
      item.shapedRun.glyphs.reduce((width, glyph) => width + glyph.advanceX, 0)
    );

    const a = layoutBody(modelWith(['A']), createHarfBuzzLayoutOptions()).pages[0]!.items.find(
      (candidate) => candidate.type === 'text'
    );
    const v = layoutBody(modelWith(['V']), createHarfBuzzLayoutOptions()).pages[0]!.items.find(
      (candidate) => candidate.type === 'text'
    );
    if (a?.type !== 'text' || v?.type !== 'text') throw new Error('expected text items');
    expect(item.width).toBeLessThan(a.width + v.width);
  });

  test('publishes no caret or hit boundary inside a combining sequence', () => {
    const result = layoutBody(modelWith(['x\u0301']), createHarfBuzzLayoutOptions());
    const edges = result.pages[0]!.items.filter((item) => item.type === 'caretEdge');
    expect(edges.map((edge) => edge.utf16Offset)).toEqual([0, 2]);

    const item = result.pages[0]!.items.find((candidate) => candidate.type === 'text');
    if (item?.type !== 'text') throw new Error('expected text item');
    expect(hitTest(result, 0, item.x + item.width - 1, item.y + 1)).toEqual({
      paragraphId: item.anchor.paragraphId,
      offset: 2,
    });
  });

  test('preserves authored composed and decomposed UTF-16 offsets when normalization is none', () => {
    const result = layoutBody(modelWith(['é e\u0301']), createHarfBuzzLayoutOptions());
    const item = result.pages[0]!.items.find((candidate) => candidate.type === 'text');
    if (item?.type !== 'text') throw new Error('expected text item');
    expect(item.shapedRun.text).toBe('é e\u0301');
    const edges = result.pages[0]!.items.filter((candidate) => candidate.type === 'caretEdge').map(
      (edge) => edge.utf16Offset
    );
    expect(edges).toEqual([0, 1, 2, 4]);
    expect(hitTest(result, 0, item.x + item.width - 1, item.y + 1)?.offset).toBe(4);
  });

  test('rejects normalization without an authored-to-normalized offset map', () => {
    const options = createHarfBuzzLayoutOptions();
    try {
      layoutBody(modelWith(['e\u0301']), {
        ...options,
        shaping: {
          ...options.shaping,
          environment: { ...options.shaping.environment, normalization: 'NFC' },
        },
      });
      throw new Error('expected normalization rejection');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'LayoutNormalizationError',
        code: 'unsupportedNormalization',
        normalization: 'NFC',
      });
    }
  });

  test('reshapes style spans on both sides of a contextual wrap', () => {
    const options = createHarfBuzzLayoutOptions({ pageWidth: 3380 });
    const shapedTexts: string[] = [];
    const shaper = options.shaping.shaper;
    const result = layoutBody(modelWith(['AV AV']), {
      ...options,
      shaping: {
        ...options.shaping,
        shaper: {
          shape(input) {
            shapedTexts.push(input.text);
            return shaper.shape(input);
          },
        },
      },
    });
    const text = result.pages[0]!.items.filter((item) => item.type === 'text').map(
      (item) => item.text
    );
    expect(text).toEqual(['AV ', 'AV']);
    expect(shapedTexts).toContain('AV AV');
    expect(shapedTexts).toContain('AV ');
    expect(shapedTexts).toContain('AV');
  });

  test('uses the supported RTL direction for shaping, caret edges, and hit testing', () => {
    const result = layoutBody(modelWith(['سلام']), createHarfBuzzLayoutOptions());
    const item = result.pages[0]!.items.find((candidate) => candidate.type === 'text');
    if (item?.type !== 'text') throw new Error('expected text item');
    expect(item.shapedRun.direction).toBe('rtl');
    const edges = result.pages[0]!.items.filter((candidate) => candidate.type === 'caretEdge').sort(
      (left, right) => left.x - right.x
    );
    expect(edges[0]!.utf16Offset).toBe(4);
    expect(edges.at(-1)!.utf16Offset).toBe(0);
    expect(hitTest(result, 0, item.x + 1, item.y + 1)?.offset).toBe(4);
  });

  test('wraps pure RTL text on logical cluster boundaries with exact visual hit edges', () => {
    const result = layoutBody(
      modelWith(['سلامسلام']),
      createHarfBuzzLayoutOptions({ pageWidth: 3200 })
    );
    const items = result.pages.flatMap((page) =>
      page.items.filter(
        (item): item is Extract<typeof item, { type: 'text' }> => item.type === 'text'
      )
    );
    expect(items.length).toBeGreaterThan(1);
    expect(items.map((item) => item.text).join('')).toBe('سلامسلام');
    for (const item of items) {
      const left = hitTest(result, 0, item.x + 1, item.y + 1);
      const right = hitTest(result, 0, item.x + item.width - 1, item.y + 1);
      expect(left?.offset).toBe(item.anchor.offset + item.text.length);
      expect(right?.offset).toBe(item.anchor.offset);
      const offsets = result.pages[0]!.items.filter(
        (edge) =>
          edge.type === 'caretEdge' &&
          edge.line.lineId === item.line.lineId &&
          edge.utf16Offset >= item.anchor.offset &&
          edge.utf16Offset <= item.anchor.offset + item.text.length
      )
        .sort((a, b) => a.x - b.x)
        .map((edge) => (edge.type === 'caretEdge' ? edge.utf16Offset : -1));
      expect(offsets[0]).toBe(item.anchor.offset + item.text.length);
      expect(offsets.at(-1)).toBe(item.anchor.offset);
    }
  });

  test('uses pinned bidi levels and visual runs for mixed-direction paragraphs', () => {
    const result = layoutBody(modelWith(['abc אבג']), createHarfBuzzLayoutOptions());
    const items = result.pages[0]!.items.filter((item) => item.type === 'text');
    expect(items.map((item) => [item.text, item.shapedRun.direction])).toEqual([
      ['abc ', 'ltr'],
      ['אבג', 'rtl'],
    ]);
    expect(items[0]!.x + items[0]!.width).toBe(items[1]!.x);
    expect(hitTest(result, 0, items[0]!.x + 1, items[0]!.y + 1)?.offset).toBe(0);
    expect(hitTest(result, 0, items[1]!.x + 1, items[1]!.y + 1)?.offset).toBe(7);
    const boundary = result.pages[0]!.items.filter(
      (item) => item.type === 'caretEdge' && item.utf16Offset === 4
    );
    expect(new Set(boundary.map((edge) => edge.affinity))).toEqual(
      new Set(['upstream', 'downstream'])
    );

    const rtlBase = layoutBody(modelWith(['אבג abc']), createHarfBuzzLayoutOptions());
    const rtlBaseItems = rtlBase.pages[0]!.items.filter((item) => item.type === 'text');
    expect(rtlBaseItems.map((item) => [item.text, item.shapedRun.direction])).toEqual([
      ['abc', 'ltr'],
      ['אבג ', 'rtl'],
    ]);
    expect(hitTest(rtlBase, 0, rtlBaseItems[0]!.x + 1, rtlBaseItems[0]!.y + 1)?.offset).toBe(4);
    expect(hitTest(rtlBase, 0, rtlBaseItems[1]!.x + 1, rtlBaseItems[1]!.y + 1)?.offset).toBe(4);
  });

  test('preserves an exact nested isolate level above parity through shaping and text IR', () => {
    const text = 'a\u2067אב\u2066cd\u2069ג\u2069z';
    const options = createHarfBuzzLayoutOptions();
    const result = layoutBody(modelWith([text]), options);
    const nested = result.pages
      .flatMap((page) => page.items)
      .find((item): item is TextItem => item.type === 'text' && item.text === 'cd');
    if (!nested) throw new Error('expected nested isolate text item');
    expect(nested.bidiLevel).toBe(2);
    expect(nested.direction).toBe('ltr');
    expect(nested.shapedRun.bidiLevel).toBe(2);
    expect(
      shapedRunComparatorInputs(nested.shapedRun, {
        ...options.shaping.environment,
        font: nested.shapedRun.fontSpans[0]!.font,
        direction: nested.direction,
        script: 'Latn',
        fallbackOrder: [],
      }).bidiLevel
    ).toBe(2);
  });

  test('chooses the furthest legal prefix whose contextual reshaping fits', () => {
    const options = createHarfBuzzLayoutOptions({ pageWidth: 3130 });
    const base = options.shaping.shaper;
    const result = layoutBody(modelWith(['abcd']), {
      ...options,
      shaping: {
        ...options.shaping,
        shaper: {
          shape(input) {
            const run = base.shape(input);
            if (input.text !== 'ab' && input.text !== 'abc') return run;
            const advance = input.text === 'ab' ? 100 : 80;
            return {
              ...run,
              glyphs: run.glyphs.map((glyph) => ({
                ...glyph,
                advanceX: advance as typeof glyph.advanceX,
              })),
              clusters: run.clusters.map((cluster) => ({
                ...cluster,
                advance: advance as typeof cluster.advance,
                caretEdges: [0, advance] as typeof cluster.caretEdges,
              })),
            };
          },
        },
      },
    });
    const lines = result.pages[0]!.items.filter((item) => item.type === 'text');
    expect(lines.map((item) => item.text)).toEqual(['abc', 'd']);
  });

  test('aborts with a typed restart when operation inputs drift during shaping', () => {
    const options = createHarfBuzzLayoutOptions();
    let configEpoch = options.shaping.operation.configEpoch;
    const operation = {
      ...options.shaping.operation,
      get configEpoch() {
        return configEpoch;
      },
    };
    const base = options.shaping.shaper;
    try {
      layoutBody(modelWith(['drift']), {
        ...options,
        shaping: {
          ...options.shaping,
          operation,
          shaper: {
            shape(input) {
              const run = base.shape(input);
              configEpoch += 1;
              return run;
            },
          },
        },
      });
      throw new Error('expected operation restart');
    } catch (error) {
      expect(error).toBeInstanceOf(LayoutOperationRestartError);
      expect((error as LayoutOperationRestartError).changed).toContain('configEpoch');
    }
  });

  test('resource epoch drift restarts in-flight work without contaminating reusable item fingerprints', () => {
    const options = createHarfBuzzLayoutOptions();
    let resourceEpoch = options.shaping.operation.resourceEpoch;
    const operation = {
      ...options.shaping.operation,
      get resourceEpoch() {
        return resourceEpoch;
      },
    };
    const baseShaper = options.shaping.shaper;
    expect(() =>
      layoutBody(modelWith(['restart']), {
        ...options,
        shaping: {
          ...options.shaping,
          operation,
          shaper: {
            shape(input) {
              const run = baseShaper.shape(input);
              resourceEpoch += 1;
              return run;
            },
          },
        },
      })
    ).toThrow(LayoutOperationRestartError);

    const regularModel = modelWithRuns([{ text: 'regular' }]);
    const boldModel = modelWithRuns([{ text: 'bold', props: { bold: true } }]);
    const first = optionsAtResourceEpoch(1);
    const identicalRestart = optionsAtResourceEpoch(2);
    const changedRegular = optionsAtResourceEpoch(3, { changeRegularBytes: true });
    const itemFingerprint = (model: ReturnType<typeof modelWithRuns>, layout: LayoutOptions) => {
      const item = layoutBody(model, layout)
        .pages.flatMap((page) => page.items)
        .find((candidate): candidate is TextItem => candidate.type === 'text');
      if (!item) throw new Error('expected text item');
      return item.shapingFingerprint;
    };

    expect(itemFingerprint(regularModel, identicalRestart)).toBe(
      itemFingerprint(regularModel, first)
    );
    expect(itemFingerprint(boldModel, identicalRestart)).toBe(itemFingerprint(boldModel, first));
    expect(itemFingerprint(regularModel, changedRegular)).not.toBe(
      itemFingerprint(regularModel, first)
    );
    expect(itemFingerprint(boldModel, changedRegular)).toBe(itemFingerprint(boldModel, first));
  });

  test('a one-paragraph edit reuses unchanged paragraph shapes and only reshapes changed text', () => {
    const base = createHarfBuzzLayoutOptions();
    const counters = { calls: 0, hits: 0 };
    const shaper = createHarfBuzzTextShaper({
      instrumentation: {
        onShapeCall: () => (counters.calls += 1),
        onShapeCacheEvent: ({ kind }) => {
          if (kind === 'hit') counters.hits += 1;
        },
      },
    });
    const options: LayoutOptions = {
      ...base,
      shaping: { ...base.shaping, shaper },
    };
    try {
      layoutBody(modelWith(['stable paragraph', 'edited paragraph']), options);
      const firstPassCalls = counters.calls;
      layoutBody(modelWith(['stable paragraph', 'changed paragraph']), options);
      const secondPassCalls = counters.calls - firstPassCalls;

      expect(firstPassCalls).toBeGreaterThan(0);
      expect(secondPassCalls).toBeGreaterThan(0);
      expect(secondPassCalls).toBeLessThan(firstPassCalls);
      expect(counters.hits).toBeGreaterThan(0);
    } finally {
      shaper.dispose();
    }
  });

  test('derives the operation shaping hash from actual environments instead of caller text', () => {
    const firstOptions = createHarfBuzzLayoutOptions();
    const secondOptions = createHarfBuzzLayoutOptions();
    const first = layoutBody(modelWith(['hash']), {
      ...firstOptions,
      shaping: {
        ...firstOptions.shaping,
        operation: { ...firstOptions.shaping.operation, shapingHash: 'caller-forgery-a' },
      },
    }) as ReturnType<typeof layoutBody> & { operation: { shapingHash: string } };
    const second = layoutBody(modelWith(['hash']), {
      ...secondOptions,
      shaping: {
        ...secondOptions.shaping,
        operation: { ...secondOptions.shaping.operation, shapingHash: 'caller-forgery-b' },
      },
    }) as ReturnType<typeof layoutBody> & { operation: { shapingHash: string } };
    expect(first.operation.shapingHash).not.toBe('caller-forgery-a');
    expect(first.operation.shapingHash).toBe(second.operation.shapingHash);

    const changedOptions = createHarfBuzzLayoutOptions();
    const changed = layoutBody(modelWith(['hash']), {
      ...changedOptions,
      shaping: {
        ...changedOptions.shaping,
        environment: {
          ...changedOptions.shaping.environment,
          features: { ...changedOptions.shaping.environment.features, kern: 0 },
        },
      },
    }) as ReturnType<typeof layoutBody> & { operation: { shapingHash: string } };
    expect(changed.operation.shapingHash).not.toBe(first.operation.shapingHash);

    const substituted = layoutBody(
      modelWithRuns([{ text: 'hash', props: { fonts: { ascii: 'Missing' } } }]),
      createHarfBuzzLayoutOptions()
    );
    expect(substituted.operation.shapingHash).not.toBe(first.operation.shapingHash);
  });

  test('aborts when an actual shaping input drifts without caller snapshot drift', () => {
    const options = createHarfBuzzLayoutOptions();
    const features = { ...options.shaping.environment.features };
    const base = options.shaping.shaper;
    try {
      layoutBody(modelWith(['drift']), {
        ...options,
        shaping: {
          ...options.shaping,
          environment: { ...options.shaping.environment, features },
          shaper: {
            shape(input) {
              const run = base.shape(input);
              features.kern = 0;
              return run;
            },
          },
        },
      });
      throw new Error('expected actual shaping input restart');
    } catch (error) {
      expect(error).toBeInstanceOf(LayoutOperationRestartError);
      expect((error as LayoutOperationRestartError).changed).toContain('shapingHash');
    }
  });

  test('publishes baseline metrics and uses the tallest face for caret geometry', () => {
    const options = createHarfBuzzLayoutOptions();
    const base = options.shaping.shaper;
    const result = layoutBody(
      modelWithRuns([{ text: 'regular' }, { text: 'bold', props: { bold: true } }]),
      {
        ...options,
        shaping: {
          ...options.shaping,
          shaper: {
            shape(input) {
              const run = base.shape(input);
              if (input.environment.font.request.weight !== 700) return run;
              return {
                ...run,
                metrics: {
                  ascent: 300 as typeof run.metrics.ascent,
                  descent: 100 as typeof run.metrics.descent,
                  lineGap: 40 as typeof run.metrics.lineGap,
                },
              };
            },
          },
        },
      }
    );
    const items = result.pages[0]!.items.filter((item) => item.type === 'text');
    expect(items[0]).toMatchObject({ ascent: expect.any(Number), descent: expect.any(Number) });
    expect(items[1]).toMatchObject({
      ascent: 300,
      descent: 100,
      lineGap: 40,
      baseline: items[0]!.y + 300,
    });
    const carets = result.pages[0]!.items.filter((item) => item.type === 'caretEdge');
    expect(new Set(carets.map((caret) => caret.y))).toEqual(new Set([items[0]!.y]));
    expect(new Set(carets.map((caret) => caret.height))).toEqual(new Set([440]));
    expect(new Set(carets.map((caret) => caret.baseline))).toEqual(new Set([items[0]!.y + 300]));
    expect(new Set(carets.map((caret) => caret.ascent))).toEqual(new Set([300]));
    expect(new Set(carets.map((caret) => caret.descent))).toEqual(new Set([100]));
    expect(new Set(carets.map((caret) => caret.lineGap))).toEqual(new Set([40]));
  });
});
