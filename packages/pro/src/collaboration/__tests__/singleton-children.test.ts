/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The visibility rule for children OOXML allows once, on child lists edits do not produce.

import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI } from '@docx-editor.dev/core/store';
import {
  partitionChildIds,
  singletonLayout,
  type ChildShell,
} from '../document/singleton-children.ts';

const PPR_A = 'lid:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1';
const PPR_B = 'lid:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:1';
const RUN = 'lid:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:2';

const shells: Record<string, ChildShell> = {
  [PPR_A]: { kind: 'paragraphProperties', namespaceUri: WML_NAMESPACE_URI, localName: 'pPr' },
  [PPR_B]: { kind: 'paragraphProperties', namespaceUri: WML_NAMESPACE_URI, localName: 'pPr' },
  [RUN]: { kind: 'run', namespaceUri: WML_NAMESPACE_URI, localName: 'r' },
};
const shellOf = (id: string): ChildShell | null => shells[id] ?? null;

describe('singleton child layout', () => {
  test('a properties element listed twice stays shown once and is never hidden', () => {
    const result = partitionChildIds('paragraph', [PPR_A, RUN, PPR_A], shellOf);
    expect(result.hidden).toEqual([]);
    expect(result.shown[0]).toBe(PPR_A);
  });

  test('a second copy is hidden behind the first, which names it as a companion', () => {
    const layout = singletonLayout('paragraph', [PPR_A, RUN, PPR_B], shellOf);
    expect(layout?.order).toEqual([0, 1]);
    expect([...(layout?.companions ?? [])]).toEqual([[0, [2]]]);
  });

  test('a properties element after a run moves to the front', () => {
    expect(singletonLayout('paragraph', [RUN, PPR_A], shellOf)?.order).toEqual([1, 0]);
  });

  test("the paragraph mark's w:rPr shows after siblings it may not precede", () => {
    const mark = 'lid:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:3';
    const jc = 'lid:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:4';
    const sectPr = 'lid:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:5';
    const local: Record<string, ChildShell> = {
      [mark]: { kind: 'runProperties', namespaceUri: WML_NAMESPACE_URI, localName: 'rPr' },
      [jc]: { kind: 'generic', namespaceUri: WML_NAMESPACE_URI, localName: 'jc' },
      [sectPr]: { kind: 'generic', namespaceUri: WML_NAMESPACE_URI, localName: 'sectPr' },
    };
    const layout = singletonLayout(
      'paragraphProperties',
      [mark, jc, sectPr],
      (id) => local[id] ?? null
    );
    expect(layout?.order).toEqual([1, 0, 2]);
    expect(
      singletonLayout('paragraphProperties', [jc, mark, sectPr], (id) => local[id] ?? null)
    ).toBeNull();
  });

  test('a list without conflicts needs no layout', () => {
    expect(singletonLayout('paragraph', [PPR_A, RUN], shellOf)).toBeNull();
    expect(singletonLayout('body', [PPR_A, PPR_B], shellOf)).toBeNull();
  });
});
