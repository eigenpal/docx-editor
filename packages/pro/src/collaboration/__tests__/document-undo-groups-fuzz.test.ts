/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Seeded fuzz of explicit undo groups. A server session (`agent`) runs grouped operations
// while a person (`person`) types, deletes text and paragraphs, splits, undoes and redoes
// in the same room. Gaps between the agent's writes fall both under and over the 500 ms
// capture window, and the relay holds updates back at random.
//
// Invariants:
// - A group with a write that landed is exactly one new undo step, and one undo takes exactly
//   one step off the stack, even when other participants removed all the group wrote.
// - One undo removes every token the undone group typed, and keeps every other token that
//   was present: the person's and the agent's earlier groups'.
// - An undo followed at once by a redo restores the text exactly.
// - Undo and redo refuse while a group is open, and change nothing.
// - An ungrouped agent write keeps the timing rule and never joins a group's step.
// - Replicas converge, and the saved document reopens with the same text.
//
// Undo and redo near text that a person's split moved have open defects that do not depend
// on groups (#1393, #1394). The checks that those defects break relax once text moved.
//
// Environment:
// - `UNDO_GROUP_FUZZ_SEEDS` and `UNDO_GROUP_FUZZ_FROM` choose the seeds.
// - `UNDO_GROUP_FUZZ_SHRINK=<seed>` reduces that seed's failure to the fewest actions and
//   prints them.
// - `UNDO_GROUP_FUZZ_TRACE=1` prints every action with both replicas' paragraphs.
import { afterAll, afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { readOoxmlPackage, type TreeDocOp } from '@docx-editor.dev/core/store';
import type { CanonicalPrimitiveJournal } from '@docx-editor.dev/core/collaboration/replication';
import { readCollaborationDocument } from '../document-read.ts';
import {
  CollaborationUndoGroupError,
  type CollaborationUndoGroup,
} from '../document-undo-group.ts';
import {
  createPeerHarness,
  nodeText,
  walk,
  zipDocument,
  type Peer,
} from './document-peer-support.ts';

const SEEDS = Number(process.env.UNDO_GROUP_FUZZ_SEEDS ?? 24);
const FROM = Number(process.env.UNDO_GROUP_FUZZ_FROM ?? 1);
const SHRINK = process.env.UNDO_GROUP_FUZZ_SHRINK;
const TRACE = process.env.UNDO_GROUP_FUZZ_TRACE === '1';
const STEPS = 30;
/** Gaps between an agent's writes: under, at the edge of, and over the capture window. */
const GAPS = [0, 40, 250, 499, 501, 900, 4_000];

const harness = createPeerHarness('undo-groups-fuzz-room');
afterEach(() => {
  harness.cleanup();
  setSystemTime();
});

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const doc = () =>
  zipDocument(
    [
      'First paragraph of shared text.',
      'Second paragraph to split and join.',
      'Third paragraph for deletions.',
      'Fourth paragraph at the end.',
    ]
      .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
      .join('') + '<w:sectPr/>'
  );

type Who = 'agent' | 'person';

/** One edit in document coordinates, so a shrunk action list stays meaningful. */
export type Edit =
  | {
      readonly kind: 'type';
      readonly paragraph: number;
      readonly offset: number;
      /** The token's name; `bind` puts it in brackets that fit where it lands. */
      readonly token: string;
    }
  | {
      readonly kind: 'delete';
      readonly paragraph: number;
      readonly offset: number;
      readonly length: number;
    }
  | { readonly kind: 'split'; readonly paragraph: number; readonly offset: number }
  | {
      readonly kind: 'format';
      readonly paragraph: number;
      readonly offset: number;
      readonly length: number;
      readonly property: string;
    }
  | { readonly kind: 'deleteBlock'; readonly paragraph: number };

export type Action =
  | { readonly kind: 'begin' | 'end' | 'refuse' | 'pause' | 'resume' }
  | { readonly kind: 'elapse'; readonly ms: number }
  | { readonly kind: 'edit'; readonly who: Who; readonly edit: Edit }
  | { readonly kind: 'personUndo' | 'personRedo' | 'agentRedo' }
  /** Undo and redo while the agent's group is open: both refuse and change nothing. */
  | { readonly kind: 'agentUndoOpen' }
  /** Undo the agent's last group. `redo` redoes it at once; `typing` types while held back. */
  | { readonly kind: 'agentUndo'; readonly redo: boolean; readonly typing: Edit | null };

function texts(peer: Peer): string[] {
  const found: string[] = [];
  walk(peer.store.bodyStore().part.root, (node) => {
    if (node.kind === 'paragraph') found.push(nodeText(node));
  });
  return found;
}

function paragraphIds(peer: Peer): string[] {
  return texts(peer).map((_, index) => harness.paragraphIdAt(peer, index));
}

/** The tokens of `candidates` whose text shows in `peer`. */
function present(peer: Peer, candidates: Iterable<string>): Set<string> {
  const text = texts(peer).join('\n');
  return new Set([...candidates].filter((token) => text.includes(token)));
}

/** Brackets a token can take. */
const BRACKETS = ['[]', '()', '{}', '<>', '«»'] as const;

/**
 * The text a token inserts: its name in brackets that differ from the characters around the
 * insertion point. A store commit describes typing by its difference from the text before,
 * and a bracket equal to the next character would make the shared insert start one bracket
 * later, inside the next token. Undo would then remove characters of that token, which is
 * ordinary attribution of identical text, not a defect.
 */
function bracketed(name: string, before: string | undefined, after: string | undefined): string {
  const pair = BRACKETS.find(([open, close]) => open !== after && close !== before) ?? '[]';
  return `${pair[0]}${name}${pair[1]}`;
}

/** `offset`, moved to the end of any token of `text` it falls inside. */
function outsideTokens(text: string, offset: number, tokens: ReadonlySet<string>): number {
  let at = offset;
  for (let moved = true; moved; ) {
    moved = false;
    for (const token of tokens) {
      for (let from = text.indexOf(token); from >= 0; from = text.indexOf(token, from + 1)) {
        if (from < at && at < from + token.length) {
          at = from + token.length;
          moved = true;
        }
      }
    }
  }
  return at;
}

/** Bind an edit to `peer`'s current paragraphs, or null when it no longer applies. */
function bind(peer: Peer, edit: Edit, tokens: ReadonlySet<string>): TreeDocOp | null {
  const paragraphs = texts(peer);
  if (paragraphs.length === 0) return null;
  const index = Math.min(edit.paragraph, paragraphs.length - 1);
  const paragraphId = harness.paragraphIdAt(peer, index);
  const length = paragraphs[index]!.length;
  if (edit.kind === 'deleteBlock') {
    return paragraphs.length > 3 ? { op: 'deleteBlock', blockId: paragraphId } : null;
  }
  const offset = Math.min(edit.offset, length);
  switch (edit.kind) {
    case 'type': {
      const text = paragraphs[index]!;
      // Typing never lands inside a token: its text would then not show whole, and the
      // oracles could not tell what an undo kept.
      const at = outsideTokens(text, offset, tokens);
      const token = bracketed(edit.token, text[at - 1], text[at]);
      return { op: 'insertText', paragraphId, offset: at, text: token };
    }
    case 'split':
      return { op: 'splitParagraph', paragraphId, offset };
    case 'delete': {
      if (length === 0) return null;
      const text = paragraphs[index]!;
      const start = Math.min(offset, length - 1);
      // As with a token, a range whose first character repeats after it, or whose last
      // repeats before it, is attributed to other characters of identical text.
      for (let end = Math.min(length, start + edit.length); end > start; end -= 1) {
        if (text[start] !== text[end] && text[end - 1] !== text[start - 1]) {
          return { op: 'deleteText', paragraphId, start, end };
        }
      }
      return null;
    }
    case 'format': {
      if (length === 0) return null;
      const start = Math.min(offset, length - 1);
      return {
        op: 'setRunProperties',
        paragraphId,
        start,
        end: Math.min(length, start + edit.length),
        properties: [{ localName: edit.property }],
      };
    }
  }
}

const EMPTY_STATS = {
  undoChecks: 0,
  tokenChecks: 0,
  tokensExempt: 0,
  redoExact: 0,
  redoTokensMoved: 0,
  openRefusals: 0,
  ungroupedSteps: 0,
};
const totals = { ...EMPTY_STATS };

interface Group {
  readonly tokens: string[];
  /** Paragraphs the group's splits created. Its undo removes them, with what they hold. */
  readonly created: Set<string>;
  /** A step of ungrouped writes, which the timing rule shapes. */
  readonly ungrouped?: boolean;
}

/** Two replicas, the agent's open group, and what the oracles know. */
class Run {
  readonly problems: string[] = [];
  readonly trail: string[] = [];
  private now: number;
  private paused = false;
  private tap: ((journal: CanonicalPrimitiveJournal) => void) | null = null;
  private handle: CollaborationUndoGroup | null = null;
  private group: Group | null = null;
  private groupSteps = 0;
  private landed = false;
  private readonly everyToken = new Set<string>();
  /** Tokens a person's action took from view: a later undo of it may bring back copies. */
  private readonly uncertain = new Set<string>();
  /**
   * A person split or removed a paragraph, which moves text. Undo and redo of text near
   * moved text have open defects that are not about group boundaries (#1393, #1394), so
   * some checks relax once text moved.
   */
  private moved = false;
  /** How often each check ran, and how often an exemption applied. */
  readonly stats = { ...EMPTY_STATS };
  /** When the agent's last ungrouped write landed, and whether the next one may join it. */
  private lastUngrouped = 0;
  private mergeable = false;
  /** The agent's groups that hold a step, oldest first, and the ones it undid. */
  readonly done: Group[] = [];
  private readonly undone: Group[] = [];

  private constructor(
    readonly agent: Peer,
    readonly person: Peer,
    private readonly controls: { pause: () => void; resume: () => void },
    seed: number
  ) {
    this.now = 1_800_000_000_000 + seed * 1_000_000;
  }

  static async open(seed: number): Promise<Run> {
    setSystemTime(new Date(1_800_000_000_000 + seed * 1_000_000));
    const { alice, bob, pause, resume } = await harness.pair(doc());
    const run = new Run(alice, bob, { pause, resume }, seed);
    // The agent's port is tapped, so the fuzz can publish a journal shared state refuses.
    alice.detach();
    alice.room.session.attach({
      ...alice.port,
      observePrimitiveJournal: (listener) => {
        run.tap = listener;
        return alice.port.observePrimitiveJournal(listener);
      },
    });
    return run;
  }

  get groupOpen(): boolean {
    return this.handle !== null;
  }

  get failed(): boolean {
    return this.problems.length > 0;
  }

  private undoSteps(): number {
    const session = this.agent.room.session as unknown as {
      undoManager: { undoStack: unknown[] };
    };
    return session.undoManager.undoStack.length;
  }

  private fail(message: string): void {
    this.problems.push(`${message}\n  trail: ${this.trail.slice(-25).join('\n  ')}`);
  }

  private settle(): void {
    if (this.paused) this.controls.resume();
    this.paused = false;
  }

  private note(entry: string): void {
    this.trail.push(entry);
    if (!TRACE) return;
    const shown = (peer: Peer): string =>
      paragraphIds(peer)
        .map((id, index) => `${id}=${JSON.stringify(texts(peer)[index])}`)
        .join(' | ');
    console.warn(`${entry}\n    agent: ${shown(this.agent)}\n    person: ${shown(this.person)}`);
  }

  private write(peer: Peer, op: TreeDocOp): boolean {
    try {
      harness.apply(peer, [op]);
      return true;
    } catch {
      return false;
    }
  }

  /** Run one person action, and mark every token it takes from view as uncertain. */
  private asPerson(run: () => string): void {
    const before = present(this.person, this.everyToken);
    this.note(run());
    const after = present(this.person, this.everyToken);
    for (const token of before) if (!after.has(token)) this.uncertain.add(token);
  }

  /** Returns the paragraph the edit addressed, or null when it no longer applies. */
  private personEdit(edit: Edit): string | null {
    const op = bind(this.person, edit, this.everyToken);
    if (!op) return null;
    this.asPerson(() => `person ${JSON.stringify(op)} ${this.write(this.person, op)}`);
    if (op.op === 'splitParagraph' || op.op === 'deleteBlock') {
      this.moved = true;
    }
    if (op.op === 'insertText') this.everyToken.add(op.text);
    return 'paragraphId' in op ? op.paragraphId : op.op === 'deleteBlock' ? op.blockId : null;
  }

  private agentEdit(edit: Edit): void {
    const op = bind(this.agent, edit, this.everyToken);
    if (!op) return;
    const before = new Set(paragraphIds(this.agent));
    const steps = this.undoSteps();
    const ok = this.write(this.agent, op);
    this.note(`agent ${JSON.stringify(op)} ${ok}`);
    if (!ok) return;
    // An ungrouped write keeps the timing rule: it starts a step of its own, or joins the
    // ungrouped step right below it when that step is less than 500 ms old. It never joins
    // a group's step.
    let group = this.group;
    if (!group) {
      const added = this.undoSteps() - steps;
      const top = this.done[this.done.length - 1];
      if (added === 1) {
        group = { tokens: [], created: new Set(), ungrouped: true };
        this.stats.ungroupedSteps += 1;
        this.done.push(group);
        this.undone.length = 0;
      } else if (added === 0 && op.op === 'insertText') {
        if (!top?.ungrouped || this.now - this.lastUngrouped >= 500 || !this.mergeable) {
          this.fail('an ungrouped write joined a step it should not join');
          return;
        }
        group = top;
      }
      this.lastUngrouped = this.now;
      this.mergeable = true;
    }
    if (!group) return;
    for (const id of paragraphIds(this.agent)) if (!before.has(id)) group.created.add(id);
    if (op.op === 'insertText') {
      this.everyToken.add(op.text);
      group.tokens.push(op.text);
      if (group === this.group) this.landed = true;
    }
  }

  async perform(action: Action): Promise<void> {
    switch (action.kind) {
      case 'elapse':
        this.now += action.ms;
        setSystemTime(new Date(this.now));
        return;
      case 'pause':
        this.paused = true;
        this.controls.pause();
        return;
      case 'resume':
        this.settle();
        return;
      case 'begin':
        if (this.handle) return;
        this.mergeable = false;
        this.handle = this.agent.room.session.beginUndoGroup();
        this.group = { tokens: [], created: new Set() };
        this.groupSteps = this.undoSteps();
        this.landed = false;
        this.note('agent begin');
        return;
      case 'end': {
        if (!this.handle || !this.group) return;
        this.handle.end();
        this.note('agent end');
        const added = this.undoSteps() - this.groupSteps;
        if (added > 1 || (this.landed && added !== 1)) {
          this.fail(`a group added ${added} undo steps (typed ${this.group.tokens.length} tokens)`);
        }
        if (added === 1) {
          this.done.push(this.group);
          this.undone.length = 0;
        }
        this.handle = null;
        this.group = null;
        this.mergeable = false;
        return;
      }
      case 'agentUndoOpen': {
        if (!this.handle) return;
        const before = JSON.stringify(texts(this.agent));
        const steps = this.undoSteps();
        const session = this.agent.room.session;
        const refused =
          !session.canUndo() && !session.canRedo() && !session.undo() && !session.redo();
        this.note('agent undo and redo while open');
        if (!refused || !session.undoGroupOpen)
          this.fail('undo or redo ran while a group was open');
        this.stats.openRefusals += 1;
        if (JSON.stringify(texts(this.agent)) !== before || this.undoSteps() !== steps) {
          this.fail('a refused undo or redo changed the document or its history');
        }
        return;
      }
      case 'refuse':
        this.mergeable = false;
        this.tap?.({
          effects: [
            {
              kind: 'spliceText',
              logicalId: 'missing',
              utf16Start: 0,
              deleteCount: 0,
              insert: 'X',
            },
          ],
        });
        this.note('agent refused journal');
        // The realign ends the batch; the session recovers once it is over.
        await Promise.resolve();
        return;
      case 'edit':
        if (action.who === 'agent') this.agentEdit(action.edit);
        else this.personEdit(action.edit);
        return;
      case 'personUndo':
        this.asPerson(() => `person undo ${this.person.room.session.undo()}`);
        return;
      case 'personRedo':
        this.asPerson(() => `person redo ${this.person.room.session.redo()}`);
        return;
      case 'agentRedo': {
        this.settle();
        const group = this.undone[this.undone.length - 1];
        if (!group || this.handle) return;
        if (this.agent.room.session.redo()) {
          this.agent.port.flushPendingJournals();
          this.note('agent redo');
          this.mergeable = false;
          this.undone.pop();
          this.done.push(group);
        }
        return;
      }
      case 'agentUndo':
        this.agentUndo(action);
        return;
    }
  }

  private agentUndo(action: Extract<Action, { kind: 'agentUndo' }>): void {
    this.settle();
    if (this.done.length === 0 || this.handle) return;
    const idsBefore = paragraphIds(this.agent);
    const textBefore = texts(this.agent);
    const presentBefore = present(this.agent, this.everyToken);
    if (action.typing) {
      this.paused = true;
      this.controls.pause();
    }
    const stepsBefore = this.undoSteps();
    if (!this.agent.room.session.undo()) {
      this.fail('undo refused with a closed group and a step on the stack');
      return;
    }
    this.agent.port.flushPendingJournals();
    this.note('agent undo');
    // A group's step goes alone. An ungrouped step may take ungrouped steps below it that
    // changed nothing, as without groups, but never a group's step.
    const taken = stepsBefore - this.undoSteps();
    const steps = this.done.slice(-Math.max(taken, 1));
    if (
      taken < 1 ||
      (taken > 1 && steps.some((step) => !step.ungrouped)) ||
      (!steps[steps.length - 1]!.ungrouped && taken !== 1)
    ) {
      this.fail(`one undo took ${taken} steps off the stack`);
      return;
    }
    const group: Group = {
      tokens: steps.flatMap((step) => step.tokens),
      created: new Set(steps.flatMap((step) => [...step.created])),
      ...(steps[0]!.ungrouped ? { ungrouped: true } : {}),
    };
    // Undo of a split removes the paragraph it created, and with it what a person typed
    // there (#1398). That is the split's own undo rule, not the group's, so those tokens are
    // exempt.
    const inCreated = textBefore
      .filter((_, index) => group.created.has(idsBefore[index]!))
      .join('\n');
    // Text the removal joins back can still be lost by a later undo (#1393).
    for (const token of this.everyToken) if (inCreated.includes(token)) this.uncertain.add(token);
    const others = new Set(
      [...presentBefore].filter(
        (token) => !group.tokens.includes(token) && !inCreated.includes(token)
      )
    );
    this.done.splice(-steps.length, steps.length - 1);
    this.mergeable = false;
    this.done.pop();
    this.undone.push(group);
    if (!action.typing && action.redo) {
      if (!this.agent.room.session.redo()) this.fail('redo refused at once after undo');
      this.agent.port.flushPendingJournals();
      this.note('agent redo');
      this.done.push(group);
      this.undone.pop();
      // The text must read exactly as before. Once a person's split moved text, a redo can
      // write the group's own tokens in another place, or show one again where a person
      // removed it (#1394). Only then, and only the group's tokens, may differ.
      const without = (lines: string[]): string => {
        let text = lines.join('\n');
        for (const token of group.tokens) text = text.split(token).join('');
        return text;
      };
      const after = texts(this.agent);
      const exact = JSON.stringify(after) === JSON.stringify(textBefore);
      if (exact) this.stats.redoExact += 1;
      else if (this.moved && without(after) === without(textBefore))
        this.stats.redoTokensMoved += 1;
      else {
        this.fail(
          `undo then redo changed the text: ${JSON.stringify(textBefore)} -> ${JSON.stringify(texts(this.agent))}`
        );
      }
      return;
    }
    // A person who types near moved text before the undo arrives can write a copy of that
    // text as their own, and the copy stays (#1394). The group's tokens are then exempt
    // from the check that the undo removed them.
    const concurrentCopy = action.typing !== null && this.moved;
    if (action.typing) {
      const tokensBefore = new Set(this.everyToken);
      const target = this.personEdit(action.typing);
      // Typing into a paragraph that the undo removes joins the text it is joined back to,
      // where a later undo can lose it (#1393).
      if (target !== null && group.created.has(target)) {
        for (const token of this.everyToken)
          if (!tokensBefore.has(token)) this.uncertain.add(token);
      }
    }
    this.settle();
    for (const replica of [this.agent, this.person]) {
      this.stats.undoChecks += 1;
      this.stats.tokenChecks += group.tokens.length;
      for (const token of present(replica, group.tokens)) {
        if (this.uncertain.has(token) || concurrentCopy) this.stats.tokensExempt += 1;
        else this.fail(`undo left the group's token ${token}`);
      }
      const kept = present(replica, others);
      for (const token of others) {
        this.stats.tokenChecks += 1;
        if (kept.has(token)) continue;
        if (this.uncertain.has(token)) this.stats.tokensExempt += 1;
        else {
          this.fail(
            `undo removed ${token}, which the group did not type: ${JSON.stringify(textBefore)} -> ${JSON.stringify(texts(replica))}`
          );
        }
      }
    }
  }

  /** The final oracles: convergence, the room's read, and a reopened replica. */
  async finish(): Promise<void> {
    if (this.handle) await this.perform({ kind: 'end' });
    this.settle();
    try {
      harness.expectConverged(this.agent, this.person);
    } catch (error) {
      this.fail(String(error));
    }
    const read = readOoxmlPackage(readCollaborationDocument(this.person.ydoc));
    if (!read.ok) this.fail(`the room does not reopen: ${read.reason}`);
    const reopened = await harness.remount(this.person);
    if (JSON.stringify(texts(reopened)) !== JSON.stringify(texts(this.agent))) {
      this.fail('a reopened replica shows other text');
    }
  }

  /** A random edit on `peer`'s current paragraphs. */
  randomEdit(peer: Who, random: () => number, token: string | null): Edit | null {
    const paragraphs = texts(peer === 'agent' ? this.agent : this.person);
    const paragraph = Math.floor(random() ** 2 * paragraphs.length);
    const length = paragraphs[paragraph]!.length;
    const offset = Math.floor(random() * (length + 1));
    if (token !== null) return { kind: 'type', paragraph, offset, token };
    const roll = random();
    const span = 1 + Math.floor(random() * 10);
    if (roll < 0.3 && length > 0) return { kind: 'delete', paragraph, offset, length: span };
    if (roll < 0.55) return { kind: 'split', paragraph, offset };
    if (roll < 0.8 && length > 0) {
      const property = ['b', 'i', 'u'][Math.floor(random() * 3)]!;
      return { kind: 'format', paragraph, offset, length: span, property };
    }
    return paragraphs.length > 3 ? { kind: 'deleteBlock', paragraph } : null;
  }
}

/** Generate and perform one seed's actions. */
async function runSeed(seed: number): Promise<{ problems: string[]; actions: Action[] }> {
  const random = seededRandom(seed);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  const run = await Run.open(seed);
  const actions: Action[] = [];
  const perform = async (action: Action | null): Promise<void> => {
    if (!action || run.failed) return;
    actions.push(action);
    await run.perform(action);
  };
  let counter = 0;
  // Names of one width: a token that loses a character never reads as another token.
  const name = (prefix: string): string => `${prefix}${String((counter += 1)).padStart(4, '0')}`;
  const personAction = (onlyTyping: boolean): Action | null => {
    const roll = random();
    if (!onlyTyping && roll < 0.12) return { kind: 'personUndo' };
    if (!onlyTyping && roll < 0.18) return { kind: 'personRedo' };
    const token = onlyTyping || roll < 0.6 ? name('p') : null;
    const edit = run.randomEdit('person', random, token);
    return edit ? { kind: 'edit', who: 'person', edit } : null;
  };
  await perform({ kind: 'elapse', ms: 0 });
  for (let step = 0; step < STEPS && !run.failed; step += 1) {
    const roll = random();
    if (roll < 0.5) {
      await perform({ kind: 'begin' });
      const writes = 1 + Math.floor(random() * 4);
      for (let at = 0; at < writes; at += 1) {
        if (random() < 0.25) await perform({ kind: 'pause' });
        if (random() < 0.1) await perform({ kind: 'refuse' });
        const token = random() < 0.7 ? name('a') : null;
        const edit = run.randomEdit('agent', random, token);
        if (edit) await perform({ kind: 'edit', who: 'agent', edit });
        if (random() < 0.6) await perform(personAction(false));
        if (random() < 0.5) await perform({ kind: 'resume' });
        if (random() < 0.15) await perform({ kind: 'agentUndoOpen' });
        await perform({ kind: 'elapse', ms: pick(GAPS) });
      }
      await perform({ kind: 'end' });
    } else if (roll < 0.6) {
      // Ungrouped agent writes between groups keep the timing rule.
      const writes = 1 + Math.floor(random() * 3);
      for (let at = 0; at < writes; at += 1) {
        const token = random() < 0.8 ? name('a') : null;
        const edit = run.randomEdit('agent', random, token);
        if (edit) await perform({ kind: 'edit', who: 'agent', edit });
        if (random() < 0.4) await perform(personAction(false));
        await perform({ kind: 'elapse', ms: pick(GAPS) });
      }
    } else if (roll < 0.7 && run.done.length > 0) {
      const typing = random() < 0.3;
      const redo = !typing && random() < 0.4;
      const edit = typing ? run.randomEdit('person', random, name('p')) : null;
      await perform({ kind: 'agentUndo', redo, typing: edit });
    } else if (roll < 0.78) {
      await perform({ kind: 'agentRedo' });
    } else {
      await perform(personAction(false));
      if (random() < 0.5) await perform({ kind: 'resume' });
    }
    await perform({ kind: 'elapse', ms: pick(GAPS) });
  }
  if (!run.failed) await run.finish();
  const problems = run.problems.map((problem) => `seed ${seed}: ${problem}`);
  for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += run.stats[key];
  harness.cleanup();
  return { problems, actions };
}

/** Perform recorded actions on a fresh room. */
async function replay(actions: readonly Action[]): Promise<string[]> {
  const run = await Run.open(0);
  try {
    for (const action of actions) {
      if (run.failed) break;
      await run.perform(action);
    }
    if (!run.failed) await run.finish();
  } catch (error) {
    if (!(error instanceof CollaborationUndoGroupError)) run.problems.push(`threw ${error}`);
  }
  harness.cleanup();
  return run.problems;
}

/** The kind of a problem, without its trail and values, to keep a shrink on one defect. */
function kindOf(problem: string): string {
  return problem
    .replace(/\n[\s\S]*$/, '')
    .replace(/:.*$/, '')
    .replace(/[[({<«][ap]\d+[\])}>»]|\d+/g, '#')
    .slice(0, 40);
}

/** Remove actions while the same kind of problem persists. */
async function shrink(actions: readonly Action[], kind: string): Promise<Action[]> {
  let current = [...actions];
  for (let size = Math.ceil(current.length / 2); size >= 1; size = Math.floor(size / 2)) {
    let removed = true;
    while (removed) {
      removed = false;
      for (let start = 0; start < current.length; start += size) {
        const candidate = [...current.slice(0, start), ...current.slice(start + size)];
        const problems = await replay(candidate);
        if (problems.some((problem) => kindOf(problem) === kind)) {
          current = candidate;
          removed = true;
          break;
        }
      }
    }
  }
  return current;
}

describe('undo groups fuzz', () => {
  if (SHRINK !== undefined) {
    test(`shrink seed ${SHRINK}`, async () => {
      const { problems, actions } = await runSeed(Number(SHRINK));
      expect(problems.length).toBeGreaterThan(0);
      const kind = kindOf(problems[0]!.replace(/^seed \d+: /, ''));
      const minimal = await shrink(actions, kind);
      console.warn(`${kind}\n${JSON.stringify(minimal, null, 1)}`);
      console.warn((await replay(minimal))[0]);
    }, 600_000);
    return;
  }
  afterAll(() => {
    // How much each oracle checked. Exemptions should stay a small share of the checks.
    console.warn(`undo group fuzz checks: ${JSON.stringify(totals)}`);
  });
  for (let seed = FROM; seed < FROM + SEEDS; seed += 1) {
    test(`seed ${seed}`, async () => {
      const { problems } = await runSeed(seed);
      expect(problems).toEqual([]);
    });
  }
});
