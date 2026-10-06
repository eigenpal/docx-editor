// One undo step per typing run.
//
// The type buffer lands keystrokes through one transaction per flush, and a flush runs on
// the next task, so at an ordinary typing speed every character was its own transaction
// and its own undo step. A run of typing is one user intent, so its flushes share one
// history group: the store extends the entry the run opened, and a collaboration session
// merges the frames into one shared undo item however long the run takes.
//
// The run is scoped by intent, never by a clock. It continues only while the caret is
// exactly where the run's last flush left it. Anything else ends it: a caret move by key,
// pointer or API, any other edit (Backspace, Delete, Enter, paste, formatting), undo and
// redo, a typing format armed at the caret, or a change from elsewhere (a collaborator, an
// automation write, another editor on the same store) to the paragraph the run types in.
// Typing over a selection starts a run, so the replacement and the text typed after it are
// one step.

import type { HistoryGroup, OoxmlPackage, TreeModelChange } from '@docx-editor.dev/core/store';
import type { SemanticSelection } from '../layout/semantic-interaction.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { ooxmlTreesEqual } from '../store/package/ooxml-tree.ts';
import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { ORIGIN_IDS } from '../store/registry/frozen-ids.ts';

/** The paragraph node `paragraphId` names in `pkg`: story ids carry their part before `#`. */
function paragraphIn(pkg: OoxmlPackage, paragraphId: string): OoxmlNode | null {
  const hash = paragraphId.indexOf('#');
  const partName = hash > 0 ? paragraphId.slice(0, hash) : pkg.mainDocumentPart;
  const part = pkg.parts.get(partName);
  return part ? findNode(part, paragraphId) : null;
}

/** Where a typing run expects the caret, or `null` when the selection is not a caret. */
function caretKey(selection: SemanticSelection): string | null {
  const { anchor, head } = selection;
  if (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset) return null;
  return `${head.paragraphId}\u0000${head.offset}`;
}

/** The open typing run of one surface. */
export class TypingHistory {
  private group: HistoryGroup | undefined;
  private expected: string | null = null;
  private paragraphId: string | null = null;
  /** The run's paragraph as its last flush left it, to tell whether a later change touched it. */
  private landedNode: OoxmlNode | null = null;

  constructor(private readonly currentPackage: () => OoxmlPackage) {}

  /** The history group for a flush that starts at `selection`. */
  groupAt(selection: SemanticSelection): HistoryGroup {
    if (this.group === undefined || caretKey(selection) !== this.expected) {
      this.group = Symbol('typing');
    }
    return this.group;
  }

  /** Record where the flush left the caret; the run continues only from there. */
  landed(selection: SemanticSelection): void {
    this.expected = caretKey(selection);
    this.paragraphId = this.expected === null ? null : selection.head.paragraphId;
    const id = this.paragraphId;
    this.landedNode = id === null ? null : paragraphIn(this.currentPackage(), id);
    if (this.expected === null) this.group = undefined;
  }

  /**
   * End the run when a change that is not one of its own flushes edited the run's paragraph.
   * The caret may not move with such a change, so its key alone cannot tell. Changes
   * elsewhere leave the run open, so a busy room does not split it per key. A change that
   * names no paragraphs (a wholesale remote package after a header or note edit) is checked
   * against the paragraph itself: a wholesale install can rebuild nodes it did not change, so
   * the content decides, not the object. Projection and awareness commits restate state the
   * store already holds and are not edits.
   */
  noteForeignChange(change: TreeModelChange): void {
    const id = this.paragraphId;
    if (id === null) return;
    if (change.origin === ORIGIN_IDS.projection || change.origin === ORIGIN_IDS.awareness) return;
    if (change.dirty.includes(id) || change.deleted.includes(id)) return this.end();
    if (change.dirty.length > 0 || change.deleted.length > 0) return;
    const before = this.landedNode;
    const after = paragraphIn(this.currentPackage(), id);
    if (before === after) return;
    if (before === null || after === null || !ooxmlTreesEqual(before, after)) this.end();
  }

  /** End the run: the next flush starts a new undo step. */
  end(): void {
    this.group = undefined;
    this.expected = null;
    this.paragraphId = null;
    this.landedNode = null;
  }
}
