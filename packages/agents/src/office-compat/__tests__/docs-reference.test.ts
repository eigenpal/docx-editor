import { describe, test, expect } from 'bun:test';
import {
  DOCS_REFERENCE_REPOSITORY,
  PINNED_DOCS_REFERENCE_COMMIT,
  isWellFormedCommitSha,
  buildDocsReferenceMetadata,
  validateDocsReferenceMetadata,
  fetchDocsReferenceCommitMetadata,
} from '../../../scripts/lib/docs-reference.mjs';

describe('isWellFormedCommitSha', () => {
  test('accepts a 40-character hex commit sha', () => {
    expect(isWellFormedCommitSha('8548490a8014ff25cc0702fd6d947d5c6f178655')).toBe(true);
  });

  test('accepts uppercase hex too', () => {
    expect(isWellFormedCommitSha('8548490A8014FF25CC0702FD6D947D5C6F178655')).toBe(true);
  });

  test('rejects a short/abbreviated sha', () => {
    expect(isWellFormedCommitSha('8548490')).toBe(false);
  });

  test('rejects a non-hex string', () => {
    expect(isWellFormedCommitSha('main')).toBe(false);
  });

  test('rejects null/undefined', () => {
    expect(isWellFormedCommitSha(undefined)).toBe(false);
    expect(isWellFormedCommitSha(null)).toBe(false);
  });
});

describe('the pinned docs-reference commit constant', () => {
  test('is a well-formed commit sha (sanity: the pin itself must look like a real commit)', () => {
    expect(isWellFormedCommitSha(PINNED_DOCS_REFERENCE_COMMIT)).toBe(true);
  });

  test('points at the expected upstream repository', () => {
    expect(DOCS_REFERENCE_REPOSITORY).toBe('OfficeDev/office-js-docs-reference');
  });
});

describe('buildDocsReferenceMetadata', () => {
  test('normalizes the fields the scheduled fetch job records', () => {
    const metadata = buildDocsReferenceMetadata({
      repository: DOCS_REFERENCE_REPOSITORY,
      commit: PINNED_DOCS_REFERENCE_COMMIT,
      commitDate: '2026-08-04T15:36:00Z',
      commitMessage: 'Automatically generated docs (#2601)',
      htmlUrl: `https://github.com/${DOCS_REFERENCE_REPOSITORY}/commit/${PINNED_DOCS_REFERENCE_COMMIT}`,
    });
    expect(metadata).toEqual({
      repository: DOCS_REFERENCE_REPOSITORY,
      commit: PINNED_DOCS_REFERENCE_COMMIT,
      commitDate: '2026-08-04T15:36:00Z',
      commitMessage: 'Automatically generated docs (#2601)',
      htmlUrl: `https://github.com/${DOCS_REFERENCE_REPOSITORY}/commit/${PINNED_DOCS_REFERENCE_COMMIT}`,
      note: metadata.note,
    });
    expect(typeof metadata.note).toBe('string');
    expect(metadata.note.length).toBeGreaterThan(0);
  });

  test('defaults a missing commitMessage to null rather than undefined (JSON-serializable)', () => {
    const metadata = buildDocsReferenceMetadata({
      repository: DOCS_REFERENCE_REPOSITORY,
      commit: PINNED_DOCS_REFERENCE_COMMIT,
      commitDate: '2026-08-04T15:36:00Z',
      htmlUrl: 'https://github.com/OfficeDev/office-js-docs-reference/commit/abc',
    });
    expect(metadata.commitMessage).toBeNull();
  });
});

describe('validateDocsReferenceMetadata', () => {
  const wellFormed = () =>
    buildDocsReferenceMetadata({
      repository: DOCS_REFERENCE_REPOSITORY,
      commit: PINNED_DOCS_REFERENCE_COMMIT,
      commitDate: '2026-08-04T15:36:00Z',
      commitMessage: 'Automatically generated docs (#2601)',
      htmlUrl: `https://github.com/${DOCS_REFERENCE_REPOSITORY}/commit/${PINNED_DOCS_REFERENCE_COMMIT}`,
    });

  test('accepts well-formed metadata', () => {
    expect(validateDocsReferenceMetadata(wellFormed())).toEqual([]);
  });

  test('flags a repository that does not match the pinned upstream repo', () => {
    const issues = validateDocsReferenceMetadata({ ...wellFormed(), repository: 'someone/fork' });
    expect(issues.some((i) => /repository/.test(i))).toBe(true);
  });

  test('flags a commit that is not a well-formed sha', () => {
    const issues = validateDocsReferenceMetadata({ ...wellFormed(), commit: 'main' });
    expect(issues.some((i) => /commit/.test(i))).toBe(true);
  });

  test('flags a missing commitDate', () => {
    const issues = validateDocsReferenceMetadata({ ...wellFormed(), commitDate: '' });
    expect(issues.some((i) => /commitDate/.test(i))).toBe(true);
  });

  test('flags an htmlUrl that is not a github.com URL', () => {
    const issues = validateDocsReferenceMetadata({
      ...wellFormed(),
      htmlUrl: 'javascript:alert(1)',
    });
    expect(issues.some((i) => /htmlUrl/.test(i))).toBe(true);
  });
});

describe('fetchDocsReferenceCommitMetadata', () => {
  function fakeGitHubResponse(body, { ok = true, status = 200, statusText = 'OK' } = {}) {
    return async () => ({
      ok,
      status,
      statusText,
      json: async () => body,
    });
  }

  test('normalizes a successful GitHub commit API response, verifying the returned sha matches the pinned commit', async () => {
    const commit = PINNED_DOCS_REFERENCE_COMMIT;
    const fetchImpl = fakeGitHubResponse({
      sha: commit,
      html_url: `https://github.com/${DOCS_REFERENCE_REPOSITORY}/commit/${commit}`,
      commit: {
        author: { date: '2026-08-04T15:36:00Z' },
        message:
          'Automatically generated docs (#2601)\n\nCo-authored-by: github-actions <github-actions@github.com>',
      },
    });
    const metadata = await fetchDocsReferenceCommitMetadata(commit, { fetchImpl });
    expect(metadata.repository).toBe(DOCS_REFERENCE_REPOSITORY);
    expect(metadata.commit).toBe(commit);
    expect(metadata.commitDate).toBe('2026-08-04T15:36:00Z');
    expect(metadata.commitMessage).toBe('Automatically generated docs (#2601)');
    expect(metadata.htmlUrl).toBe(
      `https://github.com/${DOCS_REFERENCE_REPOSITORY}/commit/${commit}`
    );
    expect(validateDocsReferenceMetadata(metadata)).toEqual([]);
  });

  test('throws when the GitHub API request fails (non-ok response) rather than silently skipping verification', async () => {
    const fetchImpl = fakeGitHubResponse({}, { ok: false, status: 404, statusText: 'Not Found' });
    await expect(
      fetchDocsReferenceCommitMetadata(PINNED_DOCS_REFERENCE_COMMIT, { fetchImpl })
    ).rejects.toThrow(/404/);
  });

  test('throws when the returned commit sha does not match the requested pinned commit (validation, not blind trust)', async () => {
    const fetchImpl = fakeGitHubResponse({
      sha: 'a'.repeat(40),
      html_url: 'https://github.com/OfficeDev/office-js-docs-reference/commit/a'.padEnd(10, 'a'),
      commit: { author: { date: '2026-08-04T15:36:00Z' }, message: 'unexpected commit' },
    });
    await expect(
      fetchDocsReferenceCommitMetadata(PINNED_DOCS_REFERENCE_COMMIT, { fetchImpl })
    ).rejects.toThrow(/unexpected commit sha/);
  });

  test('throws when the response is missing commit.author.date', async () => {
    const commit = PINNED_DOCS_REFERENCE_COMMIT;
    const fetchImpl = fakeGitHubResponse({
      sha: commit,
      html_url: `https://github.com/${DOCS_REFERENCE_REPOSITORY}/commit/${commit}`,
      commit: { message: 'no date' },
    });
    await expect(fetchDocsReferenceCommitMetadata(commit, { fetchImpl })).rejects.toThrow(
      /commit\.author\.date/
    );
  });
});
