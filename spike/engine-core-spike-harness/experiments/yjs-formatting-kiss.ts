/** @spike-features yjs-backend — task 2.4 KISS formatting A/B falsification */
import * as Y from 'yjs';

export type CandidateName = 'native-attributes' | 'mark-contributions';
export type CaseName =
  | 'overlap-undo'
  | 'observed-disable'
  | 'mark-independence'
  | 'endpoint-affinity'
  | 'split-tail'
  | 'reopen-history';

export interface CaseOutcome {
  readonly passed: boolean;
  readonly diagnostic: string;
}

export interface CandidateResult {
  readonly passed: boolean;
  readonly encodedBytes: number;
  readonly cases: Readonly<Record<CaseName, CaseOutcome>>;
}

export interface BakeoffResult {
  readonly cases: readonly CaseName[];
  readonly candidates: Readonly<Record<CandidateName, CandidateResult>>;
  readonly winner: CandidateName | null;
}

const CASES: readonly CaseName[] = [
  'overlap-undo',
  'observed-disable',
  'mark-independence',
  'endpoint-affinity',
  'split-tail',
  'reopen-history',
];

let docSerial = 0;

type MarkKind = 'bold' | 'italic';

interface MarkRange {
  readonly start: number;
  readonly end: number;
  readonly kind: MarkKind;
}

interface BoundaryEmbed {
  readonly kind: 'paragraph-boundary';
  readonly paragraphId: string;
}

interface ContributionMeta {
  readonly semanticMarkId: string;
  readonly actorId: string;
  readonly commitId: string;
  readonly kind: MarkKind;
}

type JournalEntry =
  | { readonly op: 'insert'; readonly index: number; readonly text: string }
  | {
      readonly op: 'enable';
      readonly kind: MarkKind;
      readonly start: number;
      readonly end: number;
      readonly contributionId: string;
      readonly meta: ContributionMeta;
    }
  | { readonly op: 'disable'; readonly kind: MarkKind; readonly start: number; readonly end: number }
  | { readonly op: 'split'; readonly index: number; readonly paragraphId: string };

interface BakeoffContext {
  readonly doc: Y.Doc;
  readonly body: Y.Text;
  readonly formattingMetadata: Y.Map<ContributionMeta>;
  readonly markContributions: Y.Map<Record<string, unknown>>;
  readonly observedAdds: Set<string>;
}

interface CandidateAdapter {
  readonly name: CandidateName;
  enable(
    ctx: BakeoffContext,
    origin: string,
    kind: MarkKind,
    start: number,
    end: number,
    contributionId: string,
    meta: ContributionMeta
  ): void;
  disable(ctx: BakeoffContext, origin: string, kind: MarkKind, start: number, end: number): void;
  projectMarks(ctx: BakeoffContext): MarkRange[];
  trackedTypes(ctx: BakeoffContext): Y.AbstractType<any>[];
}

function boundaryEmbed(paragraphId: string): BoundaryEmbed {
  return Object.freeze({ kind: 'paragraph-boundary', paragraphId });
}

function isBoundaryEmbed(value: unknown): value is BoundaryEmbed {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as BoundaryEmbed).kind === 'paragraph-boundary' &&
    typeof (value as BoundaryEmbed).paragraphId === 'string'
  );
}

function syncReplica(from: BakeoffContext, to: BakeoffContext): void {
  Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc));
  from.markContributions.forEach((record, id) => {
    if (record.kind === 'add') to.observedAdds.add(id);
  });
}

function encodedPayloadBytes(ctx: BakeoffContext): number {
  const payload = {
    delta: ctx.body.toDelta(),
    formattingMetadata: [...ctx.formattingMetadata.entries()].sort(([a], [b]) => a.localeCompare(b)),
    markContributions: [...ctx.markContributions.entries()].sort(([a], [b]) => a.localeCompare(b)),
  };
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}

function bindContext(doc: Y.Doc, observedAdds = new Set<string>()): BakeoffContext {
  return Object.freeze({
    doc,
    body: doc.getText('bodySequence'),
    formattingMetadata: doc.getMap<ContributionMeta>('formattingMetadata'),
    markContributions: doc.getMap<Record<string, unknown>>('markContributions'),
    observedAdds,
  });
}

function createContext(initialText = 'abcdefghij'): BakeoffContext {
  const serial = docSerial + 1;
  const doc = new Y.Doc({ gc: false, guid: `kiss-doc-${serial}` });
  docSerial = serial;
  const body = doc.getText('bodySequence');
  doc.transact(() => {
    body.insertEmbed(0, boundaryEmbed('p0'));
    body.insert(1, initialText);
    body.insertEmbed(body.length, boundaryEmbed('p1'));
  });
  return bindContext(doc);
}

function cloneReplica(from: BakeoffContext): BakeoffContext {
  const serial = docSerial + 1;
  const doc = new Y.Doc({ gc: false, guid: `kiss-doc-${serial}` });
  docSerial = serial;
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(from.doc));
  return bindContext(doc, new Set(from.observedAdds));
}

function createReplicaPair(initialText = 'abcdefghij'): [BakeoffContext, BakeoffContext] {
  const primary = createContext(initialText);
  return [primary, cloneReplica(primary)];
}

function createUndoManager(ctx: BakeoffContext, adapter: CandidateAdapter, origin: string): Y.UndoManager {
  return new Y.UndoManager(adapter.trackedTypes(ctx), {
    trackedOrigins: new Set([origin]),
    captureTimeout: Number.MAX_SAFE_INTEGER,
  });
}

function encodeEndpoint(doc: Y.Doc, body: Y.Text, index: number, affinity: 'before' | 'after'): string {
  const assoc = affinity === 'before' ? -1 : 0;
  const relative = Y.createRelativePositionFromTypeIndex(body, index, assoc);
  return btoa(String.fromCharCode(...Y.encodeRelativePosition(relative)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function resolveEndpoint(doc: Y.Doc, body: Y.Text, envelope: string): number {
  const padded = envelope.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const bytes = Uint8Array.from(atob(padded + '='.repeat(padLength)), (c) => c.charCodeAt(0));
  const absolute = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(bytes), doc);
  if (!absolute || absolute.type !== body) throw new TypeError('endpoint detached');
  return absolute.index;
}

function textIndexSet(body: Y.Text): Set<number> {
  const indices = new Set<number>();
  let index = 0;
  for (const segment of body.toDelta()) {
    const len = typeof segment.insert === 'string' ? segment.insert.length : 1;
    if (typeof segment.insert === 'string') {
      for (let offset = 0; offset < len; offset++) indices.add(index + offset);
    }
    index += len;
  }
  return indices;
}

function clipRangeToText(body: Y.Text, start: number, end: number): { start: number; end: number } | null {
  const textIndices = textIndexSet(body);
  let lo = Math.min(start, end);
  let hi = Math.max(start, end);
  while (lo < hi && !textIndices.has(lo)) lo++;
  while (hi > lo && !textIndices.has(hi - 1)) hi--;
  return hi > lo ? { start: lo, end: hi } : null;
}

function mergeRanges(ranges: MarkRange[]): MarkRange[] {
  const grouped = new Map<MarkKind, number[][]>();
  for (const range of ranges) {
    const list = grouped.get(range.kind) ?? [];
    list.push([range.start, range.end]);
    grouped.set(range.kind, list);
  }
  const merged: MarkRange[] = [];
  for (const [kind, spans] of grouped) {
    spans.sort((a, b) => a[0]! - b[0]!);
    let cur: [number, number] | null = null;
    for (const [start, end] of spans) {
      if (!cur || start > cur[1]) {
        if (cur) merged.push({ kind, start: cur[0], end: cur[1] });
        cur = [start, end];
      } else {
        cur[1] = Math.max(cur[1], end);
      }
    }
    if (cur) merged.push({ kind, start: cur[0], end: cur[1] });
  }
  return merged.sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind));
}

function rangesCover(ranges: readonly MarkRange[], kind: MarkKind, start: number, end: number): boolean {
  if (end <= start) return true;
  const targetStart = start;
  const targetEnd = end;
  const matching = ranges.filter((r) => r.kind === kind);
  let covered = targetStart;
  for (const range of matching.sort((a, b) => a.start - b.start)) {
    if (range.start > covered) return false;
    covered = Math.max(covered, range.end);
    if (covered >= targetEnd) return true;
  }
  return covered >= targetEnd;
}

function textAt(body: Y.Text, start: number, end: number): string {
  let result = '';
  let index = 0;
  for (const segment of body.toDelta()) {
    const len = typeof segment.insert === 'string' ? segment.insert.length : 1;
    if (typeof segment.insert === 'string') {
      const clipStart = Math.max(start, index);
      const clipEnd = Math.min(end, index + len);
      if (clipEnd > clipStart) {
        result += segment.insert.slice(clipStart - index, clipEnd - index);
      }
    }
    index += len;
  }
  return result;
}

const candidateA: CandidateAdapter = {
  name: 'native-attributes',
  enable(ctx, origin, kind, start, end, contributionId, meta) {
    const span = clipRangeToText(ctx.body, start, end);
    if (!span) return;
    ctx.doc.transact(() => {
      if (!ctx.formattingMetadata.has(contributionId)) {
        ctx.formattingMetadata.set(contributionId, Object.freeze({ ...meta }));
      }
      ctx.body.format(span.start, span.end - span.start, { [kind]: contributionId });
    }, origin);
  },
  disable(ctx, origin, kind, start, end) {
    const span = clipRangeToText(ctx.body, start, end);
    if (!span) return;
    ctx.doc.transact(() => {
      ctx.body.format(span.start, span.end - span.start, { [kind]: null });
    }, origin);
  },
  projectMarks(ctx) {
    const ranges: MarkRange[] = [];
    let index = 0;
    for (const segment of ctx.body.toDelta()) {
      const len = typeof segment.insert === 'string' ? segment.insert.length : 1;
      if (typeof segment.insert === 'string' && segment.attributes) {
        for (const kind of ['bold', 'italic'] as const) {
          const contributionId = segment.attributes[kind];
          if (typeof contributionId === 'string' && ctx.formattingMetadata.has(contributionId)) {
            const meta = ctx.formattingMetadata.get(contributionId)!;
            if (meta.kind === kind) {
              ranges.push({ kind, start: index, end: index + len });
            }
          }
        }
      }
      index += len;
    }
    return mergeRanges(ranges);
  },
  trackedTypes(ctx) {
    return [ctx.body];
  },
};

const candidateB: CandidateAdapter = {
  name: 'mark-contributions',
  enable(ctx, origin, kind, start, end, contributionId, meta) {
    const span = clipRangeToText(ctx.body, start, end);
    if (!span) return;
    ctx.doc.transact(() => {
      ctx.markContributions.set(
        contributionId,
        Object.freeze({
          kind: 'add',
          markKind: kind,
          actorId: meta.actorId,
          commitId: meta.commitId,
          proposedSemanticMarkId: meta.semanticMarkId,
          relativeStart: encodeEndpoint(ctx.doc, ctx.body, span.start, 'after'),
          relativeEnd: encodeEndpoint(ctx.doc, ctx.body, span.end, 'before'),
        })
      );
      ctx.observedAdds.add(contributionId);
    }, origin);
  },
  disable(ctx, origin, kind, start, end) {
    const span = clipRangeToText(ctx.body, start, end);
    if (!span) return;
    const targets = [...ctx.observedAdds].filter((id) => {
      const record = ctx.markContributions.get(id);
      return record?.kind === 'add' && record.markKind === kind;
    });
    if (targets.length === 0) return;
    const removeId = `remove-${kind}-${span.start}-${span.end}-${targets.join(',')}`;
    ctx.doc.transact(() => {
      ctx.markContributions.set(
        removeId,
        Object.freeze({
          kind: 'remove',
          markKind: kind,
          relativeStart: encodeEndpoint(ctx.doc, ctx.body, span.start, 'after'),
          relativeEnd: encodeEndpoint(ctx.doc, ctx.body, span.end, 'before'),
          targetAddContributionIds: targets.sort(),
        })
      );
    }, origin);
  },
  projectMarks(ctx) {
    const adds: Array<{ id: string; kind: MarkKind; start: number; end: number }> = [];
    const removes: Array<{ kind: MarkKind; start: number; end: number; targets: string[] }> = [];
    ctx.markContributions.forEach((record, id) => {
      if (record.kind === 'add') {
        adds.push({
          id,
          kind: record.markKind as MarkKind,
          start: resolveEndpoint(ctx.doc, ctx.body, record.relativeStart as string),
          end: resolveEndpoint(ctx.doc, ctx.body, record.relativeEnd as string),
        });
      } else if (record.kind === 'remove') {
        removes.push({
          kind: record.markKind as MarkKind,
          start: resolveEndpoint(ctx.doc, ctx.body, record.relativeStart as string),
          end: resolveEndpoint(ctx.doc, ctx.body, record.relativeEnd as string),
          targets: [...(record.targetAddContributionIds as string[])],
        });
      }
    });
    const active = new Map<string, { kind: MarkKind; start: number; end: number }>();
    for (const add of adds.sort((a, b) => a.id.localeCompare(b.id))) {
      active.set(add.id, { kind: add.kind, start: add.start, end: add.end });
    }
    for (const remove of removes.sort((a, b) => `${a.start}:${a.end}`.localeCompare(`${b.start}:${b.end}`))) {
      for (const target of remove.targets) {
        const add = active.get(target);
        if (!add || add.kind !== remove.kind) continue;
        const left = clipRangeToText(ctx.body, add.start, Math.min(add.end, remove.start));
        const right = clipRangeToText(ctx.body, Math.max(add.start, remove.end), add.end);
        active.delete(target);
        if (left) active.set(`${target}:L`, { kind: add.kind, ...left });
        if (right) active.set(`${target}:R`, { kind: add.kind, ...right });
      }
    }
    return mergeRanges([...active.values()].map(({ kind, start, end }) => ({ kind, start, end })));
  },
  trackedTypes(ctx) {
    return [ctx.body, ctx.markContributions];
  },
};

function meta(actorId: string, commitId: string, kind: MarkKind): ContributionMeta {
  return Object.freeze({
    semanticMarkId: `${actorId}-${commitId}-${kind}`,
    actorId,
    commitId,
    kind,
  });
}

interface ScenarioResult {
  readonly outcome: CaseOutcome;
  readonly ctx: BakeoffContext;
}

function runOverlapUndo(adapter: CandidateAdapter): ScenarioResult {
  const [local, remote] = createReplicaPair('abcdefghij');
  const localUm = createUndoManager(local, adapter, 'actor-a');
  adapter.enable(local, 'actor-a', 'bold', 3, 7, 'a-bold-1', meta('actor-a', 'c1', 'bold'));
  adapter.enable(remote, 'actor-b', 'bold', 5, 9, 'b-bold-1', meta('actor-b', 'c1', 'bold'));
  syncReplica(remote, local);
  syncReplica(local, remote);
  localUm.undo();
  localUm.stopCapturing();
  const marks = adapter.projectMarks(local);
  const bobSurvives = rangesCover(marks, 'bold', 5, 9);
  const outcome = {
    passed: bobSurvives,
    diagnostic: bobSurvives
      ? 'actor-a undo left actor-b bold on efgh'
      : `actor-b bold lost after actor-a undo: ${JSON.stringify(marks)}`,
  };
  return { outcome, ctx: local };
}

function runObservedDisable(adapter: CandidateAdapter): ScenarioResult {
  const [alice, bob] = createReplicaPair('0123456789');
  adapter.enable(bob, 'actor-b', 'bold', 6, 10, 'b-bold-1', meta('actor-b', 'c1', 'bold'));
  adapter.enable(alice, 'actor-a', 'bold', 2, 7, 'a-bold-1', meta('actor-a', 'c1', 'bold'));
  syncReplica(alice, bob);
  adapter.disable(alice, 'actor-a', 'bold', 2, 7);
  syncReplica(bob, alice);
  syncReplica(alice, bob);
  const marks = adapter.projectMarks(alice);
  const unseenSurvives = rangesCover(marks, 'bold', 6, 10);
  const outcome = {
    passed: unseenSurvives,
    diagnostic: unseenSurvives
      ? 'unseen actor-b enable survived observed actor-a disable'
      : `unseen enable erased: ${JSON.stringify(marks)}`,
  };
  return { outcome, ctx: alice };
}

function runMarkIndependence(adapter: CandidateAdapter): ScenarioResult {
  const ctx = createContext('0123456789');
  const um = createUndoManager(ctx, adapter, 'actor-a');
  adapter.enable(ctx, 'actor-a', 'italic', 2, 8, 'a-ital-1', meta('actor-a', 'c2', 'italic'));
  um.stopCapturing();
  adapter.enable(ctx, 'actor-a', 'bold', 2, 8, 'a-bold-1', meta('actor-a', 'c1', 'bold'));
  um.stopCapturing();
  um.undo();
  const marks = adapter.projectMarks(ctx);
  const italicOk = rangesCover(marks, 'italic', 2, 8);
  const boldGone = !rangesCover(marks, 'bold', 2, 8);
  const passed = italicOk && boldGone;
  const outcome = {
    passed,
    diagnostic: passed
      ? 'undo removed bold only; italic intact'
      : `independence failed: ${JSON.stringify(marks)}`,
  };
  return { outcome, ctx };
}

function runEndpointAffinity(adapter: CandidateAdapter): ScenarioResult {
  const [left, right] = createReplicaPair('0123456789');
  adapter.enable(left, 'actor-a', 'bold', 3, 7, 'a-bold-1', meta('actor-a', 'c1', 'bold'));
  syncReplica(left, right);
  right.doc.transact(() => {
    right.body.insert(7, 'X');
  }, 'actor-b');
  syncReplica(right, left);
  const marks = adapter.projectMarks(left);
  const expanded = rangesCover(marks, 'bold', 7, 8) && textAt(left.body, 7, 8) === 'X';
  const outcome = {
    passed: expanded,
    diagnostic: expanded
      ? 'concurrent tail insert stayed inside bold coverage'
      : `endpoint affinity failed: ${JSON.stringify(marks)} text=${textAt(left.body, 3, 8)}`,
  };
  return { outcome, ctx: left };
}

function splitParagraph(ctx: BakeoffContext, index: number, paragraphId: string, origin: string): void {
  ctx.doc.transact(() => {
    ctx.body.insertEmbed(index, boundaryEmbed(paragraphId));
  }, origin);
}

function runSplitTail(adapter: CandidateAdapter): ScenarioResult {
  const [local, remote] = createReplicaPair('helloworld');
  adapter.enable(local, 'actor-a', 'bold', 2, 10, 'a-bold-1', meta('actor-a', 'c1', 'bold'));
  syncReplica(local, remote);
  splitParagraph(remote, 7, 'p-mid', 'actor-b');
  syncReplica(remote, local);
  const marks = adapter.projectMarks(local);
  const head = rangesCover(marks, 'bold', 2, 7);
  const tail = rangesCover(marks, 'bold', 8, 11);
  const passed = head && tail;
  const outcome = {
    passed,
    diagnostic: passed
      ? 'split preserved bold head and tail across boundary embed'
      : `split tail lost coverage: ${JSON.stringify(marks)}`,
  };
  return { outcome, ctx: local };
}

function replayJournal(adapter: CandidateAdapter, journal: readonly JournalEntry[], origin: string): {
  ctx: BakeoffContext;
  um: Y.UndoManager;
} {
  const ctx = createContext('');
  const um = createUndoManager(ctx, adapter, origin);
  for (const entry of journal) {
    if (entry.op === 'insert') {
      ctx.doc.transact(() => ctx.body.insert(entry.index, entry.text), origin);
    } else if (entry.op === 'enable') {
      adapter.enable(
        ctx,
        origin,
        entry.kind,
        entry.start,
        entry.end,
        entry.contributionId,
        entry.meta
      );
    }
    um.stopCapturing();
  }
  return { ctx, um };
}

function runReopenHistory(adapter: CandidateAdapter): ScenarioResult {
  const origin = 'actor-a';
  const journal: JournalEntry[] = [
    { op: 'insert', index: 1, text: 'abc' },
    {
      op: 'enable',
      kind: 'bold',
      start: 1,
      end: 4,
      contributionId: 'a-bold-1',
      meta: meta(origin, 'c1', 'bold'),
    },
    { op: 'insert', index: 4, text: 'Z' },
  ];
  const live = createContext('');
  const liveUm = createUndoManager(live, adapter, origin);
  for (const entry of journal) {
    if (entry.op === 'insert') {
      live.doc.transact(() => live.body.insert(entry.index, entry.text), origin);
    } else if (entry.op === 'enable') {
      adapter.enable(
        live,
        origin,
        entry.kind,
        entry.start,
        entry.end,
        entry.contributionId,
        entry.meta
      );
    }
    liveUm.stopCapturing();
  }
  const reopened = replayJournal(adapter, journal, origin);
  liveUm.undo();
  reopened.um.undo();
  const liveMarks = adapter.projectMarks(live);
  const reopenedMarks = adapter.projectMarks(reopened.ctx);
  const liveText = textAt(live.body, 1, 4);
  const reopenedText = textAt(reopened.ctx.body, 1, 4);
  const passed =
    liveText === reopenedText &&
    JSON.stringify(liveMarks) === JSON.stringify(reopenedMarks) &&
    liveText === 'abc';
  const outcome = {
    passed,
    diagnostic: passed
      ? 'journal replay restored undo parity after reopen'
      : `reopen mismatch live=${liveText}/${JSON.stringify(liveMarks)} replay=${reopenedText}/${JSON.stringify(reopenedMarks)}`,
  };
  return { outcome, ctx: live };
}

type ScenarioRunner = (adapter: CandidateAdapter) => ScenarioResult;

const SCENARIOS: Record<CaseName, ScenarioRunner> = {
  'overlap-undo': runOverlapUndo,
  'observed-disable': runObservedDisable,
  'mark-independence': runMarkIndependence,
  'endpoint-affinity': runEndpointAffinity,
  'split-tail': runSplitTail,
  'reopen-history': runReopenHistory,
};

function evaluateCandidate(adapter: CandidateAdapter): CandidateResult {
  const cases = {} as Record<CaseName, CaseOutcome>;
  let encodedBytes = 0;
  for (const caseName of CASES) {
    const result = SCENARIOS[caseName](adapter);
    cases[caseName] = result.outcome;
    encodedBytes += encodedPayloadBytes(result.ctx);
  }
  const passed = CASES.every((caseName) => cases[caseName].passed);
  return Object.freeze({ passed, encodedBytes, cases });
}

function pickWinner(
  a: CandidateResult,
  b: CandidateResult
): CandidateName | null {
  if (a.passed && b.passed) {
    if (a.encodedBytes < b.encodedBytes) return 'native-attributes';
    return 'mark-contributions';
  }
  if (a.passed) return 'native-attributes';
  if (b.passed) return 'mark-contributions';
  return null;
}

export function runFormattingBakeoff(): BakeoffResult {
  docSerial = 0;
  const native = evaluateCandidate(candidateA);
  const contributions = evaluateCandidate(candidateB);
  return Object.freeze({
    cases: CASES,
    candidates: Object.freeze({
      'native-attributes': native,
      'mark-contributions': contributions,
    }),
    winner: pickWinner(native, contributions),
  });
}

if (import.meta.main) {
  console.log(JSON.stringify(runFormattingBakeoff(), null, 2));
}
