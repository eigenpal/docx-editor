import { expect, test } from 'bun:test';
import { alignColorPickerPopover, focusColorSwatch } from '../color-picker.ts';

function grid(left: number, width: number): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = '<button data-color-swatch aria-pressed="true"></button>';
  element.getBoundingClientRect = () =>
    ({ left, right: left + width, top: 0, bottom: 200, width, height: 200 }) as DOMRect;
  document.body.append(element);
  return element;
}

test('a popover grid past the start edge of the window aligns to the start edge', () => {
  const clipped = grid(-120, 280);
  alignColorPickerPopover(clipped);
  expect(clipped.getAttribute('data-align')).toBe('start');
  const fits = grid(40, 280);
  fits.setAttribute('data-align', 'start');
  alignColorPickerPopover(fits);
  expect(fits.hasAttribute('data-align')).toBe(false);
  clipped.remove();
  fits.remove();
});

test('opening the grid aligns it before the focus moves in', () => {
  const clipped = grid(-10, 280);
  focusColorSwatch(clipped);
  expect(clipped.getAttribute('data-align')).toBe('start');
  expect(document.activeElement).toBe(clipped.querySelector('button'));
  clipped.remove();
});
