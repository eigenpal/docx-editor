// The first body round of a notes pass.
//
// A seeded pass starts from the reserves the previous pass settled on, at the page indices
// they had. An edit that moved the flow by whole pages moved the notes with it, so on every
// later note page the seed was wrong, and the round laid out the rest of the document under
// it before the search could repair it. The round therefore first lays out with each page
// reading its reserve where its content stood before (`reserveAt` in
// `note-reserve-resume.ts`), which lets the moved tail be reused as it was.
//
// The search can settle on more than one answer, and which one depends on where it starts.
// So that answer is kept only when it is already settled: when the reserves the pages need
// are exactly the ones they read. Otherwise the round runs again from the seed as it is, and
// the search goes on as it did before.

import type { LayoutSteps } from './layout-steps.ts';
import { takeReadReserves, withReadReserves } from './note-reserve-resume.ts';
import { compactFootnoteReserves, takeMovedSeedReserves } from './note-reserves.ts';
import type { SemanticLayout } from './semantic-records.ts';

type Reserves = ReadonlyMap<number, number>;

/**
 * Run the first round under `seed` (empty when the pass has none), and return its layout with
 * the reserves its pages were laid out under. `run` lays the body out, following the flow
 * when asked; `settles` says whether a layout needs exactly the reserves it was given.
 */
export function* firstNotesRound(
  session: object | undefined,
  seed: Reserves | undefined,
  run: (reserves: Reserves, followFlow: boolean) => LayoutSteps<SemanticLayout>,
  settles: (layout: SemanticLayout, reserves: Reserves) => boolean
): LayoutSteps<{ readonly layout: SemanticLayout; readonly used: Reserves }> {
  const given = seed ? compactFootnoteReserves(seed) : new Map<number, number>();
  let layout = yield* run(given, seed !== undefined);
  // The seed at the page indices this pass laid it out at, when sections moved it.
  const moved = takeMovedSeedReserves(session);
  const used = moved ? compactFootnoteReserves(moved) : given;
  const read = takeReadReserves(session);
  if (!read) return { layout, used };
  const followed = compactFootnoteReserves(withReadReserves(used, read));
  if (settles(layout, followed)) return { layout, used: followed };
  layout = yield* run(given, false);
  takeMovedSeedReserves(session);
  return { layout, used };
}
