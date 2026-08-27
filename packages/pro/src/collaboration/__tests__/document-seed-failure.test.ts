/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A failed seed must stay invisible. Yjs commits everything a transaction wrote before the
// refusal stopped it, so the one thing the seed controls is WHAT is written before the first
// possible refusal. Marking the room initialized first left a failed seed advertising a
// joinable room: joiners passed the initialization wait and then hit `document-id-mismatch`,
// and a retried `create` refused with `already-initialized` — the room id was bricked.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { DocumentRegistry, seedPackage } from '../document/index.ts';
import { openBaselinePackage } from '../document-bootstrap.ts';
import { collaborationDocx } from './support.ts';

function baseline(): ReturnType<typeof openBaselinePackage> {
  return openBaselinePackage(collaborationDocx());
}

describe('seed failure', () => {
  test('a refused seed leaves the room uninitialized', async () => {
    const ydoc = new Y.Doc();
    const registry = new DocumentRegistry(ydoc, { maxNodes: 5 });
    const seeded = await seedPackage(registry, baseline());
    expect(seeded.ok).toBe(false);
    // The flag is the joiner's whole signal, so a failed seed must never set it.
    expect(registry.schema.meta.get('initialized')).toBeUndefined();
    expect(registry.schema.meta.get('mainDocumentPart')).toBeUndefined();
    registry.destroy();
    ydoc.destroy();
  });

  test('a joiner never observes a failed seed as an initialized room', async () => {
    const seeder = new Y.Doc();
    const limited = new DocumentRegistry(seeder, { maxNodes: 5 });
    const seeded = await seedPackage(limited, baseline());
    expect(seeded.ok).toBe(false);
    // The failed transaction still broadcast: replay it onto a joiner's document.
    const joiner = new Y.Doc();
    Y.applyUpdate(joiner, Y.encodeStateAsUpdate(seeder), 'join');
    expect(joiner.getMap('docx-package-meta-v1').get('initialized')).not.toBe(true);
    limited.destroy();
    seeder.destroy();
    joiner.destroy();
  });

  test('the same room accepts a retried seed after a refusal', async () => {
    const ydoc = new Y.Doc();
    const limited = new DocumentRegistry(ydoc, { maxNodes: 5 });
    const refused = await seedPackage(limited, baseline());
    expect(refused.ok).toBe(false);
    limited.destroy();
    // The retry a host performs after fixing its baseline: same document, default limits.
    const registry = new DocumentRegistry(ydoc);
    const seeded = await seedPackage(registry, baseline());
    expect(seeded.ok).toBe(true);
    expect(registry.schema.meta.get('initialized')).toBe(true);
    expect(typeof registry.schema.meta.get('mainDocumentPart')).toBe('string');
    registry.destroy();
    ydoc.destroy();
  });
});
