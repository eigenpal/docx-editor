/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, test, expect } from 'bun:test';
import {
  overloadEquals,
  compareMemberOverloads,
  compareSymbol,
  compareFixtures,
} from '../../../scripts/lib/shape-compare.mjs';

const insertTextReference = {
  params: [
    { name: 'text', type: 'string' },
    { name: 'insertLocation', type: '"Replace" | "Start" | "End"' },
  ],
  returns: 'Range',
};

describe('overloadEquals', () => {
  test('is true for identical overloads', () => {
    expect(overloadEquals(insertTextReference, { ...insertTextReference })).toBe(true);
  });

  test('is false when a param type is narrowed (subset union)', () => {
    // A DocxEditor overload that only accepts "Start" | "End" is a *narrowing*
    // of the reference contract: every reference-valid call must still
    // type-check against DocxEditor. Structural `extends` would actually let
    // the *wider* reference type be assignable FROM the narrower one in some
    // directions, which is exactly the failure mode this helper must catch.
    const narrowed = {
      ...insertTextReference,
      params: [insertTextReference.params[0], { name: 'insertLocation', type: '"Start" | "End"' }],
    };
    expect(overloadEquals(insertTextReference, narrowed)).toBe(false);
  });

  test('is false when the return type differs', () => {
    const changedReturn = { ...insertTextReference, returns: 'void' };
    expect(overloadEquals(insertTextReference, changedReturn)).toBe(false);
  });

  test('is false when a param becomes optional (arity/shape changed)', () => {
    const madeOptional = {
      ...insertTextReference,
      params: [insertTextReference.params[0], { ...insertTextReference.params[1], optional: true }],
    };
    expect(overloadEquals(insertTextReference, madeOptional)).toBe(false);
  });

  test('is false when parameter order differs even if types match as a set', () => {
    const reordered = {
      params: [insertTextReference.params[1], insertTextReference.params[0]],
      returns: insertTextReference.returns,
    };
    expect(overloadEquals(insertTextReference, reordered)).toBe(false);
  });

  test('ignores parameter name differences (only shape matters)', () => {
    const renamed = {
      ...insertTextReference,
      params: [{ name: 'value', type: 'string' }, insertTextReference.params[1]],
    };
    expect(overloadEquals(insertTextReference, renamed)).toBe(true);
  });
});

describe('compareMemberOverloads', () => {
  test('reports no issues when every reference overload has an exact authored match', () => {
    const issues = compareMemberOverloads([insertTextReference], [insertTextReference]);
    expect(issues).toEqual([]);
  });

  test('allows the authored side to declare additional overloads (additive APIs)', () => {
    const extra = { params: [], returns: 'void' };
    const issues = compareMemberOverloads([insertTextReference], [insertTextReference, extra]);
    expect(issues).toEqual([]);
  });

  test('flags a missing overload', () => {
    const issues = compareMemberOverloads([insertTextReference], []);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/missing/i);
  });

  test('flags a narrowed overload as variance, not as merely missing', () => {
    const narrowed = {
      ...insertTextReference,
      params: [insertTextReference.params[0], { name: 'insertLocation', type: '"Start" | "End"' }],
    };
    const issues = compareMemberOverloads([insertTextReference], [narrowed]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/missing/i);
  });
});

describe('compareSymbol', () => {
  const referenceSymbol = {
    uid: 'Word.Body',
    kind: 'class',
    members: {
      text: {
        uid: 'Word.Body#text',
        kind: 'property',
        readonly: true,
        overloads: [{ params: [], returns: 'string' }],
      },
      insertText: {
        uid: 'Word.Body#insertText',
        kind: 'method',
        overloads: [insertTextReference],
      },
    },
  };

  test('reports no issues for a fully conformant authored symbol', () => {
    const authored = {
      members: {
        text: { overloads: [{ params: [], returns: 'string' }], readonly: true },
        insertText: { overloads: [insertTextReference] },
        extraMethod: { overloads: [{ params: [], returns: 'void' }] },
      },
    };
    expect(compareSymbol(referenceSymbol, authored)).toEqual([]);
  });

  test('flags a member missing entirely from the authored declarations', () => {
    const authored = {
      members: {
        text: { overloads: [{ params: [], returns: 'string' }], readonly: true },
      },
    };
    const issues = compareSymbol(referenceSymbol, authored);
    expect(issues.some((i) => /insertText/.test(i) && /missing/i.test(i))).toBe(true);
  });

  test('flags a narrowed member signature', () => {
    const authored = {
      members: {
        text: { overloads: [{ params: [], returns: 'string' }], readonly: true },
        insertText: {
          overloads: [
            {
              params: [
                insertTextReference.params[0],
                { name: 'insertLocation', type: '"Start" | "End"' },
              ],
              returns: 'Range',
            },
          ],
        },
      },
    };
    const issues = compareSymbol(referenceSymbol, authored);
    expect(issues.some((i) => /insertText/.test(i))).toBe(true);
  });

  test('flags dropping readonly: a reference property marked readonly whose authored counterpart is writable is a variance, not a pass', () => {
    // `Word.Body#text` is `readonly` upstream. An authored `text` with the
    // exact same overload shape (params/returns) but WITHOUT `readonly` is
    // structurally identical by overload comparison alone — callers gain
    // the ability to assign a property Office.js never lets them assign.
    // This must be caught even though `overloadEquals` (params/returns
    // only) sees no difference at all.
    const authored = {
      members: {
        text: { overloads: [{ params: [], returns: 'string' }] }, // no `readonly: true`
        insertText: { overloads: [insertTextReference] },
      },
    };
    const issues = compareSymbol(referenceSymbol, authored);
    expect(issues.some((i) => /text/.test(i) && /readonly/i.test(i))).toBe(true);
  });

  test('does not flag readonly parity when both sides agree (reference and authored both readonly)', () => {
    const authored = {
      members: {
        text: { overloads: [{ params: [], returns: 'string' }], readonly: true },
        insertText: { overloads: [insertTextReference] },
      },
    };
    expect(compareSymbol(referenceSymbol, authored)).toEqual([]);
  });

  test('flags adding readonly where the reference is writable (narrowing the other direction)', () => {
    const writableReference = {
      uid: 'Word.Body',
      kind: 'class',
      members: {
        style: {
          uid: 'Word.Body#style',
          kind: 'property',
          overloads: [{ params: [], returns: 'string' }],
        },
      },
    };
    const authored = {
      members: {
        style: { overloads: [{ params: [], returns: 'string' }], readonly: true },
      },
    };
    const issues = compareSymbol(writableReference, authored);
    expect(issues.some((i) => /style/.test(i) && /readonly/i.test(i))).toBe(true);
  });
});

describe('compareFixtures', () => {
  const referenceFixture = {
    symbols: {
      Body: {
        uid: 'Word.Body',
        kind: 'class',
        members: {
          insertText: {
            uid: 'Word.Body#insertText',
            kind: 'method',
            overloads: [insertTextReference],
          },
        },
      },
      run: {
        uid: 'Word.run',
        kind: 'function',
        overloads: [
          {
            params: [{ name: 'batch', type: '(context: RequestContext) => Promise<T>' }],
            returns: 'Promise<T>',
          },
        ],
      },
    },
  };

  test('reports no issues when every reference symbol (class and function kind) is fully matched', () => {
    const authoredFixture = {
      symbols: {
        Body: { members: { insertText: { overloads: [insertTextReference] } } },
        run: {
          overloads: [
            {
              params: [{ name: 'batch', type: '(context: RequestContext) => Promise<T>' }],
              returns: 'Promise<T>',
            },
          ],
        },
      },
    };
    expect(compareFixtures(referenceFixture, authoredFixture)).toEqual([]);
  });

  test('flags an entire symbol missing from the authored fixture', () => {
    const authoredFixture = { symbols: {} };
    const issues = compareFixtures(referenceFixture, authoredFixture);
    expect(issues.some((i) => /Word\.Body/.test(i) && /missing/i.test(i))).toBe(true);
    expect(issues.some((i) => /Word\.run/.test(i) && /missing/i.test(i))).toBe(true);
  });

  test('flags a missing overload on a function-kind symbol (not just class/interface members)', () => {
    const authoredFixture = {
      symbols: {
        Body: { members: { insertText: { overloads: [insertTextReference] } } },
        run: { overloads: [] },
      },
    };
    const issues = compareFixtures(referenceFixture, authoredFixture);
    expect(issues.some((i) => /Word\.run/.test(i) && /missing/i.test(i))).toBe(true);
  });
});
