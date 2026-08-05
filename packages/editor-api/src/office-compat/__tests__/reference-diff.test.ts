/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, test, expect } from 'bun:test';
import { diffReferenceFixtures } from '../../../scripts/lib/reference-diff.mjs';

function fixture(symbols) {
  return {
    schemaVersion: 1,
    generatedFrom: { package: '@types/office-js', version: '1.0.0' },
    symbols,
  };
}

describe('diffReferenceFixtures', () => {
  test('reports no differences for two identical fixtures', () => {
    const f = fixture({
      Body: {
        uid: 'Word.Body',
        kind: 'class',
        requirementSet: 'WordApi 1.1',
        members: {
          text: {
            uid: 'Word.Body#text',
            kind: 'property',
            readonly: true,
            requirementSet: null,
            overloads: [{ params: [], returns: 'string' }],
          },
        },
      },
    });
    const diff = diffReferenceFixtures(f, f);
    expect(diff.addedSymbols).toEqual([]);
    expect(diff.removedSymbols).toEqual([]);
    expect(diff.changedSymbols).toEqual([]);
  });

  test('reports an added symbol', () => {
    const oldFixture = fixture({});
    const newFixture = fixture({
      NewThing: { uid: 'Word.NewThing', kind: 'class', requirementSet: null, members: {} },
    });
    const diff = diffReferenceFixtures(oldFixture, newFixture);
    expect(diff.addedSymbols).toEqual(['Word.NewThing']);
    expect(diff.removedSymbols).toEqual([]);
  });

  test('reports a removed symbol', () => {
    const oldFixture = fixture({
      OldThing: { uid: 'Word.OldThing', kind: 'class', requirementSet: null, members: {} },
    });
    const newFixture = fixture({});
    const diff = diffReferenceFixtures(oldFixture, newFixture);
    expect(diff.removedSymbols).toEqual(['Word.OldThing']);
    expect(diff.addedSymbols).toEqual([]);
  });

  test('reports an added member on an otherwise-unchanged symbol', () => {
    const oldFixture = fixture({
      Body: {
        uid: 'Word.Body',
        kind: 'class',
        requirementSet: 'WordApi 1.1',
        members: {
          text: {
            uid: 'Word.Body#text',
            kind: 'property',
            requirementSet: null,
            overloads: [{ params: [], returns: 'string' }],
          },
        },
      },
    });
    const newFixture = fixture({
      Body: {
        uid: 'Word.Body',
        kind: 'class',
        requirementSet: 'WordApi 1.1',
        members: {
          text: {
            uid: 'Word.Body#text',
            kind: 'property',
            requirementSet: null,
            overloads: [{ params: [], returns: 'string' }],
          },
          newMember: {
            uid: 'Word.Body#newMember',
            kind: 'method',
            requirementSet: 'WordApi 1.6',
            overloads: [{ params: [], returns: 'void' }],
          },
        },
      },
    });
    const diff = diffReferenceFixtures(oldFixture, newFixture);
    expect(diff.addedSymbols).toEqual([]);
    expect(diff.changedSymbols).toHaveLength(1);
    expect(diff.changedSymbols[0].uid).toBe('Word.Body');
    expect(diff.changedSymbols[0].addedMembers).toEqual(['Word.Body#newMember']);
    expect(diff.changedSymbols[0].removedMembers).toEqual([]);
  });

  test('reports a removed member', () => {
    const oldFixture = fixture({
      Body: {
        uid: 'Word.Body',
        kind: 'class',
        requirementSet: null,
        members: {
          gone: {
            uid: 'Word.Body#gone',
            kind: 'method',
            requirementSet: null,
            overloads: [{ params: [], returns: 'void' }],
          },
        },
      },
    });
    const newFixture = fixture({
      Body: { uid: 'Word.Body', kind: 'class', requirementSet: null, members: {} },
    });
    const diff = diffReferenceFixtures(oldFixture, newFixture);
    expect(diff.changedSymbols[0].removedMembers).toEqual(['Word.Body#gone']);
  });

  test('reports an overload-level change (added/removed overload) on an existing member, not just "changed"', () => {
    const oldFixture = fixture({
      Body: {
        uid: 'Word.Body',
        kind: 'class',
        requirementSet: null,
        members: {
          insertText: {
            uid: 'Word.Body#insertText',
            kind: 'method',
            requirementSet: null,
            overloads: [
              {
                params: [
                  { name: 'text', type: 'string' },
                  { name: 'loc', type: '"Start" | "End"' },
                ],
                returns: 'Range',
              },
            ],
          },
        },
      },
    });
    const newFixture = fixture({
      Body: {
        uid: 'Word.Body',
        kind: 'class',
        requirementSet: null,
        members: {
          insertText: {
            uid: 'Word.Body#insertText',
            kind: 'method',
            requirementSet: null,
            overloads: [
              {
                params: [
                  { name: 'text', type: 'string' },
                  { name: 'loc', type: '"Start" | "End" | "Replace"' },
                ],
                returns: 'Range',
              },
            ],
          },
        },
      },
    });
    const diff = diffReferenceFixtures(oldFixture, newFixture);
    const memberDiff = diff.changedSymbols[0].changedMembers[0];
    expect(memberDiff.uid).toBe('Word.Body#insertText');
    expect(memberDiff.removedOverloads).toHaveLength(1);
    expect(memberDiff.addedOverloads).toHaveLength(1);
  });

  test('reports a readonly-modifier change on a property member', () => {
    const oldFixture = fixture({
      Range: {
        uid: 'Word.Range',
        kind: 'class',
        requirementSet: null,
        members: {
          start: {
            uid: 'Word.Range#start',
            kind: 'property',
            requirementSet: null,
            overloads: [{ params: [], returns: 'number' }],
          },
        },
      },
    });
    const newFixture = fixture({
      Range: {
        uid: 'Word.Range',
        kind: 'class',
        requirementSet: null,
        members: {
          start: {
            uid: 'Word.Range#start',
            kind: 'property',
            readonly: true,
            requirementSet: null,
            overloads: [{ params: [], returns: 'number' }],
          },
        },
      },
    });
    const diff = diffReferenceFixtures(oldFixture, newFixture);
    const memberDiff = diff.changedSymbols[0].changedMembers[0];
    expect(memberDiff.readonlyChanged).toEqual({ from: false, to: true });
  });

  test('reports a requirementSet change on a member', () => {
    const oldFixture = fixture({
      Body: {
        uid: 'Word.Body',
        kind: 'class',
        requirementSet: null,
        members: {
          text: {
            uid: 'Word.Body#text',
            kind: 'property',
            requirementSet: 'WordApi 1.1',
            overloads: [{ params: [], returns: 'string' }],
          },
        },
      },
    });
    const newFixture = fixture({
      Body: {
        uid: 'Word.Body',
        kind: 'class',
        requirementSet: null,
        members: {
          text: {
            uid: 'Word.Body#text',
            kind: 'property',
            requirementSet: 'WordApi 1.2',
            overloads: [{ params: [], returns: 'string' }],
          },
        },
      },
    });
    const diff = diffReferenceFixtures(oldFixture, newFixture);
    const memberDiff = diff.changedSymbols[0].changedMembers[0];
    expect(memberDiff.requirementSetChanged).toEqual({ from: 'WordApi 1.1', to: 'WordApi 1.2' });
  });

  test('reports an overload-level change directly on a function-kind symbol (e.g. Word.run), not inside `members`', () => {
    const oldFixture = fixture({
      run: {
        uid: 'Word.run',
        kind: 'function',
        requirementSet: null,
        overloads: [
          {
            params: [{ name: 'batch', type: '(context: RequestContext) => Promise<T>' }],
            returns: 'Promise<T>',
          },
        ],
      },
    });
    const newFixture = fixture({
      run: {
        uid: 'Word.run',
        kind: 'function',
        requirementSet: null,
        overloads: [
          {
            params: [{ name: 'batch', type: '(context: RequestContext) => Promise<T>' }],
            returns: 'Promise<T>',
          },
          {
            params: [
              { name: 'object', type: 'ClientObject' },
              { name: 'batch', type: '(context: RequestContext) => Promise<T>' },
            ],
            returns: 'Promise<T>',
          },
        ],
      },
    });
    const diff = diffReferenceFixtures(oldFixture, newFixture);
    expect(diff.changedSymbols).toHaveLength(1);
    expect(diff.changedSymbols[0].uid).toBe('Word.run');
    expect(diff.changedSymbols[0].addedOverloads).toHaveLength(1);
    expect(diff.changedSymbols[0].removedOverloads).toEqual([]);
  });
});
