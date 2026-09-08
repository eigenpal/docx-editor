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
