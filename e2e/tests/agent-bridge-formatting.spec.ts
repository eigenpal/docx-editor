/**
 * E2E for the new agent-bridge surfaces: `applyFormatting`,
 * `setParagraphStyle`, `getPageContent`. These drive the same paths the
 * `apply_formatting` / `set_paragraph_style` / `read_page` tools call.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

async function getFirstParaId(page: import('@playwright/test').Page): Promise<string | null> {
  await page.waitForFunction(() => Boolean(window.__DOCX_EDITOR_E2E__), undefined, {
    timeout: 15000,
  });
  await page
    .waitForFunction(
      () => Boolean(window.__DOCX_EDITOR_E2E__?.getFirstTextblockParaId()),
      undefined,
      { timeout: 15000 }
    )
    .catch(() => undefined);
  return await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.getFirstTextblockParaId() ?? null);
}

test.describe('Agent bridge — formatting + paged reads', () => {
  test.beforeEach(async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    // Fixture has paraIds — required for paraId-anchored mutations.
    await editor.loadDocxFile('fixtures/example-with-image.docx');
  });

  test('applyFormatting bolds an entire paragraph', async ({ page }) => {
    const paraId = await getFirstParaId(page);
    test.skip(!paraId, 'Fixture has no paraIds');

    const ok = await page.evaluate(
      ([id]) =>
        window.__DOCX_EDITOR_E2E__?.agentApplyFormatting({
          paraId: id!,
          marks: { bold: true },
        }) ?? false,
      [paraId]
    );
    expect(ok).toBe(true);

    // The layout-painter renders bold via inline `font-weight: bold` rather
    // than <strong>, so assert on the painted style.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const runs = Array.from(
              document.querySelectorAll('.paged-editor__pages [style*="font-weight"]')
            ) as HTMLElement[];
            return runs.some(
              (el) => el.style.fontWeight === 'bold' || el.style.fontWeight === '700'
            );
          }),
        { timeout: 5000 }
      )
      .toBe(true);
  });

  test('applyFormatting returns false for an unknown paraId', async ({ page }) => {
    const ok = await page.evaluate(
      () =>
        window.__DOCX_EDITOR_E2E__?.agentApplyFormatting({
          paraId: 'no_such_paraid',
          marks: { bold: true },
        }) ?? false
    );
    expect(ok).toBe(false);
  });

  test('setParagraphStyle applies a known styleId to the first paragraph', async ({ page }) => {
    const paraId = await getFirstParaId(page);
    test.skip(!paraId, 'Fixture has no paraIds');

    // Walk the fixture's available styles via the bridge — we need an id
    // that's actually defined in styles.xml because the bridge now refuses
    // unknown styles instead of silently writing them.
    const styleId = await page.evaluate(() => {
      const styles = (
        window.__DOCX_EDITOR_E2E__ as unknown as {
          getDocument?: () => {
            package?: { styles?: { styles?: Array<{ id: string; type: string }> } };
          };
        }
      )?.getDocument?.()?.package?.styles?.styles;
      const candidate = styles?.find((s) => s.type === 'paragraph');
      return candidate?.id ?? null;
    });
    test.skip(!styleId, 'Fixture has no defined paragraph styles');

    const ok = await page.evaluate(
      ([id, sid]) =>
        window.__DOCX_EDITOR_E2E__?.agentSetParagraphStyle({
          paraId: id!,
          styleId: sid!,
        }) ?? false,
      [paraId, styleId]
    );
    expect(ok).toBe(true);

    // The PM doc reflects the new styleId on that paragraph.
    const styleIdAfter = await page.evaluate(
      ([id]) => {
        const page = window.__DOCX_EDITOR_E2E__?.agentGetPageContent(1);
        if (!page) return null;
        const para = page.paragraphs.find((p) => p.paraId === id);
        return para?.styleId ?? null;
      },
      [paraId]
    );

    expect(styleIdAfter).toBe(styleId);
  });

  test('setParagraphStyle returns false for unknown styleId (no silent corruption)', async ({
    page,
  }) => {
    const paraId = await getFirstParaId(page);
    test.skip(!paraId, 'Fixture has no paraIds');

    const ok = await page.evaluate(
      ([id]) =>
        window.__DOCX_EDITOR_E2E__?.agentSetParagraphStyle({
          paraId: id!,
          styleId: 'NoSuchStyleDefinitelyMissing',
        }) ?? false,
      [paraId]
    );
    expect(ok).toBe(false);
  });

  test('getPageContent returns paragraphs on page 1 with stable paraIds', async ({ page }) => {
    const paraId = await getFirstParaId(page);
    test.skip(!paraId, 'Fixture has no paraIds');

    const result = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.agentGetPageContent(1) ?? null
    );
    expect(result).not.toBeNull();
    expect(result!.pageNumber).toBe(1);
    expect(result!.paragraphs.length).toBeGreaterThan(0);
    // First paraId on the page should be the document's first paraId.
    const paraIds = result!.paragraphs.map((p) => p.paraId);
    expect(paraIds).toContain(paraId);
  });

  test('getPageContent returns null for an out-of-range page', async ({ page }) => {
    const result = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.agentGetPageContent(9999) ?? null
    );
    expect(result).toBeNull();
  });
});
