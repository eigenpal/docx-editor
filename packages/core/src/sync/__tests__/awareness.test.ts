// Awareness + viewer role tests (document-engine task 10.6).

import { describe, expect, test } from 'bun:test';
import { PresenceRegistry, canSubmitUpdate, canExport, YjsBackend, type Presence } from '../index.ts';
import { createEmptyModel, encodeModel } from '@docx-editor.dev/engine-core';

describe('read-only viewer role', () => {
  test('viewers cannot submit updates or export; editors can', () => {
    expect(canSubmitUpdate('editor')).toBe(true);
    expect(canSubmitUpdate('viewer')).toBe(false);
    expect(canExport('viewer')).toBe(false);
    expect(canExport('editor')).toBe(true);
  });
});

describe('ephemeral presence', () => {
  test('presence is published, observable, and lease-expired', () => {
    const reg = new PresenceRegistry(5);
    const p: Presence = { actorId: 'a', role: 'editor', cursor: { paragraphId: 'p-1', offset: 3 }, at: 10 };
    reg.set(p);
    expect(reg.get('a')).toEqual(p);
    expect(reg.all(12).map((x) => x.actorId)).toEqual(['a']); // within lease window
    expect(reg.all(100)).toEqual([]); // lease expired -> dropped
    expect(reg.get('a')).toBeUndefined();
  });

  test('presence is out-of-band: it never affects the authored model', () => {
    // Awareness lives in the registry, not the Yjs doc -> authored state is unchanged.
    const backend = YjsBackend.fromModel('doc', 'a', createEmptyModel());
    const before = JSON.stringify(encodeModel(backend.deriveModel()));
    const reg = new PresenceRegistry();
    reg.set({ actorId: 'a', role: 'editor', cursor: { paragraphId: 'p-1', offset: 99 }, at: 1 });
    const after = JSON.stringify(encodeModel(backend.deriveModel()));
    expect(after).toBe(before); // authored state identical
    expect(reg.get('a')).toBeDefined(); // presence still exists out-of-band
  });
});
