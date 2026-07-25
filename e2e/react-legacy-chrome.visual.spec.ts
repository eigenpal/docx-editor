// M6V.1 — legacy chrome visual parity gate (React only).
//
// Asserts that every NAMED legacy chrome region is present, that exactly the five
// permitted controls are actionable, and that nothing else can dispatch. It also
// captures the fixed-viewport screenshot the task's pass boundary requires.
//
// Region presence is asserted structurally rather than by pixel diff: a pixel baseline
// would fail on font rendering across machines and would not tell a reader WHICH region
// regressed. The screenshot is recorded for the side-by-side comparison against the
// legacy reference; this spec guards that no region silently disappears.

import { expect, test } from '@playwright/test';
import type { Editor } from '@docx-editor.dev/core-contract/editor';

declare global {
  interface Window {
    __docxAdapterEditor?: Editor;
  }
}

/** Exactly the controls M6V.1 permits to act. */
const ENABLED = ['toolbar-undo', 'toolbar-redo', 'toolbar-bold', 'toolbar-italic', 'toolbar-save'];

test.describe('M6V.1 legacy chrome visual parity (React)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5273/');
    await page.waitForFunction(() => !!window.__docxAdapterEditor);
    await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');
  });

  test('every named legacy chrome region is present', async ({ page }) => {
    const regions = await page.evaluate(() => {
      const has = (s: string) => !!document.querySelector(s);
      const count = (s: string) => document.querySelectorAll(s).length;
      const bar = document.querySelector('.ep-toolbar')!;
      const rulerRow = document.querySelector('.docx-editor__ruler-row')!;
      return {
        shell: has('[data-testid="docx-editor"]'),
        titleBar: has('[data-testid="document-title-bar"]'),
        menuBar: has('[data-testid="menu-bar"]'),
        menuItems: count('[data-testid^="menu-"]') - 1, // minus the menubar itself
        toolbarControls: count('[data-testid^="toolbar-"]'),
        toolbarGroups: count('.ep-toolbar__group'),
        // The legacy formatting bar is a PILL that scrolls, not a flat wrapping bar.
        pillRadius: getComputedStyle(bar).borderRadius,
        pillOverflowX: getComputedStyle(bar).overflowX,
        horizontalRuler: has('.docx-editor__ruler-row'),
        rulerPosition: getComputedStyle(rulerRow).position,
        // `.docx-vertical-ruler` is the LEGACY class. The ported ruler replaced my
        // interim one, whose `.ep-ruler--vertical` class had been introduced in the interim implementation; the gate
        // follows the legacy markup rather than the other way round.
        verticalRuler: has('.docx-vertical-ruler'),
        scrollContainer: has('.docx-editor__scroll-container'),
        workspace: has('.docx-editor__content'),
        pages: count('[data-page-index]'),
        sidebar: has('[data-testid="docx-editor-sidebar"]'),
        dialogLaunchers: count('[data-testid^="dialog-launcher-"]'),
      };
    });

    expect(regions.shell, 'shell container').toBe(true);
    expect(regions.titleBar, 'title bar').toBe(true);
    expect(regions.menuBar, 'menu region').toBe(true);
    expect(regions.menuItems, 'menu items').toBe(4);
    expect(regions.toolbarControls, 'toolbar controls').toBe(31);
    expect(regions.toolbarGroups, 'toolbar groups').toBe(12);
    expect(regions.pillRadius, 'formatting bar is a pill').toBe('9999px');
    expect(regions.pillOverflowX, 'formatting bar scrolls rather than wrapping').toBe('auto');
    expect(regions.horizontalRuler, 'horizontal ruler').toBe(true);
    expect(regions.rulerPosition, 'ruler row is sticky').toBe('sticky');
    expect(regions.verticalRuler, 'vertical ruler').toBe(true);
    expect(regions.scrollContainer, 'scroll container').toBe(true);
    expect(regions.workspace, 'workspace/page chrome').toBe(true);
    expect(regions.pages, 'painted page').toBeGreaterThan(0);
    // The sidebar is CLOSED by default, matching the reference. It was asserted open
    // when this spec was written; the reference shows no panel until the user opens
    // one, and an always-open 260px panel is itself a parity defect.
    expect(regions.sidebar, 'sidebar closed by default').toBe(false);
    expect(regions.dialogLaunchers, 'dialog launchers hidden with the sidebar').toBe(0);
  });

  test('exactly five controls are enabled and nothing else can dispatch', async ({ page }) => {
    const enabled = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="toolbar-"]')]
        .filter((el) => el.tagName === 'BUTTON' && !(el as HTMLButtonElement).disabled)
        .map((el) => (el as HTMLElement).dataset.testid!)
        .sort(),
    );
    expect(enabled).toEqual([...ENABLED].sort());

    // Every parity-only control must carry a localized reason, not bare English or a
    // raw i18n key, and must leave the document untouched when clicked.
    const probe = await page.evaluate(() => {
      const editor = window.__docxAdapterEditor!;
      const before = editor.getDocumentHandle().revision;
      const parityOnly = [...document.querySelectorAll('[data-parity-only="true"]')] as HTMLElement[];
      const missingReason = parityOnly.filter((el) => {
        const label = el.getAttribute('aria-label') ?? '';
        return label.length === 0 || /^[a-z]+\.[a-zA-Z.]+$/.test(label);
      }).length;
      for (const el of parityOnly) el.click();
      return { count: parityOnly.length, missingReason, before, after: editor.getDocumentHandle().revision };
    });
    // Floor, not an exact count: the sidebar's launchers are no longer rendered by
    // default, so the previous threshold of 30 counted controls the reference does not
    // show. What must hold is that the toolbar and menu are overwhelmingly parity-only.
    expect(probe.count, 'parity-only controls').toBeGreaterThan(20);
    expect(probe.missingReason, 'controls with no localized reason').toBe(0);
    expect(probe.after, 'a disabled control mutated the document').toBe(probe.before);
  });

  test('captures the fixed-viewport parity screenshot', async ({ page }) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/m6v1-react-legacy-chrome.png' });
  });
});
