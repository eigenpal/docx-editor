/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A tracked-change decision the API refuses reaches telemetry as `review.skipped`, with its
// review code, the operation, and the structure that blocked it, from a server runtime and from
// an in-browser one alike.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import type { EditorDiagnostic } from '@docx-editor.dev/core/contracts/editor';
import { DocxEditor } from '../../browser.ts';
import { hostFailure, refusalCause } from '../batch.ts';
import { docx } from './support/docx.ts';

const DATE = '2026-10-01T10:00:00Z';
const stamp = (id: number) => `w:id="${id}" w:author="Ada" w:date="${DATE}"`;
const cell = (content: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const inserted = (id: number, text: string) =>
  `<w:p><w:pPr><w:rPr><w:ins ${stamp(id)}/></w:rPr></w:pPr><w:ins ${stamp(id + 1)}><w:r><w:t>${text}</w:t></w:r></w:ins></w:p>`;
// An inserted row that holds a nested table with untracked text: rejecting it keeps the row.
const nested =
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1500"/></w:tblGrid>' +
  `<w:tr>${cell(para('inner'))}</w:tr></w:tbl>`;
const kept = docx(
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    `<w:tr>${cell(para('a'))}${cell(para('b'))}</w:tr>` +
    `<w:tr><w:trPr><w:ins ${stamp(30)}/></w:trPr>${cell(nested + inserted(32, ''))}${cell(inserted(34, 'n2'))}</w:tr>` +
    '</w:tbl>' +
    para('After')
);

const RETAINED = {
  kind: 'review.skipped',
  code: 'review.retained-structure',
  count: 1,
  operation: 'reject',
  cause: 'nested-table',
};

test('a refused decision from a server runtime reports its code and structure', async () => {
  const events: EditorDiagnostic[] = [];
  const runtime = await DocxEditor.createServer(kept, {
    author: 'Reviewer',
    modules: [{ id: 'observer', onDiagnostic: (event) => events.push(event) }],
  });
  try {
    await runtime.run(async (context) => {
      context.document.body.revisions.rejectAll();
      await context.sync().catch(() => {});
    });
    expect(events.filter((event) => event.kind === 'review.skipped')).toEqual([
      expect.objectContaining(RETAINED),
    ]);
    expect(events.some((event) => event.kind === 'edit.rejected')).toBe(false);
  } finally {
    runtime.dispose();
  }
});

test('a refused decision from an in-browser agent reaches the editor telemetry', async () => {
  const events: EditorDiagnostic[] = [];
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: kept,
    modules: [{ id: 'observer', onDiagnostic: (event) => events.push(event) }],
  });
  const runtime = DocxEditor.createBrowser(editor, { author: 'Reviewer' });
  try {
    await runtime.run(async (context) => {
      context.document.body.revisions.rejectAll();
      await context.sync().catch(() => {});
    });
    expect(events.filter((event) => event.kind === 'review.skipped')).toEqual([
      expect.objectContaining(RETAINED),
    ]);
  } finally {
    runtime.dispose();
    editor.destroy();
    container.remove();
  }
});

test('a refusal names the skip structure only when the engine knows it', () => {
  const failure = (detail: string) =>
    hostFailure({
      code: 'unsupported-revision',
      message: 'a tracked change in that decision cannot be resolved',
      detail,
    });
  const paired = failure('incomplete-group:paired-change');
  expect(paired.debugInfo.innerError?.code).toBe('review.incomplete-group');
  expect(refusalCause(paired)).toBe('paired-change');
  const unknown = failure('incomplete-group:w:customXml');
  expect(unknown.debugInfo.innerError?.code).toBe('review.incomplete-group');
  expect(refusalCause(unknown)).toBeUndefined();
  // A bare detail with its own code is its own cause.
  const locked = failure('locked-content');
  expect(locked.debugInfo.innerError?.code).toBe('review.locked-content');
  expect(refusalCause(locked)).toBe('locked-content');
});
