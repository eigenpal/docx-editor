// Seeded scenarios for rooms that a Hocuspocus server seeds with `createCollaborationState`.
//
// Each seed picks a document, how participants open the room (at once or in turn, `join` or
// `create-or-join`), who leaves while the server still loads the room, who aborts their join,
// and a run of actions: inserts right after the room opens, disconnects, reconnects while others
// type, late joiners, and participants who leave. When every participant leaves, the server
// unloads the room, and the next one loads it from storage.
//
// The seed fixes every choice. The network and the server run in real time, so two runs of
// one seed can interleave differently.
//
// At the end, these checks run:
// - Every replica and the server hold the same Yjs state and the same paragraphs.
// - The paragraphs are the seed plus the inserted characters. Each character appears once.
// - The server seeded the room once, and the room records one seed.
// - No participant sent a seed-sized sync message, and none received more than one: the room
//   itself, once. A participant that seeds the room would send one, and receive it back.
// - The stored room reads back as the same paragraphs, and a participant that joins after a
//   restart of the room reads them too.
// - No session reported an error.

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { readCollaborationDocument } from '@docx-editor.dev/pro/collaboration';
import { createCollaborationRoomId } from '@docx-editor.dev/pro/collaboration/hocuspocus';
import {
  docxParagraphTexts,
  joinRoom,
  paragraphTexts,
  paragraphsDocx,
  startSeedServer,
  until,
  type SeedParticipant,
  type SeedServer,
} from './seed-transfer-harness.ts';

const SEED_RECORDS_KEY = 'docx-collaboration-seeds-v1';
const WORDS = ['alpha', 'bravo', 'clause', 'delta', 'party', 'term', 'notice', 'review'];

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One inserted character each: private-use code points never occur in the seed. */
const marker = (index: number): string => String.fromCodePoint(0xe000 + index);
const MARKERS = /[\u{e000}-\u{e8ff}]/gu;

interface Live {
  readonly participant: SeedParticipant;
  online: boolean;
}

export interface SeedScenarioResult {
  readonly seed: number;
  readonly problems: string[];
  readonly summary: string;
}

/** How the room starts. The defaults are the supported path; the others are controls. */
export interface SeedScenarioOptions {
  /** `server` seeds with `createCollaborationState`; `participant` lets a participant seed. */
  readonly seededBy?: 'server' | 'participant';
  /** Flush the loaded state before the first connection joins. Default true. */
  readonly flushAfterLoad?: boolean;
}

export async function runSeedScenario(
  seed: number,
  options: SeedScenarioOptions = {}
): Promise<SeedScenarioResult> {
  const byServer = (options.seededBy ?? 'server') === 'server';
  const rng = random(seed);
  const int = (low: number, high: number) => low + Math.floor(rng() * (high - low + 1));
  const texts = Array.from({ length: int(2, 6) }, () =>
    Array.from({ length: int(3, 30) }, () => WORDS[int(0, WORDS.length - 1)]).join(' ')
  );
  const document = paragraphsDocx(texts);
  // The server draws its load delays when a load starts, so it has its own sequence: the
  // scenario's choices then stay the same however the loads interleave.
  const serverRng = random(seed ^ 0x5eed);
  const server = await startSeedServer({
    seed: byServer ? 'server' : 'none',
    document,
    flushAfterLoad: options.flushAfterLoad ?? true,
    loadDelayMs: () => (serverRng() < 0.5 ? 0 : 5 + Math.floor(serverRng() * 56)),
  });
  const roomId = createCollaborationRoomId();
  const problems: string[] = [];
  const live: Live[] = [];
  const left: SeedParticipant[] = [];
  const log: string[] = [];
  let peers = 0;
  let inserted = 0;

  // A `join` waits for a seed, so a room no server seeds needs `create-or-join` everywhere.
  const bootstrap = () =>
    byServer && rng() < 0.5
      ? ({ kind: 'join' } as const)
      : ({ kind: 'create-or-join', document, electionWindowMs: int(20, 80) } as const);

  const open = async (when: string): Promise<void> => {
    const peer = `p${peers++}`;
    const abort = rng() < 0.2 ? new AbortController() : null;
    const chosen = bootstrap();
    log.push(`${when} ${peer} ${chosen.kind}${abort ? ' abort' : ''}`);
    if (abort) setTimeout(() => abort.abort(), int(0, 60));
    try {
      const participant = await joinRoom(server, {
        peer,
        roomId,
        bootstrap: abort ? { ...chosen, signal: abort.signal } : chosen,
      });
      live.push({ participant, online: true });
    } catch (error) {
      const code = (error as { code?: string }).code;
      // An aborted join is the participant leaving; anything else is a defect.
      if (!(abort?.signal.aborted && code === 'initialization-aborted')) {
        problems.push(`${peer} failed to open the room: ${code ?? (error as Error).message}`);
      }
    }
  };

  /** A participant that leaves while the server still loads the room. */
  const leaveDuringLoad = async (): Promise<void> => {
    const provider = new HocuspocusProvider({
      url: `${server.url}/?peer=leaver`,
      name: roomId,
      document: new Y.Doc(),
    });
    provider.on('open', () =>
      provider.sendStateless(JSON.stringify({ type: 'docx-room-generation', generation: null }))
    );
    await sleep(int(0, 50));
    provider.destroy();
  };

  try {
    // The room opens: some participants at once, some in turn.
    const opening: Promise<void>[] = [];
    if (rng() < 0.4) opening.push(leaveDuringLoad());
    for (let index = int(2, 4); index > 0; index -= 1) {
      if (rng() < 0.5) opening.push(open('race'));
      else {
        await sleep(int(0, 40));
        opening.push(open('turn'));
      }
    }
    await Promise.all(opening);
    if (live.length === 0) await open('fallback');

    for (let step = int(10, 30); step > 0; step -= 1) {
      const roll = rng();
      const online = live.filter((entry) => entry.online);
      const offline = live.filter((entry) => !entry.online);
      if (roll < 0.6 && live.length > 0) {
        const entry = live[int(0, live.length - 1)]!;
        const character = marker(inserted++);
        entry.participant.insert(int(0, 10), rng(), character);
        log.push(`${entry.participant.peer} insert`);
      } else if (roll < 0.7 && online.length > 0) {
        const entry = online[int(0, online.length - 1)]!;
        entry.participant.disconnect();
        entry.online = false;
        log.push(`${entry.participant.peer} disconnect`);
      } else if (roll < 0.8 && offline.length > 0) {
        const entry = offline[int(0, offline.length - 1)]!;
        await entry.participant.reconnect();
        entry.online = true;
        log.push(`${entry.participant.peer} reconnect`);
      } else if (roll < 0.9) {
        await open('late');
      } else if (online.length > 1) {
        // Leave only with every edit stored on the server, so the oracle still expects them.
        const entry = online[int(0, online.length - 1)]!;
        await synced(entry.participant);
        live.splice(live.indexOf(entry), 1);
        entry.participant.destroy();
        left.push(entry.participant);
        log.push(`${entry.participant.peer} leave`);
      }
      if (rng() < 0.5) await sleep(int(0, 15));
    }

    for (const entry of live) {
      if (!entry.online) await entry.participant.reconnect();
      entry.online = true;
    }
    for (const entry of live) await synced(entry.participant);
    const room = server.document(roomId);
    if (!room) throw new Error('the room is not loaded');
    await until(
      () => live.every((entry) => sameState(entry.participant.room.ydoc, room)),
      'every replica to converge'
    );

    const expected = paragraphTexts(live[0]!.participant.store);
    for (const entry of live) {
      const actual = paragraphTexts(entry.participant.store);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        problems.push(
          `${entry.participant.peer} shows other paragraphs than ${live[0]!.participant.peer}`
        );
      }
    }
    const stripped = expected.map((text) => text.replace(MARKERS, ''));
    if (JSON.stringify(stripped) !== JSON.stringify(texts)) {
      problems.push(`the document is not the seed plus the inserts: ${JSON.stringify(stripped)}`);
    }
    const joined = expected.join('\n');
    for (let index = 0; index < inserted; index += 1) {
      const count = joined.split(marker(index)).length - 1;
      if (count !== 1) problems.push(`insert ${index} appears ${count} times`);
    }
    if (server.seeds() !== (byServer ? 1 : 0)) {
      problems.push(`the server seeded the room ${server.seeds()} times`);
    }
    const records = room.getArray(SEED_RECORDS_KEY).length;
    if (records !== 1) problems.push(`the room records ${records} seeds`);

    // No seed upload, and no seed echo: one room-sized message for each participant at most.
    const state = Y.encodeStateAsUpdate(room).byteLength;
    const large = state / 2;
    for (const peer of new Set(server.connections.map((entry) => entry.peer))) {
      if (peer === 'leaver') continue;
      const traffic = server.traffic(peer);
      if (traffic.largestSyncSent >= large) {
        problems.push(`${peer} sent a seed-sized sync message of ${traffic.largestSyncSent} B`);
      }
      if (traffic.largeSyncReceived(large) > 1) {
        problems.push(`${peer} received ${traffic.largeSyncReceived(large)} seed-sized messages`);
      }
    }

    for (const entry of [...live.map((item) => item.participant), ...left]) {
      const errors = entry.statuses.filter((status) => status.startsWith('error'));
      if (errors.length > 0) problems.push(`${entry.peer} reported ${errors.join(', ')}`);
    }

    // Save and reopen: the stored room, then a participant after the room restarts.
    await until(
      () => storedTexts(server, roomId) === JSON.stringify(expected),
      'the server to store the room'
    );
    for (const entry of live) entry.participant.destroy();
    live.length = 0;
    await until(() => server.document(roomId) === undefined, 'the server to unload the room');
    const reopened = await joinRoom(server, {
      peer: 'reopen',
      roomId,
      bootstrap: { kind: 'create-or-join', document },
    });
    if (JSON.stringify(paragraphTexts(reopened.store)) !== JSON.stringify(expected)) {
      problems.push('a participant after the restart reads other paragraphs');
    }
    if (server.seeds() !== (byServer ? 1 : 0)) problems.push('the restart seeded the room again');
    reopened.destroy();
  } catch (error) {
    problems.push(`threw: ${(error as Error).message}`);
  } finally {
    for (const entry of live) entry.participant.destroy();
    await server.stop();
  }
  return { seed, problems, summary: log.join('; ') };
}

async function synced(participant: SeedParticipant): Promise<void> {
  await until(
    () => participant.room.provider.isSynced && !participant.room.provider.hasUnsyncedChanges,
    `peer ${participant.peer} to sync`
  );
}

function sameState(left: Y.Doc, right: Y.Doc): boolean {
  const a = Y.encodeStateVector(left);
  const b = Y.encodeStateVector(right);
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function storedTexts(server: SeedServer, roomId: string): string {
  const state = server.storage.get(roomId);
  if (!state) return '';
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, state);
    return JSON.stringify(docxParagraphTexts(readCollaborationDocument(document)));
  } catch {
    return '';
  } finally {
    document.destroy();
  }
}

if (import.meta.main) {
  // `bun seed-transfer-fuzz.ts <first seed> <count>`
  const first = Number(process.argv[2] ?? 1);
  const count = Number(process.argv[3] ?? 20);
  let failed = 0;
  for (let seed = first; seed < first + count; seed += 1) {
    const result = await runSeedScenario(seed);
    if (result.problems.length > 0) {
      failed += 1;
      console.log(`seed ${seed} FAILED: ${result.problems.join(' | ')}\n  ${result.summary}`);
    } else console.log(`seed ${seed} ok`);
  }
  process.exit(failed > 0 ? 1 : 0);
}
