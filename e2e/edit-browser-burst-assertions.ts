import { expect } from '@playwright/test';
import { type BurstReport } from './edit-browser-burst.js';

function textDelta(report: BurstReport): number {
  return report.paragraphTextAfter!.length - report.paragraphTextBefore!.length;
}

function maxBackspaceRemovals(report: BurstReport): number {
  return Math.min(report.processedEvents, report.initialSelection.offset);
}

function assertCollapsedCaret(report: BurstReport, offset: number): void {
  expect(report.finalSelection?.head).toEqual({
    paragraphId: report.initialSelection.paragraphId,
    offset,
  });
  expect(report.finalSelection?.anchor).toEqual(report.finalSelection?.head);
}

function assertEditCommitted(report: BurstReport): void {
  expect(report.canUndo).toBe(true);
  expect(report.revisionAfter).toBeGreaterThan(report.revisionBefore);
}

export function assertBurstDocumentState(report: BurstReport): void {
  const before = report.paragraphTextBefore!;
  const after = report.paragraphTextAfter!;
  const start = report.initialSelection.offset;

  if (report.name === 'editing-type') {
    const insertedLength = textDelta(report);
    expect(insertedLength).toBe(report.processedEvents);
    expect(after).toBe(
      `${before.slice(0, start)}${'X'.repeat(insertedLength)}${before.slice(start)}`
    );
    assertCollapsedCaret(report, start + insertedLength);
    assertEditCommitted(report);
    return;
  }

  if (report.name === 'suggesting-type') {
    // Suggesting inserts are `w:ins` in all-markup: each typed character is visible once.
    const insertedLength = textDelta(report);
    expect(insertedLength).toBe(report.processedEvents);
    expect(after).toBe(
      `${before.slice(0, start)}${'X'.repeat(insertedLength)}${before.slice(start)}`
    );
    assertCollapsedCaret(report, start + insertedLength);
    assertEditCommitted(report);
    return;
  }

  if (report.name === 'editing-backspace') {
    const removed = maxBackspaceRemovals(report);
    expect(before.length - after.length).toBe(removed);
    assertCollapsedCaret(report, start - removed);
    assertEditCommitted(report);
    return;
  }

  if (report.name === 'suggesting-backspace') {
    // Suggesting Backspace wraps `w:del` without removing characters from all-markup text.
    // The caret still walks left one model unit per processed key.
    const moved = maxBackspaceRemovals(report);
    expect(after).toBe(before);
    assertCollapsedCaret(report, start - moved);
    assertEditCommitted(report);
    return;
  }

  if (report.name === 'editing-ordered-type') {
    const inserted = report.orderedText!;
    const actualInserted = after.slice(start, start + inserted.length);
    expect(actualInserted).toBe(inserted);
    expect(after).toBe(`${before.slice(0, start)}${inserted}${before.slice(start)}`);
    assertCollapsedCaret(report, start + inserted.length);
    assertEditCommitted(report);
    return;
  }

  if (report.name === 'editing-delete') {
    expect(after.length).toBe(before.length - report.requestedEvents);
    assertCollapsedCaret(report, start);
    assertEditCommitted(report);
  }
}
