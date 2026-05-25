import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

// Heading1 paragraphs in this fixture inherit a list marker from numId=11 but
// override pPr.ind with `<w:ind w:left="0" w:firstLine="720"/>`. Per
// ECMA-376 §17.3.1.12, w:firstLine implicitly clears the inherited
// w:hanging, so the effective indent is {left:0, firstLine:720, hanging:0}.
// The painter must render the marker inline at the firstLine offset, not on
// a separate row above the body text — that was the bug in #483.
test.describe('issue #483: list marker with firstLine indent and no hanging slot', () => {
  test('marker renders inline with first body line and pages do not overlap', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.loadDocxFile('fixtures/issue-483-firstline-marker.docx');

    const report = await page.evaluate(() => {
      const pages = Array.from(document.querySelectorAll('[data-page-number]'));
      // For every painted line, ensure no other line at any earlier index
      // sits on top of it (same Y range AND overlapping X range).
      const realOverlaps: Array<{ page: number; cur: string; prev: string; yOverlap: number }> = [];
      pages.forEach((page, pi) => {
        const rects = Array.from(page.querySelectorAll('.layout-line')).map((l) => {
          const r = (l as HTMLElement).getBoundingClientRect();
          return { r, t: l.textContent ?? '' };
        });
        rects.sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
        for (let i = 1; i < rects.length; i++) {
          const cur = rects[i];
          for (let j = i - 1; j >= 0 && rects[j].r.top > cur.r.top - 30; j--) {
            const p = rects[j];
            const yOverlap = p.r.bottom - cur.r.top;
            const xOverlap = Math.min(p.r.right, cur.r.right) - Math.max(p.r.left, cur.r.left);
            if (yOverlap > 0.5 && xOverlap > 0.5) {
              realOverlaps.push({
                page: pi + 1,
                cur: cur.t.slice(0, 30),
                prev: p.t.slice(0, 30),
                yOverlap: +yOverlap.toFixed(2),
              });
              break;
            }
          }
        }
      });

      // For each numbered Heading1 paragraph that actually carries a marker
      // (skip head fragments with numbering suppressed, and continuation
      // fragments which never carry the marker), confirm:
      //  (a) the marker is the first child of its first line element
      //      (inline, not a separate sibling row above the body text), and
      //  (b) the body text starts at the explicit num tab stop position —
      //      §17.9.25 default `w:suff="tab"`. For this fixture, firstLine
      //      = 720 twips (48 px) and the num tab stop is at 1080 twips
      //      (72 px), so the body text's first run should start ≈72 px
      //      from the paragraph's left edge.
      const headings = Array.from(
        document.querySelectorAll('[data-style-id="Heading1"][data-block-id]')
      ).filter(
        (el) =>
          el.getAttribute('data-continues-from-prev') !== 'true' &&
          !!el.querySelector('.layout-list-marker')
      ) as HTMLElement[];
      const inlineMarker = headings.map((h) => {
        const blockLeft = h.getBoundingClientRect().left;
        const firstLine = h.querySelector('.layout-line');
        const firstChild = firstLine?.firstElementChild;
        const isInline = firstChild?.classList.contains('layout-list-marker') ?? false;
        const marker = isInline ? (firstChild as HTMLElement) : null;
        const markerText = marker?.textContent ?? '';
        const firstBodyRun = marker?.nextElementSibling as HTMLElement | null;
        const bodyLeftRel = firstBodyRun
          ? firstBodyRun.getBoundingClientRect().left - blockLeft
          : null;
        return {
          id: h.getAttribute('data-block-id'),
          markerText,
          isInline,
          bodyLeftRel: bodyLeftRel === null ? null : +bodyLeftRel.toFixed(1),
        };
      });

      return { realOverlaps, inlineMarker };
    });

    // No painted line should overlap another (the original symptom was a
    // ~15px overlap between the last line of the first fragment and the
    // first line of its continuation fragment on page 2).
    expect(report.realOverlaps).toEqual([]);

    // The fixture has at least four Heading1 paragraphs; each one should
    // render its marker inline as the first child of its first line, and
    // the body text should align at the num tab stop (1080 twips ≈ 72 px).
    // Tolerance is 1 px for sub-pixel rendering.
    const EXPECTED_BODY_LEFT_PX = 72;
    expect(report.inlineMarker.length).toBeGreaterThanOrEqual(4);
    for (const m of report.inlineMarker) {
      expect(m.isInline).toBe(true);
      expect(m.markerText).toMatch(/^\d+\.$/);
      expect(m.bodyLeftRel).not.toBeNull();
      expect(Math.abs((m.bodyLeftRel ?? 0) - EXPECTED_BODY_LEFT_PX)).toBeLessThan(1);
    }
  });
});
