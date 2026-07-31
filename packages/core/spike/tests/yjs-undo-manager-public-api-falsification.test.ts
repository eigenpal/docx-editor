/** @spike-features origin-metadata, yjs-backend */
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';

describe('task 2.4 Y.UndoManager public-API falsification', () => {
  test('untracked replacement of a tracked map key consumes the undo item', () => {
    const doc = new Y.Doc({ gc: false });
    const authoredRecord = doc.getMap<string>('authored-record');
    const undoManager = new Y.UndoManager(authoredRecord, {
      trackedOrigins: new Set(['actor-a']),
      captureTimeout: Number.MAX_SAFE_INTEGER,
      ignoreRemoteMapChanges: true,
    });
    doc.transact(() => authoredRecord.set('value', 'local'), 'actor-a');
    doc.transact(() => authoredRecord.set('value', 'remote'), 'actor-b');

    expect(undoManager.undoStack).toHaveLength(1);
    expect(undoManager.undo()).toBeNull();
    expect(authoredRecord.get('value')).toBe('remote');
    expect(undoManager.redoStack).toHaveLength(0);
  });

  test('undoing a locally created nested type deletes later untracked child edits', () => {
    const doc = new Y.Doc({ gc: false });
    const authoredRecords = doc.getMap<Y.Text>('authored-records');
    const undoManager = new Y.UndoManager(authoredRecords, {
      trackedOrigins: new Set(['actor-a']),
      captureTimeout: Number.MAX_SAFE_INTEGER,
    });
    let localRecord!: Y.Text;
    doc.transact(() => {
      localRecord = new Y.Text();
      authoredRecords.set('tail', localRecord);
      localRecord.insert(0, 'local');
    }, 'actor-a');
    doc.transact(() => localRecord.insert(localRecord.length, 'remote'), 'actor-b');

    expect(localRecord.toString()).toBe('localremote');
    expect(undoManager.undo()).not.toBeNull();
    expect(authoredRecords.has('tail')).toBe(false);
    expect(localRecord.toString()).toBe('');
  });
});
