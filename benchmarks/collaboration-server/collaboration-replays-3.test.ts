// Share 3 of the replayed fuzzer cases; see `collaboration-replays.ts`.
// First: the scenario clock has to replace Date.now before Yjs loads.
import './scenario-clock.ts';
import { replayShare } from './collaboration-replays.ts';

replayShare(2);
