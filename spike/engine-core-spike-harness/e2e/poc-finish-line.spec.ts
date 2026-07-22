/** @spike-features engine-neutral-editor-driver-contract, one-preservation-capsule */
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import {
  POC_PARAGRAPH_ID,
  createPocDocxFixture,
  loadPocDocx,
} from '../src/poc/docx';

const REMOTE_SUFFIX = 'REMOTE';
const TEXT_AFTER_LOCAL_EDITS = 'Hi bold italic';
const EXPECTED_TEXT_AFTER_FLOW = `${TEXT_AFTER_LOCAL_EDITS}${REMOTE_SUFFIX}`;

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function extractCapsuleSubstring(documentXml: string): string {
  const start = documentXml.indexOf('<custom:PocUnsupported');
  const end = documentXml.indexOf('</custom:PocUnsupported>') + '</custom:PocUnsupported>'.length;
  if (start < 0 || end <= start) throw new Error('capsule missing from document.xml');
  return documentXml.slice(start, end);
}

async function documentXmlFromBytes(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('word/document.xml missing from saved bytes');
  return entry.async('string');
}

test('POC finish line through public EditorDriver', async ({ page }) => {
  const fixtureBytes = await createPocDocxFixture();
  const fixture = await loadPocDocx(fixtureBytes);

  await page.goto('/');
  await page.waitForFunction(() => window.pocEditorDriver !== undefined);
  await page.evaluate(async (bytes) => {
    await window.pocEditorDriver!.loadDocx(new Uint8Array(bytes));
  }, Array.from(fixtureBytes));

  const editable = page.getByRole('textbox', { name: 'Editable POC paragraph' });
  const replica = page.getByRole('document', { name: 'Read-only synchronized replica' });

  const boldResult = await page.evaluate(async () => {
    const driver = window.pocEditorDriver!;
    await driver.selectText('Hello');
    await driver.type('Hi');
    await driver.selectText('Hi');
    return driver.execute({ type: 'toggleMark', mark: 'bold' });
  });
  expect(boldResult).toEqual({ status: 'applied', changed: true });

  await expect(editable).toHaveText(TEXT_AFTER_LOCAL_EDITS);
  await expect(replica).toHaveText(TEXT_AFTER_LOCAL_EDITS);

  const remoteResult = await page.evaluate(async (suffix) => {
    return window.pocEditorDriver!.applyRemoteEdit({ text: suffix });
  }, REMOTE_SUFFIX);
  expect(remoteResult).toEqual({ status: 'applied', changed: true });

  await expect(editable).toHaveText(EXPECTED_TEXT_AFTER_FLOW);
  await expect(replica).toHaveText(EXPECTED_TEXT_AFTER_FLOW);

  const undoResult = await page.evaluate(async () => window.pocEditorDriver!.undo());
  expect(undoResult).toEqual({ status: 'applied', changed: true });

  const postUndoFind = await page.evaluate(async (text) => {
    return window.pocEditorDriver!.query({ type: 'findText', text });
  }, EXPECTED_TEXT_AFTER_FLOW);
  expect(postUndoFind).toEqual({
    type: 'findText',
    ranges: [
      expect.objectContaining({
        blockId: POC_PARAGRAPH_ID,
        start: 0,
        end: EXPECTED_TEXT_AFTER_FLOW.length,
      }),
    ],
  });
  await expect(editable).toHaveText(EXPECTED_TEXT_AFTER_FLOW);
  await expect(replica).toHaveText(EXPECTED_TEXT_AFTER_FLOW);

  const savePayload = await page.evaluate(async () => {
    const result = await window.pocEditorDriver!.save();
    return {
      status: result.status,
      bytes: result.bytes ? Array.from(result.bytes) : null,
    };
  });
  expect(savePayload.status).toBe('saved');
  expect(savePayload.bytes).not.toBeNull();

  const savedBytes = new Uint8Array(savePayload.bytes!);
  const savedXml = await documentXmlFromBytes(savedBytes);
  const savedCapsule = new TextEncoder().encode(extractCapsuleSubstring(savedXml));
  expect(bytesEqual(savedCapsule, fixture.capsuleBytes)).toBe(true);

  await page.evaluate(async (bytes) => {
    await window.pocEditorDriver!.loadDocx(new Uint8Array(bytes));
  }, Array.from(savedBytes));

  const reopenedFind = await page.evaluate(async (text) => {
    return window.pocEditorDriver!.query({ type: 'findText', text });
  }, EXPECTED_TEXT_AFTER_FLOW);
  expect(reopenedFind).toEqual({
    type: 'findText',
    ranges: [
      expect.objectContaining({
        blockId: POC_PARAGRAPH_ID,
        start: 0,
        end: EXPECTED_TEXT_AFTER_FLOW.length,
      }),
    ],
  });

  const reopened = await loadPocDocx(savedBytes);
  expect(reopened.paragraphId).toBe(POC_PARAGRAPH_ID);
  expect(reopened.text).toBe(EXPECTED_TEXT_AFTER_FLOW);
  expect(reopened.runs.some((run) => run.text.includes('Hi') && !run.bold && !run.italic)).toBe(true);
  expect(reopened.runs.some((run) => run.text.includes('bold') && run.bold && !run.italic)).toBe(
    true
  );
  expect(reopened.runs.some((run) => run.text.includes('italic') && !run.bold && run.italic)).toBe(
    true
  );
  expect(reopened.runs.some((run) => run.text.includes(REMOTE_SUFFIX) && !run.bold && !run.italic)).toBe(
    true
  );
  expect(bytesEqual(reopened.capsuleBytes, fixture.capsuleBytes)).toBe(true);

  await expect(editable).toHaveText(EXPECTED_TEXT_AFTER_FLOW);
  await expect(replica).toHaveText(EXPECTED_TEXT_AFTER_FLOW);
});
