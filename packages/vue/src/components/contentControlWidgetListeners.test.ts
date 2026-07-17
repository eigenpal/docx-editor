import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { bindContentControlWidgetListeners } from './contentControlWidgetListeners';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

describe('bindContentControlWidgetListeners', () => {
  test('binds only pages-ready synchronization and removes delegated listeners', () => {
    const container = document.createElement('div');
    const calls = {
      mouseDown: 0,
      click: 0,
      keyDown: 0,
      pagesReady: 0,
    };
    const unbind = bindContentControlWidgetListeners(container, {
      onMouseDown: () => calls.mouseDown++,
      onClick: () => calls.click++,
      onKeyDown: () => calls.keyDown++,
      onPagesReady: () => calls.pagesReady++,
    });

    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    container.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    container.dispatchEvent(new Event('docx-editor-vue:painted-pages-ready'));
    container.dispatchEvent(new Event('painter:painted'));
    expect(calls).toEqual({
      mouseDown: 1,
      click: 1,
      keyDown: 1,
      pagesReady: 1,
    });

    unbind();
    unbind();
    container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    container.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    container.dispatchEvent(new Event('docx-editor-vue:painted-pages-ready'));
    container.dispatchEvent(new Event('painter:painted'));

    expect(calls).toEqual({
      mouseDown: 1,
      click: 1,
      keyDown: 1,
      pagesReady: 1,
    });
  });
});
