/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { readOoxmlPackage, type OoxmlPackage } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument } from '../../../../core/src/layout/semantic-layout.ts';
import { buildStyleCascadeTable } from '../../../../core/src/layout/style-cascade.ts';
import { NO_THEME_FONTS } from '../../../../core/src/layout/run-style.ts';
import { linesOf, type TextMeasurer } from '../../../../core/src/layout/semantic-records.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, W, REL, R, type Peer } from './document-peer-support.ts';

const measurer: TextMeasurer = {
  measure: (value, style) => value.length * (12 + style.characterSpacingPt),
  lineMetrics: () => ({ height: 16, baseline: 12 }),
  hasResolvedFont: () => true,
};
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('The two editor sessions did not converge');
}

// Reproject each editor save through a fixed-advance measurer. The real editors below own
// commands, collaboration, history, cursors, and save.
function projection(pkg: OoxmlPackage) {
  const main = pkg.parts.get(pkg.mainDocumentPart)!;
  const cascade = buildStyleCascadeTable(
    pkg.parts.get('/word/styles.xml')!.root,
    { ...NO_THEME_FONTS, eastAsianFontTableFaces: ['test cjk'] },
    pkg.parts.get('/word/settings.xml')!.root
  );
  return linesOf(
    layoutSemanticDocument(main, 0, {
      measurer,
      styleCascade: cascade,
      geometry: { width: 400, height: 500, margin: { top: 10, bottom: 10, left: 10, right: 10 } },
    })
  ).map((line) => ({
    text: line.spans.map((span) => span.text).join(''),
    // The bearing that adjacent punctuation shares on the line, in points.
    shared: [...line.spans].reduce((sum, span) => sum + span.text.length * 12 - span.box.width, 0),
    spans: line.spans.map((span) => ({
      text: span.text,
      start: span.range.start,
      end: span.range.end,
      box: span.box,
    })),
  }));
}

test('Japanese punctuation pair classes follow two-editor edits, history, and cold save', async () => {
  const harness = createPeerHarness('punctuation-pair-classes');
  const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
  const mount = (peer: Peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    const view = { editor, container };
    views.push(view);
    return view;
  };
  try {
    // A Japanese semicolon is centred: it keeps its bearing before a closing bracket.
    const pair = await harness.pair(
      zipDocument(
        `<w:p><w:r><w:rPr><w:rFonts w:eastAsia="Test CJK"/><w:sz w:val="24"/><w:kern w:val="2"/><w:lang w:eastAsia="ja-JP"/></w:rPr><w:t>甲；）乙</w:t></w:r></w:p>`,
        {
          documentRels: `<Relationships xmlns="${REL}"><Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="settings" Type="${R}/settings" Target="settings.xml"/></Relationships>`,
          extraXml: {
            'word/styles.xml': `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:eastAsia="Test CJK"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
            'word/settings.xml': `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/></w:settings>`,
          },
        }
      )
    );
    const left = mount(pair.alice),
      right = mount(pair.bob);
    await until(() => views.every((view) => !!view.editor.surface));
    const sessions = views.map((view) => view.editor.surface!.session);
    const id = harness.paragraphIdAt(pair.alice, 0);
    const select = (editor: DocxEditorInstance, start: number, end = start) =>
      editor.exec({
        type: 'setSelection',
        range: {
          anchor: { paragraphId: id, offset: start },
          head: { paragraphId: id, offset: end },
        },
      });
    const flush = () => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
    };
    const shared = async (expected: string, bearing: number) => {
      flush();
      await until(() =>
        views.every((view) => view.editor.surface!.session.bodyText() === expected)
      );
      const leftBytes = new Uint8Array(await left.editor.save());
      const rightBytes = new Uint8Array(await right.editor.save());
      const leftPackage = readOoxmlPackage(leftBytes),
        rightPackage = readOoxmlPackage(rightBytes);
      if (!leftPackage.ok) throw Error(leftPackage.reason);
      if (!rightPackage.ok) throw Error(rightPackage.reason);
      const a = projection(leftPackage.package),
        b = projection(rightPackage.package);
      expect(strFromU8(unzipSync(leftBytes)['word/document.xml']!)).toBe(
        strFromU8(unzipSync(rightBytes)['word/document.xml']!)
      );
      expect(a).toEqual(b);
      expect(a.map((line) => line.text).join('')).toBe(expected);
      expect(a.reduce((sum, line) => sum + line.shared, 0)).toBeCloseTo(bearing, 6);
      for (const line of a)
        for (const span of line.spans) expect(span.text).toBe(expected.slice(span.start, span.end));
      views.forEach((view, index) => expect(view.editor.surface!.session).toBe(sessions[index]));
      return a;
    };
    await shared('甲；）乙', 0);
    // Concurrent insert of an opening bracket after the semicolon and an edit elsewhere.
    pair.pause();
    select(left.editor, 4);
    select(right.editor, 2);
    expect(left.editor.exec({ type: 'insertText', text: '丙' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: '（' }).ok).toBe(true);
    flush();
    pair.resume();
    await shared('甲；（）乙丙', 6);
    expect(right.editor.exec({ type: 'undo' }).ok).toBe(true);
    await shared('甲；）乙丙', 0);
    expect(right.editor.exec({ type: 'redo' }).ok).toBe(true);
    await shared('甲；（）乙丙', 6);
    select(right.editor, 3);
    applyAwarenessUpdate(
      pair.alice.awareness,
      encodeAwarenessUpdate(pair.bob.awareness, [pair.bob.awareness.clientID]),
      'test-provider'
    );
    const caret = left.container.querySelector<HTMLElement>('.docx-remote-caret');
    expect(caret).not.toBeNull();
    expect(Number.isFinite(parseFloat(caret!.style.left))).toBe(true);
    // One peer deletes the semicolon while the other types a closing bracket before it.
    pair.pause();
    select(left.editor, 1, 2);
    select(right.editor, 1);
    expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: '」' }).ok).toBe(true);
    flush();
    pair.resume();
    // `」（` shares the closing bracket's bearing; `（）` keeps both bearings.
    const finalText = '甲」（）乙丙';
    const finalProjection = await shared(finalText, 6);
    const bytes = new Uint8Array(await left.editor.save());
    const loaded = readOoxmlPackage(bytes);
    if (!loaded.ok) throw Error(loaded.reason);
    expect(projection(loaded.package)).toEqual(finalProjection);
    const container = document.createElement('div');
    document.body.append(container);
    const cold = createDocxEditor({ container, document: bytes });
    try {
      await until(() => !!cold.surface);
      expect(cold.surface!.session.bodyText()).toBe(finalText);
    } finally {
      cold.destroy();
      container.remove();
    }
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
}, 10000);
