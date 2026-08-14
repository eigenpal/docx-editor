import { expect } from '@playwright/test';
import { type BurstReport } from './edit-browser-burst.js';

function textDelta(report: BurstReport): number {
  return report.paragraphTextAfter!.length - report.paragraphTextBefore!.length;
}

function maxBackspaceRemovals(report: BurstReport): number {
  return Math.min(report.processedEvents, report.initialSelection.offset);
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
    expect(report.canUndo).toBe(true);
    expect(report.finalSelection?.head.paragraphId).toBe(report.initialSelection.paragraphId);
    return;
  }

  if (report.name === 'suggesting-type') {
    const insertedLength = textDelta(report);
    expect(insertedLength).toBeGreaterThanOrEqual(report.processedEvents);
    expect(after.slice(0, start + insertedLength)).toBe(
      `${before.slice(0, start)}${'X'.repeat(insertedLength)}`
    );
    expect(report.canUndo).toBe(true);
    expect(report.finalSelection?.head.paragraphId).toBe(report.initialSelection.paragraphId);
    return;
  }

  if (report.name === 'editing-backspace') {
    const removed = maxBackspaceRemovals(report);
    expect(before.length - after.length).toBe(removed);
    expect(report.canUndo).toBe(true);
    expect(report.finalSelection?.head.paragraphId).toBe(report.initialSelection.paragraphId);
    return;
  }

  if (report.name === 'suggesting-backspace') {
    expect(after).toBe(before);
    const moved = maxBackspaceRemovals(report);
    expect(report.finalSelection?.head.paragraphId).toBe(report.initialSelection.paragraphId);
    expect(report.finalSelection?.head.offset).toBeLessThanOrEqual(start);
    expect(report.finalSelection?.head.offset).toBeGreaterThanOrEqual(start - moved);
    expect(report.canUndo).toBe(true);
    return;
  }

  if (report.name === 'editing-ordered-type') {
    const inserted = report.orderedText!;
    expect(after).toBe(`${before.slice(0, start)}${inserted}${before.slice(start)}`);
    expect(report.finalSelection?.head).toEqual({
      paragraphId: report.initialSelection.paragraphId,
      offset: start + inserted.length,
    });
    return;
  }

  if (report.name === 'editing-delete') {
    expect(after.length).toBe(before.length - report.requestedEvents);
    expect(report.canUndo).toBe(true);
  }
}
