// The `getStyles` read: every style `styles.xml` defines, cached on the styles part.
//
// A batch that lists styles several times (a load, a count, a lookup, a load per item) must not
// rebuild the listing per operation, and neither must an edit that leaves `styles.xml` alone. The
// listing is cached on the styles part root, so every such answer is the same frozen array.

import { describe, expect, test } from 'bun:test';
import { docx, open, p, paragraphsOf, roots } from './support/protocol.ts';
import type { AutomationStyleRead } from '../style-listing.ts';
import type { AutomationHost } from '../protocol.ts';
import type { AutomationOperation } from '../operations.ts';
import { MAX_STYLE_DEFINITIONS } from '../../layout/style-cascade.ts';

const STYLES =
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
  '<w:uiPriority w:val="0"/><w:qFormat/></w:style>' +
  '<w:style w:type="character" w:styleId="QuoteChar"><w:name w:val="Quote"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>' +
  // Duplicated children: the last one wins, as the store index reads `w:basedOn`.
  '<w:basedOn w:val="Missing"/><w:basedOn w:val="Normal"/>' +
  // A next style the listing leaves out answers no name.
  '<w:next w:val="Nameless"/><w:semiHidden/><w:unhideWhenUsed w:val="true"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Nameless"/>' +
  // A next style of another kind, and a base style of another kind, answer no name.
  '<w:style w:type="paragraph" w:styleId="Probe"><w:name w:val="Probe"/>' +
  '<w:basedOn w:val="QuoteChar"/><w:next w:val="QuoteChar"/><w:uiPriority w:val="x"/></w:style>';

const STYLED = docx(p('first') + p('second'), STYLES);

function answers(
  host: AutomationHost,
  operations: readonly AutomationOperation[]
): (readonly AutomationStyleRead[])[] {
  const response = host.execute({ operations });
  return response.results.map((result) => {
    if (result.status !== 'ok' || result.value.kind !== 'styles')
      throw new Error(`expected styles: ${JSON.stringify(result)}`);
    return result.value.styles;
  });
}

const LIST: AutomationOperation = { op: 'getStyles' };

describe('getStyles', () => {
  test('keeps same-name styles of different kinds apart by id', () => {
    const [styles] = answers(open(STYLED), [LIST]);
    expect(styles!.map((style) => [style.id, style.name, style.type])).toEqual([
      ['Normal', 'Normal', 'paragraph'],
      ['QuoteChar', 'Quote', 'character'],
      ['Quote', 'Quote', 'paragraph'],
      ['Probe', 'Probe', 'paragraph'],
    ]);
  });

  test('resolves references only to listed styles of the allowed kind', () => {
    const [styles] = answers(open(STYLED), [LIST]);
    const byId = new Map(styles!.map((style) => [style.id, style]));
    expect(byId.get('Quote')!.basedOn).toBe('Normal');
    expect(byId.get('Quote')!.next).toBe(null);
    expect(byId.get('Normal')!.next).toBe('Normal');
    expect(byId.get('QuoteChar')!.next).toBe(null);
    expect(byId.get('Probe')!.basedOn).toBe(null);
    expect(byId.get('Probe')!.next).toBe(null);
  });

  test('reads visibility, priority, quick style, and unhide flags', () => {
    const [styles] = answers(open(STYLED), [LIST]);
    expect(
      styles!.map((style) => [
        style.id,
        style.hidden,
        style.uiPriority,
        style.quickStyle,
        style.unhideWhenUsed,
      ])
    ).toEqual([
      ['Normal', false, 0, true, false],
      ['QuoteChar', false, null, false, false],
      ['Quote', true, null, false, true],
      ['Probe', false, null, false, false],
    ]);
  });

  test('a name lookup prefers the paragraph style and compares like setStyle', () => {
    const host = open(STYLED);
    const [quote, missing] = answers(host, [
      { op: 'getStyles', name: '  QUOTE ' },
      { op: 'getStyles', name: 'Absent' },
    ]);
    expect(quote!.map((style) => style.id)).toEqual(['Quote']);
    expect(missing).toEqual([]);
  });

  test('answers one listing, shared across operations, batches, and body edits', () => {
    const host = open(STYLED);
    const [first, second, third] = answers(host, [LIST, LIST, LIST]);
    expect(second).toBe(first!);
    expect(third).toBe(first!);
    expect(answers(host, [LIST])[0]).toBe(first!);

    const [paragraph] = paragraphsOf(host, roots(host).body);
    const written = host.execute({
      operations: [{ op: 'setStyle', span: { paragraph: paragraph! }, name: 'Quote' }],
    });
    expect(written.ok).toBe(true);
    // The edit changed the body, not `styles.xml`, so the listing is reused.
    expect(answers(host, [LIST])[0]).toBe(first!);
  });

  test('counts only the definitions layout counts', () => {
    const over = MAX_STYLE_DEFINITIONS + 4;
    let styles = '';
    for (let index = 0; index < over; index += 1)
      styles += `<w:style w:type="paragraph" w:styleId="S${index}"><w:name w:val="S${index}"/></w:style>`;
    const host = open(docx(p('one'), styles));
    const [listing] = answers(host, [LIST]);
    expect(listing!.length).toBe(MAX_STYLE_DEFINITIONS);
    expect(listing!.at(-1)!.name).toBe(`S${MAX_STYLE_DEFINITIONS - 1}`);

    // The setter index has the same bound: a style past it is not one a write may apply.
    const [paragraph] = paragraphsOf(host, roots(host).body);
    const refused = host.execute({
      operations: [
        { op: 'setStyle', span: { paragraph: paragraph! }, name: `S${MAX_STYLE_DEFINITIONS}` },
      ],
    });
    expect(refused.ok).toBe(false);
    const applied = host.execute({
      operations: [
        { op: 'setStyle', span: { paragraph: paragraph! }, name: `S${MAX_STYLE_DEFINITIONS - 1}` },
      ],
    });
    expect(applied.ok).toBe(true);
  });
});
