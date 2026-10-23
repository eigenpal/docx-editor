/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
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
  measure(value, style) {
    const natural =
      [...value].reduce((sum, char) => sum + (/[A-Za-z0-9]/u.test(char) ? 7 : 12), 0) -
      (value.match(/AV/gu)?.length ?? 0) * 4;
    return (natural * style.horizontalScalePercent) / 100 + value.length * style.characterSpacingPt;
  },
  lineMetrics: () => ({ height: 16, baseline: 12 }),
  hasResolvedFont: () => true,
  inkBounds: (char) =>
    char === '（'
      ? { left: 8, right: 10 }
      : char === '）'
        ? { left: 2, right: 4 }
        : { left: 0.6, right: 11.4 },
  textOutline: () => ({ path: null, ink: { left: 0.4, right: 9.7, top: -10, bottom: 2 } }),
};
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('The two editor sessions did not converge');
}

// Reproject each actual editor save through the deterministic measurement port.
// The real editors below still own commands, collaboration, history, cursors, and save.
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
      geometry: { width: 72, height: 500, margin: { top: 10, bottom: 10, left: 10, right: 10 } },
    })
  ).map((line) => ({
    text: line.spans.map((span) => span.text).join(''),
    spans: line.spans.map((span) => ({
      text: span.text,
      start: span.range.start,
      end: span.range.end,
      box: span.box,
      style: span.style,
    })),
  }));
}

test.each(['甲）AV（乙末', '甲）AV（乙≥丙末'])(
  'mixed optical geometry follows two-editor edits and cold save: %s',
  async (text) => {
    const harness = createPeerHarness('local-cjk-optical');
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
      const pair = await harness.pair(
        zipDocument(
          `<w:p><w:pPr><w:jc w:val="both"/><w:overflowPunct w:val="0"/><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Test Latin" w:hAnsi="Test Latin" w:eastAsia="Test CJK"/><w:sz w:val="24"/><w:kern w:val="2"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`,
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
      const shared = async (expected: string) => {
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
        for (const line of a)
          for (const span of line.spans)
            expect(span.text).toBe(expected.slice(span.start, span.end));
        views.forEach((view, index) => expect(view.editor.surface!.session).toBe(sessions[index]));
        return a;
      };
      const initial = await shared(text);
      if (text === '甲）AV（乙末') expect(initial[0]!.text).toBe('甲）AV（乙');
      else {
        const symbol = initial.flatMap((line) => line.spans).find((span) => span.text === '≥');
        expect(symbol).toBeDefined();
        expect(symbol!.box.width).toBe(12);
        expect(symbol!.style.characterSpacingPt).toBe(0);
      }
      pair.pause();
      select(left.editor, 0);
      select(right.editor, text.length);
      expect(left.editor.exec({ type: 'insertText', text: 'A' }).ok).toBe(true);
      expect(right.editor.exec({ type: 'insertText', text: 'B' }).ok).toBe(true);
      flush();
      pair.resume();
      await shared('A' + text + 'B');
      expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
      const undone = await shared(text + 'B');
      // Both peers still fit the mixed line after a concurrent edit and its undo.
      if (text === '甲）AV（乙末') {
        expect(undone[0]!.text).toBe('甲）AV（乙');
        expect(undone[0]!.spans.some((span) => span.style.characterSpacingPt < 0)).toBe(true);
      }
      expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
      await shared('A' + text + 'B');
      select(right.editor, 3);
      applyAwarenessUpdate(
        pair.alice.awareness,
        encodeAwarenessUpdate(pair.bob.awareness, [pair.bob.awareness.clientID]),
        'test-provider'
      );
      const caret = left.container.querySelector<HTMLElement>('.docx-remote-caret');
      expect(caret).not.toBeNull();
      expect(Number.isFinite(parseFloat(caret!.style.left))).toBe(true);
      expect(parseFloat(caret!.style.height)).toBeGreaterThan(0);
      pair.pause();
      select(left.editor, 1, 2);
      select(right.editor, text.length + 2);
      expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
      expect(right.editor.exec({ type: 'insertText', text: 'C' }).ok).toBe(true);
      flush();
      pair.resume();
      const finalText = 'A' + text.slice(1) + 'BC';
      const finalProjection = await shared(finalText);
      const bytes = new Uint8Array(await left.editor.save());
      const xml = strFromU8(unzipSync(bytes)['word/document.xml']!);
      expect(xml).not.toContain('w:spacing');
      const loaded = readOoxmlPackage(bytes);
      if (!loaded.ok) throw Error(loaded.reason);
      expect(projection(loaded.package)).toEqual(finalProjection);
      const container = document.createElement('div');
      document.body.append(container);
      const cold = createDocxEditor({ container, document: bytes });
      try {
        await until(() => !!cold.surface);
        expect(cold.surface!.session.bodyText()).toBe(finalText);
        expect(cold.snapshot().canUndo).toBe(false);
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
  },
  10000
);
