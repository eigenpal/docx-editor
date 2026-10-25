import { expect, test } from 'bun:test';
import { placeSubmenu, submenuKeys } from '../submenu-placement.ts';

const view = { width: 1440, height: 900 };
const panel = { width: 240, height: 200 };

test('a left-to-right submenu opens to the right, and to the left when it does not fit', () => {
  expect(placeSubmenu({ left: 400, right: 600, top: 100 }, panel, view, false)).toEqual({
    left: 600,
    top: 96,
  });
  expect(placeSubmenu({ left: 1100, right: 1300, top: 100 }, panel, view, false).left).toBe(860);
});

test('a right-to-left submenu opens to the left, and to the right when it does not fit', () => {
  expect(placeSubmenu({ left: 830, right: 1050, top: 440 }, panel, view, true).left).toBe(590);
  expect(placeSubmenu({ left: 100, right: 300, top: 440 }, panel, view, true).left).toBe(300);
});

test('a submenu on a low row rises to stay in view', () => {
  expect(placeSubmenu({ left: 400, right: 600, top: 850 }, panel, view, false).top).toBe(692);
});

test('the inline-end arrow opens a submenu', () => {
  expect(submenuKeys(false)).toEqual({ open: 'ArrowRight', close: 'ArrowLeft' });
  expect(submenuKeys(true)).toEqual({ open: 'ArrowLeft', close: 'ArrowRight' });
});
