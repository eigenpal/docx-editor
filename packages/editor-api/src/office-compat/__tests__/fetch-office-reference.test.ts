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
import {
  adoptShapeIdenticalDrift,
  checkForDrift,
  regenerate,
} from '../../../scripts/fetch-office-reference.mjs';
import { gitBlobSha } from '../../../scripts/lib/definitely-typed-commit.mjs';
import { PINNED_DOCS_REFERENCE_COMMIT } from '../../../scripts/lib/docs-reference.mjs';

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

/**
 * Extends `fakeNpmFetch` with the two GitHub endpoints the adopt path needs:
 * the DefinitelyTyped commit walk that proves the source commit, and the
 * pinned docs-reference commit every provenance record records.
 * `declarationBlobSha` is what GitHub reports for `types/office-js/index.d.ts`
 * at the newest commit — set it to something else to model a release whose
 * bytes no commit explains.
 */
function fakeAdoptFetch({
  version,
  declarationText,
  sourceCommit,
  declarationBlobSha = gitBlobSha(Buffer.from(declarationText)),
}: {
  version: string;
  declarationText: string;
  sourceCommit: string;
  declarationBlobSha?: string;
}) {
  const npmFetch = fakeNpmFetch({ version, declarationText });
  const respond = (body: unknown) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  });

  return async (url: string, ...rest: unknown[]) => {
    if (url.includes('DefinitelyTyped/commits?')) {
      return respond([
        {
          sha: sourceCommit,
          html_url: `https://github.com/DefinitelyTyped/DefinitelyTyped/commit/${sourceCommit}`,
          commit: { committer: { date: '2026-08-13T05:10:31Z' } },
        },
      ]);
    }
    if (url.includes('/contents/types/office-js?ref=')) {
      return respond([{ name: 'index.d.ts', sha: declarationBlobSha }]);
    }
    if (url.includes('office-js-docs-reference/commits/')) {
      return respond({
        sha: PINNED_DOCS_REFERENCE_COMMIT,
        html_url: `https://github.com/OfficeDev/office-js-docs-reference/commit/${PINNED_DOCS_REFERENCE_COMMIT}`,
        commit: { author: { date: '2026-08-04T15:36:00Z' }, message: 'Automatically generated' },
      });
    }
    return npmFetch(url, ...(rest as []));
  };
}

/** Same shape as `PREVIOUS_FIXTURE`, so the delta is provenance-only. */
const SHAPE_IDENTICAL_DECLARATION = `declare namespace Word {
  class Body {
    readonly text: string;
  }
}`;

describe('adoptShapeIdenticalDrift() (the write path used by compat:adopt)', () => {
  test('adopts a provenance-only bump and proves the source commit against the published bytes', async () => {
    const sourceCommit = 'e8ab93aca9dcb062ad042380341762b019c4a488';
    const result = await adoptShapeIdenticalDrift({
      version: UNPINNED_VERSION,
      fetchImpl: fakeAdoptFetch({
        version: UNPINNED_VERSION,
        declarationText: SHAPE_IDENTICAL_DECLARATION,
        sourceCommit,
      }),
      existingFixtureJson: `${JSON.stringify(PREVIOUS_FIXTURE, null, 2)}\n`,
    });

    expect(result.adopted).toBe(true);
    expect(result.definitelyTypedCommit).toBe(sourceCommit);
    expect(result.commitWasPinned).toBe(false);
    expect(result.declarationBlobSha).toBe(gitBlobSha(Buffer.from(SHAPE_IDENTICAL_DECLARATION)));

    // Provenance records the version and the commit that was just proved —
    // this is the whole content of an auto-adopted bump.
    const provenance = JSON.parse(result.provenanceJson);
    expect(provenance.upstreamPackage.version).toBe(UNPINNED_VERSION);
    expect(provenance.upstreamPackage.sourceRepository.commit).toBe(sourceCommit);
    expect(provenance.upstreamPackage.sourceRepository.sourceUrl).toContain(sourceCommit);
  });

  test('refuses a release whose shape moved, leaving it for a maintainer to review', async () => {
    const result = await adoptShapeIdenticalDrift({
      version: UNPINNED_VERSION,
      fetchImpl: fakeAdoptFetch({
        version: UNPINNED_VERSION,
        // One member more than the checked-in fixture: a fact about the API.
        declarationText: `declare namespace Word {
          class Body {
            readonly text: string;
            clear(): void;
          }
        }`,
        sourceCommit: 'e8ab93aca9dcb062ad042380341762b019c4a488',
      }),
      existingFixtureJson: `${JSON.stringify(PREVIOUS_FIXTURE, null, 2)}\n`,
    });

    expect(result.adopted).toBe(false);
    expect(result.reason).toBe('shape-changed');
    expect(result.diffSummary).toContain('Word.Body#clear');
    // Nothing adoptable is produced, so nothing can be written by mistake.
    expect(result.provenanceJson).toBeUndefined();
    expect(result.fixtureJson).toBeUndefined();
  });

  test('fails loudly when no DefinitelyTyped commit explains the published bytes', async () => {
    await expect(
      adoptShapeIdenticalDrift({
        version: UNPINNED_VERSION,
        fetchImpl: fakeAdoptFetch({
          version: UNPINNED_VERSION,
          declarationText: SHAPE_IDENTICAL_DECLARATION,
          sourceCommit: 'e8ab93aca9dcb062ad042380341762b019c4a488',
          declarationBlobSha: 'a blob sha that does not match the tarball',
        }),
        existingFixtureJson: `${JSON.stringify(PREVIOUS_FIXTURE, null, 2)}\n`,
      })
    ).rejects.toThrow(/has an index\.d\.ts matching the published/);
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
