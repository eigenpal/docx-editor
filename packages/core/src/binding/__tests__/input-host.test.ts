import './dom-setup.ts';

import { describe, expect, test } from 'bun:test';
import {
  createInputHostController,
  readInputHostComputedStyles,
  clampRectToViewport,
  INPUT_HOST_MIN_WIDTH_PX,
  INPUT_HOST_MIN_HEIGHT_PX,
} from '../input-host.ts';

const VIEWPORT = { x: 0, y: 0, width: 400, height: 300 };

describe('input host controller', () => {
  test('clip shell is attached, non-display:none, opacity 0, bounded, and pointer-events none', () => {
    const host = createInputHostController(document, { viewport: VIEWPORT });
    document.body.append(host.root);
    host.updatePlacement({
      frameId: { value: 1 },
      activeFrameId: { value: 1 },
      caretClientRect: { x: 120, y: 80, width: 1, height: 18 },
      viewport: VIEWPORT,
    });
    const clipStyles = readInputHostComputedStyles(host.clipShell);
    const rootStyles = readInputHostComputedStyles(host.root);
    const mountStyles = readInputHostComputedStyles(host.pmMount);
    expect(clipStyles.display).not.toBe('none');
    expect(parseFloat(clipStyles.opacity)).toBe(0);
    expect(clipStyles.pointerEvents).toBe('none');
    expect(rootStyles.pointerEvents).toBe('none');
    expect(mountStyles.pointerEvents).toBe('none');
    expect(parseInt(clipStyles.width, 10)).toBeGreaterThanOrEqual(INPUT_HOST_MIN_WIDTH_PX);
    expect(parseInt(clipStyles.height, 10)).toBeGreaterThanOrEqual(INPUT_HOST_MIN_HEIGHT_PX);
    host.destroy();
  });

  test('pointer-events none and non-overlapping placement avoid painted-page hit interception', () => {
    const host = createInputHostController(document, { viewport: VIEWPORT });
    const page = document.createElement('div');
    page.setAttribute('data-page-index', '0');
    page.style.position = 'fixed';
    page.style.left = '0';
    page.style.top = '0';
    page.style.width = '400px';
    page.style.height = '300px';
    page.style.background = 'white';
    page.style.pointerEvents = 'auto';
    document.body.append(page, host.root);
    const placement = host.updatePlacement({
      frameId: { value: 1 },
      activeFrameId: { value: 1 },
      caretClientRect: { x: 300, y: 250, width: 20, height: 20 },
      viewport: VIEWPORT,
    });
    expect(readInputHostComputedStyles(host.clipShell).pointerEvents).toBe('none');
    expect(placement.clientRect.x).toBeGreaterThan(40);
    expect(placement.clientRect.y).toBeGreaterThan(40);
    host.destroy();
    page.remove();
  });

  test('stale, pending, noCaret, and readOnly retain typed reasons and safe fallback', () => {
    const host = createInputHostController(document, { viewport: VIEWPORT });
    document.body.append(host.root);
    host.updatePlacement({
      frameId: { value: 1 },
      activeFrameId: { value: 1 },
      caretClientRect: { x: 50, y: 50, width: 20, height: 20 },
      viewport: VIEWPORT,
    });
    expect(host.updatePlacement({ frameId: { value: 1 }, activeFrameId: { value: 2 }, caretClientRect: { x: 200, y: 200, width: 20, height: 20 }, viewport: VIEWPORT }).reason).toBe('staleFrame');
    expect(host.updatePlacement({ frameId: { value: 3 }, activeFrameId: { value: 3 }, caretClientRect: null, pendingLayout: true, viewport: VIEWPORT }).reason).toBe('pendingLayout');
    expect(host.updatePlacement({ frameId: { value: 3 }, activeFrameId: { value: 3 }, caretClientRect: null, viewport: VIEWPORT }).reason).toBe('noCaret');
    expect(host.updatePlacement({ frameId: { value: 3 }, activeFrameId: { value: 3 }, caretClientRect: { x: 10, y: 10, width: 20, height: 20 }, readOnly: true, viewport: VIEWPORT }).reason).toBe('readOnly');
    host.destroy();
  });

  test('clamps negative and offscreen caret rects into viewport', () => {
    const host = createInputHostController(document, { viewport: VIEWPORT });
    document.body.append(host.root);
    const offscreen = host.updatePlacement({
      frameId: { value: 1 },
      activeFrameId: { value: 1 },
      caretClientRect: { x: -500, y: 900, width: 800, height: 400 },
      viewport: VIEWPORT,
    });
    expect(offscreen.clientRect.x).toBeGreaterThanOrEqual(0);
    expect(offscreen.clientRect.y).toBeLessThanOrEqual(VIEWPORT.height - INPUT_HOST_MIN_HEIGHT_PX);
    expect(offscreen.clientRect.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(clampRectToViewport({ x: -10, y: -10, width: 1, height: 18 }, VIEWPORT).x).toBe(0);
    host.destroy();
  });

  test('assistive policy avoids duplicate document role and redundant textbox ARIA', () => {
    const host = createInputHostController(document);
    document.body.append(host.root);
    expect(host.root.getAttribute('data-assistive-policy')).toBe('sole-semantic-projection');
    expect(host.pmMount.hasAttribute('role')).toBe(false);
    expect(host.pmMount.hasAttribute('aria-multiline')).toBe(false);
    expect(host.root.querySelector('[role="document"]')).toBeNull();
    host.destroy();
  });
});
