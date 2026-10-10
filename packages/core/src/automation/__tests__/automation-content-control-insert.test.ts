// Authoring a control over the automation protocol: a span, and a point.
//
// Both surfaces plan onto the same store op, so a script and a keystroke must author the same
// element. A COLLAPSED span is the point case — the empty, prompt-showing control Word inserts
// with nothing selected — and it used to be refused as an invalid range, which left a template
// generator unable to place a field it had not first written text into.

import { describe, expect, test } from 'bun:test';
import { docx, open, paragraphsOf, roots, savedMainXml, textAt } from './support/protocol.ts';
import type { AutomationHost } from '../protocol.ts';

function withSentence(): AutomationHost {
  return open(docx(`<w:p><w:r><w:t>Between ACME CORP and BUYER LTD</w:t></w:r></w:p>`));
}

function bodyText(host: AutomationHost): string {
  const { body } = roots(host);
  const paragraph = paragraphsOf(host, body)[0]!;
  return textAt(host.execute({ operations: [{ op: 'getText', target: paragraph }] }), 0);
}

describe('insertContentControl over the protocol', () => {
  test('wraps a span in a control of the named subtype', () => {
    const host = withSentence();
    const { body } = roots(host);
    const paragraph = paragraphsOf(host, body)[0]!;
    const response = host.execute({
      operations: [
        {
          op: 'insertContentControl',
          span: { start: { paragraph, offset: 8 }, end: { paragraph, offset: 17 } },
          subtype: 'plainText',
          tag: 'party',
        },
      ],
    });
    expect(response.results[0]?.status).toBe('ok');
    const xml = savedMainXml(host);
    expect(xml).toContain('w:val="party"');
    expect(bodyText(host)).toBe('Between ACME CORP and BUYER LTD');
  });

  test('a collapsed span inserts an empty control showing its prompt', () => {
    const host = withSentence();
    const { body } = roots(host);
    const paragraph = paragraphsOf(host, body)[0]!;
    const response = host.execute({
      operations: [
        {
          op: 'insertContentControl',
          span: { start: { paragraph, offset: 8 }, end: { paragraph, offset: 8 } },
          subtype: 'date',
          tag: 'effective',
          title: 'Effective date',
        },
      ],
    });
    expect(response.results[0]?.status).toBe('ok');
    const xml = savedMainXml(host);
    expect(xml).toContain('<w:showingPlcHdr/>');
    expect(xml).toContain('w:val="effective"');
    // The prompt belongs to the TYPE, so a date field reads as one before anybody fills it.
    expect(bodyText(host)).toBe('Between Click here to enter a date.ACME CORP and BUYER LTD');
  });
});
