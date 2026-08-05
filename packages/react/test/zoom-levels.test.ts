import { describe, expect, test } from 'bun:test';
import { ZOOM_LEVELS, stepZoomLevel, zoomLevelForShortcut } from '../src/editor/zoom-levels.ts';

describe('React zoom levels', () => {
  test('steps through the toolbar presets and stops at the bounds', () => {
    expect(ZOOM_LEVELS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
    expect(stepZoomLevel(1, 'in')).toBe(1.25);
    expect(stepZoomLevel(1, 'out')).toBe(0.75);
    expect(stepZoomLevel(2, 'in')).toBeNull();
    expect(stepZoomLevel(0.5, 'out')).toBeNull();
  });

  test('maps keyboard spellings and keeps recognized bound events owned', () => {
    expect(zoomLevelForShortcut('=', 1)).toBe(1.25);
    expect(zoomLevelForShortcut('+', 1)).toBe(1.25);
    expect(zoomLevelForShortcut('-', 1)).toBe(0.75);
    expect(zoomLevelForShortcut('0', 1.5)).toBe(1);
    expect(zoomLevelForShortcut('+', 2)).toBe(2);
    expect(zoomLevelForShortcut('x', 1)).toBeNull();
  });
});
