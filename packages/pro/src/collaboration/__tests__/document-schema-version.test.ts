/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { PACKAGE_META_KEY } from '../document/schema.ts';
const h = createPeerHarness('schema-version-592');
afterEach(() => h.cleanup());
for (const version of [2, 4]) {
  test(`rejects incompatible shared text schema ${version} on an existing peer and a new join`, async () => {
    const { alice, bob } = await h.pair(
      zipDocument('<w:p><w:r><w:t>text</w:t></w:r></w:p><w:sectPr/>')
    );
    alice.ydoc.getMap(PACKAGE_META_KEY).set('sharedSchemaVersion', version);
    expect(bob.room.session.statusSnapshot().reason?.code).toBe('schema-version-mismatch');
    await expect(h.join(alice, 'cold')).rejects.toMatchObject({ code: 'schema-version-mismatch' });
  });
}
