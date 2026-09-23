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
      await refresh.apply({
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
  expect(result.opacity).toBeLessThan(0.14);
  expect(result.target).toBe('0.14');
  expect(result.radius).toBe('6px');
  expect(result.border).toBe('0px');
  expect(result.background).toBe('rgb(59, 130, 246)');
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
  expect(result.duringExit).toBeLessThan(0.14);
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
    opacity: '0.22',
    color: 'rgb(102, 51, 153)',
    animations: 0,
  });
  await expect(page.locator('[data-docx-refresh-highlight]')).toHaveCount(0);
});
