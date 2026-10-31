import { expect, test } from 'bun:test';
import { createOutputCapture } from './output-capture.mjs';

test('output under the bounds is kept whole', () => {
  const capture = createOutputCapture({ head: 8, tail: 8, limit: 100 });
  capture.write(Buffer.from('abc'));
  capture.write('def');
  expect(capture.text()).toBe('abcdef');
  expect(capture.bytes).toBe(6);
  expect(capture.overLimit).toBe(false);
});

test('output past the bounds keeps its start and end and counts the rest', () => {
  const capture = createOutputCapture({ head: 4, tail: 6, limit: 100 });
  for (const chunk of ['HEAD', '-middle-', 'more-', 'xx', 'TAIL!!']) capture.write(chunk);
  expect(capture.text()).toBe('HEAD\n[... 15 bytes of output omitted ...]\nTAIL!!');
  expect(capture.overLimit).toBe(false);
});

test('one chunk larger than the tail keeps only its end', () => {
  const capture = createOutputCapture({ head: 2, tail: 3, limit: 100 });
  capture.write('ab0123456789');
  expect(capture.text()).toBe('ab\n[... 7 bytes of output omitted ...]\n789');
});

test('output over the limit is reported as over it', () => {
  const capture = createOutputCapture({ head: 2, tail: 2, limit: 10 });
  capture.write('0123456789A');
  expect(capture.overLimit).toBe(true);
  expect(capture.text()).toContain(
    'wrote 11 bytes of output, more than the 10-byte limit, and was stopped'
  );
});

test('a long flood is held in bounded memory', () => {
  const capture = createOutputCapture({ head: 1024, tail: 4096, limit: 1 << 30 });
  const chunk = Buffer.alloc(65536, 120);
  for (let index = 0; index < 2048; index += 1) capture.write(chunk);
  expect(capture.bytes).toBe(65536 * 2048);
  expect(capture.text().length).toBeLessThan(1024 + 4096 + 100);
});
