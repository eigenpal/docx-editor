// Bounded XML reader tests (document-engine task 2.4): DTD/entity rejection,
// order/attribute/whitespace preservation, and no value coercion.

import { describe, expect, test } from 'bun:test';
import { readXml, findElement, childElements, textContent } from '../src/package/xml-reader.ts';

describe('trust boundary rejections', () => {
  test('refuses DTDs, entity declarations, and custom entity refs', () => {
    expect(readXml('<!DOCTYPE x><x/>')).toMatchObject({ ok: false, reason: 'dtd-forbidden' });
    expect(readXml('<!ENTITY lol "z"><x/>')).toMatchObject({ ok: false, reason: 'entity-forbidden' });
    // Billion-laughs style reference to a custom entity.
    expect(readXml('<x>&lol;</x>')).toMatchObject({ ok: false, reason: 'entity-forbidden' });
    // The five predefined entities are allowed.
    expect(readXml('<x>a &amp; b</x>').ok).toBe(true);
  });
  test('enforces a size bound', () => {
    expect(readXml('<x/>', { maxBytes: 2 })).toMatchObject({ ok: false, reason: 'too-large' });
  });
});

describe('fidelity preservation', () => {
  test('preserves significant child order', () => {
    const r = readXml('<p><a/><b/><a/></p>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = findElement(r.nodes, 'p')!;
    expect(p.children.filter((c) => c.type === 'element').map((c) => (c as { name: string }).name)).toEqual(['a', 'b', 'a']);
  });

  test('preserves attributes and raw lexical values without coercion', () => {
    const r = readXml('<w:t w:space="preserve" n="007" b="true">0042</w:t>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = findElement(r.nodes, 'w:t')!;
    // Zero-padded / boolean-looking attribute values stay strings, verbatim.
    expect(t.attributes).toEqual({ 'w:space': 'preserve', n: '007', b: 'true' });
    expect(textContent(t)).toBe('0042'); // not coerced to number 42
  });

  test('preserves significant whitespace in text', () => {
    const r = readXml('<w:t>  spaced  </w:t>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(textContent(findElement(r.nodes, 'w:t')!)).toBe('  spaced  ');
  });

  test('reads a wordprocessing paragraph structure', () => {
    const xml = '<w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t> world</w:t></w:r></w:p></w:body>';
    const r = readXml(xml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const body = findElement(r.nodes, 'w:body')!;
    const paras = childElements(body, 'w:p');
    expect(paras).toHaveLength(1);
    expect(textContent(paras[0])).toBe('Hello world');
  });
});
