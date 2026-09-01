import { describe, expect, test } from 'bun:test';
import { markdownPageToReveal } from './preview-navigation';

describe('Code view page synchronization', () => {
  test('reveals the latest editor page when returning to Markdown', () => {
    let latestEditorPage = 3;
    expect(markdownPageToReveal('developer', 'ready', true, latestEditorPage)).toBeNull();

    latestEditorPage = 17;
    expect(markdownPageToReveal('rendered', 'ready', true, latestEditorPage)).toBe(17);
    expect(markdownPageToReveal('source', 'ready', true, latestEditorPage)).toBe(17);
    expect(markdownPageToReveal('rendered', 'exporting', true, latestEditorPage)).toBeNull();
    expect(markdownPageToReveal('rendered', 'ready', false, latestEditorPage)).toBeNull();
  });
});
