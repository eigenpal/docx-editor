/** @spike-features engine-neutral-editor-driver-contract, bold-mark, italic-mark, yjs-backend */
import * as Y from 'yjs';
import type { DocxEditor } from '../driver/editor-driver';
import { docRange } from '../driver/editor-driver';
import { snapshotAndValidateCommand } from '../vocabulary/validate';
import { type LoadedPocDocx } from './docx';
import {
  BINDING_RECONCILIATION_ORIGIN,
  isBindingReconciliationOrigin,
  POC_STORY_ID,
} from './constants';
import {
  createPocStore,
  type CreatePocStoreOptions,
  type PocSnapshot,
  type PocStore,
} from './store';

export { BINDING_RECONCILIATION_ORIGIN, isBindingReconciliationOrigin };

export interface TextSelection {
  readonly start: number;
  readonly end: number;
}

export interface PocEditorIdentity extends CreatePocStoreOptions {}

export interface CreatePocEditorSessionOptions {
  readonly editable: PocEditorIdentity;
  readonly replica: PocEditorIdentity;
}

let nextPocSessionClientId = 0x1000_0000;

export function allocatePocEditorSessionOptions(
  label: 'browser' | 'headless'
): CreatePocEditorSessionOptions {
  const editableClientId = nextPocSessionClientId++;
  const replicaClientId = nextPocSessionClientId++;
  return {
    editable: {
      actorId: `${label}-editable`,
      sessionId: `${label}-editable-${editableClientId}`,
      clientId: editableClientId,
    },
    replica: {
      actorId: `${label}-replica`,
      sessionId: `${label}-replica-${replicaClientId}`,
      clientId: replicaClientId,
    },
  };
}

export interface PocEditorSession {
  readonly loaded: LoadedPocDocx;
  readonly editable: PocStore;
  readonly replica: PocStore;
  getSelection(): TextSelection;
  setSelection(selection: TextSelection): void;
  selectText(text: string): boolean;
  typeText(text: string): void;
  replaceSelection(text: string): void;
  toggleMark(mark: 'bold' | 'italic'): DocxEditor.CommandResult;
  undo(): DocxEditor.CommandResult;
  findText(text: string): readonly DocxEditor.DocRange[];
  selectedText(): string;
  selectionFormatting(): DocxEditor.RunFormatting | null;
  selectionRange(): DocxEditor.DocRange | null;
  syncEditableToReplica(): void;
  applyRemoteReplicaEdit(mutate: (store: PocStore) => void): void;
  subscribeEditable(listener: (snapshot: PocSnapshot) => void): () => void;
  subscribeReplica(listener: (snapshot: PocSnapshot) => void): () => void;
  snapshotsConverged(): boolean;
}

function diffUpdate(source: PocStore, target: PocStore): Uint8Array {
  const sourceDoc = new Y.Doc({ gc: false });
  Y.applyUpdate(sourceDoc, source.encodeUpdate());
  const targetDoc = new Y.Doc({ gc: false });
  Y.applyUpdate(targetDoc, target.encodeUpdate());
  return Y.encodeStateAsUpdate(sourceDoc, Y.encodeStateVector(targetDoc));
}

function normalizeSelection(selection: TextSelection): TextSelection {
  return selection.start <= selection.end
    ? selection
    : { start: selection.end, end: selection.start };
}

function clampSelection(selection: TextSelection, textLength: number): TextSelection {
  const normalized = normalizeSelection(selection);
  return {
    start: Math.max(0, Math.min(normalized.start, textLength)),
    end: Math.max(0, Math.min(normalized.end, textLength)),
  };
}

function findOccurrences(text: string, needle: string): readonly TextSelection[] {
  if (needle.length === 0) return [];
  const ranges: TextSelection[] = [];
  let index = text.indexOf(needle);
  while (index !== -1) {
    ranges.push({ start: index, end: index + needle.length });
    index = text.indexOf(needle, index + 1);
  }
  return ranges;
}

function isRangeFullyMarked(
  snapshot: PocSnapshot,
  mark: 'bold' | 'italic',
  start: number,
  end: number
): boolean {
  if (start >= end) return false;
  let cursor = 0;
  for (const run of snapshot.runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    for (let index = Math.max(start, runStart); index < Math.min(end, runEnd); index += 1) {
      const marked = mark === 'bold' ? run.bold : run.italic;
      if (!marked) return false;
    }
    cursor = runEnd;
  }
  return true;
}

function selectionFormattingForRange(
  snapshot: PocSnapshot,
  start: number,
  end: number
): DocxEditor.RunFormatting | null {
  if (start >= end) return null;
  return Object.freeze({
    bold: isRangeFullyMarked(snapshot, 'bold', start, end),
    italic: isRangeFullyMarked(snapshot, 'italic', start, end),
  });
}

function snapshotsEqual(left: PocSnapshot, right: PocSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createPocEditorSession(
  loaded: LoadedPocDocx,
  options: CreatePocEditorSessionOptions
): PocEditorSession {
  const editable = createPocStore(loaded, options.editable);
  const replica = createPocStore(loaded, options.replica);
  let selection: TextSelection = { start: 0, end: 0 };

  const toDocRange = (range: TextSelection): DocxEditor.DocRange =>
    docRange({
      storyId: POC_STORY_ID,
      blockId: loaded.paragraphId,
      start: range.start,
      end: range.end,
    });

  const syncEditableToReplica = (): void => {
    replica.applyRemoteUpdate(diffUpdate(editable, replica));
  };

  const commitLocalEdit = (apply: () => void): void => {
    apply();
    syncEditableToReplica();
  };

  const replaceSelection = (text: string): void => {
    const current = clampSelection(selection, editable.snapshot().text.length);
    if (current.start === current.end && text.length === 0) return;
    commitLocalEdit(() => {
      if (current.start !== current.end) {
        editable.delete(current.start, current.end);
      }
      if (text.length > 0) {
        editable.insert(current.start, text);
      }
      const nextOffset = current.start + text.length;
      selection = { start: nextOffset, end: nextOffset };
    });
  };

  return {
    loaded,
    editable,
    replica,
    getSelection() {
      return clampSelection(selection, editable.snapshot().text.length);
    },
    setSelection(next) {
      selection = clampSelection(next, editable.snapshot().text.length);
    },
    selectText(text) {
      const match = findOccurrences(editable.snapshot().text, text)[0];
      if (!match) return false;
      selection = match;
      return true;
    },
    typeText(text) {
      if (text.length === 0) return;
      replaceSelection(text);
    },
    replaceSelection,
    toggleMark(mark) {
      const validation = snapshotAndValidateCommand({ type: 'toggleMark', mark });
      if (validation.errors.length > 0 || !validation.snapshot) {
        return Object.freeze({
          status: 'failed',
          code: 'invalid-command',
          reason: 'command payload failed schema validation',
        });
      }
      const current = normalizeSelection(selection);
      if (current.start >= current.end) {
        return Object.freeze({
          status: 'noOp',
          changed: false,
          reason: 'empty selection',
        });
      }
      const before = editable.snapshot();
      commitLocalEdit(() => {
        editable.toggleMark(current.start, current.end, mark);
      });
      const changed = !snapshotsEqual(before, editable.snapshot());
      return Object.freeze({
        status: changed ? 'applied' : 'noOp',
        ...(changed ? { changed: true } : { changed: false, reason: 'no store change' }),
      });
    },
    undo() {
      const before = editable.snapshot();
      if (!editable.undo()) {
        return Object.freeze({ status: 'noOp', changed: false, reason: 'empty undo stack' });
      }
      selection = clampSelection(selection, editable.snapshot().text.length);
      syncEditableToReplica();
      const changed = !snapshotsEqual(before, editable.snapshot());
      return Object.freeze({
        status: changed ? 'applied' : 'noOp',
        changed,
      });
    },
    findText(text) {
      return findOccurrences(editable.snapshot().text, text).map((range) => toDocRange(range));
    },
    selectedText() {
      const current = normalizeSelection(selection);
      return editable.snapshot().text.slice(current.start, current.end);
    },
    selectionFormatting() {
      const current = normalizeSelection(selection);
      return selectionFormattingForRange(editable.snapshot(), current.start, current.end);
    },
    selectionRange() {
      const current = normalizeSelection(selection);
      if (current.start >= current.end) return null;
      return toDocRange(current);
    },
    syncEditableToReplica,
    applyRemoteReplicaEdit(mutate) {
      mutate(replica);
      editable.applyRemoteUpdate(diffUpdate(replica, editable));
      selection = clampSelection(selection, editable.snapshot().text.length);
    },
    subscribeEditable(listener) {
      return editable.subscribe(listener);
    },
    subscribeReplica(listener) {
      return replica.subscribe(listener);
    },
    snapshotsConverged() {
      return snapshotsEqual(editable.snapshot(), replica.snapshot());
    },
  };
}
