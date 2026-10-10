/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { DocxEditor } from '../../index.ts';
import { docx, mainXmlOf } from './support/documents.ts';

const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const wrappers = {
  plain: (s: string) => run(s),
  split: (s: string) => Array.from(s).map(run).join(''),
  hyperlink: (s: string) => `<w:hyperlink w:anchor="target">${run(s)}</w:hyperlink>`,
  inlineControl: (s: string) =>
    `<w:sdt><w:sdtPr><w:id w:val="1"/><w:text/></w:sdtPr><w:sdtContent>${run(s)}</w:sdtContent></w:sdt>`,
  bookmark: (s: string) =>
    `<w:bookmarkStart w:id="0" w:name="target"/>${run(s)}<w:bookmarkEnd w:id="0"/>`,
  inserted: (s: string) => `<w:ins w:id="1" w:author="Original">${run(s)}</w:ins>`,
};
for (const wrapper of Object.keys(wrappers) as (keyof typeof wrappers)[])
  for (const location of ['Replace', 'Before', 'After'] as const)
    for (const inserted of ['Q', '😀é', 'é', '\t']) {
      test(`round2 text matrix ${wrapper} ${location} ${JSON.stringify(inserted)}`, async () => {
        const source = 'AA😀BBéCC';
        const runtime = await DocxEditor.createServer(
          docx(`<w:p>${wrappers[wrapper](source)}</w:p>`)
        );
        try {
          await runtime.run(async (context) => {
            const target = context.document.body.search('BB').getFirst();
            const result = target.insertText(inserted, location);
            await context.sync();
            result.load('text');
            context.document.body.load('text');
            await context.sync();
            expect(result.text).toBe(inserted);
            const replacement =
              location === 'Replace'
                ? inserted
                : location === 'Before'
                  ? inserted + 'BB'
                  : 'BB' + inserted;
            expect(context.document.body.text).toBe(source.replace('BB', replacement));
          });
          const xml = await mainXmlOf(runtime);
          const marker = {
            plain: undefined,
            split: undefined,
            hyperlink: 'w:anchor="target"',
            inlineControl: '<w:sdt>',
            bookmark: 'w:name="target"',
            inserted: 'w:author="Original"',
          }[wrapper];
          if (marker) expect(xml).toContain(marker);
          const reopened = await DocxEditor.createServer(await runtime.save());
          try {
            await reopened.run(async (context) => {
              context.document.body.load('text');
              await context.sync();
              const replacement =
                location === 'Replace'
                  ? inserted
                  : location === 'Before'
                    ? inserted + 'BB'
                    : 'BB' + inserted;
              expect(context.document.body.text).toBe(source.replace('BB', replacement));
            });
          } finally {
            reopened.dispose();
          }
        } finally {
          runtime.dispose();
        }
      });
    }
