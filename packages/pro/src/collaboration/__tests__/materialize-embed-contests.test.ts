/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two texts can embed one node; it shows in the first a full pass places. An incremental pass
// that rebuilds the second while it reuses the first cannot say which shows it, so it asks for
// a full pass once. After that pass, the same contest is decided and costs no further pass.
import { expect, test } from 'bun:test';
import { ListingContests } from '../document/materialize-contests.ts';
import type { LogicalId } from '../document/identity.ts';
import type { DocumentRegistry } from '../document/registry.ts';

const EMBED = 'embed' as LogicalId;
const FIRST = 'first' as LogicalId;
const SECOND = 'second' as LogicalId;

test('a shared embed costs one full pass, not one per rebuild', () => {
  const registry = { structureVersion: 0 };
  const contests = new ListingContests(registry as DocumentRegistry);
  const shownUnder = new Map<LogicalId, LogicalId>([[EMBED, FIRST]]);
  const rebuilt = new Set<LogicalId>([SECOND]);

  contests.reset();
  expect(contests.noteEmbed(EMBED, SECOND, shownUnder, rebuilt)).toBe(true);
  expect(contests.contested).toBe(true);
  expect(contests.decided()).toBe(false);
  // The full pass shows the embed in the first text and records that.
  contests.reset();
  contests.recordEmbeds(shownUnder);

  for (let keystroke = 0; keystroke < 3; keystroke += 1) {
    contests.reset();
    expect(contests.noteEmbed(EMBED, SECOND, shownUnder, rebuilt)).toBe(false);
    expect(contests.contested).toBe(false);
  }
  // A move can put the second text first: the decision holds no longer.
  registry.structureVersion += 1;
  contests.reset();
  expect(contests.noteEmbed(EMBED, SECOND, shownUnder, rebuilt)).toBe(true);
  expect(contests.contested).toBe(true);
});

test('an embed shown nowhere, shown by this text, or shown by a rebuilt text is no contest', () => {
  const contests = new ListingContests({} as DocumentRegistry);
  contests.reset();
  expect(contests.noteEmbed(EMBED, SECOND, new Map(), new Set())).toBe(true);
  expect(contests.noteEmbed(EMBED, SECOND, new Map([[EMBED, SECOND]]), new Set())).toBe(true);
  expect(contests.noteEmbed(EMBED, SECOND, new Map([[EMBED, FIRST]]), new Set([FIRST]))).toBe(true);
  expect(contests.contested).toBe(false);
});
