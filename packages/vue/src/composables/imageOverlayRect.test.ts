import { describe, expect, test } from 'bun:test';
import { computeImageOverlayRect } from './imageOverlayRect';

/**
 * Issue #764 — the Vue image-selection frame was shifted right on platforms
 * with classic scrollbars, because `scrollbar-gutter: stable both-edges`
 * reserves an inline-start gutter the overlay math didn't subtract.
 */
describe('computeImageOverlayRect (#764)', () => {
  const base = {
    imageRect: { left: 300, top: 200, width: 120, height: 80 },
    parentRect: { left: 100, top: 50 },
    scrollLeft: 0,
    scrollTop: 0,
    zoom: 1,
  };

  test('no reserved gutter (overlay scrollbars, e.g. macOS) → unchanged', () => {
    const r = computeImageOverlayRect({
      ...base,
      parentOffsetWidth: 800,
      parentClientWidth: 800, // no gutter
    });
    expect(r.left).toBe(200); // 300 - 100
    expect(r.top).toBe(150); // 200 - 50
    expect(r.width).toBe(120);
    expect(r.height).toBe(80);
  });

  test('classic scrollbars with both-edges → subtract the inline-start gutter', () => {
    // 30px total reserved (15px each edge); left frame must shift left by 15.
    const r = computeImageOverlayRect({
      ...base,
      parentOffsetWidth: 800,
      parentClientWidth: 770,
    });
    expect(r.left).toBe(185); // 300 - 100 - 15
    expect(r.top).toBe(150); // vertical is unaffected
  });

  test('honors scrollLeft/scrollTop and zoom', () => {
    const r = computeImageOverlayRect({
      ...base,
      scrollLeft: 10,
      scrollTop: 40,
      parentOffsetWidth: 800,
      parentClientWidth: 770, // 15px left gutter
      zoom: 2,
    });
    // (300 - 100 - 15 + 10) / 2 = 97.5 ; (200 - 50 + 40) / 2 = 95
    expect(r.left).toBeCloseTo(97.5, 5);
    expect(r.top).toBeCloseTo(95, 5);
    expect(r.width).toBe(60);
    expect(r.height).toBe(40);
  });

  test('never subtracts a negative gutter', () => {
    const r = computeImageOverlayRect({
      ...base,
      parentOffsetWidth: 700,
      parentClientWidth: 800, // pathological; clamp to 0
    });
    expect(r.left).toBe(200);
  });
});
