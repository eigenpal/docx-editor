// Shrunk action lists the fuzzer once failed on, replayed exactly. Each file in `replays/`
// names its scenario shape, replica count, delivery and seed, and the actions that remain
// after `bun scenarios.ts shrink`. A case is short, so the whole corpus runs in seconds, and
// each replay checks every replica against a fresh read of its shared state after every
// action and every delivery.
//
// Add a case: shrink a failing seed, fix the cause, then copy the shrunk file here with a
// name that says what it exercises. The shrunk file already names its scenario shape.

// First: the scenario clock has to replace Date.now before Yjs loads.
import './scenario-clock.ts';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import { readCase, replayOf } from './scenario-case.ts';
import { replayActions } from './scenario-harness.ts';
import { DEFAULT_DOCUMENT, documentFor } from './scenarios.ts';

const directory = path.join(import.meta.dirname, 'replays');
const fallback = new Uint8Array(readFileSync(DEFAULT_DOCUMENT));

describe('replayed fuzzer cases', () => {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort();
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
