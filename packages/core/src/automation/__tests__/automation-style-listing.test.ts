// The `getStyles` read: every style `styles.xml` defines, built once per package revision.
//
// A batch that lists styles several times (a load, a count, a lookup, a load per item) must not
// rebuild the listing per operation. The listing is cached on the package reads, so every answer at
// one revision is the same frozen array, and a write that publishes a new revision builds a new one.

import { describe, expect, test } from 'bun:test';
import { docx, open, p, paragraphsOf, roots } from './support/protocol.ts';
import type { AutomationStyleRead } from '../style-listing.ts';
import type { AutomationHost } from '../protocol.ts';

const STYLES =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="character" w:styleId="QuoteChar"><w:name w:val="Quote"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>' +
  // Duplicated children: the last one wins, as the store index reads `w:basedOn`.
  '<w:basedOn w:val="Missing"/><w:basedOn w:val="Normal"/>' +
  // A next style the listing leaves out answers no name.
  '<w:next w:val="Nameless"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Nameless"/>';

const STYLED = docx(p('first') + p('second'), STYLES);

function listings(host: AutomationHost, count: number): (readonly AutomationStyleRead[])[] {
  const response = host.execute({
    operations: Array.from({ length: count }, () => ({ op: 'getStyles' as const })),
  });
  return response.results.map((result) => {
    if (result.status !== 'ok' || result.value.kind !== 'styles')
      throw new Error(`expected styles: ${JSON.stringify(result)}`);
    return result.value.styles;
  });
}

describe('getStyles', () => {
  test('keeps same-name styles of different kinds apart by id', () => {
    const [styles] = listings(open(STYLED), 1);
    expect(styles!.map((style) => [style.id, style.name, style.type])).toEqual([
      ['Normal', 'Normal', 'paragraph'],
      ['QuoteChar', 'Quote', 'character'],
      ['Quote', 'Quote', 'paragraph'],
    ]);
  });

  test('reads basedOn like the store index and answers no next name for an unlisted style', () => {
    const [styles] = listings(open(STYLED), 1);
    const quote = styles!.find((style) => style.id === 'Quote')!;
    expect(quote.basedOn).toBe('Normal');
    expect(quote.next).toBe(null);
    expect(styles!.find((style) => style.id === 'Normal')!.next).toBe('Normal');
    expect(styles!.find((style) => style.id === 'QuoteChar')!.next).toBe(null);
  });

  test('answers one listing per revision, shared across operations and batches', () => {
    const host = open(STYLED);
    const [first, second, third] = listings(host, 3);
    expect(second).toBe(first!);
    expect(third).toBe(first!);
    expect(listings(host, 1)[0]).toBe(first!);

    const [paragraph] = paragraphsOf(host, roots(host).body);
    const written = host.execute({
      operations: [{ op: 'setStyle', span: { paragraph: paragraph! }, name: 'Quote' }],
    });
    expect(written.ok).toBe(true);
    const after = listings(host, 1)[0]!;
    expect(after).not.toBe(first!);
    expect(after).toEqual(first!);
  });
});
