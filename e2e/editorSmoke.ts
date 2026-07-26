// Shared engine-neutral editing smoke flow, run identically against the production
// React and Vue adapters. Selection is established through the public one-surface
// target or EditorDriver; the hidden ProseMirror input host is never geometry authority.

import { test, expect, type Page } from '@playwright/test';
import type { EditorDriver } from '../packages/engine-editor/src/index.ts';

declare global {
  interface Window {
    __editorSmokeDriver?: EditorDriver;
  }
}

async function mount(page: Page, baseUrl: string, fixture = 'editable-sample.docx'): Promise<void> {
  await page.goto(`${baseUrl}/?realAdapter=1&fixture=${fixture}`);
  await page.waitForFunction(() => !!window.__docxAdapterDriver);
  await page.evaluate(() => {
    window.__editorSmokeDriver = window.__docxAdapterDriver as EditorDriver;
  });
}

async function paragraphTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    window
      .__editorSmokeDriver!.accessibilityObservation()
      .entries.filter((entry) => entry.role === 'editableParagraph')
      .map((entry) => entry.text)
  );
}

async function bodyText(page: Page): Promise<string> {
  return (await paragraphTexts(page)).join('\n');
}

async function authorizeCaret(
  page: Page,
  blockIndex: number,
  graphemeOffset: number
): Promise<void> {
  const outcome = await page.evaluate(
    ({ blockIndex, graphemeOffset }) =>
      window.__editorSmokeDriver!.authorizeCaret(blockIndex, graphemeOffset),
    { blockIndex, graphemeOffset }
  );
  expect(outcome.ok).toBe(true);
}

async function exec(page: Page, command: Parameters<EditorDriver['exec']>[0]): Promise<void> {
  const outcome = await page.evaluate(
    (nextCommand) => window.__editorSmokeDriver!.exec(nextCommand),
    command
  );
  expect(outcome.ok).toBe(true);
}

export function editorSmoke(adapter: string, baseUrl: string): void {
  test.describe(`${adapter} editing vertical`, () => {
    test('plain DOCX: edit maps to the canonical model and survives save + reopen', async ({
      page,
    }) => {
      await mount(page, baseUrl);
      await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');
      expect(await page.evaluate(() => window.__editorSmokeDriver!.editable())).toBe(true);

      // The painted glyph is the public one-surface pointer target. Playwright dispatches
      // a normal click to it; the hidden input host is neither targeted nor inspected.
      const clickTarget = page.getByTestId('one-surface-click-target');
      await expect(clickTarget).toBeVisible();
      await clickTarget.click();
      const marker = `[${adapter.toUpperCase()}-SMOKE]`;
      await page.keyboard.type(` ${marker}`);

      expect(await bodyText(page)).toContain(marker);
      expect(await page.evaluate(() => window.__editorSmokeDriver!.saveAndReopenText())).toContain(
        marker
      );
      await expect
        .poll(() => page.evaluate(() => window.__editorSmokeDriver!.displaySnapshot().text))
        .toContain(marker.replace(/\s+/g, ''));
    });

    test('unsupported Enter leaves the canonical model intact', async ({ page }) => {
      await mount(page, baseUrl);
      await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');

      const paragraphs = await paragraphTexts(page);
      const before = paragraphs.join('\n');
      await authorizeCaret(page, 0, paragraphs[0]!.length);
      await page.keyboard.press('Enter');
      expect(await bodyText(page)).toBe(before);
    });

    test('undo and redo drive the canonical store through a public text edit', async ({ page }) => {
      await mount(page, baseUrl);
      await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');
      const before = await bodyText(page);
      const paragraphs = await paragraphTexts(page);

      await authorizeCaret(page, 0, paragraphs[0]!.length);
      await page.keyboard.type('S');
      const edited = await bodyText(page);
      expect(edited).not.toBe(before);

      await exec(page, { type: 'undo' });
      expect(await bodyText(page)).toBe(before);

      await exec(page, { type: 'redo' });
      expect(await bodyText(page)).toBe(edited);
    });

    test('multi-step undo then redo stays consistent with the canonical model', async ({
      page,
    }) => {
      await mount(page, baseUrl);
      await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');
      const line0 = async () => (await paragraphTexts(page))[0] ?? '';
      await authorizeCaret(page, 0, (await line0()).length);
      await page.keyboard.type('AB'); // two per-keystroke commits

      expect(await line0()).toMatch(/AB$/);
      await exec(page, { type: 'undo' });
      expect(await line0()).toMatch(/A$/);
      await exec(page, { type: 'undo' });
      expect(await line0()).toMatch(/paragraph\.$/);
      await exec(page, { type: 'redo' });
      expect(await line0()).toMatch(/A$/);
      await exec(page, { type: 'redo' });
      expect(await line0()).toMatch(/AB$/);
    });

    test('undo keeps subsequent input in the edited paragraph, not the document end', async ({
      page,
    }) => {
      await mount(page, baseUrl);
      await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');
      const first = (await paragraphTexts(page))[0] ?? '';
      await authorizeCaret(page, 0, first.length);
      await page.keyboard.type('Q');
      await exec(page, { type: 'undo' });
      await page.keyboard.type('R');

      const lines = await paragraphTexts(page);
      expect(lines[0].includes('R'), `body=${JSON.stringify(lines)}`).toBe(true);
      expect(lines[lines.length - 1].includes('R')).toBe(false);
    });

    test('a refused edit snaps back without corrupting the model, and the editor keeps working', async ({
      page,
    }) => {
      await mount(page, baseUrl);
      await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');
      const before = await bodyText(page);

      const selectionOutcome = await page.evaluate(() => {
        const driver = window.__editorSmokeDriver!;
        const entries = driver
          .accessibilityObservation()
          .entries.filter((entry) => entry.role === 'editableParagraph');
        const first = entries[0]!;
        const last = entries[entries.length - 1]!;
        return driver.setSelection({
          frameId: driver.frameId(),
          scope: { kind: 'body' },
          anchor: {
            kind: 'text',
            scope: { kind: 'body' },
            identity: first.identity,
            graphemeOffset: 0,
            affinity: 'upstream',
          },
          head: {
            kind: 'text',
            scope: { kind: 'body' },
            identity: last.identity,
            graphemeOffset: last.text.length,
            affinity: 'downstream',
          },
        });
      });
      expect(selectionOutcome.ok).toBe(true);
      expect((await page.evaluate(() => window.__editorSmokeDriver!.focus())).ok).toBe(true);
      await page.keyboard.type('Z');
      expect(await bodyText(page)).toBe(before);

      const first = (await paragraphTexts(page))[0] ?? '';
      await authorizeCaret(page, 0, first.length);
      await page.keyboard.type('!OK');
      expect(await bodyText(page)).toContain('!OK');
    });

    test('a document with a table reports its current public editability capability', async ({
      page,
    }) => {
      await mount(page, baseUrl, 'with-tables.docx');
      // Tables used to force the legacy mapper read-only. The production public surface
      // now supports this fixture, so pin the fixture and assert the advertised capability
      // instead of preserving an obsolete read-only expectation.
      await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');
      expect(await page.evaluate(() => window.__editorSmokeDriver!.editable())).toBe(true);
      expect(
        await page.evaluate(() => window.__editorSmokeDriver!.displaySnapshot().pageCount)
      ).toBeGreaterThan(0);
    });
  });
}
