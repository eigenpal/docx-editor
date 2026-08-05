/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Orchestration tests for `fetch-office-reference.mjs`'s network-fetch ->
 * verify -> extract -> diff pipeline, with `fetch` injected so no real
 * network call happens. This is deliberately narrow: it covers the one
 * behavior that matters for CI/drift-check correctness (does `--check`
 * still produce a symbol/member delta when the fetched version has no
 * reviewed `PINNED_DEFINITELY_TYPED_COMMITS` entry?), not full coverage of
 * every branch in the script (see `task-1-report.md`'s Concern 3).
 */
import { describe, test, expect } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { checkForDrift, regenerate } from '../../../scripts/fetch-office-reference.mjs';

/** Mirrors `tar.test.ts`'s helper: a minimal single-entry USTAR archive. */
function buildTar(entries: { name: string; content: string }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const { name, content } of entries) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 'ascii');
    const contentBuf = Buffer.from(content, 'utf8');
    const sizeOctal = contentBuf.length.toString(8).padStart(11, '0');
    header.write(sizeOctal, 124, 'ascii');
    header[156] = '0'.charCodeAt(0);
    chunks.push(header);
    chunks.push(contentBuf);
    const padding = (512 - (contentBuf.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function sha512Integrity(buffer: Buffer): string {
  return `sha512-${createHash('sha512').update(buffer).digest('base64')}`;
}

/** Builds a fake `fetch` that answers the npm registry metadata request and
 * the tarball download for a single synthetic, unpinned `@types/office-js`
 * version — never touching the real network. */
function fakeNpmFetch({ version, declarationText }: { version: string; declarationText: string }) {
  const tar = buildTar([{ name: 'package/index.d.ts', content: declarationText }]);
  const tarballGzip = gzipSync(tar);
  const tarballUrl = `https://example.invalid/${version}.tgz`;
  const integrity = sha512Integrity(tarballGzip);

  return async (url: string) => {
    if (url.includes('registry.npmjs.org')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          version,
          dist: { integrity, shasum: 'deadbeef', tarball: tarballUrl },
          typesPublisherContentHash: null,
          repository: {
            type: 'git',
            url: 'https://github.com/DefinitelyTyped/DefinitelyTyped.git',
            directory: 'types/office-js',
          },
          license: 'MIT',
        }),
      };
    }
    if (url === tarballUrl) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () =>
          tarballGzip.buffer.slice(
            tarballGzip.byteOffset,
            tarballGzip.byteOffset + tarballGzip.byteLength
          ),
      };
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  };
}

const PREVIOUS_FIXTURE = {
  schemaVersion: 1,
  generatedFrom: { package: '@types/office-js', version: '1.0.604' },
  symbols: {
    Body: {
      uid: 'Word.Body',
      kind: 'class',
      requirementSet: null,
      members: {
        text: {
          uid: 'Word.Body#text',
          kind: 'property',
          readonly: true,
          requirementSet: null,
          overloads: [{ params: [], returns: 'string' }],
        },
      },
    },
  },
};

const UNPINNED_VERSION = '9.9.9-not-a-real-pinned-release';

describe('checkForDrift against a new @types/office-js version with no reviewed DefinitelyTyped commit pin', () => {
  test('still fetches, extracts, and reports a complete symbol/member delta instead of aborting', async () => {
    const fetchImpl = fakeNpmFetch({
      version: UNPINNED_VERSION,
      declarationText: `declare namespace Word {
        class Body {
          readonly text: string;
          clear(): void;
        }
      }`,
    });

    const result = await checkForDrift({
      version: UNPINNED_VERSION,
      fetchImpl,
      existingFixtureJson: `${JSON.stringify(PREVIOUS_FIXTURE, null, 2)}\n`,
      existingProvenance: { upstreamPackage: { version: '1.0.604' } },
    });

    expect(result.driftDetected).toBe(true);
    expect(result.upstreamVersion).toBe(UNPINNED_VERSION);

    // The complete delta must be present, not skipped — this is the whole
    // point: a version bump is how real drift arrives, so the scheduled
    // job must be able to compute it even before a maintainer has reviewed
    // and pinned the new version's exact DefinitelyTyped source commit.
    expect(result.diff.changedSymbols).toHaveLength(1);
    expect(result.diff.changedSymbols[0].uid).toBe('Word.Body');
    expect(result.diff.changedSymbols[0].addedMembers).toEqual(['Word.Body#clear']);
    expect(result.diffSummary).toContain('Word.Body#clear');
    expect(result.diffSummary).toMatch(/added/i);

    // Explicitly flagged as unreviewed, not silently treated as adoptable.
    expect(result.reviewRequired).toBe(true);
    expect(result.reviewReason).toMatch(new RegExp(UNPINNED_VERSION.replace(/[.-]/g, '\\$&')));
    expect(result.provenance).toBeNull();
    expect(result.provenanceJson).toBeNull();
  });

  test('a genuine integrity failure still throws rather than being swallowed as "review required"', async () => {
    const fetchImpl = fakeNpmFetch({
      version: UNPINNED_VERSION,
      declarationText: `declare namespace Word { class Body { readonly text: string; } }`,
    });
    const brokenFetchImpl = async (url: string, ...rest: unknown[]) => {
      const response = await fetchImpl(url, ...(rest as []));
      if (url.includes('registry.npmjs.org')) {
        const body = await response.json();
        // Corrupt the integrity hash so verification must fail loudly.
        return {
          ...response,
          json: async () => ({
            ...body,
            dist: { ...body.dist, integrity: 'sha512-not-a-real-hash' },
          }),
        };
      }
      return response;
    };

    await expect(
      checkForDrift({
        version: UNPINNED_VERSION,
        fetchImpl: brokenFetchImpl,
        existingFixtureJson: `${JSON.stringify(PREVIOUS_FIXTURE, null, 2)}\n`,
        existingProvenance: { upstreamPackage: { version: '1.0.604' } },
      })
    ).rejects.toThrow(/integrity mismatch/);
  });
});

describe('regenerate() (the write path used by compat:fetch-reference)', () => {
  test('still hard-fails for an unpinned version, refusing to produce adoptable provenance', async () => {
    const fetchImpl = fakeNpmFetch({
      version: UNPINNED_VERSION,
      declarationText: `declare namespace Word { class Body { readonly text: string; } }`,
    });

    await expect(regenerate({ version: UNPINNED_VERSION, fetchImpl })).rejects.toThrow(
      /No reviewed DefinitelyTyped commit is pinned/
    );
  });
});
