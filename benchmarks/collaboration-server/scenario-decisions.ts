// An oracle for decisions on pending changes: an accept or reject reaches all of the change
// its author saw.
//
// Every replica can agree on a wrong result, so convergence alone passes a decision that is
// lost on part of its change, as a peer's concurrent typing inside the change once made it.
// So when a replica accepts or rejects a change, the typed tokens the change holds in that
// replica's view are recorded. At the end, none of them may still sit in a change with the
// same identity. A replica that undoes or redoes after its decision may have brought the
// change back, so its earlier decisions are not checked. The undo restores the change as new
// content, so a peer's decision on the same change that did not see the undo misses it too,
// and is not checked either.

import type {
  OoxmlNode,
  OoxmlPackage,
  TreeDocOp,
  TreePackageStore,
} from '@docx-editor.dev/core/store';
import * as Y from 'yjs';
import { TOKEN_BASE, tokenNumber } from './scenario-tokens.ts';

const DECISIONS = new Set([
  'acceptRevision',
  'rejectRevision',
  'acceptAllRevisions',
  'rejectAllRevisions',
]);
const REVISIONS = new Set(['ins', 'del']);
const TOKEN_END = TOKEN_BASE + 0x1900;

/** A pending change's identity: element, `w:id`, author, and date. */
function identityOf(node: OoxmlNode): string | null {
  if (node.kind === 'textValue' || !REVISIONS.has(node.localName)) return null;
  const value = (name: string) =>
    node.attributes.find((attribute) => attribute.localName === name)?.value ?? '';
  return JSON.stringify([node.localName, value('id'), value('author'), value('date')]);
}

/** Each typed token in `root`, with the identities of the changes around it. */
function tokensInChanges(root: OoxmlNode): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const walk = (node: OoxmlNode, around: readonly string[]): void => {
    if (node.kind === 'textValue') {
      for (const character of node.value) {
        const code = character.charCodeAt(0);
        if (code < TOKEN_BASE || code >= TOKEN_END || around.length === 0) continue;
        const identities = found.get(character) ?? new Set<string>();
        for (const identity of around) identities.add(identity);
        found.set(character, identities);
      }
      return;
    }
    const identity = identityOf(node);
    const inner = identity === null ? around : [...around, identity];
    for (const child of node.children) walk(child, inner);
  };
  walk(root, []);
  return found;
}

/** The node with `id` under `root`, or null. */
function findIn(root: OoxmlNode, id: string): OoxmlNode | null {
  if (root.id === id) return root;
  if (root.kind === 'textValue') return null;
  for (const child of root.children) {
    const found = findIn(child, id);
    if (found) return found;
  }
  return null;
}

function bodyOf(pkg: OoxmlPackage): OoxmlNode | null {
  return pkg.parts.get(pkg.mainDocumentPart)?.root ?? null;
}

interface Decision {
  readonly replica: number;
  readonly label: string;
  /** Each token the change held when the replica decided, and the identities it decided. */
  readonly tokens: ReadonlyMap<string, ReadonlySet<string>>;
  /** The deciding replica's shared state, to tell later which undos it had seen. */
  readonly seen: Uint8Array;
  excused: boolean;
}

/** An undo or redo: the replica's shared clock after it, and the changes it may restore. */
interface Restore {
  readonly replica: number;
  readonly client: number;
  readonly clock: number;
  readonly identities: ReadonlySet<string>;
}

const decidedIdentities = (decision: Decision): Set<string> =>
  new Set([...decision.tokens.values()].flatMap((identities) => [...identities]));

export class DecisionOracle {
  private readonly decisions: Decision[] = [];
  private readonly restores: Restore[] = [];

  /** Before `op` applies on `replica`: what a decision decides there. Null for other edits. */
  before(store: TreePackageStore, op: TreeDocOp, replica: number, ydoc: Y.Doc): Decision | null {
    if (!DECISIONS.has(op.op)) return null;
    const root = store.bodyStore().part.root;
    // A decision that names its sites, as a card decision does, decides those sites only: the
    // tokens inside them, not those in another piece of the same change, which is its own card.
    const named = (op as unknown as { siteNodeIds?: readonly string[] }).siteNodeIds;
    const inChanges = named ? new Map<string, Set<string>>() : tokensInChanges(root);
    for (const id of named ?? []) {
      const node = findIn(root, id);
      if (!node) continue;
      for (const [token, identities] of tokensInChanges(node)) {
        const known = inChanges.get(token) ?? new Set<string>();
        for (const identity of identities) known.add(identity);
        inChanges.set(token, known);
      }
    }
    const namedIdentities = named
      ? new Set(
          named.flatMap((id) => {
            const node = findIn(root, id);
            const identity = node ? identityOf(node) : null;
            return identity ? [identity] : [];
          })
        )
      : null;
    const decided = (identity: string): boolean => {
      if (namedIdentities) return namedIdentities.has(identity);
      if (op.op === 'acceptAllRevisions' || op.op === 'rejectAllRevisions') return true;
      const { revision, localName } = op as unknown as {
        revision: { id: string; author: string; date?: string };
        localName?: string;
      };
      const [name, id, author, date] = JSON.parse(identity) as string[];
      return (
        (localName === undefined || localName === name) &&
        id === revision.id &&
        author === revision.author &&
        date === (revision.date ?? '')
      );
    };
    const tokens = new Map<string, Set<string>>();
    for (const [token, identities] of inChanges) {
      const mine = [...identities].filter(decided);
      if (mine.length > 0) tokens.set(token, new Set(mine));
    }
    return { replica, label: op.op, tokens, seen: Y.encodeStateVector(ydoc), excused: false };
  }

  /** A decision that applied. */
  applied(decision: Decision | null): void {
    if (decision && decision.tokens.size > 0) this.decisions.push(decision);
  }

  /** An undo or redo on `replica`: its earlier decisions may come back. */
  undone(replica: number, ydoc: Y.Doc): void {
    const identities = new Set<string>();
    for (const decision of this.decisions) {
      if (decision.replica !== replica) continue;
      decision.excused = true;
      for (const identity of decidedIdentities(decision)) identities.add(identity);
    }
    const client = ydoc.clientID;
    this.restores.push({ replica, client, clock: Y.getState(ydoc.store, client), identities });
  }

  /** Whether a peer's undo that `decision` had not seen may restore a change it decided. */
  private restoredBehind(decision: Decision): boolean {
    const seen = Y.decodeStateVector(decision.seen);
    const decided = decidedIdentities(decision);
    return this.restores.some(
      (restore) =>
        restore.replica !== decision.replica &&
        (seen.get(restore.client) ?? 0) < restore.clock &&
        [...restore.identities].some((identity) => decided.has(identity))
    );
  }

  /** The decisions that left a token they decided in the change they decided. */
  check(pkg: OoxmlPackage): string[] {
    const root = bodyOf(pkg);
    if (!root) return [];
    const final = tokensInChanges(root);
    const problems: string[] = [];
    for (const decision of this.decisions) {
      if (decision.excused || this.restoredBehind(decision)) continue;
      for (const [token, decided] of decision.tokens) {
        const still = [...(final.get(token) ?? [])].filter((identity) => decided.has(identity));
        if (still.length === 0) continue;
        problems.push(
          `replica ${decision.replica}'s ${decision.label} left typed token ${tokenNumber(token)} in the change it decided ${still[0]}`
        );
        break;
      }
    }
    return problems;
  }
}
