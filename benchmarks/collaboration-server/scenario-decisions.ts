// An oracle for decisions on pending changes: an accept or reject reaches all of the change
// its author saw.
//
// Every replica can agree on a wrong result, so convergence alone passes a decision that is
// lost on part of its change, as a peer's concurrent typing inside the change once made it.
// So when a replica accepts or rejects a change, the typed tokens the change holds in that
// replica's view are recorded. At the end, none of them may still sit in a change with the
// same identity. A replica that undoes or redoes after its decision may have brought the
// change back, so its earlier decisions are not checked.

import type {
  OoxmlNode,
  OoxmlPackage,
  TreeDocOp,
  TreePackageStore,
} from '@docx-editor.dev/core/store';
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

function bodyOf(pkg: OoxmlPackage): OoxmlNode | null {
  return pkg.parts.get(pkg.mainDocumentPart)?.root ?? null;
}

interface Decision {
  readonly replica: number;
  readonly label: string;
  /** Each token the change held when the replica decided, and the identities it decided. */
  readonly tokens: ReadonlyMap<string, ReadonlySet<string>>;
  excused: boolean;
}

export class DecisionOracle {
  private readonly decisions: Decision[] = [];

  /** Before `op` applies on `replica`: what a decision decides there. Null for other edits. */
  before(store: TreePackageStore, op: TreeDocOp, replica: number): Decision | null {
    if (!DECISIONS.has(op.op)) return null;
    const root = store.bodyStore().part.root;
    const inChanges = tokensInChanges(root);
    const decided = (identity: string): boolean => {
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
    return { replica, label: op.op, tokens, excused: false };
  }

  /** A decision that applied. */
  applied(decision: Decision | null): void {
    if (decision && decision.tokens.size > 0) this.decisions.push(decision);
  }

  /** An undo or redo on `replica`: its earlier decisions may come back. */
  undone(replica: number): void {
    for (const decision of this.decisions)
      if (decision.replica === replica) decision.excused = true;
  }

  /** The decisions that left a token they decided in the change they decided. */
  check(pkg: OoxmlPackage): string[] {
    const root = bodyOf(pkg);
    if (!root) return [];
    const final = tokensInChanges(root);
    const problems: string[] = [];
    for (const decision of this.decisions) {
      if (decision.excused) continue;
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
