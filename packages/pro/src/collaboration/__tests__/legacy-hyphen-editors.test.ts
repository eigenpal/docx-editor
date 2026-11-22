/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { readOoxmlPackage, type OoxmlPackage } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument } from '../../../../core/src/layout/semantic-layout.ts';
import { buildStyleCascadeTable } from '../../../../core/src/layout/style-cascade.ts';
import { NO_THEME_FONTS } from '../../../../core/src/layout/run-style.ts';
import { linesOf, type TextMeasurer } from '../../../../core/src/layout/semantic-records.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, W, REL, R, type Peer } from './document-peer-support.ts';

const measurer: TextMeasurer = {
  measure: (value) =>
    [...value].reduce((sum, char) => sum + (/[A-Za-z0-9]/u.test(char) ? 7 : 12), 0),
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

// Reproject each saved package through a deterministic measurer: 80 pt lines.
function lines(pkg: OoxmlPackage): string[] {
  const cascade = buildStyleCascadeTable(
    pkg.parts.get('/word/styles.xml')!.root,
    NO_THEME_FONTS,
    pkg.parts.get('/word/settings.xml')!.root
  );
  return linesOf(
    layoutSemanticDocument(pkg.parts.get(pkg.mainDocumentPart)!, 0, {
      measurer,
      styleCascade: cascade,
      geometry: { width: 100, height: 500, margin: { top: 10, bottom: 10, left: 10, right: 10 } },
    })
  ).map((line) => line.spans.map((span) => span.text).join(''));
}

test('two editors keep a legacy hyphen word whole through concurrent edits and save', async () => {
  const harness = createPeerHarness('legacy-hyphen');
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
    views.push({ editor, container });
    return { editor, container };
  };
  try {
    const pair = await harness.pair(
      zipDocument(
        `<w:p><w:pPr><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/></w:pPr><w:r><w:t>甲乙丙丁AB-CD戊</w:t></w:r></w:p>`,
        {
          documentRels: `<Relationships xmlns="${REL}"><Relationship Id="styles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="settings" Type="${R}/settings" Target="settings.xml"/></Relationships>`,
          extraXml: {
            'word/styles.xml': `<w:styles xmlns:w="${W}"/>`,
            'word/settings.xml': `<w:settings xmlns:w="${W}"><w:characterSpacingControl w:val="compressPunctuation"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="14"/></w:compat></w:settings>`,
          },
        }
      )
    );
    const left = mount(pair.alice);
    const right = mount(pair.bob);
    await until(() => views.every((view) => !!view.editor.surface));
    const id = harness.paragraphIdAt(pair.alice, 0);
    const select = (editor: DocxEditorInstance, start: number) =>
      editor.exec({
        type: 'setSelection',
        range: {
          anchor: { paragraphId: id, offset: start },
          head: { paragraphId: id, offset: start },
        },
      });
    const shared = async (expected: string) => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
      await until(() =>
        views.every((view) => view.editor.surface!.session.bodyText() === expected)
      );
      const packages = await Promise.all(
        views.map(async (view) => readOoxmlPackage(new Uint8Array(await view.editor.save())))
      );
      const projected = packages.map((value) => {
        if (!value.ok) throw Error(value.reason);
        return lines(value.package);
      });
      expect(projected[0]).toEqual(projected[1]!);
      return projected[0]!;
    };
    // 甲乙丙丁AB- would fit 80 pt; the hyphen keeps AB-CD together on the next line.
    expect(await shared('甲乙丙丁AB-CD戊')).toEqual(['甲乙丙丁', 'AB-CD戊']);
    pair.pause();
    select(left.editor, 8);
    select(right.editor, 9);
    expect(left.editor.exec({ type: 'insertText', text: 'E' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'F' }).ok).toBe(true);
    pair.resume();
    expect(await shared('甲乙丙丁AB-CEDF戊')).toEqual(['甲乙丙丁', 'AB-CEDF戊']);
    expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(await shared('甲乙丙丁AB-CDF戊')).toEqual(['甲乙丙丁', 'AB-CDF戊']);
    expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
    await shared('甲乙丙丁AB-CEDF戊');
    // Deleting the hyphen while the other peer types after it rejoins an ordinary word.
    pair.pause();
    left.editor.exec({
      type: 'setSelection',
      range: { anchor: { paragraphId: id, offset: 6 }, head: { paragraphId: id, offset: 7 } },
    });
    select(right.editor, 9);
    expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'G' }).ok).toBe(true);
    pair.resume();
    const finalLines = await shared('甲乙丙丁ABCEGDF戊');
    expect(finalLines).toEqual(['甲乙丙丁', 'ABCEGDF戊']);
    applyAwarenessUpdate(
      pair.alice.awareness,
      encodeAwarenessUpdate(pair.bob.awareness, [pair.bob.awareness.clientID]),
      'test-provider'
    );
    expect(left.container.querySelector('.docx-remote-caret')).not.toBeNull();
    const reopened = readOoxmlPackage(new Uint8Array(await right.editor.save()));
    if (!reopened.ok) throw Error(reopened.reason);
    expect(lines(reopened.package)).toEqual(finalLines);
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
}, 10000);
