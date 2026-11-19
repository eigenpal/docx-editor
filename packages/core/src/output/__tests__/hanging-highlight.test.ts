import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { expect, test } from 'bun:test';
import { loadFixture } from '../../layout/__tests__/punctuation-kerning-fixture.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

const prefix = '国'.repeat(19);

for (const compression of ['compressPunctuation', 'doNotCompress']) {
  test(`paint an authored highlight at a hanging mark with ${compression}`, () => {
    const fixture = loadFixture({
      text: prefix + '。余',
      available: 468,
      language: 'ja-JP',
      compatibility: 14,
      compression,
      highlight: true,
      paragraphProperties: '<w:jc w:val="both"/>',
    });
    const line = fixture.lines[0]!;
    const last = line.spans.at(-1)!;
    const right = line.box.x + line.box.width;
    expect(last.box.x + last.box.width).toBeGreaterThan(right);
    const container = document.createElement('div');
    paintSemanticLayout(container, fixture.layout, { scale: 1 });
    const painted = container.querySelector<HTMLElement>('.docx-line')!;
    expect(painted.textContent).toBe(prefix + '。');
    const run = [...painted.querySelectorAll<HTMLElement>('.layout-run-text')].at(-1)!;
    if (compression === 'compressPunctuation') {
      expect(last.box.x).toBeCloseTo(right, 6);
      expect(run.style.backgroundSize).toBe('');
      expect(run.style.backgroundColor).toBe('');
    } else {
      expect(run.style.backgroundSize).toBe('');
      expect(run.style.backgroundColor).not.toBe('');
    }
  });
}

test('paint the part of a hanging mark within the line measure', () => {
  const fixture = loadFixture({
    text: prefix + '。余',
    available: 456,
    language: 'ja-JP',
    compatibility: 15,
    compression: 'compressPunctuation',
    highlight: true,
    paragraphProperties: '<w:jc w:val="both"/><w:overflowPunct/>',
  });
  const line = fixture.lines[0]!;
  const last = line.spans.at(-1)!;
  const room = line.box.x + line.box.width - last.box.x;
  expect(room).toBeGreaterThan(0);
  expect(room).toBeLessThan(last.box.width);
  const container = document.createElement('div');
  paintSemanticLayout(container, fixture.layout, { scale: 1 });
  const painted = container.querySelector<HTMLElement>('.docx-line')!;
  expect(painted.textContent).toBe(prefix + '。');
  const run = [...painted.querySelectorAll<HTMLElement>('.layout-run-text')].at(-1)!;
  expect(parseFloat(run.style.backgroundSize)).toBeCloseTo(room, 6);
  expect(run.style.backgroundColor).toBe('');
});
