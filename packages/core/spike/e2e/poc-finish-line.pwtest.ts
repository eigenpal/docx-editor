/** @spike-features engine-neutral-editor-driver-contract, one-preservation-capsule */
import { expect, test, type Locator } from '@playwright/test';
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

async function expectProjectionFormatting(
  editable: Locator,
  replica: Locator,
  formatting: {
    readonly hiBold: boolean;
    readonly boldWordBold: boolean;
    readonly italicWordItalic: boolean;
    readonly remotePresent: boolean;
  }
): Promise<void> {
  for (const root of [editable, replica]) {
    if (formatting.hiBold) {
      await expect(root.locator('strong').getByText('Hi', { exact: true })).toBeVisible();
    } else {
      await expect(root.locator('strong').getByText('Hi', { exact: true })).toHaveCount(0);
      await expect(root.locator('p')).toContainText(/^Hi /);
    }

    if (formatting.boldWordBold) {
      await expect(root.locator('strong').getByText('bold', { exact: true })).toBeVisible();
    } else {
      await expect(root.locator('strong').getByText('bold', { exact: true })).toHaveCount(0);
    }

    if (formatting.italicWordItalic) {
      await expect(root.locator('em').getByText('italic', { exact: true })).toBeVisible();
    } else {
      await expect(root.locator('em').getByText('italic', { exact: true })).toHaveCount(0);
    }

    if (formatting.remotePresent) {
      await expect(root).toContainText(REMOTE_SUFFIX);
      await expect(root.locator('strong').getByText(REMOTE_SUFFIX, { exact: true })).toHaveCount(0);
      await expect(root.locator('em').getByText(REMOTE_SUFFIX, { exact: true })).toHaveCount(0);
    } else {
      await expect(root).not.toContainText(REMOTE_SUFFIX);
    }
  }
}

function expectReopenedRunSemantics(
  runs: readonly { readonly text: string; readonly bold: boolean; readonly italic: boolean }[]
): void {
  const hiRuns = runs.filter((run) => run.text.includes('Hi'));
  expect(hiRuns.length).toBeGreaterThan(0);
  expect(hiRuns.every((run) => !run.bold && !run.italic)).toBe(true);

  const boldRuns = runs.filter((run) => run.text.includes('bold'));
  expect(boldRuns.some((run) => run.bold && !run.italic)).toBe(true);
  expect(boldRuns.every((run) => !run.italic)).toBe(true);

  const italicRuns = runs.filter((run) => run.text.includes('italic'));
  expect(italicRuns.some((run) => run.italic && !run.bold)).toBe(true);
  expect(italicRuns.every((run) => !run.bold)).toBe(true);

  const remoteRuns = runs.filter((run) => run.text.includes(REMOTE_SUFFIX));
  expect(remoteRuns.length).toBeGreaterThan(0);
  expect(remoteRuns.every((run) => !run.bold && !run.italic)).toBe(true);
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

  await page.evaluate(async () => {
    const driver = window.pocEditorDriver!;
    await driver.selectText('Hello');
    await driver.type('Hi');
    await driver.selectText('Hi');
    await driver.execute({ type: 'toggleMark', mark: 'bold' });
  });

  await expect(editable).toHaveText(TEXT_AFTER_LOCAL_EDITS);
  await expect(replica).toHaveText(TEXT_AFTER_LOCAL_EDITS);
  await expectProjectionFormatting(editable, replica, {
    hiBold: true,
    boldWordBold: true,
    italicWordItalic: true,
    remotePresent: false,
  });

  await page.evaluate(async (suffix) => {
    await window.pocEditorDriver!.applyRemoteEdit({ text: suffix });
  }, REMOTE_SUFFIX);

  await expect(editable).toHaveText(EXPECTED_TEXT_AFTER_FLOW);
  await expect(replica).toHaveText(EXPECTED_TEXT_AFTER_FLOW);
  await expectProjectionFormatting(editable, replica, {
    hiBold: true,
    boldWordBold: true,
    italicWordItalic: true,
    remotePresent: true,
  });

  await page.evaluate(async () => {
    await window.pocEditorDriver!.undo();
  });

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
  await expectProjectionFormatting(editable, replica, {
    hiBold: false,
    boldWordBold: true,
    italicWordItalic: true,
    remotePresent: true,
  });

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
  expect(savedXml).toContain(`<poc:ParagraphId>${POC_PARAGRAPH_ID}</poc:ParagraphId>`);
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
  expectReopenedRunSemantics(reopened.runs);
  expect(bytesEqual(reopened.capsuleBytes, fixture.capsuleBytes)).toBe(true);

  await expect(editable).toHaveText(EXPECTED_TEXT_AFTER_FLOW);
  await expect(replica).toHaveText(EXPECTED_TEXT_AFTER_FLOW);
  await expectProjectionFormatting(editable, replica, {
    hiBold: false,
    boldWordBold: true,
    italicWordItalic: true,
    remotePresent: true,
  });
});
