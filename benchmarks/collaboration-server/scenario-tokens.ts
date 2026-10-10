// An oracle for typed text: what a participant types shows once, unless someone removed it.
//
// Convergence alone passes a defect that drops typing the same way on every replica. So each
// typing action also inserts one unique character from the Private Use Area: one character
// cannot be split by another insert, so the check looks for it alone.
//
// A token is excused from the "shows once" rule when someone removed it: a replica deleted
// text that showed it, an undo or redo by its typist took it out of the typist's view, or the
// paragraph it was typed in is gone. A token never shows twice, excused or not.
//
// A token a participant deleted stays deleted, unless that participant's own undo brought it
// back: a peer who moved the text at the same time must not bring it back.

import {
  type OoxmlPackage,
  type TreeDocOp,
  type TreePackageStore,
} from '@docx-editor.dev/core/store';
import type { Addressed } from './scenario-plan.ts';
import { findNode, textOf } from './scenario-tree.ts';

/** The first token: the Basic Multilingual Plane's Private Use Area, one UTF-16 unit each. */
export const TOKEN_BASE = 0xe000;
const COUNT = 0x1900;

/** A token's number, in the order tokens were typed: how problems name it. */
export function tokenNumber(token: string): number {
  return token.charCodeAt(0) - TOKEN_BASE;
}

/** Edits that delete text: what they take out of view is what their author deleted. */
const DELETING = new Set<string>([
  'deleteText',
  'deleteBlock',
  'deleteTableRow',
  'deleteTableColumn',
  'deleteDrawing',
]);

/** Whether any part of `pkg` holds a paragraph with `id`. */
function hasParagraph(pkg: OoxmlPackage, id: string): boolean {
  for (const part of pkg.parts.values()) {
    const node = findNode(part.root, id);
    if (node) return node.kind === 'paragraph';
  }
  return false;
}

export class TypedTokens {
  private next = 0;
  /** Each token typed, by whom, into which paragraph of that replica's store. */
  private readonly typed = new Map<
    string,
    { readonly replica: number; readonly paragraph: string }
  >();
  private readonly excused = new Set<string>();
  /** Each token a replica deleted, by the replica, until that replica's undo puts it back. */
  private readonly deletedBy = new Map<string, number>();
  /** Every replica that ever deleted each token: its redo may delete the token again. */
  private readonly deleters = new Map<string, Set<number>>();
  /** Tokens already reported as vanished, so each is reported once. */
  private readonly vanished = new Set<string>();

  /** The edit with a fresh token added to its typed text, or the edit as it is. */
  tag(addressed: Addressed): { readonly addressed: Addressed; readonly token: string | null } {
    const op = addressed.op as { op?: string; text?: string };
    if (op.op !== 'insertText' || typeof op.text !== 'string' || this.next >= COUNT) {
      return { addressed, token: null };
    }
    const token = String.fromCharCode(TOKEN_BASE + this.next);
    this.next += 1;
    return {
      addressed: { ...addressed, op: { ...op, text: op.text + token } as TreeDocOp },
      token,
    };
  }

  /** A tagged edit that applied: its token is now in `paragraph` of `replica`'s store. */
  typedInto(token: string, replica: number, paragraph: string): void {
    this.typed.set(token, { replica, paragraph });
  }

  /**
   * Before `op` applies on a replica: the tokens its view shows, when `op` deletes text, for
   * `afterEdit` to compare. Null for any other edit.
   */
  beforeEdit(store: TreePackageStore, op: TreeDocOp): Set<string> | null {
    return DELETING.has(op.op) ? this.shownIn(store.currentPackage(), () => true) : null;
  }

  /**
   * After a deleting edit applied on `replica`: every token it took out of that replica's view
   * was deleted by it. Each is excused from showing, and must not show again.
   */
  afterEdit(store: TreePackageStore, before: ReadonlySet<string> | null, replica: number): void {
    if (!before) return;
    const after = this.shownIn(store.currentPackage(), () => true);
    for (const token of before) {
      if (after.has(token)) continue;
      this.excused.add(token);
      this.deletedBy.set(token, replica);
      const deleters = this.deleters.get(token) ?? new Set<number>();
      deleters.add(replica);
      this.deleters.set(token, deleters);
    }
  }

  /**
   * An undo or redo takes back the typing of its own step only: the tokens of its replica that
   * its shared text held before it and does not hold after it. Shared text, not the view: a
   * token can be hidden for a moment, as while a held-back update moves it, and the undo still
   * takes it back.
   */
  undoOn(
    replica: number,
    before: string,
    after: string,
    shown?: { readonly before: OoxmlPackage; readonly after: OoxmlPackage }
  ): void {
    const still = this.ownInText(after, replica);
    for (const token of this.ownInText(before, replica)) {
      if (!still.has(token)) this.excused.add(token);
    }
    // An undo of a replica's own deletion puts the token back. A deleted paragraph keeps its
    // text, so the undo shows in the view, not in the shared text.
    const viewBefore = shown ? this.shownIn(shown.before, () => true) : new Set<string>();
    const viewAfter = shown ? this.shownIn(shown.after, () => true) : new Set<string>();
    // Typing a peer moved is undone by recording its characters deleted, which hides their
    // copies: the copies stay in the shared text, and only the view shows the undo.
    for (const token of viewBefore) {
      if (!viewAfter.has(token) && this.typed.get(token)?.replica === replica) {
        this.excused.add(token);
      }
    }
    for (const [token, deleter] of this.deletedBy) {
      if (deleter !== replica) continue;
      const back =
        (after.includes(token) && !before.includes(token)) ||
        (viewAfter.has(token) && !viewBefore.has(token));
      if (back) this.deletedBy.delete(token);
    }
  }

  /** The tokens a replica typed that some text holds. */
  private ownInText(text: string, replica: number): Set<string> {
    const found = new Set<string>();
    for (const character of text) {
      if (this.typed.get(character)?.replica === replica) found.add(character);
    }
    return found;
  }

  /** The tokens other replicas typed that a package shows. */
  othersIn(pkg: OoxmlPackage, replica: number): Set<string> {
    return this.shownIn(pkg, (typist) => typist !== replica);
  }

  private shownIn(pkg: OoxmlPackage, typedBy: (replica: number) => boolean): Set<string> {
    const shown = new Set<string>();
    for (const part of pkg.parts.values()) {
      for (const character of textOf(part.root)) {
        const typed = this.typed.get(character);
        if (typed && typedBy(typed.replica)) shown.add(character);
      }
    }
    return shown;
  }

  /**
   * An undo or redo takes back only its own replica's edits: every token another replica typed
   * that showed before still shows, unless the paragraph it was typed in is gone, as when the
   * undo takes back a block it was typed into.
   */
  checkUndo(before: ReadonlySet<string>, after: OoxmlPackage, replica: number): string[] {
    const still = this.othersIn(after, replica);
    const problems: string[] = [];
    for (const token of before) {
      const typed = this.typed.get(token);
      if (!typed || still.has(token) || !hasParagraph(after, typed.paragraph)) continue;
      // A redo of this replica's own deletion takes the token out again.
      if (this.deleters.get(token)?.has(replica)) {
        this.deletedBy.set(token, replica);
        continue;
      }
      problems.push(
        `undo or redo by replica ${replica} removed typed token ${tokenNumber(token)} of replica ${typed.replica}`
      );
    }
    return problems;
  }

  /**
   * The tokens a replica typed that its own document does not show, while nobody removed them
   * and the paragraph they were typed in remains. A participant who sees their own typing
   * vanish for a moment, even if it comes back, has lost it as far as they can tell.
   */
  hiddenOn(pkg: OoxmlPackage, replica: number): string[] {
    let shown: Set<string> | null = null;
    const problems: string[] = [];
    for (const [token, typed] of this.typed) {
      if (typed.replica !== replica || this.excused.has(token) || this.vanished.has(token))
        continue;
      shown ??= new Set(
        [...pkg.parts.values()].flatMap((part) =>
          [...textOf(part.root)].filter((c) => this.typed.has(c))
        )
      );
      if (shown.has(token) || !hasParagraph(pkg, typed.paragraph)) continue;
      this.vanished.add(token);
      problems.push(
        `typed token ${tokenNumber(token)} of replica ${replica} vanished from its own view`
      );
    }
    return problems;
  }

  /** Problems with typed text in the final document, read from each typist's store. */
  check(packages: readonly OoxmlPackage[]): string[] {
    const counts = new Map<string, number>();
    const first = packages[0];
    if (!first) return [];
    for (const part of first.parts.values()) {
      for (const character of textOf(part.root)) {
        if (this.typed.has(character)) counts.set(character, (counts.get(character) ?? 0) + 1);
      }
    }
    const problems: string[] = [];
    for (const [token, typed] of this.typed) {
      const count = counts.get(token) ?? 0;
      const name = `typed token ${tokenNumber(token)} of replica ${typed.replica}`;
      if (count > 1) problems.push(`${name} shows ${count} times`);
      const deleter = this.deletedBy.get(token);
      if (count > 0 && deleter !== undefined) {
        problems.push(`${name} shows again after replica ${deleter} deleted it`);
      }
      const store = packages[typed.replica];
      if (
        count === 0 &&
        !this.excused.has(token) &&
        store !== undefined &&
        hasParagraph(store, typed.paragraph)
      ) {
        problems.push(`${name} is lost, while the paragraph it was typed in remains`);
      }
    }
    return problems;
  }
}
