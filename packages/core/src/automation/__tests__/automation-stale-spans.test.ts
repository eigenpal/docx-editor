// Endpoints carry the revision they were read at, and the host refuses one whose position moved.
//
// A span answered at one revision names text by raw offsets. An edit before an offset moves it,
// so writing through the old span would change other words. The host stamps every endpoint it
// answers with `readAt` and refuses, with `stale-revision`, an endpoint whose paragraph prefix
// changed since. Edits after the span and formatting edits leave it valid. Endpoints built by
// hand carry no stamp and are taken as current.

import { describe, expect, test } from 'bun:test';
import { richDocx } from './support/furniture.ts';
import { open, paragraphsOf, refusal, roots, storyText } from './support/protocol.ts';
import { STALE_SPAN_HISTORY } from '../stale-spans.ts';
import type { AutomationBatchResponse, AutomationHost, AutomationSpan } from '../protocol.ts';

function fixture() {
  const host = open(
    richDocx({
      body: '<w:p><w:r><w:t>alpha beta gamma</w:t></w:r></w:p><w:p><w:r><w:t>other</w:t></w:r></w:p>',
    })
  );
  const { body } = roots(host);
  const [first, second] = paragraphsOf(host, body);
  return { host, body, first: first!, second: second! };
}

function rawSpans(response: AutomationBatchResponse): readonly AutomationSpan[] {
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'spans') throw new Error('no spans');
  return result.value.spans;
}

function find(host: AutomationHost, paragraph: unknown, text: string): AutomationSpan {
  const response = host.execute({
    operations: [{ op: 'search', scope: { paragraph } as never, text }],
  });
  return rawSpans(response)[0]!;
}

function replace(host: AutomationHost, span: AutomationSpan, text: string) {
  return host.execute({ operations: [{ op: 'replaceSpan', span, text }] });
}

describe('stamped endpoints', () => {
  test('answers stamp each endpoint with the revision they were read at', () => {
    const { host, first } = fixture();
    const response = host.execute({
      operations: [{ op: 'search', scope: { paragraph: first }, text: 'beta' }],
    });
    const [span] = rawSpans(response);
    expect(span!.start.readAt).toBe(response.revision);
    expect(span!.end.readAt).toBe(response.revision);
  });

  test('a span read before an edit earlier in its paragraph refuses and changes nothing', () => {
    const { host, body, first } = fixture();
    const alpha = find(host, first, 'alpha');
    const gamma = find(host, first, 'gamma');
    expect(replace(host, alpha, 'A').ok).toBe(true);
    const before = storyText(host, body);
    expect(refusal(replace(host, gamma, 'G'))).toBe('stale-revision');
    expect(storyText(host, body)).toBe(before);
  });

  test('an edit inside the span makes it stale', () => {
    const { host, first } = fixture();
    const span = find(host, first, 'alpha beta');
    expect(replace(host, find(host, first, 'beta'), 'b').ok).toBe(true);
    expect(refusal(replace(host, span, 'x'))).toBe('stale-revision');
  });

  test('edits after the span, in other paragraphs, and to formatting keep it valid', () => {
    const { host, body, first, second } = fixture();
    const alpha = find(host, first, 'alpha');
    expect(replace(host, find(host, first, 'gamma'), 'G').ok).toBe(true);
    expect(replace(host, find(host, second, 'other'), 'Other').ok).toBe(true);
    expect(
      host.execute({
        operations: [{ op: 'setFont', span: alpha, font: { bold: true } } as never],
      }).ok
    ).toBe(true);
    expect(replace(host, alpha, 'A').ok).toBe(true);
    expect(storyText(host, body)).toContain('A beta G');
  });

  test('an endpoint built by hand is taken as current', () => {
    const { host, body, first } = fixture();
    expect(replace(host, find(host, first, 'alpha'), 'A').ok).toBe(true);
    const handBuilt: AutomationSpan = {
      start: { paragraph: first, offset: 0 },
      end: { paragraph: first, offset: 1 },
    };
    expect(replace(host, handBuilt, 'Z').ok).toBe(true);
    expect(storyText(host, body)).toContain('Z beta gamma');
  });

  test('a bad offset on an old endpoint is a bad argument, not a stale read', () => {
    const { host, first, second } = fixture();
    const alpha = find(host, first, 'alpha');
    expect(replace(host, find(host, second, 'other'), 'Other').ok).toBe(true);
    const negative = { ...alpha, start: { ...alpha.start, offset: -1 } };
    expect(refusal(replace(host, negative, 'A'))).toBe('invalid-offset');
  });

  test('a read revision the host no longer remembers refuses', () => {
    const { host, first, second } = fixture();
    const alpha = find(host, first, 'alpha');
    for (let i = 0; i <= STALE_SPAN_HISTORY; i += 1)
      expect(
        replace(host, find(host, second, i % 2 ? 'x' : 'other'), i % 2 ? 'other' : 'x').ok
      ).toBe(true);
    expect(refusal(replace(host, alpha, 'A'))).toBe('stale-revision');
    const unknown = { ...alpha, start: { ...alpha.start, readAt: 1e9 } };
    expect(refusal(replace(host, unknown, 'A'))).toBe('stale-revision');
  });
});
