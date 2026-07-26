import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  DocxEditableLifecycle,
  type DocxEditableLifecycleDependencies,
  type DocxEditableLifecycleView,
} from './docxEditableLifecycle.ts';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type Shaping = { readonly id: string };
type Driver = { readonly id: string; readonly editable: boolean };
type Mount = { readonly driver: Driver; destroy(): void };

function wrapperHarness(mount: DocxEditableLifecycleDependencies<Shaping, Mount>['mount']) {
  const host = document.createElement('div');
  const published: Driver[] = [];
  const cleared: Driver[] = [];
  const statuses: string[] = [];
  const disposedShaping: string[] = [];
  let currentDriver: Driver | undefined;
  const view: DocxEditableLifecycleView<Driver> = {
    getHost: () => host,
    publishDriver: (driver) => {
      published.push(driver);
      currentDriver = driver;
    },
    clearDriver: (driver) => {
      cleared.push(driver);
      if (currentDriver === driver) currentDriver = undefined;
    },
    setStatus: (status) => statuses.push(status),
    resetReopened: () => {},
  };
  const dependencies: DocxEditableLifecycleDependencies<Shaping, Mount> = {
    loadBytes: async (url) => new TextEncoder().encode(url),
    createShaping: async () => ({ id: 'shaping' }),
    disposeShaping: (shaping) => disposedShaping.push(shaping.id),
    mount,
  };
  return {
    host,
    published,
    cleared,
    statuses,
    disposedShaping,
    currentDriver: () => currentDriver,
    lifecycle: new DocxEditableLifecycle(view, dependencies),
  };
}

for (const adapter of ['React', 'Vue'] as const) {
  describe(`${adapter} DocxEditable lifecycle`, () => {
    test('unmount during delayed font-backed mount destroys the stale mount and lease', async () => {
      const delayed = deferred<Mount>();
      let released = 0;
      const harness = wrapperHarness(async (root) => {
        root.textContent = 'stale';
        return delayed.promise;
      });

      const loading = harness.lifecycle.load('/slow.docx');
      await Promise.resolve();
      await Promise.resolve();
      harness.lifecycle.dispose();
      delayed.resolve({
        driver: { id: 'slow', editable: true },
        destroy: () => {
          released += 1;
        },
      });
      await loading;

      expect(released).toBe(1);
      expect(harness.disposedShaping).toEqual(['shaping']);
      expect(harness.published).toEqual([]);
      expect(harness.host.textContent).toBe('');
    });

    test('fixture replacement cannot let the stale mount reclaim DOM or driver ownership', async () => {
      const first = deferred<Mount>();
      let firstDestroyed = 0;
      let secondDestroyed = 0;
      const connectedDuringMount: boolean[] = [];
      const harness = wrapperHarness(async (root, bytes) => {
        connectedDuringMount.push(root.isConnected);
        const url = new TextDecoder().decode(bytes);
        const content = root.ownerDocument.createElement('section');
        content.textContent = url;
        root.replaceChildren(content);
        if (url === '/first.docx') return first.promise;
        return {
          driver: { id: 'second', editable: true },
          destroy: () => {
            secondDestroyed += 1;
          },
        };
      });

      const firstLoad = harness.lifecycle.load('/first.docx');
      await Promise.resolve();
      await Promise.resolve();
      await harness.lifecycle.load('/second.docx');
      first.resolve({
        driver: { id: 'first', editable: false },
        destroy: () => {
          firstDestroyed += 1;
        },
      });
      await firstLoad;

      expect(firstDestroyed).toBe(1);
      expect(secondDestroyed).toBe(0);
      expect(connectedDuringMount).toEqual([true, true]);
      expect(harness.host.textContent).toBe('/second.docx');
      expect(harness.host.firstElementChild?.tagName).toBe('SECTION');
      expect(harness.published.at(-1)?.id).toBe('second');
      expect(harness.currentDriver()?.id).toBe('second');
      expect(harness.statuses.at(-1)).toBe('Editable (paragraphs)');

      harness.lifecycle.dispose();
      expect(secondDestroyed).toBe(1);
      expect(harness.currentDriver()).toBeUndefined();
      expect(harness.host.textContent).toBe('');
    });
  });
}
