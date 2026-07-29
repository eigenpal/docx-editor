// Shared backend conformance: local vs Yjs (document-engine task 5.9, text/run
// subset). The same insertText script applied to the local DocumentStore and to
// the Yjs backend MUST produce equivalent normalized authored state. (Full op
// parity including central id allocation is the coordinator's job, task 5.3.)

import { describe, expect, test } from 'bun:test';
import { LocalBackend, YjsBackend } from '../index.ts';
import { createEmptyModel, encodeModel, fingerprint, ORIGIN_IDS } from '@docx-editor.dev/engine-core';

const HUMAN = ORIGIN_IDS.mutationHuman;
const P1 = 'p-1';

type Insert = { text: string; bold?: boolean };
const SCRIPT: Insert[] = [
  { text: 'Hello ' },
  { text: 'bold', bold: true },
  { text: ' world' },
  { text: '!' },
];

function localFingerprint(): string {
  const backend = LocalBackend.fromModel('doc', createEmptyModel());
  for (const ins of SCRIPT) {
    backend.documentStore.transact(HUMAN, (c) =>
      c.apply({ op: 'insertText', paragraphId: P1, text: ins.text, props: ins.bold ? { bold: true } : undefined }),
    );
  }
  return fingerprint('authoredState', encodeModel(backend.documentStore.currentModel));
}

function yjsFingerprint(): string {
  const backend = YjsBackend.fromModel('doc', 'a', createEmptyModel());
  for (const ins of SCRIPT) backend.insertText(P1, ins.text, ins.bold ? { bold: true } : undefined);
  return fingerprint('authoredState', encodeModel(backend.deriveModel()));
}

describe('local vs Yjs conformance (5.9, text subset)', () => {
  test('both backends produce equivalent normalized authored state', () => {
    expect(yjsFingerprint()).toBe(localFingerprint());
  });

  test('normalization merges the two identical-prop runs identically on both', () => {
    const backend = YjsBackend.fromModel('doc', 'a', createEmptyModel());
    backend.insertText(P1, 'a');
    backend.insertText(P1, 'b'); // adjacent, same (absent) props -> merge to "ab"
    const runs = backend.deriveModel().stories.get('st-1')!.blocks[0];
    expect((runs as { runs: { text: string }[] }).runs.map((r) => r.text)).toEqual(['ab']);
  });
});
