/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The query parameter in which a Hocuspocus client names its collaboration format.
import { describe, expect, test } from 'bun:test';
import { COLLABORATION_FORMAT_VERSION } from '../document-format.ts';
import {
  COLLABORATION_FORMAT_PARAMETER,
  withCollaborationFormatParameter,
} from '../format-parameter.ts';

const FORMAT = encodeURIComponent(COLLABORATION_FORMAT_VERSION);
const parameters = (url: string) => new URL(url).searchParams;

describe('the collaboration format parameter', () => {
  test('is added to a URL without a query', () => {
    const url = withCollaborationFormatParameter('wss://collab.example.test/rooms');
    expect(url).toBe(`wss://collab.example.test/rooms?${COLLABORATION_FORMAT_PARAMETER}=${FORMAT}`);
  });

  test('keeps the parameters the URL already holds', () => {
    const url = withCollaborationFormatParameter('wss://collab.example.test/rooms?tenant=a&b=1');
    expect(parameters(url).get('tenant')).toBe('a');
    expect(parameters(url).get('b')).toBe('1');
    expect(parameters(url).get(COLLABORATION_FORMAT_PARAMETER)).toBe(COLLABORATION_FORMAT_VERSION);
  });

  test('replaces a format the caller put in the URL', () => {
    const url = withCollaborationFormatParameter(
      `wss://collab.example.test?${COLLABORATION_FORMAT_PARAMETER}=other`
    );
    expect(parameters(url).getAll(COLLABORATION_FORMAT_PARAMETER)).toEqual([
      COLLABORATION_FORMAT_VERSION,
    ]);
  });

  // The provider removes trailing slashes from a URL without a query, so the server's path
  // must be the same with the parameter as it was without it.
  test('removes the trailing slashes the provider would have removed', () => {
    expect(
      new URL(withCollaborationFormatParameter('wss://collab.example.test/rooms///')).pathname
    ).toBe('/rooms');
    expect(new URL(withCollaborationFormatParameter('wss://collab.example.test/')).pathname).toBe(
      '/'
    );
    expect(new URL(withCollaborationFormatParameter('wss://collab.example.test')).pathname).toBe(
      '/'
    );
  });

  test('leaves a URL that does not parse as it is, for the provider to report', () => {
    expect(withCollaborationFormatParameter('not a url')).toBe('not a url');
    expect(withCollaborationFormatParameter('')).toBe('');
  });
});
