// Shrunk action lists the fuzzer once failed on, replayed exactly. Each file in `replays/`
// names its scenario shape, replica count, delivery and seed, and the actions that remain
// after `bun scenarios.ts shrink`. Each replay checks every replica against a fresh read of
// its shared state after every action and every delivery, which takes seconds per case, so
// the corpus runs in `REPLAY_SHARES` test files, one share each, that the suite spreads over
// its workers and CI shards.
//
// Add a case: shrink a failing seed, fix the cause, then copy the shrunk file here with a
// name that says what it exercises. The shrunk file already names its scenario shape.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { readCase, replayOf } from './scenario-case.ts';
import { replayActions } from './scenario-harness.ts';
import { DEFAULT_DOCUMENT, documentFor } from './scenarios.ts';

const directory = path.join(import.meta.dirname, 'replays');
const fallback = new Uint8Array(readFileSync(DEFAULT_DOCUMENT));

/** How many test files share the replays. Each file defines one share with `replayShare`. */
export const REPLAY_SHARES = 8;

/** Define the tests for every `REPLAY_SHARES`th replay, starting at `share`. */
export function replayShare(share: number): void {
  describe(`replayed fuzzer cases, share ${share + 1} of ${REPLAY_SHARES}`, () => {
    const files = readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .filter((_, index) => index % REPLAY_SHARES === share);
    for (const file of files) {
      test(file.replace(/\.json$/, ''), async () => {
        const saved = readCase(path.join(directory, file));
        const { problems } = await replayActions(documentFor(saved.config, fallback), {
          ...replayOf(saved),
          strict: true,
        });
        expect(problems).toEqual([]);
      });
    }
  });
}
