import { expect, test } from 'bun:test';
import { createTextFormFieldChrome } from '../text-form-field-chrome.ts';
import type { TextFormFieldDialogSession } from '../text-form-field-session.ts';

function session(): TextFormFieldDialogSession {
  const controller = new AbortController();
  return {
    field: {} as TextFormFieldDialogSession['field'],
    signal: controller.signal,
    canApply: () => !controller.signal.aborted,
    apply: () => false,
    cancel: () => controller.abort(),
  };
}

test('Field Options chrome supports reused handlers and out-of-order disposal', () => {
  const chrome = createTextFormFieldChrome();
  const requests: TextFormFieldDialogSession[] = [];
  const handlers = { onRequest: (request: TextFormFieldDialogSession) => requests.push(request) };
  expect(chrome.request(session())).toBe(false);
  const disposeFirst = chrome.register(handlers);
  const first = session();
  expect(chrome.request(first)).toBe(true);
  const disposeSecond = chrome.register(handlers);
  const second = session();
  expect(chrome.request(second)).toBe(true);
  disposeFirst();
  expect(first.signal.aborted).toBe(true);
  expect(second.signal.aborted).toBe(false);
  disposeFirst();
  const third = session();
  expect(chrome.request(third)).toBe(true);
  disposeSecond();
  expect(second.signal.aborted).toBe(true);
  expect(third.signal.aborted).toBe(true);
  expect(chrome.request(session())).toBe(false);
  expect(requests).toEqual([first, second, third]);
});

for (const fallbackFirst of [true, false]) {
  test(`manual chrome outranks adapter fallback (fallback first: ${fallbackFirst})`, () => {
    const chrome = createTextFormFieldChrome();
    const calls: string[] = [];
    const fallback = () =>
      chrome.register(
        {
          onRequest: (request) => {
            calls.push('fallback');
            request.cancel();
          },
        },
        { fallback: true }
      );
    const manual = () =>
      chrome.register({
        onRequest: () => {
          calls.push('manual');
        },
      });
    let disposeManual: () => void;
    let disposeFallback: () => void;
    if (fallbackFirst) {
      disposeFallback = fallback();
      disposeManual = manual();
    } else {
      disposeManual = manual();
      disposeFallback = fallback();
    }
    const custom = session();
    expect(chrome.request(custom)).toBe(true);
    expect(calls).toEqual(['manual']);
    expect(custom.signal.aborted).toBe(false);
    disposeManual();
    expect(custom.signal.aborted).toBe(true);
    const suppressed = session();
    expect(chrome.request(suppressed)).toBe(true);
    expect(suppressed.signal.aborted).toBe(true);
    expect(calls).toEqual(['manual', 'fallback']);
    disposeFallback();
    expect(chrome.request(session())).toBe(false);
  });
}
