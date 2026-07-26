import { expect, test, type Browser, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import { bodyStoryId, parseDocx } from '@docx-editor.dev/engine-core';
import {
  FIDELITY_DOCUMENT_XML,
  FIDELITY_STYLES_XML,
  FIDELITY_THEME_XML,
  createHarfBuzzTextFidelityDocx,
} from './fixtures/generate-harfbuzz-text-fidelity-fixture.ts';
import {
  FIDELITY_FONT_HASHES,
  FIDELITY_PAGE_SUMMARY,
  FIDELITY_RESOLVED,
  FIDELITY_SHAPES,
} from './fixtures/harfbuzz-fidelity-expected.ts';

const FIXTURE = 'harfbuzz-text-fidelity.docx';
const ADAPTERS = [
  { name: 'react', url: 'http://localhost:5273' },
  { name: 'vue', url: 'http://localhost:5274' },
] as const;

const parsedFixture = parseDocx(createHarfBuzzTextFidelityDocx(), { preserveAll: true });
if (!parsedFixture.ok) throw new Error(`failed to parse fidelity fixture: ${parsedFixture.reason}`);
const canonicalStoryId = bodyStoryId(parsedFixture.model);
const canonicalFirstBlock = parsedFixture.model.stories.get(canonicalStoryId)?.blocks[0];
if (!canonicalFirstBlock) throw new Error('fidelity fixture has no first body block');
const CANONICAL_FIRST_PARAGRAPH = {
  storyId: canonicalStoryId,
  blockId: canonicalFirstBlock.id,
};

declare global {
  interface Window {
    __docxAdapterEditor?: Editor;
    __docxAdapterHarness?: {
      setZoom(zoom: number): void;
      getZoom(): number;
    };
  }
}

async function mount(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/?realAdapter=1&fixture=${FIXTURE}`);
  await page.waitForFunction(() => !!window.__docxAdapterEditor);
  await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function acrossAdapters<T>(
  browser: Browser,
  scenario: (page: Page) => Promise<T>
): Promise<Record<(typeof ADAPTERS)[number]['name'], T>> {
  const results = {} as Record<(typeof ADAPTERS)[number]['name'], T>;
  for (const adapter of ADAPTERS) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await mount(page, adapter.url);
    results[adapter.name] = await scenario(page);
    await context.close();
  }
  return results;
}

async function fidelitySnapshot(page: Page) {
  return page.evaluate(() => {
    const frame = window.__docxAdapterEditor!.getInteractionFrame();
    const runs = frame.display.flatMap((page) =>
      page.items.flatMap((item) =>
        item.kind === 'text'
          ? item.runs.map((run) => ({
              pageIndex: page.index,
              text: run.text,
              box: run.box,
              family: run.fontFamily,
              hash: run.font.hash,
              request: run.font.request,
              substitution: run.font.substitution,
              size: run.fontSizeHalfPoints,
              color: run.color,
              bold: run.bold,
              italic: run.italic,
              fontSizePx: run.fontSizePx,
              shaping: run.shaping,
              glyphs: run.glyphs,
              clusters: run.clusters,
              bidiLevel: run.bidiLevel,
              verticalMetrics: run.verticalMetrics,
            }))
          : []
      )
    );
    const lineBreaks = frame.display.flatMap((page) => {
      const lines = new Map<
        number,
        {
          text: string;
          slices: {
            identity: { storyId: string; blockId: string };
            utf16From: number;
            utf16To: number;
          }[];
        }
      >();
      for (const item of page.items) {
        if (item.kind !== 'text') continue;
        const line = lines.get(item.box.y) ?? { text: '', slices: [] };
        line.text += item.runs.map((run) => run.text).join('');
        line.slices.push({
          identity: item.semantic.identity,
          utf16From: item.semantic.utf16From,
          utf16To: item.semantic.utf16To,
        });
        lines.set(item.box.y, line);
      }
      return [...lines.entries()].map(([y, line]) => ({ pageIndex: page.index, y, ...line }));
    });
    return {
      pages: frame.display.length,
      pageBoxes: frame.display.map((page) => page.box),
      runs,
      lineBreaks,
    };
  });
}

test.describe('paired HarfBuzz fidelity gate', () => {
  test('resolves, shapes, lays out, paints, and reopens identically', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const before = await fidelitySnapshot(page);
      const fontPaint = await page.locator('[data-doc-from]').evaluateAll((elements) =>
        elements.map((element) => {
          const node = element as HTMLElement;
          const paths = [...node.querySelectorAll('svg[aria-hidden="true"] path')].map((path) => ({
            d: path.getAttribute('d'),
            transform: path.getAttribute('transform'),
            fill: path.getAttribute('fill'),
          }));
          node.style.fontFamily = 'serif';
          const afterCssFontChange = [
            ...node.querySelectorAll('svg[aria-hidden="true"] path'),
          ].map((path) => ({
            d: path.getAttribute('d'),
            transform: path.getAttribute('transform'),
            fill: path.getAttribute('fill'),
          }));
          return {
            text: node.textContent ?? '',
            box: {
              x: Number.parseFloat(node.style.left),
              y: Number.parseFloat(node.style.top),
              width: Number.parseFloat(node.style.width),
              height: Number.parseFloat(node.style.height),
            },
            paths,
            afterCssFontChange,
            semanticWidth: (node.querySelector('span') as HTMLElement | null)?.style.width,
          };
        })
      );

      const saved = await page.evaluate(
        async () => new Uint8Array(await window.__docxAdapterEditor!.save())
      );
      await page.evaluate(
        (bytes) => window.__docxAdapterEditor!.load(new Uint8Array(bytes)),
        [...saved]
      );
      await expect.poll(() => fidelitySnapshot(page)).toEqual(before);

      return { before, after: await fidelitySnapshot(page), fontPaint };
    });

    expect(results.vue).toEqual(results.react);
    expect(results.react.after).toEqual(results.react.before);
    expect(results.react.before.pages).toBe(2);
    expect(
      results.react.before.lineBreaks
        .filter(({ pageIndex }) => pageIndex === 0)
        .map(({ text }) => text)
    ).toEqual([
      'AVBoldAVItalicDirectFace',
      'InheritedCharacter',
      'Major heading',
      'Minor heading',
      'سلام',
      ...Array.from(
        { length: 39 },
        (_, index) =>
          `Wrapping line ${String(index + 1).padStart(2, '0')} with AV office glyph clusters and fixed vertical metrics.`
      ),
    ]);
    expect(
      results.react.before.lineBreaks
        .filter(({ pageIndex }) => pageIndex === 1)
        .map(({ text }) => text)
    ).toEqual(
      Array.from(
        { length: 9 },
        (_, index) =>
          `Wrapping line ${String(index + 40).padStart(2, '0')} with AV office glyph clusters and fixed vertical metrics.`
      )
    );

    const runs = results.react.before.runs;
    const regular = runs.find((run) => run.text === 'AV');
    const bold = runs.find((run) => run.text === 'BoldAV');
    const italic = runs.find((run) => run.text === 'Italic');
    const direct = runs.find((run) => run.text === 'DirectFace');
    const inherited = runs.find((run) => run.text === 'InheritedCharacter');
    const major = runs.find((run) => run.text === 'Major heading');
    const minor = runs.find((run) => run.text === 'Minor heading');
    const properties = (run: (typeof runs)[number] | undefined) => ({
      family: run?.family,
      request: run?.request,
      substitution: run?.substitution,
      size: run?.size,
      color: run?.color,
      bold: run?.bold,
      italic: run?.italic,
    });
    const normal = { family: 'DejaVu Sans', weight: 400, style: 'normal' };
    const boldNormal = { family: 'DejaVu Sans', weight: 700, style: 'normal' };
    expect({
      regular: properties(regular),
      bold: properties(bold),
      italic: properties(italic),
      direct: properties(direct),
      inherited: properties(inherited),
      major: properties(major),
      minor: properties(minor),
    }).toEqual({
      regular: {
        ...FIDELITY_RESOLVED.regular,
        substitution: null,
      },
      bold: {
        ...FIDELITY_RESOLVED.bold,
        substitution: null,
      },
      italic: {
        family: 'DejaVu Sans',
        request: normal,
        substitution: {
          requested: { family: 'DejaVu Sans', weight: 400, style: 'italic' },
          resolved: normal,
        },
        size: 22,
        color: { kind: 'hex', value: '0066CC' },
        bold: false,
        italic: true,
      },
      direct: {
        family: 'DejaVu Sans',
        request: normal,
        substitution: {
          requested: { family: 'Declared Missing', weight: 400, style: 'normal' },
          resolved: normal,
        },
        size: 24,
        color: { kind: 'hex', value: '202020' },
        bold: false,
        italic: false,
      },
      inherited: {
        family: 'DejaVu Sans',
        request: boldNormal,
        substitution: {
          requested: { family: 'DejaVu Sans', weight: 700, style: 'italic' },
          resolved: boldNormal,
        },
        size: 30,
        color: { kind: 'hex', value: '202020' },
        bold: true,
        italic: true,
      },
      major: {
        ...FIDELITY_RESOLVED.major,
        substitution: {
          requested: { family: 'Cambria', weight: 700, style: 'normal' },
          resolved: boldNormal,
        },
      },
      minor: {
        ...FIDELITY_RESOLVED.minor,
        substitution: {
          requested: { family: 'Calibri', weight: 400, style: 'normal' },
          resolved: normal,
        },
      },
    });
    expect({
      regular: {
        glyphs: regular?.glyphs.map(({ id, cluster, advanceX }) => [id, cluster, advanceX]),
        clusters: regular?.clusters.map(({ utf16From, utf16To, advance }) => [
          utf16From,
          utf16To,
          advance,
        ]),
        box: regular?.box,
        metrics: regular?.verticalMetrics,
      },
      bold: {
        glyphs: bold?.glyphs.map(({ id, cluster, advanceX }) => [id, cluster, advanceX]),
        clusters: bold?.clusters.map(({ utf16From, utf16To, advance }) => [
          utf16From,
          utf16To,
          advance,
        ]),
        box: bold?.box,
        metrics: bold?.verticalMetrics,
      },
    }).toEqual({
      regular: {
        glyphs: [
          [36, 0, 149],
          [57, 1, 164],
        ],
        clusters: [
          [0, 1, 149],
          [1, 2, 164],
        ],
        box: { x: 96, y: 96, width: 20.866666666666667, height: 21.733333333333334 },
        metrics: { ascent: 223, descent: 57, lineGap: 0, baseline: 113.33333333333333 },
      },
      bold: {
        glyphs: [
          [37, 0, 213],
          [82, 1, 192],
          [79, 2, 96],
          [71, 3, 200],
          [36, 4, 198],
          [57, 5, 217],
        ],
        clusters: [
          [0, 1, 213],
          [1, 2, 192],
          [2, 3, 96],
          [3, 4, 200],
          [4, 5, 198],
          [5, 6, 217],
        ],
        box: { x: 116.86666666666666, y: 96, width: 74.4, height: 21.733333333333334 },
        metrics: { ascent: 260, descent: 66, lineGap: 0, baseline: 113.33333333333333 },
      },
    });

    const rtl = runs.find((run) => run.text === 'سلام');
    expect({
      glyphs: rtl?.glyphs.map(({ id, cluster, advanceX }) => [id, cluster, advanceX]),
      clusters: rtl?.clusters.map(({ utf16From, utf16To, advance }) => [
        utf16From,
        utf16To,
        advance,
      ]),
      bidiLevel: rtl?.bidiLevel,
      metrics: rtl?.verticalMetrics,
    }).toEqual({
      glyphs: [
        [1390, 3, 149],
        [5366, 1, 143],
        [5293, 0, 201],
      ],
      clusters: [
        [3, 4, 149],
        [1, 3, 143],
        [0, 1, 201],
      ],
      bidiLevel: 1,
      metrics: { ascent: 223, descent: 57, lineGap: 0, baseline: 211.66666666666666 },
    });

    expect(results.react.fontPaint).toHaveLength(runs.length);
    for (const [index, painted] of results.react.fontPaint.entries()) {
      const ir = runs[index]!;
      expect(painted.text).toBe(ir.text);
      expect(painted.box.x).toBeCloseTo(ir.box.x, 2);
      expect(painted.box.y).toBeCloseTo(ir.box.y, 2);
      expect(painted.box.width).toBeCloseTo(ir.box.width, 2);
      expect(painted.box.height).toBeCloseTo(ir.box.height, 2);
      expect(painted.paths.map(({ d }) => d)).toEqual(
        ir.glyphs.map((glyph) => glyph.outline.path)
      );
      const fixedToPx = 4 / (3 * ir.shaping.fixedPointScale);
      const baseline = ir.verticalMetrics.baseline - ir.box.y;
      expect(painted.paths.map(({ transform }) => transform)).toEqual(
        ir.glyphs.map((glyph) => {
          const scale = ir.fontSizePx / glyph.outline.unitsPerEm;
          return `translate(${(glyph.originX + glyph.offsetX) * fixedToPx} ${
            baseline - (glyph.originY + glyph.offsetY) * fixedToPx
          }) scale(${scale} ${-scale})`;
        })
      );
      expect(painted.paths).toEqual(painted.afterCssFontChange);
      expect(painted.semanticWidth).toBe('1px');
    }
  });

  test('regular-bold boundary has exact identity and formatting-stable typing geometry', async ({
    browser,
  }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const before = await fidelitySnapshot(page);
      const observeCaret = () =>
        page.evaluate(() => {
          const editor = window.__docxAdapterEditor!;
          const caret = editor.getCaretClientRect();
          const frame = editor.getInteractionFrame();
          const metrics = editor.getInteractionHostMetrics();
          const ir = frame.caret
            ? {
                target: frame.selection?.head ?? null,
                rect: frame.caret.rect,
                frameId: frame.caret.frameId,
              }
            : null;
          const expectedClient =
            ir && metrics
              ? {
                  x: metrics.clientOrigin.x + (ir.rect.x - metrics.scrollOffset.x) * metrics.zoom,
                  y: metrics.clientOrigin.y + (ir.rect.y - metrics.scrollOffset.y) * metrics.zoom,
                  width: ir.rect.width * metrics.zoom,
                  height: ir.rect.height * metrics.zoom,
                }
              : null;
          return {
            caret,
            ir,
            expectedClient,
          };
        });
      const boundary = await page.evaluate(() => {
        const editor = window.__docxAdapterEditor!;
        const frame = editor.getInteractionFrame();
        const metrics = editor.getInteractionHostMetrics();
        if (!metrics) throw new Error('missing interaction host metrics');
        const runs = frame.display.flatMap((displayPage, pageIndex) =>
          displayPage.items.flatMap((item) =>
            item.kind === 'text' ? item.runs.map((run) => ({ run, pageIndex })) : []
          )
        );
        const regular = runs.find(({ run }) => run.text === 'AV')!;
        const bold = runs.find(({ run }) => run.text === 'BoldAV')!;
        const toClient = (pageIndex: number, point: { x: number; y: number }) => {
          const pageTop = frame.pageGeometry[pageIndex]!.box.y;
          return {
            x: metrics.clientOrigin.x + (point.x - metrics.scrollOffset.x) * metrics.zoom,
            y: metrics.clientOrigin.y + (pageTop + point.y - metrics.scrollOffset.y) * metrics.zoom,
          };
        };
        const regularSide = toClient(regular.pageIndex, {
          x: regular.run.box.x + regular.run.box.width - 1,
          y: regular.run.box.y + regular.run.box.height / 2,
        });
        const boldSide = toClient(bold.pageIndex, {
          x: bold.run.box.x + 1,
          y: bold.run.box.y + bold.run.box.height / 2,
        });
        // The fixture's exact HarfBuzz oracle gives the first A advance as 149 fixed-point units.
        // This point is therefore the fixture-known offset-1 caret, not an address obtained from
        // resolvePointer itself.
        const regularInsert = toClient(regular.pageIndex, {
          x: regular.run.box.x + 149 / 15,
          y: regular.run.box.y + regular.run.box.height / 2,
        });
        const summarize = (point: { x: number; y: number }) => {
          const outcome = editor.resolvePointer(point);
          if (!outcome.ok) return { ok: false, code: outcome.code };
          const target = outcome.value.target;
          return {
            ok: true,
            role: outcome.value.role,
            target:
              target.kind === 'text'
                ? {
                    kind: target.kind,
                    scope: target.scope,
                    identity: target.identity,
                    graphemeOffset: target.graphemeOffset,
                    affinity: target.affinity,
                  }
                : { kind: target.kind },
          };
        };
        return {
          regularSide,
          boldSide,
          regularInsert,
          regularHit: summarize(regularSide),
          boldHit: summarize(boldSide),
          insertHit: summarize(regularInsert),
        };
      });

      await page.mouse.click(boundary.boldSide.x, boundary.boldSide.y);
      const afterBoundaryClick = {
        ...(await page.evaluate(() => ({
          selection: window.__docxAdapterEditor!.getAccessibilityObservation().selection,
          text: window
            .__docxAdapterEditor!.getAccessibilityObservation()
            .entries.find((entry) => entry.role === 'editableParagraph')!.text,
        }))),
        ...(await observeCaret()),
      };
      await page.waitForTimeout(150);
      const afterBoundaryIdle = await observeCaret();

      await page.mouse.click(boundary.regularInsert.x, boundary.regularInsert.y);
      const afterClick = {
        ...(await page.evaluate(() => ({
          selection: window.__docxAdapterEditor!.getAccessibilityObservation().selection,
        }))),
        ...(await observeCaret()),
      };
      await page.waitForTimeout(150);
      const afterIdle = await observeCaret();
      await page.keyboard.type('X');
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window
                .__docxAdapterEditor!.getAccessibilityObservation()
                .entries.find((entry) => entry.role === 'editableParagraph')!.text
          )
        )
        .toBe('AXVBoldAVItalicDirectFace');
      const afterTyping = {
        ...(await page.evaluate(() => {
          const editor = window.__docxAdapterEditor!;
          const frame = editor.getInteractionFrame();
          const insertedRun = frame.display
            .flatMap((displayPage) => displayPage.items)
            .flatMap((item) => (item.kind === 'text' ? item.runs : []))
            .find((run) => run.text.includes('X'));
          return {
            selection: editor.getAccessibilityObservation().selection,
            text: editor
              .getAccessibilityObservation()
              .entries.find((entry) => entry.role === 'editableParagraph')!.text,
            insertedRun: insertedRun
              ? {
                  text: insertedRun.text,
                  request: insertedRun.font.request,
                  size: insertedRun.fontSizeHalfPoints,
                  color: insertedRun.color,
                  bold: insertedRun.bold,
                  italic: insertedRun.italic,
                }
              : null,
          };
        })),
        ...(await observeCaret()),
      };
      const afterTypingSnapshot = await fidelitySnapshot(page);
      await page.waitForTimeout(600);
      const afterTypingBlinkOne = await observeCaret();
      await page.waitForTimeout(600);
      const afterTypingBlinkTwo = await observeCaret();
      const stability: {
        label: string;
        immediate: Awaited<ReturnType<typeof observeCaret>>;
        settled: Awaited<ReturnType<typeof observeCaret>>;
      }[] = [];
      const recordSettled = async (label: string) => {
        const immediate = await observeCaret();
        await page.waitForTimeout(180);
        stability.push({ label, immediate, settled: await observeCaret() });
      };
      const paragraphText = () =>
        page.evaluate(
          () =>
            window
              .__docxAdapterEditor!.getAccessibilityObservation()
              .entries.find((entry) => entry.role === 'editableParagraph')!.text
        );

      const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
      const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';
      await page.keyboard.press(undo);
      await expect.poll(paragraphText).toBe('AVBoldAVItalicDirectFace');
      await recordSettled('undo');
      await page.keyboard.press(redo);
      await expect.poll(paragraphText).toBe('AXVBoldAVItalicDirectFace');
      await recordSettled('redo');

      for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
        await page.keyboard.press(key);
        await recordSettled(key);
      }
      await page.mouse.click(boundary.regularInsert.x, boundary.regularInsert.y);
      await recordSettled('repeated boundary click');

      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', {
        text: 'にほ',
        selectionStart: 2,
        selectionEnd: 2,
      });
      await recordSettled('IME composition');
      await cdp.send('Input.insertText', { text: 'にほん' });
      await expect.poll(paragraphText).toContain('にほん');
      await recordSettled('IME commit');
      await page.keyboard.press(undo);
      await expect.poll(paragraphText).toBe('AXVBoldAVItalicDirectFace');
      await recordSettled('IME undo');

      await page.evaluate(() => window.__docxAdapterHarness!.setZoom(1.25));
      await expect
        .poll(() =>
          page.evaluate(() => window.__docxAdapterEditor!.getInteractionHostMetrics()?.zoom)
        )
        .toBe(1.25);
      await recordSettled('zoom');
      await page.locator('[data-testid="docx-editor-scroll"]').evaluate((element) => {
        element.scrollTop = 48;
        element.dispatchEvent(new Event('scroll'));
      });
      await recordSettled('scroll');
      await page.evaluate(() => window.__docxAdapterHarness!.setZoom(1));
      await expect
        .poll(() =>
          page.evaluate(() => window.__docxAdapterEditor!.getInteractionHostMetrics()?.zoom)
        )
        .toBe(1);
      await recordSettled('zoom restore');

      const savedBytes = await page.evaluate(async () => [
        ...new Uint8Array(await window.__docxAdapterEditor!.save()),
      ]);
      await page.evaluate(
        (bytes) => window.__docxAdapterEditor!.load(new Uint8Array(bytes)),
        savedBytes
      );
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window
                .__docxAdapterEditor!.getAccessibilityObservation()
                .entries.find((entry) => entry.role === 'editableParagraph')!.text
          )
        )
        .toBe('AXVBoldAVItalicDirectFace');
      const reopenedSnapshot = await fidelitySnapshot(page);
      return {
        before,
        boundary,
        afterBoundaryClick,
        afterBoundaryIdle,
        afterClick,
        afterIdle,
        afterTyping,
        afterTypingSnapshot,
        afterTypingBlinkOne,
        afterTypingBlinkTwo,
        stability,
        reopenedSnapshot,
        savedBytes,
      };
    });

    const caretInvariant = (observation: (typeof results)['react']['afterTyping']) =>
      observation.ir ? { target: observation.ir.target, rect: observation.ir.rect } : null;
    const adapterInvariant = (result: (typeof results)['react']) => ({
      regularHit: result.boundary.regularHit,
      boldHit: result.boundary.boldHit,
      insertHit: result.boundary.insertHit,
      boundaryCaret: caretInvariant(result.afterBoundaryClick),
      boundaryIdleCaret: caretInvariant(result.afterBoundaryIdle),
      clickCaret: caretInvariant(result.afterClick),
      idleCaret: caretInvariant(result.afterIdle),
      typedCaret: caretInvariant(result.afterTyping),
      typedBlinkOneCaret: caretInvariant(result.afterTypingBlinkOne),
      typedBlinkTwoCaret: caretInvariant(result.afterTypingBlinkTwo),
      typedSelection: result.afterTyping.selection,
      insertedRun: result.afterTyping.insertedRun,
      stability: result.stability.map(({ label, immediate, settled }) => ({
        label,
        immediate: caretInvariant(immediate),
        settled: caretInvariant(settled),
      })),
      before: result.before,
      afterTypingSnapshot: result.afterTypingSnapshot,
      reopenedSnapshot: result.reopenedSnapshot,
    });
    expect(adapterInvariant(results.vue)).toEqual(adapterInvariant(results.react));
    expect(CANONICAL_FIRST_PARAGRAPH).toEqual({ storyId: 'st-1', blockId: 'p-1' });
    const paragraphStart = {
      ok: true,
      role: 'editableText',
      target: {
        kind: 'text',
        scope: { kind: 'body' },
        identity: CANONICAL_FIRST_PARAGRAPH,
        graphemeOffset: 2,
        affinity: 'upstream',
      },
    };
    const assertAdapter = (result: (typeof results)['react']) => {
      expect(result.boundary.regularHit).toEqual(paragraphStart);
      expect(result.boundary.boldHit).toEqual(paragraphStart);
      expect(result.boundary.insertHit).toEqual({
        ...paragraphStart,
        target: { ...paragraphStart.target, graphemeOffset: 1 },
      });
      expect(result.afterBoundaryClick.selection?.head).toEqual({
        ...paragraphStart.target,
        affinity: 'downstream',
      });
      expect(result.afterBoundaryClick.caret).not.toBeNull();
      expect(result.afterBoundaryClick.caret).toEqual(result.afterBoundaryClick.expectedClient);
      expect(result.afterBoundaryIdle).toEqual({
        caret: result.afterBoundaryClick.caret,
        ir: result.afterBoundaryClick.ir,
        expectedClient: result.afterBoundaryClick.expectedClient,
      });
      expect(result.afterClick.selection?.head).toEqual({
        ...paragraphStart.target,
        graphemeOffset: 1,
        affinity: 'downstream',
      });
      expect(result.afterClick.caret).not.toBeNull();
      expect(result.afterClick.caret).toEqual(result.afterClick.expectedClient);
      expect(result.afterIdle).toEqual({
        caret: result.afterClick.caret,
        ir: result.afterClick.ir,
        expectedClient: result.afterClick.expectedClient,
      });
      expect(result.afterTyping.caret).not.toBeNull();
      expect(result.afterTyping.caret).toEqual(result.afterTyping.expectedClient);
      expect(result.afterTyping.selection?.head).toEqual({
        ...paragraphStart.target,
        graphemeOffset: 2,
        affinity: 'downstream',
      });
      expect(result.afterTyping.text).toBe('AXVBoldAVItalicDirectFace');
      expect(result.afterTyping.ir!.rect.x).toBeGreaterThan(result.afterClick.ir!.rect.x);
      expect(result.afterTyping.ir!.rect.y).toBe(result.afterClick.ir!.rect.y);
      expect(result.afterTyping.ir!.rect.width).toBe(result.afterClick.ir!.rect.width);
      expect(result.afterTyping.ir!.rect.height).toBe(result.afterClick.ir!.rect.height);
      expect(result.afterTyping.insertedRun).toEqual({
        text: 'AXV',
        request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
        size: 24,
        color: { kind: 'hex', value: '202020' },
        bold: false,
        italic: false,
      });
      expect(result.afterTypingBlinkOne).toEqual({
        caret: result.afterTyping.caret,
        ir: result.afterTyping.ir,
        expectedClient: result.afterTyping.expectedClient,
      });
      expect(result.afterTypingBlinkTwo).toEqual(result.afterTypingBlinkOne);
      expect(result.afterTypingSnapshot.pages).toBe(FIDELITY_PAGE_SUMMARY.browserPageCount);
      expect(result.afterTypingSnapshot.lineBreaks.map(({ text }) => text)).toEqual([
        'AXVBoldAVItalicDirectFace',
        ...result.before.lineBreaks.slice(1).map(({ text }) => text),
      ]);

      const beforeFocus = result.before.runs.filter((run) =>
        ['AV', 'BoldAV', 'Italic', 'DirectFace'].includes(run.text)
      );
      const afterFocus = result.afterTypingSnapshot.runs.filter((run) =>
        ['AXV', 'BoldAV', 'Italic', 'DirectFace'].includes(run.text)
      );
      expect(afterFocus.map((run) => run.text)).toEqual(['AXV', 'BoldAV', 'Italic', 'DirectFace']);
      const unchangedSemantics = (run: (typeof afterFocus)[number]) => ({
        family: run.family,
        request: run.request,
        substitution: run.substitution,
        size: run.size,
        color: run.color,
        bold: run.bold,
        italic: run.italic,
        glyphs: run.glyphs.map(({ id, cluster, advanceX, advanceY, offsetX, offsetY }) => [
          id,
          cluster,
          advanceX,
          advanceY,
          offsetX,
          offsetY,
        ]),
        clusters: run.clusters.map(({ utf16From, utf16To, glyphFrom, glyphTo, advance }) => [
          utf16From,
          utf16To,
          glyphFrom,
          glyphTo,
          advance,
        ]),
        bidiLevel: run.bidiLevel,
        verticalMetrics: run.verticalMetrics,
        box: { y: run.box.y, width: run.box.width, height: run.box.height },
      });
      for (const text of ['BoldAV', 'Italic', 'DirectFace']) {
        expect(unchangedSemantics(afterFocus.find((run) => run.text === text)!)).toEqual(
          unchangedSemantics(beforeFocus.find((run) => run.text === text)!)
        );
      }
      const beforeRegular = beforeFocus.find((run) => run.text === 'AV')!;
      const afterRegular = afterFocus.find((run) => run.text === 'AXV')!;
      expect(beforeRegular.hash).toBe(FIDELITY_FONT_HASHES.regular);
      expect(afterRegular.hash).toBe(FIDELITY_FONT_HASHES.regular);
      expect(afterFocus.find((run) => run.text === 'BoldAV')!.hash).toBe(FIDELITY_FONT_HASHES.bold);
      expect(unchangedSemantics(afterRegular)).toEqual({
        ...unchangedSemantics(beforeRegular),
        glyphs: FIDELITY_SHAPES.regularAXV.glyphs.map(([id, cluster, advanceX]) => [
          id,
          cluster,
          advanceX,
          0,
          0,
          0,
        ]),
        clusters: FIDELITY_SHAPES.regularAXV.clusters.map(
          ([utf16From, utf16To, advance], index) => [utf16From, utf16To, index, index + 1, advance]
        ),
        box: {
          ...unchangedSemantics(beforeRegular).box,
          width: FIDELITY_SHAPES.regularAXV.width,
        },
      });
      const insertedWidth = afterRegular.box.width - beforeRegular.box.width;
      for (const text of ['BoldAV', 'Italic', 'DirectFace']) {
        const beforeRun = beforeFocus.find((run) => run.text === text)!;
        const afterRun = afterFocus.find((run) => run.text === text)!;
        expect(afterRun.box.x).toBeCloseTo(beforeRun.box.x + insertedWidth, 8);
      }
      expect(afterRegular.box.x + afterRegular.box.width).toBeCloseTo(
        afterFocus.find((run) => run.text === 'BoldAV')!.box.x,
        8
      );
      expect(result.reopenedSnapshot).toEqual(result.afterTypingSnapshot);
      expect(result.stability.map(({ label }) => label)).toEqual([
        'undo',
        'redo',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'repeated boundary click',
        'IME composition',
        'IME commit',
        'IME undo',
        'zoom',
        'scroll',
        'zoom restore',
      ]);
      for (const { label, immediate, settled } of result.stability) {
        expect(immediate.caret, `${label}: client caret diverged from IR mapping`).toEqual(
          immediate.expectedClient
        );
        expect(settled.caret, `${label}: settled client caret diverged from IR mapping`).toEqual(
          settled.expectedClient
        );
        expect(caretInvariant(settled), `${label}: unsolicited target/geometry transition`).toEqual(
          caretInvariant(immediate)
        );
      }
    };
    assertAdapter(results.react);
    assertAdapter(results.vue);

    const sourceParts = unzipSync(createHarfBuzzTextFidelityDocx());
    for (const result of [results.react, results.vue]) {
      const savedParts = unzipSync(new Uint8Array(result.savedBytes));
      expect(strFromU8(savedParts['word/styles.xml']!)).toBe(FIDELITY_STYLES_XML);
      expect(strFromU8(savedParts['word/theme/theme1.xml']!)).toBe(FIDELITY_THEME_XML);
      const documentXml = strFromU8(savedParts['word/document.xml']!);
      expect(documentXml).not.toBe(FIDELITY_DOCUMENT_XML);
      expect(documentXml).toContain('<w:t xml:space="preserve">AXV</w:t>');
      expect(documentXml).toContain('<w:t xml:space="preserve">BoldAV</w:t>');

      for (const [name, sourceBytes] of Object.entries(sourceParts)) {
        if (name === 'word/document.xml') continue;
        expect(savedParts[name], `untouched package part changed: ${name}`).toEqual(sourceBytes);
      }
    }
  });
});
