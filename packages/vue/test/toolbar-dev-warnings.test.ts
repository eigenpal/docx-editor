// Development warnings print in development only. A browser bundle without a `process`
// global, or with NODE_ENV replaced by "production", is production.

import { afterEach, expect, mock, test } from 'bun:test';
import { isDevelopment } from '../src/lib/is-development';
import { toolbarDevWarning } from '../src/editor/toolbar/toolbar-warnings';

const savedProcess = globalThis.process;
const savedEnv = process.env.NODE_ENV;
const savedWarn = console.warn;

function restoreProcess(): void {
  Object.defineProperty(globalThis, 'process', {
    value: savedProcess,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  restoreProcess();
  process.env.NODE_ENV = savedEnv;
  console.warn = savedWarn;
});

function withoutProcess<T>(run: () => T): T {
  delete (globalThis as { process?: unknown }).process;
  try {
    return run();
  } finally {
    restoreProcess();
  }
}

test('a page without a process global counts as production and prints nothing', () => {
  const warn = mock(() => {});
  console.warn = warn;
  expect(withoutProcess(() => isDevelopment())).toBe(false);
  withoutProcess(() => toolbarDevWarning('no process global'));
  expect(warn).not.toHaveBeenCalled();
});

test('a production build prints nothing and a development build prints once', () => {
  const warn = mock(() => {});
  console.warn = warn;
  process.env.NODE_ENV = 'production';
  expect(isDevelopment()).toBe(false);
  toolbarDevWarning('production build');
  expect(warn).not.toHaveBeenCalled();
  process.env.NODE_ENV = 'development';
  expect(isDevelopment()).toBe(true);
  toolbarDevWarning('development build');
  toolbarDevWarning('development build');
  expect(warn).toHaveBeenCalledTimes(1);
});
