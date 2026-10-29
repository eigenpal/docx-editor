/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readOoxmlPackage, type OoxmlNode } from '@docx-editor.dev/core/store';
import {
  zipDocument,
  W,
  R,
  REL,
} from '../../../../pro/src/collaboration/__tests__/document-peer-support.ts';
import { DocxEditor } from '../../index.ts';

function fixture(kind: 'footnote' | 'endnote', bodyRPr = '') {
  return zipDocument(
    `<w:p><w:r>${bodyRPr}<w:t>Body</w:t></w:r><w:r><w:rPr>` +
      '<w:rStyle w:val="CustomReference"/><w:vertAlign w:val="superscript"/>' +
      `</w:rPr><w:${kind}Reference w:id="1"/></w:r></w:p><w:sectPr/>`,
    {
      overrides: `<Override PartName="/word/${kind}s.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}s+xml"/>`,
      documentRels: `<Relationships xmlns="${REL}"><Relationship Id="notes" Type="${R}/${kind}s" Target="${kind}s.xml"/></Relationships>`,
      extraXml: {
        [`word/${kind}s.xml`]: `<w:${kind}s xmlns:w="${W}"><w:${kind} w:id="1"><w:p><w:r><w:t>Note</w:t></w:r></w:p></w:${kind}></w:${kind}s>`,
      },
    }
  );
}

function typedRun(node: OoxmlNode): OoxmlNode | undefined {
  if (node.kind === 'textValue') return undefined;
  if (
    node.kind === 'run' &&
    node.children.some(
      (child) =>
        child.kind === 'text' &&
        child.children.some((value) => value.kind === 'textValue' && value.value === '#')
    )
  )
    return node;
  for (const child of node.children) {
    const match = typedRun(child);
    if (match) return match;
  }
  return undefined;
}

for (const kind of ['footnote', 'endnote'] as const) {
  for (const tracked of [false, true]) {
    test(`${kind}: ${tracked ? 'tracked' : 'plain'} Paragraph.insertText does not inherit the reference face`, async () => {
      const runtime = await DocxEditor.createServer(fixture(kind), { author: 'Writer' });
      try {
        await runtime.run(async (context) => {
          if (tracked) {
            context.document.changeTrackingMode = 'TrackMineOnly';
            await context.sync();
          }
          const paragraph = context.document.body.paragraphs.getFirst();
          const inserted = paragraph.insertText('#', 'End');
          await context.sync();
          inserted.load('text');
          inserted.font.load('superscript');
          await context.sync();
          expect(inserted.text).toBe('#');
          // The API reports null when the ordinary run has no authored vertical alignment.
          expect(inserted.font.superscript).toBeNull();
        });
        const bytes = await runtime.save();
        const loaded = readOoxmlPackage(bytes);
        if (!loaded.ok) throw Error(loaded.reason);
        const run = typedRun(loaded.package.parts.get(loaded.package.mainDocumentPart)!.root);
        expect(run?.kind).toBe('run');
        if (run?.kind !== 'run') throw Error('The inserted text run is missing');
        expect(run.children.some((node) => node.kind === 'noteReference')).toBe(false);
        expect(run.children.some((node) => node.kind === 'runProperties')).toBe(false);
        if (!tracked) {
          await runtime.run(async (context) => {
            const notes =
              kind === 'footnote'
                ? context.document.body.footnotes
                : context.document.body.endnotes;
            notes.load('items');
            await context.sync();
            expect(notes.items).toHaveLength(1);
            notes.items[0]!.delete();
            await context.sync();
            const paragraph = context.document.body.paragraphs.getFirst();
            paragraph.load('text');
            await context.sync();
            expect(paragraph.text).toBe('Body#');
          });
        }
      } finally {
        runtime.dispose();
      }
    });
  }
}

for (const kind of ['footnote', 'endnote'] as const) {
  for (const tracked of [false, true]) {
    test(`${kind}: ${tracked ? 'tracked' : 'plain'} Paragraph.insertText takes the face of the text before the reference`, async () => {
      const runtime = await DocxEditor.createServer(fixture(kind, '<w:rPr><w:i/></w:rPr>'), {
        author: 'Writer',
      });
      try {
        await runtime.run(async (context) => {
          if (tracked) {
            context.document.changeTrackingMode = 'TrackMineOnly';
            await context.sync();
          }
          const inserted = context.document.body.paragraphs.getFirst().insertText('#', 'End');
          await context.sync();
          inserted.font.load('italic,superscript');
          await context.sync();
          expect(inserted.font.italic).toBe(true);
          expect(inserted.font.superscript).toBeNull();
        });
        const loaded = readOoxmlPackage(await runtime.save());
        if (!loaded.ok) throw Error(loaded.reason);
        const run = typedRun(loaded.package.parts.get(loaded.package.mainDocumentPart)!.root);
        if (run?.kind !== 'run') throw Error('The inserted text run is missing');
        const rPr = run.children.find((node) => node.kind === 'runProperties');
        const names =
          rPr?.kind === 'runProperties' ? rPr.children.map((node) => node.localName) : [];
        expect(names).toEqual(['i']);
      } finally {
        runtime.dispose();
      }
    });
  }
}
