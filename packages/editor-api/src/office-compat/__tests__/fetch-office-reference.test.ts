/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Orchestration tests for `fetch-office-reference.mjs`'s network-fetch ->
 * verify -> extract -> diff pipeline, with `fetch` injected so no real
 * network call happens. Three behaviors carry weight here:
 *
 * - `--check` still produces a full symbol/member delta for a version with no
 *   reviewed source-commit pin, because a version bump is how drift arrives;
 * - `--adopt` writes only when the reference differs in nothing but the
 *   version string, and refuses every other difference, including the ones the
 *   symbol/member delta has no vocabulary for;
 * - `shapeChanged` and the `--json` summary keys, which are the contract the
 *   scheduled workflow branches on.
 */
import { describe, test, expect } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  adoptShapeIdenticalDrift,
  buildCheckResultSummary,
  checkForDrift,
  isProvenanceOnlyFixtureChange,
  regenerate,
  withPinnedCommit,
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
    // The field the scheduled workflow branches on: an added member routes to
    // a maintainer, never to the auto-adopt step.
    expect(result.shapeChanged).toBe(true);

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

const SOURCE_COMMIT = 'e8ab93aca9dcb062ad042380341762b019c4a488';

/**
 * The fixture a given declaration produces, taken from the pipeline itself
 * rather than hand-written. Lets a gate test say "upstream used to declare
 * THIS and now declares THAT" and compare what the real extractor makes of
 * each, instead of asserting against a fixture literal that could drift from
 * what `reference-normalize.mjs` actually emits.
 */
async function fixtureJsonFor(declarationText: string): Promise<string> {
  const result = await checkForDrift({
    version: UNPINNED_VERSION,
    fetchImpl: fakeNpmFetch({ version: UNPINNED_VERSION, declarationText }),
    existingFixtureJson: null,
    existingProvenance: null,
  });
  return result.fixtureJson;
}

async function adoptAfterUpstreamChange(previousDeclaration: string, nextDeclaration: string) {
  return adoptShapeIdenticalDrift({
    version: UNPINNED_VERSION,
    fetchImpl: fakeAdoptFetch({
      version: UNPINNED_VERSION,
      declarationText: nextDeclaration,
      sourceCommit: SOURCE_COMMIT,
    }),
    existingFixtureJson: await fixtureJsonFor(previousDeclaration),
  });
}

/**
 * Each pair changes one fact about the API and nothing else. Every one of them
 * must refuse. The last three are the reason the gate compares canonical
 * fixture bytes instead of asking `diffReferenceFixtures`: that diff has no
 * vocabulary for them, so a gate built on it would call them "no differences"
 * and adopt a Word API change with no maintainer in the loop.
 */
const REFUSABLE_UPSTREAM_CHANGES: {
  what: string;
  previous: string;
  next: string;
}[] = [
  {
    what: 'a member added',
    previous: 'declare namespace Word { class Body { readonly text: string; } }',
    next: 'declare namespace Word { class Body { readonly text: string; clear(): void; } }',
  },
  {
    what: 'a member removed',
    previous: 'declare namespace Word { class Body { readonly text: string; clear(): void; } }',
    next: 'declare namespace Word { class Body { readonly text: string; } }',
  },
  {
    what: 'a whole symbol added',
    previous: 'declare namespace Word { class Body { readonly text: string; } }',
    next: `declare namespace Word {
      class Body { readonly text: string; }
      class Paragraph { readonly text: string; }
    }`,
  },
  {
    what: 'a whole symbol removed',
    previous: `declare namespace Word {
      class Body { readonly text: string; }
      class Paragraph { readonly text: string; }
    }`,
    next: 'declare namespace Word { class Body { readonly text: string; } }',
  },
  {
    what: "a symbol's own requirement set moved",
    previous: `declare namespace Word {
      /** [Api set: WordApi 1.1] */
      class Body { readonly text: string; }
    }`,
    next: `declare namespace Word {
      /** [Api set: WordApi 1.9] */
      class Body { readonly text: string; }
    }`,
  },
  {
    what: 'a property became a method of the same call shape',
    previous: 'declare namespace Word { class Body { style: string; } }',
    next: 'declare namespace Word { class Body { style(): string; } }',
  },
  {
    what: 'a parameter was renamed',
    previous: 'declare namespace Word { class Body { insertText(text: string): void; } }',
    next: 'declare namespace Word { class Body { insertText(value: string): void; } }',
  },
];

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

    // The fixture it hands back is the regenerated one, carrying the new
    // version — returning the old bytes would ship a PR whose two files
    // disagree about which release is checked in.
    const fixture = JSON.parse(result.fixtureJson);
    expect(fixture.generatedFrom.version).toBe(UNPINNED_VERSION);
    expect(Object.keys(fixture.symbols)).toEqual(['Body']);
  });

  test('keeps a maintainer-reviewed pin instead of re-resolving it', async () => {
    const reviewedCommit = '929735ef7d8bafb29c17e39b26042ada8529e670';
    const result = await adoptShapeIdenticalDrift({
      version: UNPINNED_VERSION,
      fetchImpl: fakeAdoptFetch({
        version: UNPINNED_VERSION,
        declarationText: SHAPE_IDENTICAL_DECLARATION,
        // A different commit is on offer from the resolver; it must not win.
        sourceCommit: SOURCE_COMMIT,
      }),
      existingFixtureJson: `${JSON.stringify(PREVIOUS_FIXTURE, null, 2)}\n`,
      existingPins: { [UNPINNED_VERSION]: reviewedCommit },
    });

    expect(result.adopted).toBe(true);
    expect(result.commitWasPinned).toBe(true);
    expect(result.definitelyTypedCommit).toBe(reviewedCommit);
    expect(JSON.parse(result.provenanceJson).upstreamPackage.sourceRepository.commit).toBe(
      reviewedCommit
    );
  });

  for (const { what, previous, next } of REFUSABLE_UPSTREAM_CHANGES) {
    test(`refuses to adopt when ${what}`, async () => {
      const result = await adoptAfterUpstreamChange(previous, next);

      expect(result.adopted).toBe(false);
      expect(result.reason).toBe('shape-changed');
      // Nothing adoptable is produced, so nothing can be written by mistake.
      expect(result.provenanceJson).toBeUndefined();
      expect(result.fixtureJson).toBeUndefined();
    });
  }

  test('names the change in the report when the symbol/member delta can express it', async () => {
    const result = await adoptAfterUpstreamChange(
      'declare namespace Word { class Body { readonly text: string; } }',
      'declare namespace Word { class Body { readonly text: string; clear(): void; } }'
    );
    expect(result.diffSummary).toContain('Word.Body#clear');
    expect(result.diffSummary).toMatch(/added/i);
    // The delta explained it, so the "differs beyond" footnote must stay off.
    expect(result.diffSummary).not.toContain('differs beyond the upstream version string');
  });

  test('names a whole symbol appearing or disappearing, without the cannot-express footnote', async () => {
    const twoSymbols = `declare namespace Word {
      class Body { readonly text: string; }
      class Paragraph { readonly text: string; }
    }`;
    const oneSymbol = 'declare namespace Word { class Body { readonly text: string; } }';

    const added = await adoptAfterUpstreamChange(oneSymbol, twoSymbols);
    expect(added.diffSummary).toContain('Word.Paragraph');
    expect(added.diffSummary).not.toContain('differs beyond the upstream version string');

    const removed = await adoptAfterUpstreamChange(twoSymbols, oneSymbol);
    expect(removed.diffSummary).toContain('Word.Paragraph');
    expect(removed.diffSummary).not.toContain('differs beyond the upstream version string');
  });

  test('says so plainly when the delta cannot express the change, instead of printing "no differences"', async () => {
    const result = await adoptAfterUpstreamChange(
      'declare namespace Word { class Body { insertText(text: string): void; } }',
      'declare namespace Word { class Body { insertText(value: string): void; } }'
    );
    expect(result.adopted).toBe(false);
    expect(result.diffSummary).toContain('differs beyond the upstream version string');
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

describe('the version string npm hands back', () => {
  // It reaches a $GITHUB_OUTPUT line, a branch name, a commit message and a
  // PR title. A newline in it would inject a second key=value pair into the
  // workflow's own decision output — including the one that unlocks writing.
  test('is refused when it could not be a version', async () => {
    const hostileVersion = '1.0.605\nshape_changed=false';
    await expect(
      checkForDrift({
        version: hostileVersion,
        fetchImpl: fakeNpmFetch({
          version: hostileVersion,
          declarationText: SHAPE_IDENTICAL_DECLARATION,
        }),
        existingFixtureJson: null,
        existingProvenance: null,
      })
    ).rejects.toThrow(/unusable @types\/office-js version string/);
  });

  test('accepts an ordinary release, prerelease and build-metadata version', async () => {
    // Deliberately versions with no reviewed pin, so this exercises the
    // version check without also reaching for the docs-reference commit.
    for (const version of ['9.9.9', '9.9.9-beta.1', '9.9.9+build.7']) {
      const result = await checkForDrift({
        version,
        fetchImpl: fakeNpmFetch({ version, declarationText: SHAPE_IDENTICAL_DECLARATION }),
        existingFixtureJson: null,
        existingProvenance: null,
      });
      expect(result.upstreamVersion).toBe(version);
    }
  });
});

describe('the adoption gate itself', () => {
  const fixture = {
    schemaVersion: 1,
    generatedFrom: { package: '@types/office-js', version: '1.0.604' },
    symbols: {
      Body: {
        uid: 'Word.Body',
        kind: 'class',
        requirementSet: 'WordApi 1.1',
        members: {
          insertText: {
            uid: 'Word.Body#insertText',
            kind: 'method',
            requirementSet: 'WordApi 1.1',
            overloads: [
              { params: [{ name: 'text', type: 'string' }], returns: 'void' },
              { params: [], returns: 'void' },
            ],
          },
        },
      },
    },
  };
  const clone = () => JSON.parse(JSON.stringify(fixture));

  test('a moved version string alone is provenance-only', () => {
    const next = clone();
    next.generatedFrom.version = '1.0.605';
    expect(isProvenanceOnlyFixtureChange(fixture, next)).toBe(true);
  });

  test('key order is not a difference', () => {
    const next = {
      symbols: clone().symbols,
      generatedFrom: { version: '1.0.605', package: '@types/office-js' },
      schemaVersion: 1,
    };
    expect(isProvenanceOnlyFixtureChange(fixture, next)).toBe(true);
  });

  test('reordered overloads are a difference, even though the set is the same', () => {
    const next = clone();
    next.symbols.Body.members.insertText.overloads.reverse();
    expect(isProvenanceOnlyFixtureChange(fixture, next)).toBe(false);
  });

  test('a changed uid is a difference', () => {
    const next = clone();
    next.symbols.Body.uid = 'Word.Body2';
    expect(isProvenanceOnlyFixtureChange(fixture, next)).toBe(false);
  });

  test('a missing previous fixture is a difference, so nothing adopts into the unknown', () => {
    expect(isProvenanceOnlyFixtureChange(null, fixture)).toBe(false);
    expect(isProvenanceOnlyFixtureChange({ symbols: {} }, fixture)).toBe(false);
  });
});

describe('buildCheckResultSummary() (the JSON contract the workflow branches on)', () => {
  test('emits exactly the four keys the workflow reads', () => {
    const summary = buildCheckResultSummary({
      driftDetected: true,
      shapeChanged: false,
      upstreamVersion: '1.0.605',
      reviewRequired: true,
    });
    expect(Object.keys(summary).sort()).toEqual([
      'driftDetected',
      'reviewRequired',
      'shapeChanged',
      'upstreamVersion',
    ]);
    expect(summary).toEqual({
      driftDetected: true,
      shapeChanged: false,
      upstreamVersion: '1.0.605',
      reviewRequired: true,
    });
  });

  test('fails closed: only an explicit false unlocks automatic adoption', () => {
    // A future return path that forgets the field must route to a maintainer,
    // never to the step that writes.
    expect(buildCheckResultSummary({ driftDetected: true }).shapeChanged).toBe(true);
    expect(buildCheckResultSummary({ driftDetected: true, shapeChanged: null }).shapeChanged).toBe(
      true
    );
    expect(buildCheckResultSummary({ driftDetected: true, shapeChanged: false }).shapeChanged).toBe(
      false
    );
  });
});

describe('withPinnedCommit()', () => {
  test('adds the entry and keeps every field that documents what a pin means', () => {
    const before = {
      schemaVersion: 1,
      package: '@types/office-js',
      note: 'what an entry here means',
      commits: { '1.0.604': '929735ef7d8bafb29c17e39b26042ada8529e670' },
    };

    const after = withPinnedCommit(before, '1.0.605', 'e8ab93aca9dcb062ad042380341762b019c4a488');

    expect(after).toEqual({
      schemaVersion: 1,
      package: '@types/office-js',
      note: 'what an entry here means',
      commits: {
        '1.0.604': '929735ef7d8bafb29c17e39b26042ada8529e670',
        '1.0.605': 'e8ab93aca9dcb062ad042380341762b019c4a488',
      },
    });
    // Pure: the caller's object is untouched.
    expect(Object.keys(before.commits)).toEqual(['1.0.604']);
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
