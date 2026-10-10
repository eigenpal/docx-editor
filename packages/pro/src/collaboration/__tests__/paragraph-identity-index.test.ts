/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The index of which paragraphs hold which character identities. Every replica reads which
// copy shows from it, so an entry it fails to remove hides text on one replica only.

import { describe, expect, test } from 'bun:test';
import { asLogicalId } from '../document/identity.ts';
import { IdentityIndex, type IdentityRun } from '../document/paragraph-identity-index.ts';

const P = asLogicalId('p');
const Q = asLogicalId('q');
const copy: IdentityRun = { client: 7, start: 10, end: 12, kind: 'move' };

describe('identity index', () => {
  test('a paragraph that holds one copy twice and then none holds nothing', () => {
    const index = new IdentityIndex();
    index.update(P, [copy, copy]);
    expect(index.holdersOf('move', 7, 10)).toEqual([P, P]);
    index.update(P, [copy]);
    expect(index.holdersOf('move', 7, 10)).toEqual([P]);
    index.update(P, []);
    expect(index.holdersOf('move', 7, 10)).toEqual([]);
  });

  test('a copy that leaves one paragraph and stays in another keeps its other holder', () => {
    const index = new IdentityIndex();
    index.update(P, [copy]);
    index.update(Q, [copy]);
    const { affected } = index.update(P, []);
    expect(index.holdersOf('move', 7, 11)).toEqual([Q]);
    expect([...affected]).toEqual([Q]);
  });

  test('an unchanged update changes nothing and touches no other paragraph', () => {
    const index = new IdentityIndex();
    index.update(P, [copy]);
    index.update(Q, [copy]);
    const { affected, changed } = index.update(P, [copy]);
    expect(affected.size).toBe(0);
    expect(changed).toEqual([]);
  });

  test('runs that span a lookup are found after a longer run leaves', () => {
    // The longest run bounds how far back a lookup scans. When it leaves, the bound drops, but
    // never below a run still held.
    const index = new IdentityIndex();
    const long: IdentityRun = { client: 3, start: 0, end: 100_000, kind: 'move' };
    const medium: IdentityRun = { client: 3, start: 200_000, end: 200_050, kind: 'move' };
    const short: IdentityRun = { client: 3, start: 200_040, end: 200_041, kind: 'move' };
    index.update(P, [long, medium]);
    index.update(Q, [short]);
    index.update(P, [medium]);
    expect(index.holdersOf('move', 3, 50)).toEqual([]);
    expect(index.holdersOf('move', 3, 200_045)).toEqual([P]);
    expect(index.holdersOf('move', 3, 200_040).sort()).toEqual([P, Q]);
  });
});
