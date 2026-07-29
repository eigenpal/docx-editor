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
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';

declare global {
  interface Window {
    __docxAdapterEditor?: Editor;
  }
}

/** Toolbar commands currently wired through the production editor boundary. */
const ENABLED = [
  'toolbar-alignment',
  'toolbar-bold',
  'toolbar-clear-formatting',
  'toolbar-insert-link',
  'toolbar-italic',
  'toolbar-redo',
  'toolbar-strikethrough',
  'toolbar-subscript',
  'toolbar-superscript',
  'toolbar-toggle-comments-sidebar',
  'toolbar-underline',
  'toolbar-undo',
];

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
      const bar = document.querySelector('[data-testid="formatting-bar"]')!;
      const horizontalRuler = document.querySelector('.docx-horizontal-ruler')!;
      const rulerRow = horizontalRuler.parentElement!;
      return {
        shell: has('[data-testid="docx-editor"]'),
        titleBar: has('[data-testid="title-bar"]'),
        menuBar: has('[role="menubar"]'),
        menuItems: count('[role="menubar"] button'),
        toolbarControls: count(
          '[role="toolbar"] button, [role="toolbar"] input, [role="toolbar"] select'
        ),
        toolbarGroups: count('[role="toolbar"] > [role="group"]'),
        // The legacy formatting bar is a PILL that scrolls, not a flat wrapping bar.
        pillRadius: getComputedStyle(bar).borderRadius,
        pillOverflowX: getComputedStyle(bar).overflowX,
        horizontalRuler: has('.docx-horizontal-ruler'),
        rulerPosition: getComputedStyle(rulerRow).position,
        // `.docx-vertical-ruler` is the LEGACY class. The ported ruler replaced my
        // interim one, whose `.ep-ruler--vertical` class had been introduced in the interim implementation; the gate
        // follows the legacy markup rather than the other way round.
        verticalRuler: has('.docx-vertical-ruler'),
        scrollContainer: has('.docx-editor__scroll-container'),
        workspace: has('.ep-one-surface__pages'),
        pages: count('[data-page-index]'),
        sidebar: has('[data-testid="docx-editor-sidebar"]'),
        dialogLaunchers: count('[data-testid^="dialog-launcher-"]'),
      };
    });

    expect(regions.shell, 'shell container').toBe(true);
    expect(regions.titleBar, 'title bar').toBe(true);
    expect(regions.menuBar, 'menu region').toBe(true);
    expect(regions.menuItems, 'menu items').toBe(4);
    expect(regions.toolbarControls, 'toolbar controls').toBe(30);
    expect(regions.toolbarGroups, 'toolbar groups').toBe(8);
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

  test('only wired controls are enabled and disabled controls cannot dispatch', async ({
    page,
  }) => {
    const enabled = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="toolbar-"]')]
        .filter(
          (el) =>
            el.tagName === 'BUTTON' &&
            !(el as HTMLButtonElement).disabled &&
            el.getAttribute('aria-disabled') !== 'true'
        )
        .map((el) => (el as HTMLElement).dataset.testid!)
        .sort()
    );
    expect(enabled).toEqual([...ENABLED].sort());

    // Every semantically disabled control must carry a localized label and leave
    // the canonical document untouched when programmatically activated.
    const probe = await page.evaluate(() => {
      const editor = window.__docxAdapterEditor!;
      const before = editor.getDocumentHandle().revision;
      const disabled = [
        ...document.querySelectorAll('[role="toolbar"] [aria-disabled="true"]'),
      ] as HTMLElement[];
      const missingReason = disabled.filter((el) => {
        const label = el.getAttribute('aria-label') ?? '';
        return label.length === 0 || /^[a-z]+\.[a-zA-Z.]+$/.test(label);
      }).length;
      for (const el of disabled) el.click();
      return {
        count: disabled.length,
        missingReason,
        before,
        after: editor.getDocumentHandle().revision,
      };
    });
    expect(probe.count, 'disabled controls').toBeGreaterThan(0);
    expect(probe.missingReason, 'controls with no localized reason').toBe(0);
    expect(probe.after, 'a disabled control mutated the document').toBe(probe.before);
  });

  test('captures the fixed-viewport parity screenshot', async ({ page }) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/m6v1-react-legacy-chrome.png' });
  });
});
