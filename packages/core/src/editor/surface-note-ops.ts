// Footnote/endnote lifecycle ops for the paginated surface.
//
// Commits package-level note lifecycle ops through the session (one ModelChange /
// undo entry each). Entering a note scope rebinds StoryScope to notesPart + the
// focused note identity via EditorScope { kind: 'note', id }.

import type { TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import type { SemanticSelection } from '@docx-editor.dev/core-contract/layout';
import type { TreeDocOp } from '@docx-editor.dev/core-contract/store';
import type { ViewScope } from '../contracts/editor.ts';
import {
  findNoteById,
  formatNoteScopeId,
  parseNoteScopeId,
  type NoteKind,
} from '../store/package/note-nodes.ts';
import { resolveNotesPart } from '../store/package/note-references.ts';

export interface NoteOps {
  insertNote(noteKind: NoteKind): boolean;
  deleteNote(noteKind: NoteKind, noteId: number): boolean;
  convertNote(fromKind: NoteKind, noteId: number): boolean;
  convertAllNotes(fromKind: NoteKind): boolean;
  setNoteProperties(args: {
    readonly scope: 'document' | 'section';
    readonly sectionIndex?: number;
    readonly footnote?: {
      readonly numFmt?: string;
      readonly numRestart?: string;
      readonly position?: string;
      readonly numStart?: number;
    };
    readonly endnote?: {
      readonly numFmt?: string;
      readonly numRestart?: string;
      readonly position?: string;
      readonly numStart?: number;
    };
  }): boolean;
  enterNote(scopeId: string, position?: { paragraphId: string; offset: number }): boolean;
  exitNote(): void;
  activeNoteScope(): Extract<ViewScope, { kind: 'note' }> | null;
}

export function createNoteOps(deps: {
  session: TreeDocxSession;
  applyOps: (
    ops: readonly TreeDocOp[],
    before?: { paragraphId: string; start: number; end: number } | null,
    after?: { paragraphId: string; start: number; end: number } | null
  ) => ReturnType<TreeDocxSession['applyTreeOps']>;
  commit: (
    run: () => ReturnType<TreeDocxSession['applyTreeOps']> | boolean,
    selectionAfter?: () => SemanticSelection | null
  ) => void;
  selection: () => SemanticSelection;
  selectionMark: () => { paragraphId: string; start: number; end: number } | null;
  orderedStart: () => { paragraphId: string; offset: number };
  activeScope: () => ViewScope;
  setActiveScopeBodyOrHf: (scope: ViewScope) => boolean;
  setSelection: (next: SemanticSelection) => void;
  noteModelMoved: () => void;
  render: () => void;
  notify: () => void;
  lastRejection: () => string | null;
  setLastRejection: (reason: string | null) => void;
}): NoteOps {
  let activeNote: Extract<ViewScope, { kind: 'note' }> | null = null;
  let savedBodySelection: SemanticSelection | null = null;

  const commitLifecycle = (op: TreeDocOp): boolean => {
    deps.setLastRejection(null);
    deps.commit(() => {
      const result = deps.applyOps([op], deps.selectionMark());
      if (result.rejected) {
        deps.setLastRejection(String(result.reason ?? 'rejected'));
      }
      return result;
    });
    return deps.lastRejection() === null;
  };

  return {
    insertNote(noteKind) {
      if (deps.activeScope().kind !== 'body') {
        deps.setLastRejection('insertNote requires body scope');
        return false;
      }
      const start = deps.orderedStart();
      return commitLifecycle({
        op: 'insertNote',
        noteKind,
        paragraphId: start.paragraphId,
        offset: start.offset,
      } as TreeDocOp);
    },

    deleteNote(noteKind, noteId) {
      return commitLifecycle({ op: 'deleteNote', noteKind, noteId } as TreeDocOp);
    },

    convertNote(fromKind, noteId) {
      return commitLifecycle({ op: 'convertNote', fromKind, noteId } as TreeDocOp);
    },

    convertAllNotes(fromKind) {
      return commitLifecycle({ op: 'convertAllNotes', fromKind } as TreeDocOp);
    },

    setNoteProperties(args) {
      return commitLifecycle({
        op: 'setNoteProperties',
        scope: args.scope,
        sectionIndex: args.sectionIndex,
        footnote: args.footnote,
        endnote: args.endnote,
      } as TreeDocOp);
    },

    enterNote(scopeId, position) {
      const parsed = parseNoteScopeId(scopeId);
      if (!parsed) {
        deps.setLastRejection('invalid note scope id');
        return false;
      }
      const pkg = deps.session.currentPackage();
      const part = resolveNotesPart(pkg, parsed.noteKind);
      if (!part || !findNoteById(part.root, parsed.noteId)) {
        deps.setLastRejection('note not found');
        return false;
      }
      if (deps.activeScope().kind === 'body') {
        const current = deps.selection();
        savedBodySelection = {
          anchor: { paragraphId: current.anchor.paragraphId, offset: current.anchor.offset },
          head: { paragraphId: current.head.paragraphId, offset: current.head.offset },
        };
      }
      activeNote = {
        kind: 'note',
        id: formatNoteScopeId(parsed.noteKind, parsed.noteId),
      };
      if (position) {
        deps.setSelection({ anchor: position, head: position });
      } else {
        const ids = deps.session.paragraphIdsIn({
          kind: 'notesPart',
          noteKind: parsed.noteKind,
        });
        const note = findNoteById(part.root, parsed.noteId);
        const noteParagraphIds = new Set<string>();
        if (note) {
          const walk = (
            node: { kind: string; id?: string; children?: readonly unknown[] },
            depth: number
          ): void => {
            if (depth > 32) return;
            if (node.kind === 'paragraph' && typeof node.id === 'string') {
              noteParagraphIds.add(node.id);
              return;
            }
            for (const child of node.children ?? []) {
              walk(
                child as { kind: string; id?: string; children?: readonly unknown[] },
                depth + 1
              );
            }
          };
          walk(note, 0);
        }
        const first = ids.find((id) => noteParagraphIds.has(id)) ?? ids[0];
        if (first) {
          deps.setSelection({
            anchor: { paragraphId: first, offset: 0 },
            head: { paragraphId: first, offset: 0 },
          });
        }
      }
      deps.noteModelMoved();
      deps.render();
      deps.notify();
      return true;
    },

    exitNote() {
      if (!activeNote) return;
      const restore = savedBodySelection;
      activeNote = null;
      savedBodySelection = null;
      deps.setActiveScopeBodyOrHf({ kind: 'body' });
      if (restore) {
        deps.setSelection(restore);
      }
      deps.noteModelMoved();
      deps.render();
      deps.notify();
    },

    activeNoteScope() {
      return activeNote;
    },
  };
}
