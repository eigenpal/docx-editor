/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Which paragraphs show which characters, by identity (`paragraph-text-identity.ts`).
 *
 * Identities come in runs: an insert's characters have consecutive clocks, and so do a
 * copy's. Each paragraph's runs are kept sorted by clock per client, apart for moved copies
 * and for characters in their first place, so a lookup is a binary search.
 */
import type { LogicalId } from './identity.ts';
import type { TextIdentities } from './paragraph-text-identity.ts';

/** A character in its first place, a moved copy, or a copy an undo or redo put back. */
export type RunKind = 'original' | 'move' | 'restore';

export interface IdentityRun {
  readonly client: number;
  /** First clock, inclusive. */
  readonly start: number;
  /** Last clock, exclusive. */
  readonly end: number;
  readonly kind: RunKind;
}

interface Entry {
  readonly run: IdentityRun;
  readonly paragraph: LogicalId;
}

/** A text's identities as runs of consecutive clocks. */
export function identityRuns(identities: TextIdentities): IdentityRun[] {
  const runs: IdentityRun[] = [];
  let open: { client: number; start: number; end: number; kind: RunKind } | null = null;
  identities.ids.forEach((id, position) => {
    // A deleted character is held nowhere: a copy of it shows nowhere, and hides nothing.
    if (id === null || identities.deleted[position]) return;
    const client = identities.clients[position]!;
    const clock = identities.clocks[position]!;
    const kind: RunKind = identities.moved[position]
      ? 'move'
      : identities.restored[position]
        ? 'restore'
        : 'original';
    if (open && open.client === client && open.end === clock && open.kind === kind) {
      open.end += 1;
      return;
    }
    if (open) runs.push(open);
    open = { client, start: clock, end: clock + 1, kind };
  });
  if (open) runs.push(open);
  return runs;
}

/** Runs sorted by start whose lengths are all below `bound`, which bounds a backward scan. */
class RunsBelow {
  readonly entries: Entry[] = [];

  constructor(private readonly bound: number) {}

  add(entry: Entry): void {
    this.entries.splice(this.firstAtOrAfter(entry.run.start), 0, entry);
  }

  /** Removes the entry; returns whether it was here. */
  remove(entry: Entry): boolean {
    for (let at = this.firstAtOrAfter(entry.run.start); at < this.entries.length; at += 1) {
      const candidate = this.entries[at]!;
      if (candidate.run.start !== entry.run.start) break;
      if (candidate.paragraph === entry.paragraph && candidate.run.end === entry.run.end) {
        this.entries.splice(at, 1);
        return true;
      }
    }
    return false;
  }

  collect(start: number, end: number, out: Entry[]): void {
    for (let at = this.firstAtOrAfter(end) - 1; at >= 0; at -= 1) {
      const entry = this.entries[at]!;
      if (entry.run.start + this.bound <= start) break;
      if (entry.run.end > start) out.push(entry);
    }
  }

  private firstAtOrAfter(clock: number): number {
    let low = 0;
    let high = this.entries.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.entries[middle]!.run.start < clock) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}

/**
 * The runs of one client, kept by length class: lengths from 2^k up to 2^(k+1). A lookup scans
 * back in each class only as far as that class's longest length could reach. With one bound
 * for all runs, one long run made every lookup scan back over every short run before it.
 */
class ClientRuns {
  private readonly classes = new Map<number, RunsBelow>();

  add(entry: Entry): void {
    const level = lengthClass(entry.run.end - entry.run.start);
    let runs = this.classes.get(level);
    if (!runs) this.classes.set(level, (runs = new RunsBelow(2 ** (level + 1))));
    runs.add(entry);
  }

  remove(entry: Entry): void {
    const level = lengthClass(entry.run.end - entry.run.start);
    const runs = this.classes.get(level);
    if (runs?.remove(entry) && runs.entries.length === 0) this.classes.delete(level);
  }

  /** Every entry whose run overlaps `[start, end)`. */
  overlapping(start: number, end: number): Entry[] {
    const out: Entry[] = [];
    for (const runs of this.classes.values()) runs.collect(start, end, out);
    return out;
  }
}

function lengthClass(length: number): number {
  return length <= 1 ? 0 : 31 - Math.clz32(length);
}

export class IdentityIndex {
  private readonly runsOf = new Map<LogicalId, IdentityRun[]>();
  private readonly tables: Record<RunKind, Map<number, ClientRuns>> = {
    original: new Map(),
    move: new Map(),
    restore: new Map(),
  };

  /**
   * Replace a paragraph's runs. Returns the other paragraphs that show a character a changed
   * copy names, since what they show can change, and every run that came or went.
   */
  update(
    paragraph: LogicalId,
    runs: readonly IdentityRun[]
  ): { readonly affected: Set<LogicalId>; readonly changed: readonly IdentityRun[] } {
    const before = this.runsOf.get(paragraph) ?? [];
    const key = (run: IdentityRun): string => `${run.client}:${run.start}:${run.end}:${run.kind}`;
    // Counted, not as sets: a paragraph can hold one run twice, two copies of one text, and
    // losing one of them has to remove one entry.
    const count = (list: readonly IdentityRun[]): Map<string, IdentityRun[]> => {
      const byKey = new Map<string, IdentityRun[]>();
      for (const run of list) {
        const same = byKey.get(key(run));
        if (same) same.push(run);
        else byKey.set(key(run), [run]);
      }
      return byKey;
    };
    const oldRuns = count(before);
    const newRuns = count(runs);
    const affected = new Set<LogicalId>();
    const changed: IdentityRun[] = [];
    const touch = (run: IdentityRun): void => {
      for (const table of Object.values(this.tables)) {
        for (const entry of table.get(run.client)?.overlapping(run.start, run.end) ?? []) {
          if (entry.paragraph !== paragraph) affected.add(entry.paragraph);
        }
      }
    };
    for (const [runKey, removed] of oldRuns) {
      for (const run of removed.slice(newRuns.get(runKey)?.length ?? 0)) {
        this.tables[run.kind].get(run.client)?.remove({ run, paragraph });
        changed.push(run);
        if (run.kind !== 'original') touch(run);
      }
    }
    for (const [runKey, added] of newRuns) {
      for (const run of added.slice(oldRuns.get(runKey)?.length ?? 0)) {
        const table = this.tables[run.kind];
        let clientRuns = table.get(run.client);
        if (!clientRuns) {
          clientRuns = new ClientRuns();
          table.set(run.client, clientRuns);
        }
        clientRuns.add({ run, paragraph });
        changed.push(run);
        if (run.kind !== 'original') touch(run);
      }
    }
    // A character in its first place hides behind a copy, so a copy that arrives or leaves
    // changes the paragraph it came from; an original changes no other paragraph.
    if (runs.length > 0) this.runsOf.set(paragraph, [...runs]);
    else this.runsOf.delete(paragraph);
    return { affected, changed };
  }

  /** The runs of `kind` that hold a character in `[start, end)`, with their paragraphs. */
  overlapping(
    kind: RunKind,
    client: number,
    start: number,
    end: number
  ): readonly { readonly run: IdentityRun; readonly paragraph: LogicalId }[] {
    return this.tables[kind].get(client)?.overlapping(start, end) ?? [];
  }

  /** The paragraphs that hold one character as `kind`. */
  holdersOf(kind: RunKind, client: number, clock: number): LogicalId[] {
    return (this.tables[kind].get(client)?.overlapping(clock, clock + 1) ?? []).map(
      (entry) => entry.paragraph
    );
  }

  /** The paragraphs that hold one character, in any form. */
  holders(client: number, clock: number): LogicalId[] {
    return (['original', 'move', 'restore'] as const).flatMap((kind) =>
      this.holdersOf(kind, client, clock)
    );
  }

  /**
   * The paragraphs that hold a copy another paragraph holds too, and those copies' runs:
   * which of the paragraphs shows a copy depends on document order.
   */
  contested(): { readonly paragraphs: Set<LogicalId>; readonly runs: IdentityRun[] } {
    const paragraphs = new Set<LogicalId>();
    const runs: IdentityRun[] = [];
    for (const [paragraph, held] of this.runsOf) {
      for (const run of held) {
        if (run.kind === 'original') continue;
        let shared = false;
        for (const kind of ['move', 'restore'] as const) {
          for (const entry of this.overlapping(kind, run.client, run.start, run.end)) {
            if (entry.paragraph !== paragraph) {
              shared = true;
              paragraphs.add(paragraph);
              paragraphs.add(entry.paragraph);
            }
          }
        }
        if (shared) runs.push(run);
      }
    }
    return { paragraphs, runs };
  }

  clear(): void {
    this.runsOf.clear();
    for (const table of Object.values(this.tables)) table.clear();
  }
}
