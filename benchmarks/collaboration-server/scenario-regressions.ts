// Seeded collaboration scenarios that must stay clean.
//
// Each case runs replicas over the simulated network in `scenario-harness.ts` and checks
// convergence, session health, save and reopen, and the shared-state read a server export
// uses. The seeds are fixed, so a failure here replays exactly:
//
//   bun scenarios.ts shrink --config <config> --delivery <delivery> --seed <seed>
//
// Add a configuration here once the fuzzer runs it clean, so it stays clean.
//
// The seeds run in this process, so the test runner measures their memory, and they are
// split across several test files, so the runner can run those files side by side.

// First: the scenario clock has to replace Date.now before Yjs loads.
import './scenario-clock.ts';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import type { Delivery } from './scenario-harness.ts';
import { runScenario } from './scenario-harness.ts';
import {
  DEFAULT_DOCUMENT,
  documentFor,
  scenarioOptions,
  type ScenarioConfig,
} from './scenarios.ts';

// Every seed below failed before a fix, so each one guards it:
// - concurrent 2, 7 and join 4, 9: duplicated singleton properties, edits to joined
//   paragraphs, and stale or duplicated text on late joiners and exports
// - undo 1: an incremental view placed a node twice; the full-pass fallback rebuilds it
// - undo 3: a node an undo left unplaced kept a stale build that a later move reused
// - everything 12: typing where deleted boundary characters collapsed showed text twice
// - offline 11: deleting the paragraph that won concurrently moved runs
// - peer concurrent 5: a child listed before its record arrived ended the session
// - peer join 2: a late joiner missed updates without the sync handshake
// - peer everything 5: a field rewrite in flight read as "no alias", and a split nested aliases
// - peer undo 3: undo with peers out of order diverged
// - peer everything 1: a survivor ordered its joined paragraphs by local arrival
// - everything 30: split losers whose parent link a peer removed stayed on screen
// - everything 6: an undone delete adopted by a paragraph a later join removed showed nowhere
// - everything 13: a run restored after its paragraph was joined was not adopted again
// - peer everything 2: adopted comments kept a sorted order the shared list no longer had
// - peer offline 5: a walk along origins read deleted markers differently once collected
// - server everything 4: a split's view tagged a text value its parent had renamed
// - peer concurrent 6: two splits and typing duplicated a text value ID
// - server join 3: the same walk counted collected markers toward its candidate limit
// - textbox server 4: two peers' moves of one floating drawing, both undone
// - peer everything 10, server everything 11, server join 12: views renamed IDs a local
//   edit still used
// - server offline 17: a node whose stored ID kept another paragraph's tag
// - textbox server 17: a note deleted after two peers created the notes part at once
// - server concurrent 8, server denseImages 8, peer textbox 1: the caret mapped by text
//   lost its place when peers split and joined its paragraph; it now follows its characters
const CLEAN: readonly { config: ScenarioConfig; delivery: Delivery; seed: number }[] = [
  { config: 'sequential', delivery: 'in-order', seed: 1 },
  { config: 'sequential', delivery: 'in-order', seed: 2 },
  { config: 'concurrent', delivery: 'server', seed: 2 },
  { config: 'concurrent', delivery: 'server', seed: 7 },
  { config: 'join', delivery: 'server', seed: 4 },
  { config: 'join', delivery: 'server', seed: 9 },
  { config: 'undo', delivery: 'server', seed: 3 },
  { config: 'everything', delivery: 'server', seed: 6 },
  { config: 'everything', delivery: 'server', seed: 12 },
  { config: 'everything', delivery: 'server', seed: 13 },
  { config: 'everything', delivery: 'server', seed: 30 },
  { config: 'offline', delivery: 'server', seed: 11 },
  { config: 'concurrent', delivery: 'peer', seed: 5 },
  { config: 'join', delivery: 'peer', seed: 2 },
  { config: 'everything', delivery: 'peer', seed: 5 },
  { config: 'undo', delivery: 'peer', seed: 3 },
  { config: 'everything', delivery: 'peer', seed: 2 },
  { config: 'offline', delivery: 'peer', seed: 5 },
  { config: 'everything', delivery: 'server', seed: 4 },
  { config: 'join', delivery: 'server', seed: 3 },
  { config: 'textbox', delivery: 'server', seed: 4 },
  { config: 'join', delivery: 'server', seed: 12 },
  { config: 'offline', delivery: 'server', seed: 17 },
  { config: 'textbox', delivery: 'server', seed: 17 },
  { config: 'denseTable', delivery: 'server', seed: 1 },
  { config: 'denseControls', delivery: 'peer', seed: 1 },
  { config: 'denseLinks', delivery: 'peer', seed: 32 },
  { config: 'undo', delivery: 'server', seed: 1 },
  { config: 'everything', delivery: 'peer', seed: 1 },
  { config: 'concurrent', delivery: 'server', seed: 1 },
  { config: 'undo', delivery: 'peer', seed: 5 },
  { config: 'concurrent', delivery: 'peer', seed: 8 },
  { config: 'join', delivery: 'peer', seed: 8 },
  { config: 'denseLinks', delivery: 'peer', seed: 7 },
  { config: 'join', delivery: 'server', seed: 10 },
  { config: 'textbox', delivery: 'server', seed: 11 },
  { config: 'undo', delivery: 'server', seed: 11 },
  { config: 'concurrent', delivery: 'peer', seed: 14 },
  { config: 'join', delivery: 'peer', seed: 14 },
  { config: 'sequential', delivery: 'in-order', seed: 15 },
  { config: 'offline', delivery: 'peer', seed: 10 },
  { config: 'denseTable', delivery: 'server', seed: 18 },
  { config: 'denseTable', delivery: 'server', seed: 16 },
  { config: 'concurrent', delivery: 'peer', seed: 17 },
  { config: 'faults', delivery: 'peer', seed: 2 },
  { config: 'faults', delivery: 'server', seed: 2 },
  { config: 'faults', delivery: 'server', seed: 4 },
  { config: 'faults', delivery: 'peer', seed: 1 },
  { config: 'concurrent', delivery: 'peer', seed: 6 },
  { config: 'concurrent', delivery: 'peer', seed: 13 },
  { config: 'everything', delivery: 'server', seed: 11 },
  { config: 'faults', delivery: 'server', seed: 5 },
  { config: 'everything', delivery: 'peer', seed: 10 },
  { config: 'textbox', delivery: 'server', seed: 8 },
  { config: 'concurrent', delivery: 'server', seed: 8 },
  { config: 'denseImages', delivery: 'server', seed: 8 },
  { config: 'textbox', delivery: 'peer', seed: 1 },
];

/**
 * Seeds that still fail, each with its shrunk case in `replays/open/`. A fix moves the case
 * into `replays/` and the seed back into `CLEAN`.
 */
const OPEN: readonly { config: ScenarioConfig; delivery: Delivery; seed: number; case: string }[] =
  [];

/** How many test files share the seeds. Each file defines one share with `scenarioShare`. */
export const SCENARIO_SHARES = 3;

/** Define the tests for every `SCENARIO_SHARES`th seed, starting at `share`. */
export function scenarioShare(share: number): void {
  const document = new Uint8Array(readFileSync(DEFAULT_DOCUMENT));
  describe(`collaboration scenarios, share ${share + 1} of ${SCENARIO_SHARES}`, () => {
    if (share === 0) {
      for (const open of OPEN) {
        // `bun test --todo` runs these, and reports one that passes, so a fix shows.
        test.todo(
          `${open.config}, ${open.delivery} delivery, seed ${open.seed} (open: ${open.case})`,
          async () => {
            const options = scenarioOptions(
              open.config,
              open.seed,
              documentFor(open.config, document),
              open.delivery
            );
            expect((await runScenario(options)).problems).toEqual([]);
          }
        );
      }
    }
    CLEAN.forEach(({ config, delivery, seed }, index) => {
      if (index % SCENARIO_SHARES !== share) return;
      test(`${config}, ${delivery} delivery, seed ${seed}`, async () => {
        const report = await runScenario(
          scenarioOptions(config, seed, documentFor(config, document), delivery)
        );
        expect(report.problems).toEqual([]);
        expect(report.applied).toBeGreaterThan(50);
      }, 120_000);
    });
  });
}
