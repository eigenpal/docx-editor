// Seeded collaboration scenarios with oracles.
//
// Replicas run in one process, joined by a simulated network that can deliver updates at
// once, late, out of order across links, or not at all while a replica is offline. Each
// replica attaches a canonical document store the way the editor does, and edits it with
// random operations. At the end of a scenario the oracles check:
//
//   - convergence: every replica holds the same package, by canonical fingerprint
//   - save and reopen: each replica's package survives a DOCX round trip unchanged, and
//     `readCollaborationDocument` on the shared state gives the same package
//   - health: no session failed, and no operation threw
//   - sequential equivalence (in-order delivery only): the shared result equals the same
//     operations applied to one plain store, so collaboration changed nothing an author did
//   - typed text: what a participant types shows once, unless someone removed it
//   - undo scope: an undo or redo never removes what another participant typed
//   - caret: after typing, the caret stays right after the typed text while peers edit
//   - presence: once replicas agree, every peer shows each caret where its owner has it
//
// The network can also deliver an update twice, lose it, or cut it short; a state-vector
// sync, as a reconnecting provider runs, then brings what was lost.
//
// A failing scenario prints its seed. The same seed replays the same scenario.

import { advanceClock, resetClock } from './scenario-clock.ts';
import { TypedTokens } from './scenario-tokens.ts';
import { CaretWatch } from './scenario-presence.ts';
import * as Y from 'yjs';
import {
  paragraphTextOf,
  readOoxmlPackage,
  type OoxmlPackage,
  type StoryScope,
  type TreePackageStore,
} from '@docx-editor.dev/core/store';
import {
  readCollaborationDocument,
  type DocumentCollaborationHandle,
} from '../../packages/pro/src/collaboration/document-session.ts';
import { awaitingUpdates } from '../../packages/pro/src/collaboration/document/yjs-items.ts';
import { seededRandom } from './edit-model.ts';
import {
  freshBuild,
  parentDifference,
  sessionBuild,
  sessionInternals,
  withFreshBuild,
} from './scenario-fresh.ts';
import type { DocumentRegistry } from '../../packages/pro/src/collaboration/document/index.ts';
import { sharedTexts } from './scenario-tree.ts';
import { storeFrom } from './document-text.ts';
import {
  Network,
  openReplica,
  type Delivery,
  type Fault,
  type Replica,
} from './scenario-replica.ts';
import {
  bindIds,
  DEFAULT_WEIGHTS,
  applyOp,
  planEdit,
  type Addressed,
  type EditKind,
} from './scenario-plan.ts';
import {
  comparableBody,
  fingerprint,
  firstDifference,
  firstDifferentParagraph,
  paragraphIds,
  missingDeletion,
  reopen,
  sharedContent,
} from './scenario-oracles.ts';

export type { Addressed, Delivery, EditKind };

const FAULTS: readonly Fault[] = ['duplicate', 'drop', 'truncate'];

/** How much time one action takes. */
const ACTION_MILLISECONDS = 120;

const BODY: StoryScope = { kind: 'body' };

/** The document ID a seed's replicas share. */
function documentIdFor(seed: number): string {
  return `scenario-${seed}-aaaaaaaaaaaaaaaaaaaa`;
}

export interface ScenarioOptions {
  readonly seed: number;
  readonly replicas: number;
  readonly steps: number;
  readonly document: Uint8Array;
  readonly delivery: Delivery;
  /** Chance per step that one online replica goes offline, or an offline one returns. */
  readonly offlineChance?: number;
  /** Chance per step of an undo or redo by the editing replica. */
  readonly undoChance?: number;
  /** Check every replica against a fresh build of its shared state after every action. */
  readonly strict?: boolean;
  /** Replicas that join part way through, from a peer's current state. */
  readonly lateJoiners?: number;
  /** Relative weights of each edit kind. Kinds with weight 0 never run. */
  readonly weights?: Partial<Record<EditKind, number>>;
  /** Chance per delivery that the update arrives twice, is lost, or is cut short. */
  readonly faultChance?: number;
  /** Chance per step that one replica syncs by state vector with another, as on reconnect. */
  readonly resyncChance?: number;
}

export interface ScenarioReport {
  readonly seed: number;
  readonly options: Omit<ScenarioOptions, 'document'>;
  readonly applied: number;
  readonly refused: Readonly<Record<string, number>>;
  readonly undos: number;
  readonly problems: readonly string[];
  /** Up to the last 40 actions, described for people. */
  readonly trail: readonly string[];
  /** Every action, for `replayActions` and `shrinkActions`. */
  readonly actions: readonly Action[];
  /** Index of the first action after which something failed, or -1. */
  readonly firstFailure: number;
}

/** One scenario step. A recorded list of these replays a scenario exactly. */
export type Action =
  | { readonly kind: 'edit'; readonly replica: number; readonly addressed: Addressed }
  | {
      readonly kind: 'deliver';
      readonly to: number;
      readonly from: number;
      readonly fault?: Fault;
    }
  | { readonly kind: 'resync'; readonly to: number; readonly from: number }
  | { readonly kind: 'undo' | 'redo'; readonly replica: number }
  | { readonly kind: 'toggle'; readonly replica: number }
  | { readonly kind: 'join'; readonly from: number };

function describe(action: Action, replicas: readonly Replica[]): string {
  if (action.kind !== 'edit') return JSON.stringify(action);
  const editor = replicas[action.replica];
  const op = editor ? bindIds(editor.store, action.addressed) : null;
  return `replica ${action.replica} ${JSON.stringify(op ?? action.addressed)}`;
}

/** Replicas, network, and counters for one run, driven one action at a time. */
class Simulation {
  readonly replicas: Replica[] = [];
  readonly problems: string[] = [];
  readonly network: Network;
  readonly refused: Record<string, number> = {};
  readonly sequence: Addressed[] = [];
  readonly trail: string[] = [];
  private readonly tokens = new TypedTokens();
  private readonly carets: CaretWatch;
  applied = 0;
  undos = 0;
  /** Index of the first action after which something failed, or -1. */
  firstFailure = -1;
  /** Check every replica against its shared state after every action, not only at the end. */
  strict = false;
  /**
   * With in-order delivery every edit sees every earlier one, so the editing replica must
   * hold exactly what one plain store holds after the same edits. The store follows each
   * edit, and the first edit after which the two differ is the one reported.
   */
  lockstep: TreePackageStore | null = null;
  private performed = 0;

  /**
   * Each replica shows what its shared state says: the editor's tree equals a fresh build of
   * the shared state by a materializer with no caches. A difference means an incremental view
   * kept something stale, or a local edit left the editor on a tree of its own.
   */
  checkShown(when: string): void {
    for (const replica of this.replicas) {
      // A replica waiting for a held-back update keeps its last complete view on purpose.
      if (awaitingUpdates(replica.ydoc)) continue;
      const problem = withFreshBuild(replica.ydoc, replica.handle.session, (built, registry) =>
        built.ok ? this.shownDifference(replica, built.package, registry) : null
      );
      if (problem) {
        this.problems.push(`replica ${replica.index} ${when} ${problem}`);
        if (this.firstFailure < 0) this.firstFailure = this.performed;
        return;
      }
    }
  }

  /** How a replica's editor differs from `built`, a fresh build of its shared state, or null. */
  private shownDifference(
    replica: Replica,
    built: OoxmlPackage,
    fresh: DocumentRegistry
  ): string | null {
    const session = replica.handle.session;
    const shown = fingerprint(built);
    const local = fingerprint(replica.store.currentPackage());
    if (shown !== local) {
      // Which side is stale: the session's own indexes, or the editor's tree.
      const own = sessionBuild(session);
      const cause = !own.ok
        ? 'unknown'
        : fingerprint(own.package) === local
          ? 'registry indexes stale'
          : fingerprint(own.package) === shown
            ? 'editor tree stale'
            : 'both stale';
      return `shows a tree its shared state does not (${cause}), ${firstDifferentParagraph(built, replica.store.currentPackage())}, ${firstDifference(shown, local)}`;
    }
    const expectedIds = paragraphIds(built);
    const { identityMap } = sessionInternals(session);
    const actualIds = paragraphIds(replica.store.currentPackage(), (id) => identityMap.resolve(id));
    // The session's own indexes must place each node where a fresh read does: a local edit
    // routes through them, before the editor shows anything stale.
    const misplaced = parentDifference(session, fresh);
    if (misplaced) return `has indexes that place nodes as shared state does not: ${misplaced}`;
    if (expectedIds === actualIds) return null;
    const own = sessionBuild(session);
    const ownIds = own.ok ? paragraphIds(own.package) : '';
    const cause =
      ownIds === actualIds
        ? 'registry indexes stale'
        : ownIds === expectedIds
          ? 'editor tree stale'
          : 'both stale';
    return `shows node IDs its shared state does not (${cause}) ${firstDifference(expectedIds, actualIds)}`;
  }

  private readonly restoreRandomness: () => void;

  private readonly documentId: string;

  constructor(
    readonly delivery: Delivery,
    seed: number
  ) {
    this.documentId = documentIdFor(seed);
    this.network = new Network(this.replicas, delivery, this.problems);
    this.carets = new CaretWatch(this.problems);
    this.network.onReceive(
      (replica) => this.carets.before(replica),
      (replica) => this.carets.after(replica)
    );
    this.restoreRandomness = seedRandomness(seed);
    resetClock();
  }

  async open(count: number, document: Uint8Array): Promise<void> {
    await this.add(await openReplica(0, this.documentId, { kind: 'create', document }));
    for (let index = 1; index < count; index += 1) {
      await this.add(
        await openReplica(index, this.documentId, { kind: 'join', from: this.replicas[0]!.ydoc })
      );
    }
  }

  private async add(replica: Replica, readFrom?: number): Promise<void> {
    this.replicas.push(replica);
    // Only a late joiner passes `readFrom`, so it is the one that runs the sync handshake.
    this.network.connect(replica, readFrom, readFrom !== undefined);
  }

  private failed(): boolean {
    return this.problems.length > 0 || this.replicas.some((replica) => replica.failures.length > 0);
  }

  async perform(action: Action): Promise<void> {
    // Inside the undo capture window: an author's consecutive edits group as typing does.
    advanceClock(ACTION_MILLISECONDS);
    this.network.beginAction();
    try {
      await this.performOne(action);
    } finally {
      this.network.endAction();
    }
    // The replica this action changed still shows everything it typed.
    const touched =
      action.kind === 'deliver' || action.kind === 'resync'
        ? this.replicas[action.to]
        : action.kind === 'join'
          ? undefined
          : this.replicas[action.replica];
    // A replica that holds back an update has applied its deletions but not its inserts, so
    // text that update moves is missing there until what it depends on arrives. Hocuspocus
    // sends from one ordered log, and y-webrtc forwards every update it receives over ordered
    // channels, so a peer meets that gap only after a lost message. Visibility is judged once
    // the replica's state is complete.
    if (touched && !awaitingUpdates(touched.ydoc)) {
      this.problems.push(...this.tokens.hiddenOn(touched.store.currentPackage(), touched.index));
    }
    if (touched && this.firstFailure < 0 && this.failed()) this.firstFailure = this.performed - 1;
    if (this.strict && this.firstFailure < 0) this.checkShown(`after action ${this.performed - 1}`);
  }

  private async performOne(action: Action): Promise<void> {
    const index = this.performed;
    this.performed += 1;
    this.trail.push(`${index}: ${describe(action, this.replicas)}`);
    switch (action.kind) {
      case 'join': {
        const source = this.replicas[action.from];
        if (!source) break;
        // A joiner loads a peer's state, then reads the whole relay log. Yjs ignores the
        // updates it already holds, as a provider's sync step does. A join that fails is a
        // user who cannot open the room: a problem to report, not a crash of the run.
        let joiner: Replica;
        try {
          joiner = await openReplica(this.replicas.length, this.documentId, {
            kind: 'join',
            from: source.ydoc,
          });
        } catch (error) {
          this.problems.push(`replica ${this.replicas.length} could not join: ${error}`);
          break;
        }
        await this.add(joiner, 0);
        break;
      }
      case 'toggle': {
        const replica = this.replicas[action.replica];
        if (replica) this.network.setOnline(replica, !replica.online);
        break;
      }
      case 'undo':
      case 'redo': {
        const replica = this.replicas[action.replica];
        if (!replica) break;
        const session = replica.handle.session;
        const before = replica.store.currentPackage();
        const others = this.tokens.othersIn(before, replica.index);
        const sharedBefore = sharedTextOf(replica.ydoc);
        const pendingBefore = shownOrPending(replica);
        if (action.kind === 'redo' ? session.redo() : session.undo()) {
          this.undos += 1;
          this.tokens.undoOn(action.replica, sharedBefore, sharedTextOf(replica.ydoc), {
            before: pendingBefore,
            after: shownOrPending(replica),
          });
          this.carets.moved(replica);
          this.problems.push(
            ...this.tokens.checkUndo(others, replica.store.currentPackage(), replica.index)
          );
        }
        break;
      }
      case 'deliver':
        this.network.deliver(action);
        break;
      case 'resync':
        this.network.resync(action);
        break;
      case 'edit': {
        const editor = this.replicas[action.replica];
        const tagged = this.tokens.tag(action.addressed);
        const op = editor ? bindIds(editor.store, tagged.addressed) : null;
        if (!editor || !op) break;
        try {
          const refusal = editor.handle.session.gateOperations([op], BODY);
          if (refusal) {
            this.refused[`gate:${refusal}`] = (this.refused[`gate:${refusal}`] ?? 0) + 1;
            break;
          }
          const removing = this.tokens.beforeEdit(editor.store, op);
          const result = applyOp(editor.store, op, `replica-${editor.index}`);
          if (!result.ok) {
            const reason = result.reason ?? 'refused';
            this.refused[reason] = (this.refused[reason] ?? 0) + 1;
            break;
          }
          this.tokens.afterEdit(editor.store, removing, editor.index);
          editor.handle.session.flushPendingJournals();
          this.applied += 1;
          // A transient refusal takes the edit back in the same tick; its token never existed.
          if (
            tagged.token !== null &&
            op.op === 'insertText' &&
            paragraphTextOf(editor.store.bodyStore().part, op.paragraphId)?.includes(tagged.token)
          ) {
            this.tokens.typedInto(tagged.token, editor.index, op.paragraphId);
            this.carets.typed(editor, op.paragraphId, tagged.token);
          } else {
            this.carets.moved(editor);
          }
          this.sequence.push(tagged.addressed);
          this.followLockstep(editor, tagged.addressed);
        } catch (error) {
          this.problems.push(`replica ${editor.index} threw ${(error as Error).stack ?? error}`);
        }
        break;
      }
    }
    if (this.firstFailure < 0 && this.failed()) this.firstFailure = index;
  }

  /** Apply an edit a replica made to the lockstep store, and compare the two. */
  private followLockstep(editor: Replica, addressed: Addressed): void {
    const solo = this.lockstep;
    if (!solo) return;
    const op = bindIds(solo, addressed);
    const result = op
      ? applyOp(solo, op, `replica-${editor.index}`)
      : { ok: false as const, reason: 'unbound' };
    const index = this.sequence.length - 1;
    if (!result.ok) {
      this.problems.push(
        `solo store refused edit ${index} (${result.reason}) that replica ${editor.index} applied`
      );
      this.lockstep = null;
      return;
    }
    const expected = comparableBody(solo.currentPackage());
    const actual = comparableBody(editor.store.currentPackage());
    if (expected !== actual) {
      this.problems.push(
        `edit ${index} on replica ${editor.index} differs from a solo store ${firstDifference(expected, actual)}`
      );
      this.lockstep = null;
    }
  }

  /** Deliver everything, then run every oracle. */
  finish(document: Uint8Array, checkSequential: boolean): void {
    const replicas = this.replicas;
    const problems = this.problems;
    if (this.strict) {
      // One delivery at a time, so a failure names the delivery that caused it.
      for (const replica of replicas) this.network.setOnline(replica, true);
      for (let guard = 0; guard < 1_000_000 && this.firstFailure < 0; guard += 1) {
        const next = this.network.pending()[0];
        if (!next) break;
        this.network.deliver(next);
        this.checkShown(`after final delivery ${guard} to replica ${next.to}`);
      }
    }
    this.network.flush();
    if (this.firstFailure < 0 && this.failed()) this.firstFailure = this.performed;

    // Health.
    for (const replica of replicas) {
      problems.push(...replica.failures);
      const status = replica.handle.session.status();
      if (status !== 'ready') problems.push(`replica ${replica.index} ends ${status}`);
    }

    this.checkShown('at the end');
    this.carets.checkPresence(replicas);

    // Convergence.
    const packages = replicas.map((replica) => replica.store.currentPackage());
    const prints = packages.map(fingerprint);
    for (let index = 1; index < prints.length; index += 1) {
      if (prints[index] !== prints[0]) {
        // Say whether the shared states differ, which no view can repair, or only the views.
        const same = sharedContent(replicas[index]!.ydoc) === sharedContent(replicas[0]!.ydoc);
        const vectors =
          Buffer.from(Y.encodeStateVector(replicas[index]!.ydoc)).toString('hex') ===
          Buffer.from(Y.encodeStateVector(replicas[0]!.ydoc)).toString('hex');
        const missing =
          vectors && !same ? missingDeletion(replicas[0]!, replicas[index]!, replicas) : '';
        problems.push(
          `replica ${index} diverged from replica 0${missing} (${same ? 'same shared state' : vectors ? 'shared state differs, same updates' : 'shared state differs, missing updates'}) ${firstDifference(prints[0]!, prints[index]!)}`
        );
        break;
      }
    }

    // Typing that no one removed shows exactly once.
    problems.push(...this.tokens.check(packages));

    // Save and reopen, and the server's view of the shared state.
    try {
      const reopened = fingerprint(reopen(packages[0]!));
      if (reopened !== fingerprint(reopen(reopen(packages[0]!)))) {
        problems.push('save and reopen is not stable');
      }
      const shared = readOoxmlPackage(readCollaborationDocument(replicas[0]!.ydoc));
      if (!shared.ok)
        problems.push(`readCollaborationDocument output does not open: ${shared.reason}`);
      else if (comparableBody(shared.package) !== comparableBody(reopen(packages[0]!))) {
        problems.push(
          `readCollaborationDocument differs from the replicas ${firstDifference(
            comparableBody(reopen(packages[0]!)),
            comparableBody(shared.package)
          )}`
        );
      }
    } catch (error) {
      problems.push(`save failed: ${(error as Error).message}`);
    }

    // Sequential equivalence: only meaningful when every edit saw every earlier edit.
    if (checkSequential) {
      const solo = storeFrom(document);
      for (const [index, addressed] of this.sequence.entries()) {
        const op = bindIds(solo, addressed);
        const result = op ? applyOp(solo, op, 'solo') : { ok: false as const, reason: 'unbound' };
        if (!result.ok) {
          problems.push(`solo replay refused operation ${index} (${result.reason})`);
          break;
        }
      }
      const expected = comparableBody(solo.currentPackage());
      const actual = comparableBody(packages[0]!);
      if (expected !== actual) {
        problems.push(
          `shared result differs from a solo replay ${firstDifference(expected, actual)}`
        );
      }
    }
  }

  dispose(): void {
    for (const replica of this.replicas) {
      replica.detach();
      replica.handle.destroy();
      replica.awareness.destroy();
      replica.ydoc.destroy();
    }
    this.restoreRandomness();
  }
}

/**
 * Make every random choice in a run come from `seed`: Yjs client ids, replica identities, and
 * session ids. Yjs orders concurrent inserts by client id, so without this the same actions
 * pick different conflict winners on each replay, and a failure cannot be shrunk.
 */
function seedRandomness(seed: number): () => void {
  const crypto = globalThis.crypto;
  const original = {
    getRandomValues: crypto.getRandomValues.bind(crypto),
    randomUUID: crypto.randomUUID.bind(crypto),
  };
  const random = seededRandom(seed ^ 0x5eed);
  const fill = <T extends ArrayBufferView | null>(array: T): T => {
    if (array) {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let index = 0; index < bytes.length; index += 1)
        bytes[index] = Math.floor(random() * 256);
    }
    return array;
  };
  crypto.getRandomValues = fill as typeof crypto.getRandomValues;
  crypto.randomUUID = (() => {
    const hex = [...fill(new Uint8Array(16))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }) as typeof crypto.randomUUID;
  return () => {
    crypto.getRandomValues = original.getRandomValues;
    crypto.randomUUID = original.randomUUID;
  };
}

/** Every paragraph's shared text in a replica's document, live characters only. */
function sharedTextOf(ydoc: Y.Doc): string {
  return sharedTexts(ydoc)
    .map(([, text]) => text.toString())
    .join('\n');
}

/**
 * What a replica's editor shows, or will show. A replica that waits for a held-back update
 * keeps its last complete view, so an undo there shows only once the update arrives: read
 * the undo from a fresh build of its shared state instead.
 */
function shownOrPending(replica: Replica): OoxmlPackage {
  if (awaitingUpdates(replica.ydoc)) {
    const built = freshBuild(replica.ydoc, replica.handle.session);
    if (built.ok) return built.package;
  }
  return replica.store.currentPackage();
}

/**
 * Whether every edit of a run sees every earlier one, so that one plain store can follow the
 * run in lockstep: in-order delivery, and no undo or offline step.
 *
 * A fresh run decides from its shape, before it draws any action: no offline or undo chance.
 * A replay has no shape, so it decides from its actions: edits and deliveries only. The two
 * rules differ at the edges, and each run keeps its own. A shape with an undo chance that
 * drew no undo is not sequential, while its replay is; a join or a resync makes a replay not
 * sequential, while a fresh run's shape does not look at them.
 */
function isSequential(
  delivery: Delivery,
  run:
    | { readonly shape: Pick<ScenarioOptions, 'offlineChance' | 'undoChance'> }
    | { readonly actions: readonly Action[] }
): boolean {
  if (delivery !== 'in-order') return false;
  if ('shape' in run) return !run.shape.offlineChance && !run.shape.undoChance;
  return run.actions.every((action) => action.kind === 'edit' || action.kind === 'deliver');
}

export async function runScenario(options: ScenarioOptions): Promise<ScenarioReport> {
  const random = seededRandom(options.seed);
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const simulation = new Simulation(options.delivery, options.seed);
  simulation.strict = options.strict ?? false;
  const sequential = isSequential(options.delivery, { shape: options });
  if (sequential) simulation.lockstep = storeFrom(options.document);
  const actions: Action[] = [];
  const perform = async (action: Action): Promise<void> => {
    actions.push(action);
    await simulation.perform(action);
  };
  await simulation.open(options.replicas, options.document);
  const replicas = simulation.replicas;
  const joinAt = new Set(
    Array.from({ length: options.lateJoiners ?? 0 }, () => Math.floor(random() * options.steps))
  );
  try {
    for (let step = 0; step < options.steps; step += 1) {
      if (joinAt.has(step)) {
        const online = replicas.filter((replica) => replica.online);
        // A joiner needs a peer to join from; with every replica offline, it comes later.
        if (online.length > 0) {
          await perform({
            kind: 'join',
            from: online[Math.floor(random() * online.length)]!.index,
          });
        }
      }
      if (options.offlineChance && random() < options.offlineChance) {
        await perform({ kind: 'toggle', replica: Math.floor(random() * replicas.length) });
      }
      const editor = replicas[Math.floor(random() * replicas.length)]!;
      if (options.undoChance && random() < options.undoChance) {
        await perform({ kind: random() < 0.4 ? 'redo' : 'undo', replica: editor.index });
      } else {
        const addressed = planEdit(editor.store, random, weights);
        if (addressed) await perform({ kind: 'edit', replica: editor.index, addressed });
      }
      if (options.delivery !== 'in-order') {
        const count = Math.floor(random() * 4);
        for (let delivered = 0; delivered < count; delivered += 1) {
          const pending = simulation.network.pending();
          if (pending.length === 0) break;
          const next = pending[Math.floor(random() * pending.length)]!;
          // Faults draw from the random stream only when a shape asks for them, so every
          // other shape replays the seeds it always did.
          const fault: Fault | undefined =
            options.faultChance && random() < options.faultChance
              ? FAULTS[Math.floor(random() * FAULTS.length)]
              : undefined;
          await perform({ kind: 'deliver', ...next, ...(fault ? { fault } : {}) });
        }
      }
      if (options.resyncChance && random() < options.resyncChance) {
        const to = Math.floor(random() * replicas.length);
        const from = Math.floor(random() * replicas.length);
        if (to !== from) await perform({ kind: 'resync', to, from });
      }
    }
    simulation.finish(options.document, sequential);
  } finally {
    simulation.dispose();
  }
  const { document: _document, ...rest } = options;
  return {
    seed: options.seed,
    options: rest,
    applied: simulation.applied,
    refused: simulation.refused,
    undos: simulation.undos,
    problems: simulation.problems,
    trail: simulation.trail.slice(-40),
    actions,
    firstFailure: simulation.firstFailure,
  };
}

/** What a replay hands an `inspect` callback: each replica's store, Yjs document and session. */
export interface InspectedReplica {
  readonly index: number;
  readonly ydoc: Y.Doc;
  readonly store: TreePackageStore;
  readonly session: DocumentCollaborationHandle['session'];
}

/** One replay of saved actions. */
export interface ReplayOptions {
  readonly replicas: number;
  readonly delivery: Delivery;
  readonly actions: readonly Action[];
  readonly seed?: number;
  /** Check that every replica shows its shared state after each action. */
  readonly strict?: boolean;
  /** Called with the replicas once the replay has finished. */
  readonly inspect?: (replicas: readonly InspectedReplica[]) => void;
  /** Deliver everything and run the final oracles before `inspect`; true by default. */
  readonly settle?: boolean;
}

/**
 * Replay a recorded action list, and return the problems the oracles found. `inspect` runs
 * after the oracles and before teardown, for debugging a divergence against live replicas.
 */
export async function replayActions(
  document: Uint8Array,
  {
    replicas: replicaCount,
    delivery,
    actions,
    seed = 1,
    strict = false,
    inspect,
    settle = true,
  }: ReplayOptions
): Promise<{ readonly problems: readonly string[]; readonly trail: readonly string[] }> {
  const simulation = new Simulation(delivery, seed);
  simulation.strict = strict;
  await simulation.open(replicaCount, document);
  if (isSequential(delivery, { actions })) simulation.lockstep = storeFrom(document);
  const inspected = (): InspectedReplica[] =>
    simulation.replicas.map((replica) => ({
      index: replica.index,
      ydoc: replica.ydoc,
      store: replica.store,
      session: replica.handle.session,
    }));
  try {
    for (const action of actions) await simulation.perform(action);
    if (settle) simulation.finish(document, false);
    inspect?.(inspected());
  } finally {
    simulation.dispose();
  }
  return { problems: simulation.problems, trail: simulation.trail };
}

/**
 * Remove actions while `stillFails` holds, by delta debugging, and return what is left.
 *
 * Edits address paragraphs by index, so an action list stays meaningful when earlier actions
 * are removed. An edit that no longer applies is refused and changes nothing.
 */
export async function shrinkActions(
  actions: readonly Action[],
  stillFails: (candidate: readonly Action[]) => Promise<boolean>,
  /** Hears each smaller case that still fails, so a long shrink that stops keeps its progress. */
  onReduced?: (current: readonly Action[]) => void
): Promise<Action[]> {
  let current = [...actions];
  let chunks = 2;
  while (current.length >= 2) {
    const size = Math.ceil(current.length / chunks);
    let reduced = false;
    for (let start = 0; start < current.length; start += size) {
      const candidate = [...current.slice(0, start), ...current.slice(start + size)];
      if (candidate.length > 0 && (await stillFails(candidate))) {
        current = candidate;
        onReduced?.(current);
        chunks = Math.max(chunks - 1, 2);
        reduced = true;
        break;
      }
    }
    if (!reduced) {
      if (size === 1) break;
      chunks = Math.min(current.length, chunks * 2);
    }
  }
  return current;
}
