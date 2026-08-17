// The field-link registry: HYPERLINK instructions crossing the surface trust boundary.
//
// The raw target is attacker-controlled. Everything a DOM sink could see comes out of this
// registry already sanitized, and every minted id resolves back to its record so a click on
// the painted anchor means something.

import { describe, expect, test } from 'bun:test';
import { createFieldLinkRegistry } from '../surface-field-links.ts';

describe('projecting a field link', () => {
  test('an absolute allowlisted target becomes an external record', () => {
    const registry = createFieldLinkRegistry();
    const record = registry.project({
      target: 'https://example.com/Path%20A',
      anchor: null,
      tooltip: 'Visit',
    });
    expect(record).toEqual({
      id: 'field-hyperlink:1',
      kind: 'external',
      href: 'https://example.com/Path%20A',
      tooltip: 'Visit',
    });
  });

  test('a javascript: target with an \\l anchor falls back to the anchor', () => {
    const registry = createFieldLinkRegistry();
    const record = registry.project({
      target: 'javascript:alert(1)',
      anchor: 'section3',
      tooltip: null,
    });
    expect(record).toMatchObject({ kind: 'internal', href: '#section3', anchor: 'section3' });
  });

  test('a javascript: target with no anchor projects nothing', () => {
    const registry = createFieldLinkRegistry();
    expect(registry.project({ target: 'javascript:alert(1)', anchor: null, tooltip: null })).toBe(
      null
    );
  });

  test('a smuggled scheme is refused after the control characters are stripped', () => {
    const registry = createFieldLinkRegistry();
    expect(
      registry.project({ target: 'java\tscript:alert(1)', anchor: null, tooltip: null })
    ).toBeNull();
  });

  test('a relative target is refused — it would resolve against the host origin', () => {
    const registry = createFieldLinkRegistry();
    expect(registry.project({ target: 'evil/page.html', anchor: null, tooltip: null })).toBeNull();
    expect(registry.project({ target: '//evil.example', anchor: null, tooltip: null })).toBeNull();
  });

  test('an anchor-only spec is an internal record with a sanitized fragment', () => {
    const registry = createFieldLinkRegistry();
    const record = registry.project({ target: null, anchor: 'top', tooltip: null });
    expect(record).toMatchObject({ kind: 'internal', href: '#top', anchor: 'top' });
  });

  test('a hostile anchor keeps the link inert but present', () => {
    const registry = createFieldLinkRegistry();
    const record = registry.project({
      target: null,
      anchor: 'javascript:alert(1)',
      tooltip: null,
    });
    expect(record).toMatchObject({ kind: 'internal', href: null });
  });
});

describe('identity and resolution', () => {
  test('the same spec projects the same id; a different spec a different one', () => {
    const registry = createFieldLinkRegistry();
    const spec = { target: 'https://example.com', anchor: null, tooltip: null };
    const first = registry.project(spec)!;
    const again = registry.project({ ...spec })!;
    const other = registry.project({
      target: 'https://other.example',
      anchor: null,
      tooltip: null,
    })!;
    expect(again.id).toBe(first.id);
    expect(other.id).not.toBe(first.id);
  });

  test('a minted id resolves back to a record a click can act on', () => {
    const registry = createFieldLinkRegistry();
    const record = registry.project({
      target: 'https://example.com',
      anchor: null,
      tooltip: 'Visit',
    })!;
    const resolved = registry.linkById(record.id);
    expect(resolved).toMatchObject({
      id: record.id,
      kind: 'external',
      href: 'https://example.com',
      authored: 'https://example.com',
      tooltip: 'Visit',
    });
    // No `w:hyperlink` node backs it, so it addresses no range the editing lane could touch.
    expect(resolved!.paragraphId).toBe('');
    expect(registry.linkById('field-hyperlink:999')).toBeNull();
  });
});
