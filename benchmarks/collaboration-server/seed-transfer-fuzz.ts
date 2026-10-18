// Seeded scenarios for rooms that a Hocuspocus server seeds with `createCollaborationState`.
//
// Each seed picks a document, how participants open the room (at once or in turn, `join` or
// `create-or-join`), who leaves while the server still loads the room, who aborts their join,
// and a run of actions: inserts right after the room opens, deletes of inserted text while
// others type, undo and redo, disconnects, reconnects, late joiners, and participants who
// leave. When every participant leaves, the server unloads the room, and the next one loads it
// from storage. At the end the server compacts the room, a participant edits the new
// generation, and some seeds then lose the room's stored state.
//
// The seed fixes every choice. The network and the server run in real time, so two runs of
// one seed can interleave differently.
//
// These checks run:
// - Every replica and the server hold the same Yjs state, deletions included, and the same
//   paragraphs.
// - The paragraphs are the seed plus the inserted characters. A character nobody deleted
//   appears once, and a deleted one is gone. Undo and redo touch only the characters of the
//   participant that undid; another participant's characters stay as they are.
// - The server seeded the room once, and the room records one seed.
// - No participant sent a seed-sized sync message, and none received more than one: the room
//   itself, once. A participant that seeds the room would send one, and receive it back.
// - The stored room reads back as the same paragraphs. A participant that joins after a
//   restart and a compaction reads them too, and its edit reaches another participant.
// - After the stored state is lost, the server seeds nothing: a participant that reconnects
//   reports `saved-room-unavailable` and keeps its document, and a new participant is refused.
// - A join whose signal fired before it finished rejects with `initialization-aborted`.
// - No session reported any other error.

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { readCollaborationDocument } from '@docx-editor.dev/pro/collaboration';
import { createCollaborationRoomId } from '@docx-editor.dev/pro/collaboration/hocuspocus';
import {
  NativeWebSocket,
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

/** What the participants did to each inserted character, for the final checks. */
interface Ledger {
  /** The participant that inserted each character, by index. */
  readonly author: string[];
  /** Characters a participant deleted. */
  readonly removed: Set<number>;
  /** Characters an undo or redo may have changed: present at most once, or gone. */
  readonly uncertain: Set<number>;
  /** The characters each participant inserted or deleted. */
  readonly touched: Map<string, Set<number>>;
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
  /** Refuse a known room whose stored state is lost. Default true; false seeds it again. */
  readonly refuseLostRooms?: boolean;
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
  let compactOnLoad = false;
  const server = await startSeedServer({
    seed: byServer ? 'server' : 'none',
    document,
    flushAfterLoad: options.flushAfterLoad ?? true,
    refuseLostRooms: options.refuseLostRooms ?? true,
    loadDelayMs: () => (serverRng() < 0.5 ? 0 : 5 + Math.floor(serverRng() * 56)),
    compactOnLoad: () => compactOnLoad,
  });
  const roomId = createCollaborationRoomId();
  const problems: string[] = [];
  const live: Live[] = [];
  const left: SeedParticipant[] = [];
  const log: string[] = [];
  const ledger: Ledger = {
    author: [],
    removed: new Set(),
    uncertain: new Set(),
    touched: new Map(),
  };
  const touch = (peer: string, index: number) => {
    const set = ledger.touched.get(peer) ?? new Set<number>();
    set.add(index);
    ledger.touched.set(peer, set);
  };
  let peers = 0;

  // A `join` waits for a seed, so a room no server seeds needs `create-or-join` everywhere.
  const bootstrap = () =>
    byServer && rng() < 0.5
      ? ({ kind: 'join' } as const)
      : ({ kind: 'create-or-join', document, electionWindowMs: int(20, 80) } as const);

  const open = async (when: string): Promise<SeedParticipant | null> => {
    const peer = `p${peers++}`;
    const abort = rng() < 0.2 ? new AbortController() : null;
    const chosen = bootstrap();
    log.push(`${when} ${peer} ${chosen.kind}${abort ? ' abort' : ''}`);
    // Most joins finish in a few ms, so the abort lands early, often while the room loads.
    if (abort) setTimeout(() => abort.abort(), int(0, 6));
    try {
      const participant = await joinRoom(server, {
        peer,
        roomId,
        bootstrap: abort ? { ...chosen, signal: abort.signal } : chosen,
      });
      if (abort?.signal.aborted) {
        // The signal fired before the join finished: the join must reject, not resolve.
        problems.push(`${peer} joined after its join was aborted`);
        participant.destroy();
        return null;
      }
      live.push({ participant, online: true });
      return participant;
    } catch (error) {
      const code = (error as { code?: string }).code;
      // An aborted join is the participant leaving; anything else is a defect.
      if (abort?.signal.aborted && code === 'initialization-aborted') log.push(`${peer} aborted`);
      else {
        problems.push(`${peer} failed to open the room: ${code ?? (error as Error).message}`);
      }
      return null;
    }
  };

  const insert = (participant: SeedParticipant): void => {
    const index = ledger.author.length;
    ledger.author.push(participant.peer);
    touch(participant.peer, index);
    participant.insert(int(0, 10), rng(), marker(index));
  };

  /** A participant that leaves while the server still loads the room. */
  const leaveDuringLoad = async (): Promise<void> => {
    const provider = new HocuspocusProvider({
      url: `${server.url}/?peer=leaver`,
      name: roomId,
      document: new Y.Doc(),
      WebSocketPolyfill: NativeWebSocket,
    } as ConstructorParameters<typeof HocuspocusProvider>[0]);
    // Settled once the socket opens or fails; it is never closed while it connects.
    const opened = new Promise<void>((resolve) => {
      provider.on('open', () => {
        provider.sendStateless(JSON.stringify({ type: 'docx-room-generation', generation: null }));
        resolve();
      });
      provider.on('close', () => resolve());
    });
    const delay = int(0, 50);
    // Leave after the socket opens: the server loads the room once the token arrives, and the
    // load delay keeps it loading while this participant leaves. Closing a socket that is still
    // connecting makes the provider raise an error event nothing listens to.
    await opened;
    await sleep(delay);
    provider.destroy();
  };

  try {
    // The room opens: some participants at once, some in turn.
    const opening: Promise<unknown>[] = [];
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
      const any = live[int(0, Math.max(0, live.length - 1))];
      if (roll < 0.45 && any) {
        insert(any.participant);
        log.push(`${any.participant.peer} insert`);
      } else if (roll < 0.58 && any) {
        // Delete a character this replica shows, while others may still type around it.
        const shown = paragraphTexts(any.participant.store).join('').match(MARKERS) ?? [];
        const target = shown[int(0, Math.max(0, shown.length - 1))];
        if (target && any.participant.remove(target)) {
          const index = target.codePointAt(0)! - 0xe000;
          ledger.removed.add(index);
          touch(any.participant.peer, index);
          log.push(`${any.participant.peer} delete`);
        }
      } else if (roll < 0.7 && editors(live, ledger).length > 0) {
        // A participant that edited, so the shared history holds a step of its own.
        const candidates = editors(live, ledger);
        const entry = candidates[int(0, candidates.length - 1)]!;
        const undo = rng() < 0.6;
        const done = undo ? entry.participant.undo() : entry.participant.redo();
        if (done) {
          for (const index of ledger.touched.get(entry.participant.peer) ?? []) {
            ledger.uncertain.add(index);
          }
        }
        log.push(`${entry.participant.peer} ${undo ? 'undo' : 'redo'}${done ? '' : ' (nothing)'}`);
      } else if (roll < 0.77 && online.length > 0) {
        const entry = online[int(0, online.length - 1)]!;
        await entry.participant.disconnect();
        entry.online = false;
        log.push(`${entry.participant.peer} disconnect`);
      } else if (roll < 0.84 && offline.length > 0) {
        const entry = offline[int(0, offline.length - 1)]!;
        await entry.participant.reconnect();
        entry.online = true;
        log.push(`${entry.participant.peer} reconnect`);
      } else if (roll < 0.92) {
        await open('late');
      } else if (online.length > 1) {
        // Leave only with every edit stored on the server, so the checks still expect them.
        const entry = online[int(0, online.length - 1)]!;
        await synced(entry.participant);
        live.splice(live.indexOf(entry), 1);
        entry.participant.destroy();
        left.push(entry.participant);
        log.push(`${entry.participant.peer} leave`);
      }
      if (rng() < 0.5) await sleep(int(0, 15));
    }

    const expected = await settle(server, roomId, live, problems);
    checkDocument(expected, texts, ledger, problems);
    if (server.seeds() !== (byServer ? 1 : 0)) {
      problems.push(`the server seeded the room ${server.seeds()} times`);
    }
    const room = server.document(roomId)!;
    const records = room.getArray(SEED_RECORDS_KEY).length;
    if (records !== 1) problems.push(`the room records ${records} seeds`);
    checkTraffic(server, Y.encodeStateAsUpdate(room).byteLength, problems);

    // Save and reopen: the stored room, then a participant after a restart and a compaction.
    await until(
      () => storedTexts(server, roomId) === JSON.stringify(expected),
      'the server to store the room'
    );
    for (const entry of live) {
      entry.participant.destroy();
      left.push(entry.participant);
    }
    live.length = 0;
    await until(() => server.document(roomId) === undefined, 'the server to unload the room');
    compactOnLoad = true;
    const reopened = await joinRoom(server, {
      peer: 'reopen',
      roomId,
      bootstrap: { kind: 'create-or-join', document },
    });
    compactOnLoad = false;
    live.push({ participant: reopened, online: true });
    log.push(`reopen, ${server.compactions()} compactions`);
    if (JSON.stringify(paragraphTexts(reopened.store)) !== JSON.stringify(expected)) {
      problems.push('a participant after the restart reads other paragraphs');
    }
    const second = await open('after-restart');
    if (second) {
      insert(second);
      const final = await settle(server, roomId, live, problems);
      checkDocument(final, texts, ledger, problems);
    }
    if (server.seeds() !== (byServer ? 1 : 0)) problems.push('the restart seeded the room again');

    if (rng() < 0.5) await loseStorage(server, roomId, live, document, problems, log);

    for (const entry of [...live.map((item) => item.participant), ...left]) {
      const errors = entry.statuses.filter(
        (status) => status.startsWith('error') && !status.endsWith(':saved-room-unavailable')
      );
      if (errors.length > 0) problems.push(`${entry.peer} reported ${errors.join(', ')}`);
    }
  } catch (error) {
    problems.push(`threw: ${(error as Error).message}`);
  } finally {
    for (const entry of live) entry.participant.destroy();
    await server.stop();
  }
  return { seed, problems, summary: log.join('; ') };
}

function editors(live: Live[], ledger: Ledger): Live[] {
  return live.filter((entry) => (ledger.touched.get(entry.participant.peer)?.size ?? 0) > 0);
}

/** Reconnect everyone, wait for convergence, and return the paragraphs every replica shows. */
async function settle(
  server: SeedServer,
  roomId: string,
  live: Live[],
  problems: string[]
): Promise<string[]> {
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
    if (JSON.stringify(paragraphTexts(entry.participant.store)) !== JSON.stringify(expected)) {
      problems.push(`${entry.participant.peer} shows other paragraphs than the others`);
    }
  }
  return expected;
}

function checkDocument(shown: string[], seed: string[], ledger: Ledger, problems: string[]): void {
  const stripped = shown.map((text) => text.replace(MARKERS, ''));
  if (JSON.stringify(stripped) !== JSON.stringify(seed)) {
    problems.push(`the document is not the seed plus the inserts: ${JSON.stringify(stripped)}`);
  }
  const joined = shown.join('\n');
  for (let index = 0; index < ledger.author.length; index += 1) {
    const count = joined.split(marker(index)).length - 1;
    const expected = ledger.uncertain.has(index) ? null : ledger.removed.has(index) ? 0 : 1;
    if (expected === null ? count > 1 : count !== expected) {
      problems.push(
        `insert ${index} by ${ledger.author[index]} appears ${count} times, expected ${expected ?? 'at most 1'}`
      );
    }
  }
}

/** No seed upload, and no seed echo: one room-sized message for each participant at most. */
function checkTraffic(server: SeedServer, state: number, problems: string[]): void {
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
}

/**
 * Lose the stored state of a room the server knows. The server must refuse it, not seed it
 * again: a second seed would replace every edit with the original file.
 */
async function loseStorage(
  server: SeedServer,
  roomId: string,
  live: Live[],
  document: Uint8Array,
  problems: string[],
  log: string[]
): Promise<void> {
  log.push('lose storage');
  const holder = live[0]!.participant;
  const before = JSON.stringify(paragraphTexts(holder.store));
  for (const entry of live) {
    await synced(entry.participant);
    await entry.participant.disconnect();
    entry.online = false;
  }
  await until(() => server.document(roomId) === undefined, 'the server to unload the room');
  server.storage.delete(roomId);
  await holder.reconnect();
  await until(
    () => holder.statuses.some((status) => status.startsWith('error')),
    'the reconnecting participant to be refused'
  );
  const reported = holder.statuses.find((status) => status.startsWith('error'));
  if (reported !== 'error:saved-room-unavailable') {
    problems.push(`the reconnecting participant reported ${reported}, not saved-room-unavailable`);
  }
  if (JSON.stringify(paragraphTexts(holder.store)) !== before) {
    problems.push('the refused participant lost its document');
  }
  const refused = await joinRoom(server, {
    peer: 'after-loss',
    roomId,
    bootstrap: { kind: 'create-or-join', document },
  }).then(
    (participant) => {
      participant.destroy();
      return 'joined';
    },
    (error: { code?: string }) => error.code ?? 'threw'
  );
  if (refused !== 'saved-room-unavailable') {
    problems.push(`a participant after the loss got ${refused}, not saved-room-unavailable`);
  }
  if (server.storage.has(roomId)) problems.push('the server seeded the lost room again');
}

async function synced(participant: SeedParticipant): Promise<void> {
  await until(
    () => participant.room.provider.isSynced && !participant.room.provider.hasUnsyncedChanges,
    `peer ${participant.peer} to sync`
  );
}

/** The same state vector and the same deletions. */
function sameState(left: Y.Doc, right: Y.Doc): boolean {
  return Y.equalSnapshots(Y.snapshot(left), Y.snapshot(right));
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
