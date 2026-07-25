// `findMatches` resolves each hit to BOTH addresses: the engine's own (`blockId` +
// paragraph offset) and the positional one a find/replace UI navigates by
// (`paragraphIndex` / `runIndex` / `runOffset`).
//
// The run address is the part that can be silently wrong — a match starting in the
// second run must not report run 0 — so these pin it against runs of known lengths.

import { describe, expect, test } from 'bun:test';
import { createEditor } from '../src/index.ts';
import type { Editor, EditorHost } from '@docx-editor.dev/core-contract/editor';
import { writeDocx, createEmptyModel, bodyStoryId } from '@docx-editor.dev/engine-core';
import { modelWith } from './interaction-test-helpers.ts';
import type { PackageModel, ParagraphRecord } from '@docx-editor.dev/engine-core';

/**
 * A paragraph whose runs SURVIVE the DOCX round-trip. Adjacent runs with identical
 * formatting are merged on read, so each run here carries distinct properties —
 * otherwise the fixture silently collapses to one run and the run-address assertions
 * below would pass against a single run without testing anything.
 */
function modelWithFormattedRuns(parts: readonly string[]): PackageModel {
  const base = createEmptyModel();
  const storyId = bodyStoryId(base);
  const story = base.stories.get(storyId)!;
  const first = story.blocks[0] as ParagraphRecord;
  const paragraph: ParagraphRecord = {
    ...first,
    runs: parts.map((text, i) => ({ text, props: i % 2 === 0 ? { bold: true } : { italic: true } })),
  };
  return {
    ...base,
    stories: new Map(base.stories).set(storyId, { ...story, blocks: [paragraph] }),
  };
}

function host(): EditorHost {
  return {
    getBodyHostEl: () => null,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => null,
    scheduleFrame: (cb) => {
      cb();
      return () => {};
    },
  };
}

const editorFor = (document: Uint8Array): Editor => createEditor({ host: host(), document });

describe('findMatches addressing', () => {
  test('paragraphIndex counts paragraphs in order', () => {
    const editor = editorFor(writeDocx(modelWith(['alpha', 'beta', 'alpha again'])));
    const matches = editor.findMatches('alpha');
    expect(matches.map((m) => m.paragraphIndex)).toEqual([0, 2]);
    expect(matches.map((m) => m.text)).toEqual(['alpha', 'alpha']);
    editor.destroy();
  });

  test('a match inside the first run reports run 0 and its offset', () => {
    // Runs: "hello " (6) + "world" (5)
    const editor = editorFor(writeDocx(modelWithFormattedRuns(['hello ', 'world'])));
    const [match] = editor.findMatches('ello');
    expect(match).toBeDefined();
    expect(match!.runIndex).toBe(0);
    expect(match!.runOffset).toBe(1);
    expect(match!.start).toBe(1); // paragraph offset agrees for a first-run match
    editor.destroy();
  });

  test('a match inside a LATER run reports that run, not run 0', () => {
    const editor = editorFor(writeDocx(modelWithFormattedRuns(['hello ', 'world'])));
    const [match] = editor.findMatches('orld');
    expect(match).toBeDefined();
    expect(match!.runIndex).toBe(1); // the whole point: not 0
    expect(match!.runOffset).toBe(1); // offset WITHIN that run, not within the paragraph
    expect(match!.start).toBe(7); // paragraph offset still counts from the paragraph start
    editor.destroy();
  });

  test('the run address survives several runs before the match', () => {
    // Runs: "aa" (2) + "bb" (2) + "cc" (2) + "target" (6)
    const editor = editorFor(writeDocx(modelWithFormattedRuns(['aa', 'bb', 'cc', 'target'])));
    const [match] = editor.findMatches('target');
    expect(match!.runIndex).toBe(3);
    expect(match!.runOffset).toBe(0);
    expect(match!.start).toBe(6);
    editor.destroy();
  });

  test('length and text describe the match, not the query casing', () => {
    const editor = editorFor(writeDocx(modelWith(['Hello hello'])));
    const matches = editor.findMatches('HELLO'); // case-insensitive by default
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.text)).toEqual(['Hello', 'hello']);
    expect(matches.every((m) => m.length === 5)).toBe(true);
    editor.destroy();
  });

  test('selectMatch refuses rather than silently leaving the caret put', () => {
    const editor = editorFor(writeDocx(modelWith(['alpha'])));
    const [match] = editor.findMatches('alpha');
    const result = editor.selectMatch(match!);
    expect(result.ok).toBe(false);
    editor.destroy();
  });
});
