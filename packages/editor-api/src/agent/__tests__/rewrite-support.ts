/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Documents and oracles shared by the rewrite helper tests: a paragraph with a field, an
// equation, a tab, and a content-locked control; a paragraph with a note reference; and reads of
// saved bytes after every change is accepted or rejected.

import { DocxEditor, type Paragraph, type RequestContext } from '../../index.ts';
import { prepareRewrite, type PrepareRewriteOptions, type RewriteDraft } from '../../agent.ts';
import { docx } from '../../runtime/__tests__/support/docx.ts';
import {
  R,
  REL,
  W,
  zipDocument,
} from '../../../../pro/src/collaboration/__tests__/document-peer-support';

export const AUTHOR = 'Rewrite agent';
const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

export const t = (text: string): string => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
export const REF =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> REF _Ref1 \\h </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  t('Section 4.2') +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
export const EQUATION = `<m:oMath xmlns:m="${MATH}"><m:r><m:t>x</m:t></m:r></m:oMath>`;
export const PILL =
  '<w:sdt><w:sdtPr><w:tag w:val="party"/><w:lock w:val="contentLocked"/></w:sdtPr>' +
  `<w:sdtContent>${t('Acme Corp')}</w:sdtContent></w:sdt>`;

/** Field, equation, tab, and a content-locked control, each with words around it. */
export const RICH = docx(
  `<w:p>${t('Under ')}${REF}${t(' the fee ')}${EQUATION}${t(' applies')}<w:r><w:tab/></w:r>` +
    `${t('to ')}${PILL}${t(' promptly.')}</w:p>`
);
export const RICH_ORIGINAL = 'Under Section 4.2 the fee ￼ applies\tto Acme Corp promptly.';

/** A paragraph with a footnote reference between two words. */
export function footnoted(): Uint8Array {
  const FOOTNOTES_CT =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
  return zipDocument(
    `<w:p>${t('The buyer pays')}` +
      '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>' +
      `${t(' within thirty days.')}</w:p>`,
    {
      overrides: `<Override PartName="/word/footnotes.xml" ContentType="${FOOTNOTES_CT}"/>`,
      documentRels:
        `<Relationships xmlns="${REL}"><Relationship Id="f" Type="${R}/footnotes" ` +
        'Target="footnotes.xml"/></Relationships>',
      extraXml: {
        'word/footnotes.xml':
          `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1"><w:p><w:r><w:t>Net of tax.` +
          '</w:t></w:r></w:p></w:footnote></w:footnotes>',
      },
    }
  );
}

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** A paragraph with an inline picture after a word, with alternative text. */
export async function pictured(): Promise<Uint8Array> {
  const { saved } = await withRuntime(docx(`<w:p>${t('See the logo above.')}</w:p>`), async (c) => {
    const found = c.document.body.search('logo').getFirst();
    await c.sync();
    const picture = found.insertInlinePictureFromBase64(PNG, 'After');
    await c.sync();
    picture.altTextDescription = 'Company logo';
    await c.sync();
  });
  return saved;
}

export type Pick = (context: RequestContext) => Promise<Paragraph>;
export const firstParagraph: Pick = async (context) => context.document.body.paragraphs.getFirst();

/** Run `body` in a server runtime with `author` (null for none), and return its value and the bytes. */
export async function withRuntime<T>(
  bytes: Uint8Array,
  body: (context: RequestContext) => Promise<T>,
  author: string | null = AUTHOR
): Promise<{ value: T; saved: Uint8Array }> {
  const runtime = await DocxEditor.createServer(bytes, author === null ? {} : { author });
  try {
    const value = await runtime.run(body);
    return { value, saved: await runtime.save() };
  } finally {
    runtime.dispose();
  }
}

/** What the paragraph reads now, its pending revisions, and both review versions. */
export async function readBack(context: RequestContext, paragraph: Paragraph) {
  const revisions = paragraph.getRange('Whole').revisions;
  const current = paragraph.getReviewedText('Current');
  const original = paragraph.getReviewedText('Original');
  revisions.load('items/author');
  paragraph.load('text');
  await context.sync();
  return {
    text: paragraph.text,
    current: current.value,
    original: original.value,
    authors: revisions.items.map((revision) => revision.author),
  };
}

/** Reopen saved bytes, decide every change, and read the paragraph and its atoms. */
export async function decided(
  bytes: Uint8Array,
  action: 'acceptAll' | 'rejectAll',
  pick: Pick = firstParagraph
) {
  const runtime = await DocxEditor.createServer(bytes);
  try {
    return await runtime.run(async (context) => {
      context.document.body.revisions[action]();
      await context.sync();
      const paragraph = await pick(context);
      const fields = paragraph.getRange('Whole').fields;
      const controls = paragraph.contentControls;
      paragraph.load('text');
      fields.load('items');
      controls.load('items/text,items/cannotEdit');
      await context.sync();
      return {
        text: paragraph.text,
        fields: fields.items.length,
        controls: controls.items.map((item) => `${item.text}:${String(item.cannotEdit)}`),
      };
    });
  } finally {
    runtime.dispose();
  }
}

/** The error a promise rejects with, or a failure when it resolves. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error
  );
}

/** Prepare `paragraph`, and apply the text that `model` writes for its draft. */
export async function rewriteParagraph(
  context: RequestContext,
  paragraph: Paragraph,
  model: (text: string, draft: RewriteDraft) => string,
  options?: PrepareRewriteOptions
) {
  const draft = await prepareRewrite(context, paragraph, options);
  return draft.apply(model(draft.text, draft));
}
