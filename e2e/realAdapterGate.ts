// Paired Chromium gate for production React/Vue adapters (interactive-paginated 4.8).
// Proves the hidden input-host mechanism through public @docx-editor.dev/react|vue entries.

// Pins its fixture explicitly (M6D.1 follow-up).
//
// This gate proves the hidden input-host MECHANISM, not which document the demo opens by
// default. When M6D.1 changed the React default to the comprehensive fixture, these
// assertions — written against `editable-sample.docx` content — went red, and the paired
// gate broke because the two adapters no longer opened the same document. A gate must
// control its own input.
import { test, expect } from '@playwright/test';
import {
  assertAppliedPlacementState,
  assertBlurredWithRetainedSelection,
  assertCaretPlacement,
  assertInputHostShell,
  assertPaintedPagesHidden,
  assertRefocusedViaDriver,
  assertSingleOwnerTree,
  authorizeCaret,
  blurEditable,
  driverFocus,
  mountRealAdapter,
  paragraphText,
  scrollEditor,
  selectionIdentity,
  setHarnessZoom,
} from './realAdapterGateHelpers.ts';

export function realAdapterGate(adapter: string, baseUrl: string): void {
  test.describe(`${adapter} production adapter input-host gate`, () => {
    test('exposes one editable owner and hides painted pages from assistive technology', async ({ page }) => {
      await mountRealAdapter(page, baseUrl);
      await assertPaintedPagesHidden(page);
      await assertInputHostShell(page);
      await assertSingleOwnerTree(page, 'Edit me');
      expect(await page.evaluate(() => window.__docxAdapterDriver!.accessibilityObservation().owner)).toBe(
        'proseMirrorInputHost',
      );
    });

    test('authorizes caret via setSelection + focus and places the clip shell on engine caret', async ({ page }) => {
      await mountRealAdapter(page, baseUrl);
      await authorizeCaret(page, 0, 0);
      await assertCaretPlacement(page);
      await expect(page.locator('[contenteditable="true"]')).toBeFocused();
      await assertSingleOwnerTree(page, 'Edit me');
    });

    test('trusted keyboard input commits once, repaints, and survives save/reopen', async ({ page }) => {
      await mountRealAdapter(page, baseUrl);
      const revisionBefore = await page.evaluate(() => window.__docxAdapterDriver!.modelRevision());
      const endOffset = (await paragraphText(page, 0)).length;
      const blockId = (await selectionIdentity(page))?.blockId ?? (await page.evaluate(() => {
        const entry = window.__docxAdapterDriver!.accessibilityObservation().entries.find((e) => e.role === 'editableParagraph');
        return entry?.identity.blockId ?? '';
      }));

      await authorizeCaret(page, 0, endOffset);
      await assertAppliedPlacementState(page, { requiredText: 'Edit me', selectionBlockId: blockId });

      const editable = page.locator('[contenteditable="true"]');
      await editable.type('Z');

      await expect
        .poll(() => page.evaluate(() => window.__docxAdapterDriver!.accessibilityObservation().entries[0]?.text ?? ''))
        .toContain('Z');
      expect(await page.evaluate(() => window.__docxAdapterDriver!.modelRevision())).toBeGreaterThan(revisionBefore);
      expect(await page.evaluate(() => window.__docxAdapterDriver!.displaySnapshot().text)).toContain('Z');
      await assertAppliedPlacementState(page, { requiredText: 'Z', selectionBlockId: blockId });

      const reopened = await page.evaluate(() => window.__docxAdapterDriver!.saveAndReopenText());
      expect(reopened).toContain('Z');
    });

    test('synthetic composition lifecycle commits exactly once without duplicate tree content', async ({ page }) => {
      await mountRealAdapter(page, baseUrl);
      const revisionBefore = await page.evaluate(() => window.__docxAdapterDriver!.modelRevision());
      const endOffset = (await paragraphText(page, 0)).length;
      const blockId = await page.evaluate(() => {
        const entry = window.__docxAdapterDriver!.accessibilityObservation().entries.find((e) => e.role === 'editableParagraph');
        return entry?.identity.blockId ?? '';
      });

      await authorizeCaret(page, 0, endOffset);
      const editable = page.locator('[contenteditable="true"]');

      await editable.evaluate((el) => {
        el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, cancelable: true, data: '' }));
      });
      await assertSingleOwnerTree(page, 'Edit me');

      await editable.type('X');
      await editable.evaluate((el) => {
        el.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, cancelable: true, data: 'X' }));
      });
      await assertSingleOwnerTree(page, 'Edit me');

      await editable.evaluate((el) => {
        el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, cancelable: true, data: 'X' }));
      });

      await expect.poll(() => paragraphText(page, 0)).toContain('X');
      expect(await page.evaluate(() => window.__docxAdapterDriver!.modelRevision())).toBeGreaterThan(revisionBefore);
      await assertAppliedPlacementState(page, { requiredText: 'X', selectionBlockId: blockId });
    });

    test('zoom change uses adapter host metrics and keeps applied caret placement', async ({ page }) => {
      await mountRealAdapter(page, baseUrl, 'realAdapter=1&zoom=1');
      await authorizeCaret(page, 0, 0);
      await assertCaretPlacement(page);

      await setHarnessZoom(page, 1.5);
      await assertAppliedPlacementState(page, { requiredText: 'Edit me' });
      expect(await page.evaluate(() => window.__docxAdapterHarness!.getZoom())).toBe(1.5);
    });

    test('undo, scroll, and explicit relayout preserve applied placement and semantic identity', async ({ page }) => {
      await mountRealAdapter(page, baseUrl);
      const blockId = await page.evaluate(() => {
        const entry = window.__docxAdapterDriver!.accessibilityObservation().entries.find((e) => e.role === 'editableParagraph');
        return entry?.identity.blockId ?? '';
      });

      await authorizeCaret(page, 0, (await paragraphText(page, 0)).length);
      await assertAppliedPlacementState(page, { requiredText: 'Edit me', selectionBlockId: blockId });

      const editable = page.locator('[contenteditable="true"]');
      await editable.type('Q');
      await assertAppliedPlacementState(page, { selectionBlockId: blockId });
      const identityAfterEdit = (await selectionIdentity(page))!;

      await blurEditable(page);
      await assertBlurredWithRetainedSelection(page, identityAfterEdit);

      await driverFocus(page);
      await assertRefocusedViaDriver(page, identityAfterEdit);

      await page.evaluate(() => window.__docxAdapterDriver!.exec({ type: 'undo' }));
      await assertAppliedPlacementState(page, { requiredText: 'Edit me', selectionBlockId: blockId });

      await scrollEditor(page, 48);
      await assertAppliedPlacementState(page, { requiredText: 'Edit me', selectionBlockId: blockId });

      await page.evaluate(() => window.__docxAdapterDriver!.relayout());
      await assertAppliedPlacementState(page, { requiredText: 'Edit me', selectionBlockId: blockId });

      await authorizeCaret(page, 0, (await paragraphText(page, 0)).length);
      await editable.type('!');
      await expect.poll(() => paragraphText(page, 0)).toContain('!');
      await assertAppliedPlacementState(page, { selectionBlockId: blockId });
    });
  });
}
