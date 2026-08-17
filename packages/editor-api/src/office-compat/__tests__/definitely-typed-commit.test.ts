/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Tests for the resolver that answers "which DefinitelyTyped commit produced
 * this published `@types/office-js` release" by proof: git blob hashes of the
 * published `index.d.ts` against the blob hashes GitHub reports. `fetch` is
 * injected, so nothing here touches the network.
 */
import { describe, test, expect } from 'bun:test';
import {
  gitBlobSha,
  resolveDefinitelyTypedCommitFromSource,
  UnresolvedDefinitelyTypedCommitError,
} from '../../../scripts/lib/definitely-typed-commit.mjs';

/** A commit list + one directory listing per commit, as GitHub returns them. */
function fakeGitHub(commits: { sha: string; declarationBlobSha: string }[]) {
  const seenUrls: string[] = [];
  const respond = (body: unknown) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  });

  const fetchImpl = async (url: string) => {
    seenUrls.push(url);
    if (url.includes('/commits?')) {
      return respond(
        commits.map((commit) => ({
          sha: commit.sha,
          html_url: `https://github.com/DefinitelyTyped/DefinitelyTyped/commit/${commit.sha}`,
          commit: { committer: { date: '2026-08-13T05:10:31Z' } },
        }))
      );
    }
    if (url.includes('/contents/types/office-js?ref=')) {
      const ref = url.split('ref=')[1];
      const commit = commits.find((candidate) => candidate.sha === ref);
      return respond([
        { name: 'package.json', sha: 'c94348b6e629d926f18633eea08d8b51d6a5ab48' },
        { name: 'index.d.ts', sha: commit?.declarationBlobSha ?? 'missing' },
      ]);
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  };

  return { fetchImpl, seenUrls };
}

describe('gitBlobSha', () => {
  test('matches git hash-object, which is what makes GitHub blob shas comparable', () => {
    expect(gitBlobSha(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    expect(gitBlobSha(Buffer.alloc(0))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });
});

describe('resolveDefinitelyTypedCommitFromSource', () => {
  test('returns the newest commit whose index.d.ts is byte-identical to the published tarball', async () => {
    const declaration = Buffer.from('declare namespace Word { class Body {} }');
    const { fetchImpl, seenUrls } = fakeGitHub([
      { sha: 'a'.repeat(40), declarationBlobSha: 'differentblobsha' },
      { sha: 'b'.repeat(40), declarationBlobSha: gitBlobSha(declaration) },
      { sha: 'c'.repeat(40), declarationBlobSha: gitBlobSha(declaration) },
    ]);

    const resolved = await resolveDefinitelyTypedCommitFromSource({
      version: '1.0.605',
      declaration,
      fetchImpl,
    });

    expect(resolved.commit).toBe('b'.repeat(40));
    expect(resolved.blobSha).toBe(gitBlobSha(declaration));

    // Scoped to the package directory, and bounded. Without the path filter
    // the walk covers all of DefinitelyTyped, where nearly no commit touches
    // types/office-js, so nothing would ever resolve.
    expect(seenUrls[0]).toContain('/repos/DefinitelyTyped/DefinitelyTyped/commits');
    expect(seenUrls[0]).toContain('path=types%2Foffice-js');
    expect(seenUrls[0]).toMatch(/per_page=\d+/);
    // Stops at the first match rather than walking the rest.
    expect(seenUrls.some((url) => url.includes('ref=' + 'c'.repeat(40)))).toBe(false);
  });

  test('sends the token when one is supplied, so the workflow is not on the shared anonymous rate limit', async () => {
    const declaration = Buffer.from('declare namespace Word {}');
    const authorizations: unknown[] = [];
    const { fetchImpl } = fakeGitHub([
      { sha: 'd'.repeat(40), declarationBlobSha: gitBlobSha(declaration) },
    ]);

    await resolveDefinitelyTypedCommitFromSource({
      version: '1.0.605',
      declaration,
      githubToken: 'test-token',
      fetchImpl: async (url: string, init?: { headers?: Record<string, string> }) => {
        authorizations.push(init?.headers?.Authorization);
        return fetchImpl(url);
      },
    });

    expect(authorizations.length).toBeGreaterThan(0);
    expect(new Set(authorizations)).toEqual(new Set(['Bearer test-token']));
  });

  test('refuses to guess when no candidate commit carries the published bytes', async () => {
    const declaration = Buffer.from('declare namespace Word { class Body {} }');
    const { fetchImpl } = fakeGitHub([
      { sha: 'e'.repeat(40), declarationBlobSha: 'someotherblob' },
      { sha: 'f'.repeat(40), declarationBlobSha: 'anotherblob' },
    ]);

    const error = await resolveDefinitelyTypedCommitFromSource({
      version: '1.0.605',
      declaration,
      fetchImpl,
    }).catch((thrown) => thrown);

    expect(error).toBeInstanceOf(UnresolvedDefinitelyTypedCommitError);
    // Both fields a maintainer needs to finish the job by hand: which release
    // could not be explained, and the blob hash to search for.
    expect(error.version).toBe('1.0.605');
    expect(error.blobSha).toBe(gitBlobSha(declaration));
    expect(error.message).toContain('definitely-typed-commits.json');
  });

  test('aborts rather than guessing when the commit list comes back empty', async () => {
    const { fetchImpl } = fakeGitHub([]);
    await expect(
      resolveDefinitelyTypedCommitFromSource({
        version: '1.0.605',
        declaration: Buffer.from('declare namespace Word {}'),
        fetchImpl,
      })
    ).rejects.toThrow(/no commits touching/);
  });
});
