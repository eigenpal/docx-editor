// Shared Playwright helpers for production-editor accessibility-tree tests (task 4.7).

import { expect, type Page, type Locator } from '@playwright/test';

export function countSubstring(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count += 1;
    idx += needle.length;
  }
  return count;
}

export async function mountScenario(page: Page, scenario: string): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__a11yHarness !== undefined);
  await page.evaluate((s) => window.__a11yHarness!.mount({ scenario: s }), scenario);
}

export async function assertSingleOwnerTree(
  page: Page,
  options: { requiredText?: string; mountLocator?: Locator } = {},
): Promise<string> {
  expect(await page.evaluate(() => window.__a11yHarness!.countEditableOwners())).toBe(1);
  expect(await page.evaluate(() => window.__a11yHarness!.countLandmarkDocuments())).toBe(0);
  const root = options.mountLocator ?? page.locator('[data-docx-input-host-mount]');
  const tree = await root.ariaSnapshot();
  if (options.requiredText) {
    expect(countSubstring(tree, options.requiredText)).toBe(1);
  }
  return tree;
}

export async function authorizeCaret(
  page: Page,
  blockIndex: number,
  graphemeOffset: number,
): Promise<void> {
  const selection = await page.evaluate(
    ({ blockIndex, graphemeOffset }) => {
      const result = window.__a11yHarness!.setSelection(blockIndex, graphemeOffset, graphemeOffset);
      if (!result.ok) return result;
      return window.__a11yHarness!.focus();
    },
    { blockIndex, graphemeOffset },
  );
  expect(selection.ok).toBe(true);
}

export async function authorizeRange(
  page: Page,
  blockIndex: number,
  anchorOffset: number,
  headOffset: number,
): Promise<void> {
  const selection = await page.evaluate(
    ({ blockIndex, anchorOffset, headOffset }) => {
      const result = window.__a11yHarness!.setSelection(blockIndex, anchorOffset, headOffset);
      if (!result.ok) return result;
      return window.__a11yHarness!.focus();
    },
    { blockIndex, anchorOffset, headOffset },
  );
  expect(selection.ok).toBe(true);
}

declare global {
  interface Window {
    __a11yHarness?: {
      mount(o: { scenario: string }): void;
      destroy(): void;
      relayout(o?: { sync?: boolean }): void;
      setSelection(blockIndex: number, anchorOffset: number, headOffset?: number): { ok: boolean; code?: string; reason?: string };
      focus(): { ok: boolean; code?: string; reason?: string };
      blur(): void;
      swapPagesContainer(): void;
      reloadEditableTexts(texts: readonly string[]): void;
      getObservation(): {
        owner: string;
        editable: boolean;
        modelRevision: number;
        name: { kind: string; value?: string };
        entries: readonly {
          text: string;
          role: string;
          readOnly: boolean;
          atomKind?: string;
          identity: { blockId: string; storyId: string };
        }[];
        focus: { focused: boolean };
        selection: {
          collapsed: boolean;
          anchor: { kind: string; identity?: { blockId: string }; graphemeOffset?: number };
          head: { kind: string; identity?: { blockId: string }; graphemeOffset?: number };
        } | null;
        paintedPagesAssistiveRole: string | null;
      };
      getParagraphEntries(): readonly { blockId: string; storyId: string; text: string; orderIndex: number }[];
      getRevision(): number;
      getParagraphText(blockIndex: number): string;
      paintedDomText(): string;
      countEditableOwners(): number;
      countLandmarkDocuments(): number;
      pagesAssistiveMarker(): string | null;
      pagesAriaHidden(): boolean;
    };
  }
}
