// The pages layer's editable chrome is written only when it changes.
//
// A write of `contenteditable` makes a browser resolve pending style at once, even with the
// value the element already has, and the editing mode is set by paths that do not change it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { applyPagesEditableChrome } from '../surface-view-mode.ts';

/** A pages layer that records every attribute write it receives. */
function recordedLayer(): { layer: HTMLElement; writes: string[] } {
  const layer = document.createElement('div');
  const writes: string[] = [];
  const setAttribute = layer.setAttribute.bind(layer);
  const removeAttribute = layer.removeAttribute.bind(layer);
  layer.setAttribute = (name: string, value: string) => {
    writes.push(`set ${name}=${value}`);
    setAttribute(name, value);
  };
  layer.removeAttribute = (name: string) => {
    writes.push(`remove ${name}`);
    removeAttribute(name);
  };
  return { layer, writes };
}

const chromeOf = (layer: HTMLElement) => ({
  contenteditable: layer.getAttribute('contenteditable'),
  readonly: layer.getAttribute('aria-readonly'),
  tabindex: layer.getAttribute('tabindex'),
});

describe('the editable chrome of the pages layer', () => {
  test('editable pages take input and need no tab stop of their own', () => {
    const { layer } = recordedLayer();
    applyPagesEditableChrome(layer, true);
    expect(chromeOf(layer)).toEqual({
      contenteditable: 'true',
      readonly: 'false',
      tabindex: null,
    });
  });

  test('pages that are not editable stay focusable for the reader', () => {
    const { layer } = recordedLayer();
    applyPagesEditableChrome(layer, false);
    expect(chromeOf(layer)).toEqual({
      contenteditable: 'false',
      readonly: 'true',
      tabindex: '0',
    });
  });

  test('applying the state the layer already has writes nothing', () => {
    for (const editable of [true, false]) {
      const { layer, writes } = recordedLayer();
      applyPagesEditableChrome(layer, editable);
      const settled = chromeOf(layer);
      writes.length = 0;
      applyPagesEditableChrome(layer, editable);
      applyPagesEditableChrome(layer, editable);
      expect(writes).toEqual([]);
      expect(chromeOf(layer)).toEqual(settled);
    }
  });

  test('each change of state lands in full, in both directions', () => {
    const { layer } = recordedLayer();
    applyPagesEditableChrome(layer, true);
    applyPagesEditableChrome(layer, false);
    expect(chromeOf(layer)).toEqual({
      contenteditable: 'false',
      readonly: 'true',
      tabindex: '0',
    });
    applyPagesEditableChrome(layer, true);
    expect(chromeOf(layer)).toEqual({
      contenteditable: 'true',
      readonly: 'false',
      tabindex: null,
    });
  });

  test('a host that changed an attribute itself is corrected on the next write', () => {
    const { layer } = recordedLayer();
    applyPagesEditableChrome(layer, false);
    layer.setAttribute('contenteditable', 'true');
    layer.removeAttribute('tabindex');
    applyPagesEditableChrome(layer, false);
    expect(chromeOf(layer)).toEqual({
      contenteditable: 'false',
      readonly: 'true',
      tabindex: '0',
    });
  });
});
