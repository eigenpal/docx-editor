/** @spike-features engine-neutral-editor-driver-contract, bold-mark, italic-mark */
import { describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createPocDocxFixture } from '../src/poc/docx';
import { createPocEditorDriver, type PocEditorDriverHost } from '../browser/driver';
import type { EditorDriver } from '../src/driver/editor-driver';

GlobalRegistrator.register();

let nextDriverClientId = 710;

function createDriverHosts(): {
  host: HTMLDivElement;
  driver: ReturnType<typeof createPocEditorDriver>;
} {
  const host = document.createElement('div');
  host.setAttribute('data-poc-root', 'true');
  host.innerHTML =
    '<div id="editable-host"></div><div id="replica-host"></div><div id="poc-status" aria-live="polite"></div>';
  document.body.appendChild(host);
  const editableClientId = nextDriverClientId++;
  const replicaClientId = nextDriverClientId++;
  const driver = createPocEditorDriver({
    editableHost: host.querySelector('#editable-host')!,
    replicaHost: host.querySelector('#replica-host')!,
    statusHost: host.querySelector('#poc-status')!,
    editableClientId,
    replicaClientId,
  });
  return { host, driver };
}

function assertDriverShape(driver: EditorDriver): void {
  expect(typeof driver.loadDocx).toBe('function');
  expect(typeof driver.selectText).toBe('function');
  expect(typeof driver.type).toBe('function');
  expect(typeof driver.execute).toBe('function');
  expect(typeof driver.query).toBe('function');
  expect(typeof driver.undo).toBe('function');
  expect(typeof driver.save).toBe('function');
  expect('getView' in driver).toBe(false);
  expect('getEditorView' in driver).toBe(false);
}

describe('poc EditorDriver boundary', () => {
  test('driver exposes engine-neutral methods without EditorView', () => {
    const { host, driver } = createDriverHosts();
    assertDriverShape(driver);
    host.remove();
  });

  test('load, edit, bold, inspect, and undo through the public driver', async () => {
    const { host, driver } = createDriverHosts();

    await driver.loadDocx(await createPocDocxFixture());
    await driver.selectText('bold');
    expect(await driver.query({ type: 'selectedText' })).toEqual({ type: 'selectedText', text: 'bold' });
    expect(await driver.execute({ type: 'toggleMark', mark: 'bold' })).toEqual({
      status: 'applied',
      changed: true,
    });
    expect(await driver.query({ type: 'selectionFormatting' })).toEqual({
      type: 'selectionFormatting',
      formatting: { bold: false, italic: false },
    });
    await driver.type('!');
    expect((host as PocEditorDriverHost & HTMLElement).dataset.syncStatus).toBe('converged');
    expect(await driver.undo()).toEqual({ status: 'applied', changed: true });
    expect(await driver.save()).toMatchObject({ status: 'failed', code: 'not-implemented' });
    host.remove();
  });

  test('italic command is schema-valid and toggles through execute', async () => {
    const { host, driver } = createDriverHosts();
    await driver.loadDocx(await createPocDocxFixture());
    await driver.selectText('italic');
    expect(await driver.execute({ type: 'toggleMark', mark: 'italic' })).toEqual({
      status: 'applied',
      changed: true,
    });
    host.remove();
  });
});
