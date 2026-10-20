// The Vue copy of `downloadName` must stay linear on a hostile title, like the React one.
// The full behavior suite lives in `packages/react/test/menu-download-name.test.ts`;
// `check:adapter-mirror` keeps the two copies byte-identical so that suite covers both.

import { describe, expect, test } from 'bun:test';
import { downloadName } from '../src/editor/menu/download.ts';

describe('downloadName', () => {
  test('a long run of dots and spaces before the end stays linear', () => {
    expect(downloadName(`a${'. '.repeat(100_000)}b`)).toBe('a.docx');
    expect(downloadName(`a${'. '.repeat(100_000)}`)).toBe('a.docx');
  });

  test('a device name with an extension and a padded suffix are handled', () => {
    expect(downloadName('NUL')).toBe('document.docx');
    expect(downloadName('NUL.tar')).toBe('_NUL.tar.docx');
    expect(downloadName('report.docx ')).toBe('report.docx');
  });

  test('truncation that ends on a dot or a space does not leave one', () => {
    expect(downloadName(`${'a'.repeat(199)}.b`)).toBe(`${'a'.repeat(199)}.docx`);
    expect(downloadName(`${'a'.repeat(199)} b`)).toBe(`${'a'.repeat(199)}.docx`);
  });
});
