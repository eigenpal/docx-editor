import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { measureInteractionHostMetrics } from '../src/host-metrics.ts';

describe('measureInteractionHostMetrics', () => {
  test('reads scroll container client origin, scroll offsets, and zoom', () => {
    const scroll = document.createElement('div');
    scroll.scrollLeft = 12;
    scroll.scrollTop = 8;
    scroll.getBoundingClientRect = () =>
      ({
        x: 40,
        y: 60,
        width: 800,
        height: 600,
        top: 60,
        left: 40,
        right: 840,
        bottom: 660,
        toJSON: () => ({}),
      }) as DOMRect;

    expect(measureInteractionHostMetrics(scroll, 1.25)).toEqual({
      clientOrigin: { x: 40, y: 60 },
      scrollOffset: { x: 12, y: 8 },
      zoom: 1.25,
    });
  });
});
