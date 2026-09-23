import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { DocxEditorInstance } from '../packages/core/src/editor/docx-editor-types';
import type { DocumentRefresh } from '../packages/core/src/editor/document-refresh-types';

declare global {
  interface Window {
    __refreshMotion: { editor: DocxEditorInstance; refresh: DocumentRefresh; scroll: HTMLElement };
  }
}
async function open(page: Page) {
  await page.goto('http://localhost:5273/@vite/client');
  await page.evaluate(
    async (root) => {
      const { createDocxEditor } = await import(`${root}/packages/core/src/editor/docx-editor.ts`);
      const { createDocumentRefresh } = await import(
        `${root}/packages/core/src/editor/document-refresh.ts`
      );
      const { refreshFixture, refreshMetadata } = await import(
        `${root}/examples/shared/refresh-demo-fixture.ts`
      );
      await import(`${root}/packages/core/src/styles/editor.css`);
      const scroll = document.createElement('div');
      scroll.className = 'docx-editor docx-editor__scroll-container';
      scroll.style.cssText = 'height:500px;width:900px;overflow:auto;position:relative;';
      const container = document.createElement('div');
      scroll.append(container);
      document.body.replaceChildren(scroll);
      const editor = createDocxEditor({ container, document: refreshFixture(), zoom: 1 });
      const refresh = createDocumentRefresh(editor);
      const submission = await refresh.capture();
      await refresh.applyUpdate({
        submission,
        sequence: 1,
        bytes: refreshFixture(2),
        changes: refreshMetadata(2),
      });
      scroll.scrollTop = 500;
      window.__refreshMotion = { editor, refresh, scroll };
    },
    `/@fs/${resolve(import.meta.dirname, '..')}`
  );
}

test('default fade is subtle, borderless, padded, and stable across repeated calls', async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const { refresh, scroll } = window.__refreshMotion;
    const top = scroll.scrollTop;
    refresh.highlightChanges();
    const band = scroll.querySelector<HTMLElement>('[data-docx-refresh-highlight]')!;
    const animation = band.getAnimations()[0]!;
    animation.pause();
    animation.currentTime = 70;
    const opacity = Number(getComputedStyle(band).opacity);
    refresh.highlightChanges();
    const style = getComputedStyle(band);
    return {
      duration: animation.effect!.getTiming().duration,
      opacity,
      target: band.style.opacity,
      radius: style.borderRadius,
      border: style.borderWidth,
      background: style.backgroundColor,
      same: band.getAnimations()[0] === animation,
      scroll: scroll.scrollTop === top,
      paddingWidth:
        band.getBoundingClientRect().width -
        [...scroll.querySelectorAll<HTMLElement>('[data-paragraph-id]')]
          .find((element) => element.textContent === 'Section 13: Updated delivery date.')!
          .getBoundingClientRect().width,
    };
  });
  expect(result.duration).toBe(180);
  expect(result.opacity).toBeGreaterThan(0);
  expect(result.opacity).toBeLessThan(1);
  expect(result.target).toBe('1');
  expect(result.radius).toBe('6px');
  expect(result.border).toBe('0px');
  expect(result.background).toBe('color(srgb 0.231373 0.509804 0.964706 / 0.14)');
  expect(result.same).toBe(true);
  expect(result.scroll).toBe(true);
  expect(result.paddingWidth).toBeCloseTo(8, 1);
});

test('dismissal reverses from current opacity and stale highlights disappear immediately', async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const { refresh, scroll } = window.__refreshMotion;
    refresh.highlightChanges({ animation: false });
    const band = scroll.querySelector<HTMLElement>('[data-docx-refresh-highlight]')!;
    refresh.clearHighlights({ animation: { durationMs: 220 } });
    const exit = band.getAnimations()[0]!;
    exit.pause();
    exit.currentTime = 50;
    const duringExit = Number(getComputedStyle(band).opacity);
    refresh.highlightChanges();
    const entrance = band.getAnimations()[0]!;
    entrance.pause();
    entrance.currentTime = 0;
    return {
      duringExit,
      start: Number(getComputedStyle(band).opacity),
      count: scroll.querySelectorAll('[data-docx-refresh-highlight]').length,
      exitState: exit.playState,
    };
  });
  expect(result.duringExit).toBeGreaterThan(0);
  expect(result.duringExit).toBeLessThan(1);
  expect(result.start).toBeCloseTo(result.duringExit, 5);
  expect(result.count).toBe(2);
  expect(result.exitState).toBe('idle');
  await page.evaluate(() => window.__refreshMotion.editor.surface!.type('Local edit'));
  await expect(page.locator('[data-docx-refresh-highlight]')).toHaveCount(0);
});

test('custom settings survive zoom without replay and reduced motion limits fades', async ({
  page,
}) => {
  await open(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const result = await page.evaluate(() => {
    const { refresh, editor, scroll } = window.__refreshMotion;
    refresh.highlightChanges({
      color: 'rebeccapurple',
      opacity: 0.22,
      padding: 8,
      borderRadius: 12,
      animation: { durationMs: 250 },
    });
    const first = scroll.querySelector<HTMLElement>('[data-docx-refresh-highlight]')!;
    const duration = first.getAnimations()[0]!.effect!.getTiming().duration;
    for (const band of scroll.querySelectorAll('[data-docx-refresh-highlight]'))
      for (const animation of band.getAnimations()) animation.finish();
    editor.setZoom(0.75);
    const band = scroll.querySelector<HTMLElement>('[data-docx-refresh-highlight]')!;
    const result = {
      duration,
      radius: band.style.borderRadius,
      opacity: band.style.opacity,
      color: getComputedStyle(band).backgroundColor,
      animations: band.getAnimations().length,
    };
    refresh.clearHighlights({ animation: false });
    return result;
  });
  expect(result).toEqual({
    duration: 125,
    radius: '9px',
    opacity: '1',
    color: 'color(srgb 0.4 0.2 0.6 / 0.22)',
    animations: 0,
  });
  await expect(page.locator('[data-docx-refresh-highlight]')).toHaveCount(0);
});

test('highlights expire after three seconds, reset their timer, and support explicit persistence', async ({
  page,
}) => {
  await open(page);
  await page.clock.install({ time: new Date(2026, 8, 23) });
  await page.clock.pauseAt(new Date(2026, 8, 23, 0, 0, 1));
  const bands = page.locator('[data-docx-refresh-highlight]');
  await page.evaluate(() => window.__refreshMotion.refresh.highlightChanges({ animation: false }));
  await page.clock.fastForward(2999);
  await expect(bands).toHaveCount(2);
  await page.clock.fastForward(1);
  await expect(bands).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__refreshMotion.refresh.snapshot().highlightsVisible)
  ).toBe(false);
  expect(await page.evaluate(() => window.__refreshMotion.refresh.snapshot().changes.length)).toBe(
    2
  );

  expect(
    await page.evaluate(() => window.__refreshMotion.refresh.navigateToChange('delivery-date'))
  ).toBe(true);

  await page.evaluate(() =>
    window.__refreshMotion.refresh.highlightChanges({ timeoutMs: 1000, animation: false })
  );
  await page.clock.fastForward(600);
  await page.evaluate(() =>
    window.__refreshMotion.refresh.highlightChanges({ timeoutMs: 2000, animation: false })
  );
  await page.clock.fastForward(1000);
  await expect(bands).toHaveCount(2);
  await page.clock.fastForward(1000);
  await expect(bands).toHaveCount(0);

  await page.evaluate(() =>
    window.__refreshMotion.refresh.highlightChanges({ timeoutMs: null, animation: false })
  );
  await page.clock.fastForward(60000);
  await expect(bands).toHaveCount(2);
  await page.evaluate(() => window.__refreshMotion.refresh.clearHighlights({ animation: false }));
  await expect(bands).toHaveCount(0);

  await page.evaluate(() =>
    window.__refreshMotion.refresh.highlightChanges({
      timeoutMs: 100,
      animation: { durationMs: 220 },
    })
  );
  await page.clock.fastForward(100);
  const exit = await page.evaluate(() => {
    const band = window.__refreshMotion.scroll.querySelector<HTMLElement>(
      '[data-docx-refresh-highlight]'
    )!;
    return {
      visible: window.__refreshMotion.refresh.snapshot().highlightsVisible,
      opacity: band.style.opacity,
      duration: band.getAnimations()[0]!.effect!.getTiming().duration,
    };
  });
  expect(exit).toEqual({ visible: false, opacity: '0', duration: 220 });
});

test('targeted navigation supports alignment, edge padding, and reduced-motion scrolling', async ({
  page,
}) => {
  await open(page);
  const target = page
    .locator('[data-paragraph-id]')
    .filter({ hasText: 'Section 25: Updated review date.' })
    .first();
  const result = await page.evaluate(() => {
    const { refresh, scroll } = window.__refreshMotion;
    scroll.scrollTop = 0;
    const found = refresh.navigateToChange('review-date', { block: 'start', offsetPx: 80 });
    const count = refresh.highlightChanges({ changeIds: ['review-date'], animation: false });
    const top = scroll.scrollTop;
    refresh.navigateToChange('review-date', { block: 'centerIfNeeded' });
    return { found, count, top, unchanged: top === scroll.scrollTop };
  });
  expect(result).toMatchObject({ found: true, count: 1, unchanged: true });
  expect(result.top).toBeGreaterThan(0);
  await expect(page.locator('[data-docx-refresh-highlight]')).toHaveCount(1);
  const location = await target.boundingBox();
  const scrollBox = await page.locator('.docx-editor__scroll-container').boundingBox();
  expect(location!.y - scrollBox!.y).toBeGreaterThan(60);
  expect(location!.y - scrollBox!.y).toBeLessThan(100);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page.evaluate(() => {
      const { refresh, scroll } = window.__refreshMotion;
      let behavior: ScrollBehavior | undefined;
      const original = scroll.scrollTo.bind(scroll);
      scroll.scrollTo = ((options: ScrollToOptions) => {
        behavior = options.behavior;
        original(options);
      }) as typeof scroll.scrollTo;
      refresh.navigateToChange('delivery-date', { behavior: 'smooth' });
      return behavior;
    })
  ).toBe('instant');
});

test('CSS decoration, border options, custom easing, and separate exit timing work together', async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(() => {
    const { refresh, scroll } = window.__refreshMotion;
    const stylesheet = document.createElement('style');
    stylesheet.textContent = '.review-pattern { box-shadow: 0 0 8px blue; }';
    document.head.append(stylesheet);
    const count = refresh.highlightChanges({
      changeIds: ['delivery-date'],
      color: 'rebeccapurple',
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: 'blue',
      className: 'review-pattern',
      animation: { durationMs: 160, exitDurationMs: 240, easing: 'linear' },
      timeoutMs: null,
    });
    const band = scroll.querySelector<HTMLElement>('[data-docx-refresh-highlight]')!;
    const enter = band.getAnimations()[0]!;
    enter.finish();
    const style = getComputedStyle(band);
    const decoration = {
      count,
      borderWidth: style.borderWidth,
      borderStyle: style.borderStyle,
      shadow: style.boxShadow,
      borderColor: style.borderColor,
      bandOpacity: style.opacity,
      fill: style.backgroundColor,
      blendMode: style.mixBlendMode,
      pointer: style.pointerEvents,
    };
    const errors: string[] = [];
    for (const options of [
      { color: 'not-a-color' },
      { borderColor: 'not-a-color' },
      { animation: { easing: 'nonsense' } },
      { animation: { easing: 'ease, linear' } },
    ]) {
      try {
        refresh.highlightChanges(options);
      } catch (error) {
        errors.push((error as Error).name);
      }
    }
    const same = scroll.querySelector('[data-docx-refresh-highlight]') === band;
    refresh.clearHighlights();
    const exit = band.getAnimations()[0]!;
    exit.pause();
    return { ...decoration, errors, same, exit: exit.effect!.getTiming() };
  });
  expect(result).toMatchObject({
    count: 1,
    borderWidth: '2px',
    borderStyle: 'dashed',
    borderColor: 'rgb(0, 0, 255)',
    bandOpacity: '1',
    fill: 'color(srgb 0.4 0.2 0.6 / 0.14)',
    blendMode: 'multiply',
    pointer: 'none',
    errors: ['TypeError', 'TypeError', 'TypeError', 'TypeError'],
    same: true,
    exit: { duration: 240, easing: 'linear' },
  });
  expect(result.shadow).not.toBe('none');
});
