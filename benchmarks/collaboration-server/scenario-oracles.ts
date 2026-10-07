// Comparisons the scenario oracles use, and what they print when replicas differ.

import * as Y from 'yjs';
import {
  readOoxmlPackage,
  serializeOoxmlPart,
  writeOoxmlPackage,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { Replica } from './scenario-replica.ts';
import { sharedNodes } from './scenario-tree.ts';

/** The first item deleted on one replica and not the other, and which replica deleted it how. */
export function missingDeletion(
  left: Replica,
  right: Replica,
  replicas: readonly Replica[]
): string {
  const deleted = (replica: Replica): Map<number, { clock: number; len: number }[]> => {
    const out = new Map<number, { clock: number; len: number }[]>();
    Y.snapshot(replica.ydoc).ds.clients.forEach((ranges, client) => out.set(client, ranges));
    return out;
  };
  const isDeleted = (
    ranges: Map<number, { clock: number; len: number }[]>,
    client: number,
    clock: number
  ) =>
    (ranges.get(client) ?? []).some(
      (range) => range.clock <= clock && clock < range.clock + range.len
    );
  const a = deleted(left);
  const b = deleted(right);
  for (const [from, to, name] of [
    [a, b, left.index],
    [b, a, right.index],
  ] as const) {
    for (const [client, ranges] of from) {
      for (const range of ranges) {
        for (let clock = range.clock; clock < range.clock + range.len; clock += 1) {
          if (isDeleted(to, client, clock)) continue;
          const by = replicas
            .flatMap((replica) =>
              replica.deletions
                .filter(
                  (entry) =>
                    entry.client === client &&
                    entry.clock <= clock &&
                    clock < entry.clock + entry.len
                )
                .map((entry) => `replica ${replica.index} by ${entry.origin}`)
            )
            .join(', ');
          return ` [item ${client}:${clock} deleted only on replica ${name}; deleted ${by || 'nowhere logged'}]`;
        }
      }
    }
  }
  return '';
}

/**
 * The shared state as content, independent of how a replica stores deleted items: each
 * record's fields and each text's formatted content.
 */
export function sharedContent(ydoc: Y.Doc): string {
  // Key order follows each replica's own arrival order, so keys are sorted.
  const sorted = (value: unknown): unknown => {
    if (value instanceof Y.Text) return value.toDelta();
    if (value instanceof Y.Map) value = Object.fromEntries(value.entries());
    else if (value instanceof Y.Array) return value.toArray().map(sorted);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, sorted((value as Record<string, unknown>)[key])])
      );
    }
    return value;
  };
  return JSON.stringify(sorted(sharedNodes(ydoc)));
}

/** Body XML without the ids that each replica or store mints for itself. */
export function comparableBody(pkg: OoxmlPackage): string {
  const part = pkg.parts.get(pkg.mainDocumentPart);
  if (!part) return '';
  return (
    serializeOoxmlPart(part)
      .replace(/\s(w14:paraId|w14:textId|w:rsid[A-Za-z]*)="[^"]*"/g, '')
      .replace(/\sw:id="[^"]*"/g, '')
      // A new content control takes a random `w:id`, different in every store.
      .replace(/<w:id w:val="[^"]*"\/>/g, '<w:id/>')
  );
}

export function fingerprint(pkg: OoxmlPackage): string {
  return [...pkg.parts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, part]) => `${name}\n${serializable(part)}`)
    .join('\n');
}

/** A part as XML, or, when it cannot be written, a line naming the node that stops it. */
function serializable(part: OoxmlPart): string {
  try {
    return serializeOoxmlPart(part);
  } catch (error) {
    const unnamed: string[] = [];
    const walk = (node: OoxmlNode, path: string): void => {
      if (node.kind === 'textValue') return;
      const here = `${path}/${node.localName || '?'}`;
      if (!node.localName) unnamed.push(`${node.id} ${node.kind} at ${here}`);
      for (const child of node.children) walk(child, here);
    };
    walk(part.root, '');
    return `unserializable: ${(error as Error).message}: ${unnamed.slice(0, 3).join('; ')}`;
  }
}

export function reopen(pkg: OoxmlPackage): OoxmlPackage {
  const loaded = readOoxmlPackage(writeOoxmlPackage(pkg));
  if (!loaded.ok) throw new Error(`reopen failed: ${loaded.reason}`);
  return loaded.package;
}

export function firstDifference(left: string, right: string): string {
  let at = 0;
  while (at < left.length && left[at] === right[at]) at += 1;
  return `at ${at}: …${left.slice(Math.max(0, at - 120), at + 120)}… vs …${right.slice(Math.max(0, at - 120), at + 120)}…`;
}

function paragraphsOf(pkg: OoxmlPackage): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') found.push(node);
    for (const child of node.children) walk(child);
  };
  const part = pkg.parts.get(pkg.mainDocumentPart);
  if (part) walk(part.root);
  return found;
}

/** The first body paragraph two packages show differently, by position and node ID. */
export function firstDifferentParagraph(expected: OoxmlPackage, actual: OoxmlPackage): string {
  const left = paragraphsOf(expected);
  const right = paragraphsOf(actual);
  const text = (node: OoxmlNode | undefined): string => {
    if (!node) return '';
    if (node.kind === 'textValue') return node.value;
    return node.children.map(text).join('');
  };
  for (let at = 0; at < Math.max(left.length, right.length); at += 1) {
    if (left[at]?.id !== right[at]?.id || text(left[at]) !== text(right[at])) {
      return `paragraph ${at}: ${left[at]?.id ?? '(none)'} ${JSON.stringify(text(left[at]))} vs ${right[at]?.id ?? '(none)'} ${JSON.stringify(text(right[at]))}`;
    }
  }
  return 'no paragraph differs in text';
}

/**
 * The IDs of every node in the body's paragraphs, in order. Serialized XML carries no IDs,
 * so two trees can print alike while a later local edit addresses a node by an ID that
 * shared state no longer gives it. `resolve` maps an ID the editor minted to the one shared
 * state gave it, as the session's identity map does for the next edit.
 */
export function paragraphIds(
  pkg: OoxmlPackage,
  resolve: (id: string) => string = (id) => id
): string {
  const ids: string[] = [];
  const walk = (node: OoxmlNode): void => {
    ids.push(resolve(node.id));
    if (node.kind !== 'textValue') for (const child of node.children) walk(child);
  };
  // Every story: notes and comments name their nodes by the same rules as the body.
  for (const part of [...pkg.parts.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === 'paragraph') walk(node);
      else for (const child of node.children) visit(child);
    };
    visit(part.root);
  }
  return ids.join(' ');
}
