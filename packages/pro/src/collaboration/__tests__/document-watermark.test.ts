/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A document watermark is header content: a VML shape in every header the document shows,
// a new default header when a section has none, and a media part for a picture. Each of those
// is ordinary shared package state, so a peer must converge on the same watermark, keep a
// concurrent header edit, undo it as one step and read it again after a remount.

import { afterEach, describe, expect, test } from 'bun:test';
import type { OoxmlPackage, StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import { createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';

const harness = createPeerHarness('document-watermark');

afterEach(() => {
  harness.cleanup();
});

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const HEADER: StoryScope = { kind: 'headerFooter', rId: 'rId7' };
const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (char) => char.charCodeAt(0)
);

function headerDoc(mixedRun = false): Uint8Array {
  return zipDocument(
    '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId7"/>' +
      '</w:sectPr></w:pPr><w:r><w:t>body</w:t></w:r></w:p>',
    {
      documentRels:
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/></Relationships>`,
      overrides:
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
      extraXml: {
        'word/header1.xml': `<w:hdr xmlns:w="${W}" xmlns:v="urn:schemas-microsoft-com:vml"><w:p><w:r><w:t>Header text</w:t>${mixedRun ? '<w:pict><v:shape id="PowerPlusWaterMarkObject1" style="width:200pt;height:100pt"><v:textpath style="font-family:Calibri;font-size:1pt" string="OLD"/></v:shape><v:shape id="HeaderLogo" style="width:20pt;height:20pt"/></w:pict>' : ''}</w:r></w:p></w:hdr>`,
      },
    }
  );
}

const noHeaderDoc = () => zipDocument('<w:p><w:r><w:t>body</w:t></w:r></w:p><w:sectPr/>');

const text = (value: string): TreeDocOp => ({
  op: 'setWatermark',
  watermark: {
    kind: 'text',
    text: value,
    fontFamily: 'Calibri',
    fontSizePt: null,
    bold: false,
    italic: false,
    colorHex: 'C0C0C0',
    opacity: 0.5,
    diagonal: true,
    widthPt: 412,
    heightPt: 206,
  },
});

function applyLifecycle(peer: Peer, op: TreeDocOp): void {
  const refusal = peer.room.session.gateOperations([op], { kind: 'body' });
  if (refusal) throw new Error(`gate refused: ${refusal}`);
  const result = peer.store.applyLifecycleOp(op, { actorId: peer.room.session.identity.actorId });
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  peer.port.flushPendingJournals();
}

/** The `string` of every watermark text path, and the picture watermarks, across headers. */
function watermarks(pkg: OoxmlPackage): { texts: string[]; pictures: number } {
  const texts: string[] = [];
  let pictures = 0;
  for (const [name, part] of pkg.parts) {
    if (!/^\/word\/header\d+\.xml$/.test(name)) continue;
    walk(part.root, (node) => {
      if (node.kind === 'textValue' || node.localName !== 'shape') return;
      const id = node.attributes.find((a) => a.localName === 'id')?.value ?? '';
      if (id.startsWith('WordPictureWatermark')) pictures += 1;
      if (!id.startsWith('PowerPlusWaterMarkObject')) return;
      walk(node, (child) => {
        if (child.kind === 'textValue' || child.localName !== 'textpath') return;
        texts.push(child.attributes.find((a) => a.localName === 'string')?.value ?? '');
      });
    });
  }
  return { texts, pictures };
}

function headerText(pkg: OoxmlPackage): string {
  let out = '';
  const part = pkg.parts.get('/word/header1.xml');
  if (part)
    walk(part.root, (node) => {
      if (node.kind === 'textValue') out += node.value;
    });
  return out;
}

describe('watermark collaboration', () => {
  test('a text watermark replicates and survives a remount', async () => {
    const { alice, bob } = await harness.pair(headerDoc());
    applyLifecycle(alice, text('CONFIDENTIAL'));
    harness.expectConverged(alice, bob);
    expect(watermarks(harness.packageOf(bob))).toEqual({ texts: ['CONFIDENTIAL'], pictures: 0 });
    const reopened = await harness.remount(bob);
    expect(watermarks(harness.packageOf(reopened)).texts).toEqual(['CONFIDENTIAL']);
  });

  test('the header a watermark creates replicates with it', async () => {
    const { alice, bob } = await harness.pair(noHeaderDoc());
    applyLifecycle(alice, text('DRAFT'));
    harness.expectConverged(alice, bob);
    expect(watermarks(harness.packageOf(bob)).texts).toEqual(['DRAFT']);
  });

  test('a picture watermark replicates its media, and removal drops it everywhere', async () => {
    const { alice, bob } = await harness.pair(headerDoc());
    applyLifecycle(alice, {
      op: 'setWatermark',
      watermark: {
        kind: 'picture',
        washout: true,
        widthPt: 300,
        heightPt: 300,
        image: { bytes: PNG_1X1, mime: 'image/png' },
      },
    });
    harness.expectConverged(alice, bob);
    const media = (pkg: OoxmlPackage) =>
      [...pkg.partBytes.keys()].filter((name) => name.includes('/media/'));
    expect(watermarks(harness.packageOf(bob)).pictures).toBe(1);
    expect(media(harness.packageOf(bob))).toHaveLength(1);
    // A peer types the media it received, so its saved package stays valid.
    expect(
      harness.packageOf(bob).contentTypes.overrides.get(media(harness.packageOf(bob))[0]!)
    ).toBe('image/png');
    applyLifecycle(bob, { op: 'setWatermark', watermark: null });
    expect(media(harness.packageOf(bob))).toHaveLength(0);
    harness.expectConverged(alice, bob);
    expect(watermarks(harness.packageOf(alice))).toEqual({ texts: [], pictures: 0 });
    expect(media(harness.packageOf(alice))).toHaveLength(0);
  });

  test('a concurrent header edit and a watermark both survive', async () => {
    const { alice, bob, pause, resume } = await harness.pair(headerDoc());
    pause();
    applyLifecycle(alice, text('SAMPLE'));
    harness.apply(
      bob,
      [
        {
          op: 'insertText',
          paragraphId: harness.paragraphIdAt(bob, 0, HEADER),
          offset: 0,
          text: 'New ',
        },
      ],
      HEADER
    );
    resume();
    alice.port.flushPendingJournals();
    bob.port.flushPendingJournals();
    harness.expectConverged(alice, bob);
    for (const peer of [alice, bob]) {
      expect(peer.room.session.status()).toBe('ready');
      expect(watermarks(harness.packageOf(peer)).texts).toEqual(['SAMPLE']);
      expect(headerText(harness.packageOf(peer))).toContain('New Header text');
    }
  });

  for (const replacement of [false, true]) {
    test(`${replacement ? 'replacement' : 'removal'} preserves a concurrent edit in the watermark run`, async () => {
      const { alice, bob, pause, resume } = await harness.pair(headerDoc(true));
      pause();
      applyLifecycle(alice, replacement ? text('NEW') : { op: 'setWatermark', watermark: null });
      harness.apply(
        bob,
        [
          {
            op: 'insertText',
            paragraphId: harness.paragraphIdAt(bob, 0, HEADER),
            offset: 0,
            text: 'New ',
          },
        ],
        HEADER
      );
      resume();
      alice.port.flushPendingJournals();
      bob.port.flushPendingJournals();
      harness.expectConverged(alice, bob);
      for (const peer of [alice, bob]) {
        expect(peer.room.session.status()).toBe('ready');
        expect(headerText(harness.packageOf(peer))).toContain('New Header text');
        expect(watermarks(harness.packageOf(peer)).texts).toEqual(replacement ? ['NEW'] : []);
        let logo = false;
        walk(harness.packageOf(peer).parts.get('/word/header1.xml')!.root, (node) => {
          if (
            node.kind !== 'textValue' &&
            node.attributes.some((attr) => attr.value === 'HeaderLogo')
          )
            logo = true;
        });
        expect(logo).toBe(true);
      }
      const reopened = await harness.remount(bob);
      harness.expectConverged(alice, reopened);
      expect(headerText(harness.packageOf(reopened))).toContain('New Header text');
    });
  }

  test('removing a watermark in a shared run supports undo and redo without removing text', async () => {
    const { alice, bob } = await harness.pair(headerDoc(true));
    applyLifecycle(alice, { op: 'setWatermark', watermark: null });
    harness.expectConverged(alice, bob);
    expect(headerText(harness.packageOf(bob))).toBe('Header text');
    expect(alice.room.session.undo()).toBe(true);
    alice.port.flushPendingJournals();
    harness.expectConverged(alice, bob);
    expect(watermarks(harness.packageOf(bob)).texts).toEqual(['OLD']);
    expect(headerText(harness.packageOf(bob))).toBe('Header text');
    expect(alice.room.session.redo()).toBe(true);
    alice.port.flushPendingJournals();
    harness.expectConverged(alice, bob);
    expect(watermarks(harness.packageOf(bob)).texts).toEqual([]);
    expect(headerText(harness.packageOf(bob))).toBe('Header text');
  });

  test('a watermark undoes as one step on every peer', async () => {
    const { alice, bob } = await harness.pair(noHeaderDoc());
    applyLifecycle(alice, text('URGENT'));
    harness.expectConverged(alice, bob);
    expect(alice.room.session.undo()).toBe(true);
    alice.port.flushPendingJournals();
    harness.expectConverged(alice, bob);
    // The header it created goes with it.
    for (const peer of [alice, bob]) {
      expect(watermarks(harness.packageOf(peer)).texts).toEqual([]);
      expect([...harness.packageOf(peer).parts.keys()].some((n) => n.includes('header'))).toBe(
        false
      );
    }
  });
});
