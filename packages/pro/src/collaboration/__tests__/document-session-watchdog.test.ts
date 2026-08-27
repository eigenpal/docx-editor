/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A session that is never attached still reports `ready` forever; in the documented
// connect-later flow a missed `key` remount silently stops replication. The failure codes
// are a closed core union with only terminal statuses, so the surface is a one-shot
// console.warn naming the remount requirement.

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import {
  TreePackageStore,
  normalizeParagraphIdentity,
  readOoxmlPackage,
} from '@docx-editor.dev/core/store';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration';
import {
  ATTACH_WATCHDOG_MS_FOR_TESTS,
  createDocumentCollaboration,
  type DocumentCollaborationHandle,
} from '../document-session.ts';

const DOCUMENT_ID = 'watchdog-room';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function documentBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Alpha</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`
    ),
  });
}

interface Opened {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly room: DocumentCollaborationHandle;
}

const opened: Opened[] = [];
const originalWarn = console.warn;
let warnings: string[] = [];

function spyWarnings(): void {
  warnings = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
}

afterEach(() => {
  console.warn = originalWarn;
  for (const peer of opened.splice(0)) {
    peer.room.destroy();
    peer.awareness.destroy();
    peer.ydoc.destroy();
  }
});

async function createSession(watchdogMs: number): Promise<Opened> {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: 'alice', name: 'Alice' },
    bootstrap: { kind: 'create', document: documentBytes() },
    [ATTACH_WATCHDOG_MS_FOR_TESTS]: watchdogMs,
  } as Parameters<typeof createDocumentCollaboration>[0]);
  const peer: Opened = { ydoc, awareness, room };
  opened.push(peer);
  return peer;
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('document session attach watchdog', () => {
  test('a never-attached session warns once and stays ready', async () => {
    spyWarnings();
    const peer = await createSession(10);
    await settle(40);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(DOCUMENT_ID);
    expect(warnings[0]).toContain('key={session.sessionId}');
    // Non-fatal: the status contract has no warning state, so status stays untouched.
    expect(peer.room.session.status()).toBe('ready');
  });

  test('an attached session never warns', async () => {
    spyWarnings();
    const peer = await createSession(10);
    const loaded = readOoxmlPackage(peer.room.document);
    if (!loaded.ok) throw new Error(loaded.reason);
    const main = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
    const port = createCollaborationDocumentPort(store, { documentId: DOCUMENT_ID });
    const detach = peer.room.session.attach(port);
    await settle(40);
    expect(warnings).toHaveLength(0);
    detach();
  });

  test('the timer cannot fire after destroy', async () => {
    spyWarnings();
    const peer = await createSession(10);
    peer.room.destroy();
    await settle(40);
    expect(warnings).toHaveLength(0);
  });
});
