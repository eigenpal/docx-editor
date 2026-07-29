// Chromium accessibility-tree falsification for hidden PM projection + painted pages (task 4.7).

import { test, expect } from '@playwright/test';
import { LOCALIZED_ACCESSIBLE_NAME, LOCALIZED_ATOM_LABELS } from '../browser/fixtures.ts';
import {
  assertSingleOwnerTree,
  authorizeCaret,
  countSubstring,
  mountScenario,
} from './a11y-tree-helpers.ts';

function normalizeText(text: string): string {
  return text.replace(/\s+/g, '');
}

test.describe('production editor accessibility tree', () => {
  test('exposes exactly one canonical editable projection and hides painted pages', async ({
    page,
  }) => {
    await mountScenario(page, 'editable-named');

    const paintedText = normalizeText(
      await page.evaluate(() => window.__a11yHarness!.paintedDomText())
    );
    expect(paintedText).toContain('primeralínea');
    expect(paintedText).toContain('caféñ日本語');

    expect(await page.evaluate(() => window.__a11yHarness!.pagesAriaHidden())).toBe(true);
    expect(await page.evaluate(() => window.__a11yHarness!.pagesAssistiveMarker())).toBe(
      'presentation-only'
    );

    await expect(page.locator('[contenteditable="true"]')).toHaveCount(1);
    await expect(page.locator('[contenteditable="true"]')).toHaveAttribute(
      'aria-label',
      LOCALIZED_ACCESSIBLE_NAME
    );

    const tree = await assertSingleOwnerTree(page, { requiredText: 'primera línea' });
    expect(countSubstring(tree, 'café ñ 日本語')).toBe(1);
    expect(tree).not.toMatch(/role:\s*document/);
  });

  test('preserves tree-backed reading order with empty paragraph and Unicode', async ({ page }) => {
    await mountScenario(page, 'editable-named');
    const obs = await page.evaluate(() => window.__a11yHarness!.getObservation());

    expect(obs.entries.map((entry) => entry.text)).toEqual(['primera línea', '', 'café ñ 日本語']);
    expect(obs.entries.every((entry) => entry.role === 'editableParagraph')).toBe(true);

    await expect(page.locator('[data-docx-input-host-mount]')).toMatchAriaSnapshot(`
      - paragraph: primera línea
      - paragraph
      - paragraph: café ñ 日本語
    `);
  });

  test('exposes localized accessible name when supplied and omits fallback when absent', async ({
    page,
  }) => {
    await mountScenario(page, 'editable-named');
    await expect(page.locator('[contenteditable="true"]')).toHaveAttribute(
      'aria-label',
      LOCALIZED_ACCESSIBLE_NAME
    );
    await assertSingleOwnerTree(page);

    await page.evaluate(() => window.__a11yHarness!.mount({ scenario: 'editable-unnamed' }));
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(1);
    await expect(page.locator('[contenteditable="true"]')).not.toHaveAttribute('aria-label');
    const obs = await page.evaluate(() => window.__a11yHarness!.getObservation());
    expect(obs.name.kind).toBe('absent');
    await assertSingleOwnerTree(page);
  });

  test('editable mode is focusable; view mode is perceivable but not editable', async ({
    page,
  }) => {
    await mountScenario(page, 'editable-named');
    await authorizeCaret(page, 0, 0);
    const focusedObs = await page.evaluate(() => window.__a11yHarness!.getObservation());
    expect(focusedObs.focus.focused).toBe(true);
    await assertSingleOwnerTree(page);

    await page.evaluate(() => window.__a11yHarness!.mount({ scenario: 'view-mode' }));
    const viewObs = await page.evaluate(() => window.__a11yHarness!.getObservation());
    expect(viewObs.editable).toBe(false);
    const viewFocus = await page.evaluate(() => window.__a11yHarness!.focus());
    expect(viewFocus.ok).toBe(false);
    expect(viewFocus.code).toBe('readOnly');

    const viewTree = await page.locator('[data-docx-input-host-mount]').ariaSnapshot();
    expect(viewTree).toContain('primera línea');
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
    await expect(page.locator('[contenteditable="false"]')).toHaveCount(1);
  });

  test('read-only structural atoms expose localized labels and read-only semantics', async ({
    page,
  }) => {
    await mountScenario(page, 'read-only-mixed');
    const obs = await page.evaluate(() => window.__a11yHarness!.getObservation());
    // The body has editable paragraphs on both sides of the unsupported table.
    // Document editability and the atom's read-only status are distinct contracts.
    expect(obs.editable).toBe(true);
    const atom = obs.entries.find((entry) => entry.role === 'readOnlyAtom');
    expect(atom?.atomKind).toBe('table');
    expect(atom?.readOnly).toBe(true);

    await expect(page.locator('.docx-block-embed[data-kind="table"]')).toHaveAttribute(
      'aria-label',
      LOCALIZED_ATOM_LABELS.table
    );
    await expect(page.getByLabel(LOCALIZED_ATOM_LABELS.table)).toHaveCount(1);

    const tree = await page.locator('[data-docx-input-host-mount]').ariaSnapshot();
    expect(tree).toContain('antes');
    expect(tree).toContain('después');
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(1);
    await expect(page.locator('.docx-block-embed[data-kind="table"]')).toHaveAttribute(
      'contenteditable',
      'false'
    );
  });

  test('focus and native selection track exact canonical semantic selection', async ({ page }) => {
    await mountScenario(page, 'editable-named');
    const block = await page.evaluate(() => window.__a11yHarness!.getParagraphEntries()[0]!);

    await authorizeCaret(page, 0, 0);
    const editable = page.locator('[contenteditable="true"]');
    await expect(editable).toBeFocused();
    for (let i = 0; i < 3; i += 1) {
      await editable.press('Shift+ArrowRight', { delay: 30 });
    }

    await expect
      .poll(() =>
        page.evaluate(() => {
          const obs = window.__a11yHarness!.getObservation();
          if (obs.selection?.anchor.kind !== 'text' || obs.selection.head.kind !== 'text')
            return null;
          return {
            collapsed: obs.selection.collapsed,
            anchorOffset: obs.selection.anchor.graphemeOffset,
            headOffset: obs.selection.head.graphemeOffset,
            blockId: obs.selection.anchor.identity.blockId,
          };
        })
      )
      .toEqual({
        collapsed: false,
        anchorOffset: 0,
        headOffset: 3,
        blockId: block.blockId,
      });

    const obs = await page.evaluate(() => window.__a11yHarness!.getObservation());
    expect(obs.focus.focused).toBe(true);
    expect(obs.selection?.collapsed).toBe(false);
    expect(obs.selection?.anchor.kind).toBe('text');
    expect(obs.selection?.head.kind).toBe('text');

    await assertSingleOwnerTree(page, { requiredText: 'primera línea' });
  });

  test('accepted native input keeps one owner and one canonical tree instance', async ({
    page,
  }) => {
    await mountScenario(page, 'editable-named');
    const revisionBefore = await page.evaluate(() => window.__a11yHarness!.getRevision());
    const endOffset = (await page.evaluate(() => window.__a11yHarness!.getParagraphText(0))).length;

    await authorizeCaret(page, 0, endOffset);
    await assertSingleOwnerTree(page, { requiredText: 'primera línea' });

    const editable = page.locator('[contenteditable="true"]');
    await editable.type('Z');

    const afterInput = await page.evaluate(() => ({
      revision: window.__a11yHarness!.getRevision(),
      text: window.__a11yHarness!.getParagraphText(0),
    }));
    expect(afterInput.text).toContain('Z');
    expect(afterInput.revision).toBeGreaterThan(revisionBefore);

    const tree = await assertSingleOwnerTree(page, { requiredText: 'Z' });
    expect(countSubstring(tree, 'primera línea')).toBe(1);
  });

  test('composition lifecycle keeps one owner through start, update, end, and commit', async ({
    page,
  }) => {
    await mountScenario(page, 'editable-named');
    const revisionBefore = await page.evaluate(() => window.__a11yHarness!.getRevision());
    const endOffset = (await page.evaluate(() => window.__a11yHarness!.getParagraphText(0))).length;

    await authorizeCaret(page, 0, endOffset);
    await assertSingleOwnerTree(page);

    const editable = page.locator('[contenteditable="true"]');
    await editable.evaluate((el) => {
      el.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true, cancelable: true, data: '' })
      );
    });
    await assertSingleOwnerTree(page);

    await editable.type('X');
    await assertSingleOwnerTree(page);

    await editable.evaluate((el) => {
      el.dispatchEvent(
        new CompositionEvent('compositionupdate', { bubbles: true, cancelable: true, data: 'X' })
      );
    });
    await assertSingleOwnerTree(page);

    await editable.evaluate((el) => {
      el.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true, cancelable: true, data: 'X' })
      );
    });

    await expect
      .poll(() => page.evaluate(() => window.__a11yHarness!.getParagraphText(0)))
      .toContain('X');
    expect(await page.evaluate(() => window.__a11yHarness!.getRevision())).toBeGreaterThan(
      revisionBefore
    );

    const tree = await assertSingleOwnerTree(page, { requiredText: 'X' });
    expect(countSubstring(tree, 'primera línea')).toBe(1);
  });

  test('blur, external reconciliation, relayout, container swap, and destroy stay coherent', async ({
    page,
  }) => {
    await mountScenario(page, 'editable-named');
    await authorizeCaret(page, 0, 0);
    await assertSingleOwnerTree(page, { requiredText: 'primera línea' });

    await page.evaluate(() => window.__a11yHarness!.blur());
    const blurred = await page.evaluate(() => window.__a11yHarness!.getObservation());
    expect(blurred.focus.focused).toBe(false);
    await assertSingleOwnerTree(page, { requiredText: 'primera línea' });

    await authorizeCaret(
      page,
      0,
      (await page.evaluate(() => window.__a11yHarness!.getParagraphText(0))).length
    );
    const editable = page.locator('[contenteditable="true"]');
    await editable.type('Q');
    await assertSingleOwnerTree(page, { requiredText: 'Q' });

    const endOffset = (await page.evaluate(() => window.__a11yHarness!.getParagraphText(0))).length;
    await authorizeCaret(page, 0, endOffset);
    await editable.evaluate((el) => {
      el.dispatchEvent(
        new CompositionEvent('compositionstart', { bubbles: true, cancelable: true, data: '' })
      );
    });
    await editable.type('X');
    await editable.evaluate((el) => {
      el.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true, cancelable: true, data: 'X' })
      );
    });
    await expect
      .poll(() => page.evaluate(() => window.__a11yHarness!.getParagraphText(0)))
      .toContain('X');
    await assertSingleOwnerTree(page, { requiredText: 'X' });

    await page.evaluate(() =>
      window.__a11yHarness!.reloadEditableTexts(['remoto', '', 'café ñ 日本語'])
    );
    await assertSingleOwnerTree(page, { requiredText: 'remoto' });

    await page.evaluate(() => window.__a11yHarness!.relayout({ sync: false }));
    await page.evaluate(() => window.__a11yHarness!.relayout({ sync: true }));
    await assertSingleOwnerTree(page, { requiredText: 'remoto' });

    await page.evaluate(() => window.__a11yHarness!.swapPagesContainer());
    expect(await page.evaluate(() => window.__a11yHarness!.pagesAssistiveMarker())).toBe(
      'presentation-only'
    );
    await assertSingleOwnerTree(page, { requiredText: 'remoto' });

    const pages = page.locator(
      '[data-testid="harness-pages"], [data-testid="harness-pages-spare"]'
    );
    await page.evaluate(() => window.__a11yHarness!.destroy());
    await expect(page.locator('[data-docx-input-host-mount]')).toHaveCount(0);
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
    for (const handle of await pages.all()) {
      expect(await handle.getAttribute('aria-hidden')).toBeNull();
    }
  });
});
