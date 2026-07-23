// Bring-your-own Y.Doc (document-engine task 5.2 boundary). A consumer is NOT
// forced through a hosted sync service or this package's transport: they can pass
// their own Y.Doc (with any standard provider attached) and the engine applies its
// mandatory schema adapter onto it. Arbitrary external Yjs structures are never
// treated as canonical — only the adapter's blocks/blockOrder/storyOrder are.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { YjsBackend } from '../src/index.ts';
import { createEmptyModel, encodeModel, fingerprint, type ParagraphRecord } from '@docx-editor.dev/engine-core';

const BODY = 'st-1';
const P1 = 'p-1';

function fp(backend: YjsBackend): string {
  return fingerprint('authoredState', encodeModel(backend.deriveModel()));
}

describe('bring-your-own Y.Doc', () => {
  test('the adapter seeds onto a caller-supplied Y.Doc', () => {
    const ydoc = new Y.Doc(); // the consumer owns this doc
    const backend = YjsBackend.fromModel('doc', 'a', createEmptyModel(), { doc: ydoc });
    backend.insertText(P1, 'typed on my own doc');

    // The edit is visible in the derived canonical model...
    const p = backend.deriveModel().stories.get(BODY)!.blocks[0] as ParagraphRecord;
    expect(p.runs.map((r) => r.text).join('')).toBe('typed on my own doc');
    // ...and it landed on the caller's doc under the mandatory adapter keys.
    expect(ydoc.getArray('storyOrder').toArray()).toContain(BODY);
    expect(ydoc.share.has('blocks')).toBe(true);
  });

  test('a caller-supplied doc keeps its own clientID (its provider depends on it)', () => {
    const ydoc = new Y.Doc();
    ydoc.clientID = 123456; // as a real provider would assign
    YjsBackend.fromModel('doc', 'a', createEmptyModel(), { doc: ydoc });
    expect(ydoc.clientID).toBe(123456); // not overwritten by the actor-derived id
  });

  test('two externally-synced docs converge through the adapter (simulated provider)', () => {
    // Each side owns a Y.Doc; a standard provider would sync updates between them.
    // We simulate that transport with raw Y.encodeStateAsUpdate/applyUpdate.
    const docA = new Y.Doc();
    const a = YjsBackend.fromModel('doc', 'a', createEmptyModel(), { doc: docA });

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA)); // provider delivers initial state
    const b = YjsBackend.attach('doc', 'b', docB); // attach to the already-synced doc (no re-seed)

    // Concurrent edits on each side, then the "provider" exchanges updates both ways.
    a.insertText(P1, 'AAA');
    b.appendParagraph(BODY, 'p-2');
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    expect(fp(a)).toBe(fp(b)); // converged canonical state, no hosted service involved
  });
});
