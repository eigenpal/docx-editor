import { describe, expect, test } from 'bun:test';
import type { Run } from '../../types/document';
import { diffRuns } from './runDiff';

function textRun(text: string, formatting?: Run['formatting']): Run {
  return {
    type: 'run',
    ...(formatting ? { formatting } : {}),
    content: [{ type: 'text', text }],
  };
}

describe('runDiff', () => {
  test('returns a single equal chunk when text is unchanged', () => {
    const oldRuns = [textRun('Hello world')];
    const newRuns = [textRun('Hello world')];

    const result = diffRuns(oldRuns, newRuns);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('equal');
    expect(result[0].text).toBe('Hello world');
  });

  test('detects insertion in the middle', () => {
    const oldRuns = [textRun('Hello world')];
    const newRuns = [textRun('Hello brave world')];

    const result = diffRuns(oldRuns, newRuns);

    expect(result.map((chunk) => chunk.kind)).toEqual(['equal', 'insert', 'equal']);
    expect(result.map((chunk) => chunk.text)).toEqual(['Hello', ' brave', ' world']);
  });

  test('detects deletion', () => {
    const oldRuns = [textRun('Hello brave world')];
    const newRuns = [textRun('Hello world')];

    const result = diffRuns(oldRuns, newRuns);

    expect(result.map((chunk) => chunk.kind)).toEqual(['equal', 'delete', 'equal']);
    expect(result.map((chunk) => chunk.text)).toEqual(['Hello', ' brave', ' world']);
  });

  test('groups inserts by formatting', () => {
    const oldRuns = [textRun('A C')];
    const newRuns = [textRun('A '), textRun('B', { bold: true }), textRun(' C')];

    const result = diffRuns(oldRuns, newRuns);
    const insertChunks = result.filter((chunk) => chunk.kind === 'insert');

    expect(result.map((chunk) => chunk.kind)).toEqual(['equal', 'insert', 'insert', 'equal']);
    expect(insertChunks.map((chunk) => chunk.text).join('')).toBe(' B');
    expect(insertChunks.some((chunk) => chunk.runs[0].formatting?.bold)).toBe(true);
  });

  test('supports pure insertion when old side is empty', () => {
    const result = diffRuns([], [textRun('New text')]);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('insert');
    expect(result[0].text).toBe('New text');
  });

  test('supports pure deletion when new side is empty', () => {
    const result = diffRuns([textRun('Old text')], []);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('delete');
    expect(result[0].text).toBe('Old text');
  });
});
