import { test, expect } from '@playwright/test';

/**
 * Real-browser proof for the footnote-superscript line-height fix (#846).
 *
 * happy-dom does no layout, so the painter unit test can only assert the CSS
 * recipe. This measures actual rendered line-box heights in Chromium to prove
 * the mechanism: `vertical-align: super` GROWS the line box (the bug), while the
 * painter's `position: relative; top` offset leaves it at the base-font height
 * (matching what the measurement engine reserved, and what Word draws).
 *
 * Self-contained (page.setContent) — does not depend on the dev server.
 */
test('position:relative superscript keeps the line box at baseline height; vertical-align:super grows it', async ({
  page,
}) => {
  await page.setContent(`
    <style>
      body { margin: 0; }
      .line { font: 14.6667px/normal Calibri, Arial, sans-serif; width: 400px; }
      .new-sup { font-size: 0.75em; position: relative; top: -0.4em; }
      .old-sup { font-size: 0.75em; vertical-align: super; }
    </style>
    <div class="line" id="baseline">A line of body text with no reference marker at all.</div>
    <div class="line" id="newfix">A line of body text with a footnote marker<span class="new-sup">12</span> on it.</div>
    <div class="line" id="oldbug">A line of body text with a footnote marker<span class="old-sup">12</span> on it.</div>
  `);

  const h = (id: string) =>
    page.locator(`#${id}`).evaluate((el) => el.getBoundingClientRect().height);

  const baseline = await h('baseline');
  const newfix = await h('newfix');
  const oldbug = await h('oldbug');

  // New painter recipe: the superscript does NOT grow the line box.
  expect(newfix).toBeCloseTo(baseline, 1);
  // The old recipe (the bug): vertical-align:super made the line taller.
  expect(oldbug).toBeGreaterThan(baseline);
});

/**
 * Faithful reproduction of the painter's ACTUAL per-line layout. The painter
 * renders each wrapped line as a block div with a hard pixel `height` AND
 * `line-height` equal to the measured line height (renderParagraph/line.ts),
 * `overflow: visible`. This proves that, under that fixed-height regime, a
 * `position: relative` superscript cannot change the line's box height or shift
 * the following line — and quantifies the only residual effect: the raised
 * glyph paints UP into the leading above its line (a perceptual asymmetry, not
 * a line-height change).
 */
test('painter per-line fixed-height divs: superscript line is byte-identical in height and does not shift the next line', async ({
  page,
}) => {
  const LH = 18; // representative measured line height in px
  await page.setContent(`
    <style>
      body { margin: 0; }
      .stack { width: 240px; }
      .line { font-family: Calibri, Arial, sans-serif; font-size: 14.6667px;
              height: ${LH}px; line-height: ${LH}px; overflow: visible; }
      .sup { font-size: 0.75em; position: relative; top: -0.4em; }
    </style>
    <div class="stack" id="plain">
      <div class="line">one</div>
      <div class="line" id="p-mid">two with marker12</div>
      <div class="line" id="p-next">three</div>
    </div>
    <div class="stack" id="super" style="margin-top:40px">
      <div class="line">one</div>
      <div class="line" id="s-mid">two with marker<span class="sup" id="s-glyph">12</span></div>
      <div class="line" id="s-next">three</div>
    </div>
  `);

  const rect = (id: string) =>
    page.locator(`#${id}`).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height, bottom: r.bottom };
    });

  const pMid = await rect('p-mid');
  const sMid = await rect('s-mid');
  const pNext = await rect('p-next');
  const sNext = await rect('s-next');
  const glyph = await rect('s-glyph');

  // 1. The superscript line div has exactly the fixed height — same as the plain line.
  expect(sMid.height).toBe(LH);
  expect(sMid.height).toBe(pMid.height);

  // 2. The line AFTER the superscript starts at the same offset within its stack
  //    as in the plain stack (no downward push). Compare each next-line top
  //    relative to its own stack's mid-line top.
  expect(sNext.top - sMid.top).toBeCloseTo(pNext.top - pMid.top, 1);

  // 3. The only residual: the raised glyph paints ABOVE its line div's top edge
  //    (into the leading), which is the perceptual "lift" — NOT a box-height change.
  expect(glyph.top).toBeLessThan(sMid.top);
  // Report the intrusion magnitude for the record.
  console.log(
    `[superscript] glyph rises ${(sMid.top - glyph.top).toFixed(2)}px above its line div top (line-height ${LH}px); line-box height unchanged at ${sMid.height}px`
  );
});
