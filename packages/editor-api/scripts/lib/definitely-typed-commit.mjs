/**
 * Resolves which `DefinitelyTyped/DefinitelyTyped` commit produced a
 * published `@types/office-js` release, by **proof rather than trust**: the
 * answer is only accepted when the repository's `types/office-js/index.d.ts`
 * at that commit is byte-identical to the `index.d.ts` inside the
 * integrity-verified npm tarball.
 *
 * npm's registry metadata for `@types/*` records the repository and
 * directory but no `gitHead`, so the source commit cannot simply be read
 * off a published release. Before this module the only way to fill
 * `provenance.json`'s `sourceRepository.commit` was a maintainer finding it
 * by hand and writing it into `compat/definitely-typed-commits.json`. The
 * comparison here is the same fact a maintainer was establishing by hand,
 * done as a check a machine can repeat: git's own blob hash of the tarball
 * bytes against the blob hash GitHub reports for the file at a candidate
 * commit. A wrong or renamed commit cannot pass it.
 *
 * Network-only, like `docs-reference.mjs`: reached exclusively from
 * `scripts/fetch-office-reference.mjs`, never from `bun test` /
 * `typecheck` / `build` / `install`.
 */

import { createHash } from 'node:crypto';

export const DEFINITELY_TYPED_REPOSITORY = 'DefinitelyTyped/DefinitelyTyped';
export const DEFINITELY_TYPED_DIRECTORY = 'types/office-js';
export const DECLARATION_FILE_NAME = 'index.d.ts';

/** How many commits touching `types/office-js` to walk before giving up. */
const DEFAULT_MAX_COMMITS = 15;

/**
 * Git's object id for a blob: `sha1("blob <byteLength>\0" + bytes)`. This is
 * exactly what `git hash-object` prints and what the GitHub contents API
 * returns as an entry's `sha`, which is what makes the two sides comparable
 * without downloading an 8 MB file from GitHub as well.
 */
export function gitBlobSha(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash('sha1')
    .update(`blob ${buffer.length}\0`)
    .update(buffer)
    .digest('hex');
}

/**
 * Thrown when no candidate commit carries the published bytes. A distinct
 * class so callers can tell "upstream moved in a way this resolver cannot
 * explain — a maintainer must look" apart from a network or API failure.
 * Both still abort; only the message differs.
 */
export class UnresolvedDefinitelyTypedCommitError extends Error {
  constructor(version, blobSha, searchedCommits) {
    super(
      `No ${DEFINITELY_TYPED_REPOSITORY} commit in the last ${searchedCommits} touching ` +
        `${DEFINITELY_TYPED_DIRECTORY} has an ${DECLARATION_FILE_NAME} matching the published ` +
        `@types/office-js@${version} tarball (git blob ${blobSha}). Resolve the source commit by ` +
        'hand and add it to compat/definitely-typed-commits.json.'
    );
    this.name = 'UnresolvedDefinitelyTypedCommitError';
    this.version = version;
    this.blobSha = blobSha;
  }
}

function githubHeaders(githubToken) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'docx-editor-office-compat-drift-check',
  };
  // The scheduled workflow passes its token: this resolver spends one API
  // call per candidate commit, and the unauthenticated 60/hour limit is
  // shared across every job on a runner's IP.
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  return headers;
}

async function githubJson(url, { fetchImpl, githubToken }) {
  const response = await fetchImpl(url, { headers: githubHeaders(githubToken) });
  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText} (${url})`);
  }
  return response.json();
}

/**
 * Walks the commits that touched `types/office-js`, newest first, and
 * returns the first one whose `index.d.ts` blob matches `declaration`.
 *
 * Newest-first is deliberate. Two commits can share an identical
 * `index.d.ts` (a commit that only edits tests or `package.json` still
 * triggers a republish), so "the newest commit carrying these exact bytes"
 * is the one the release was cut from — this resolver only ever runs for
 * the release currently on the `latest` dist-tag.
 *
 * @param {Buffer} params.declaration `index.d.ts` bytes from the verified tarball.
 * @returns `{ commit, blobSha, commitDate, htmlUrl }`
 */
export async function resolveDefinitelyTypedCommitFromSource({
  version,
  declaration,
  fetchImpl = fetch,
  githubToken = null,
  maxCommits = DEFAULT_MAX_COMMITS,
} = {}) {
  const blobSha = gitBlobSha(declaration);

  const commits = await githubJson(
    `https://api.github.com/repos/${DEFINITELY_TYPED_REPOSITORY}/commits` +
      `?path=${encodeURIComponent(DEFINITELY_TYPED_DIRECTORY)}&per_page=${maxCommits}`,
    { fetchImpl, githubToken }
  );
  if (!Array.isArray(commits) || commits.length === 0) {
    throw new Error(
      `GitHub API returned no commits touching ${DEFINITELY_TYPED_DIRECTORY} in ${DEFINITELY_TYPED_REPOSITORY}`
    );
  }

  for (const candidate of commits) {
    // Listing the directory costs one small response and still reports each
    // entry's blob sha; fetching the 8 MB file itself would prove the same
    // thing far more expensively.
    const entries = await githubJson(
      `https://api.github.com/repos/${DEFINITELY_TYPED_REPOSITORY}/contents/` +
        `${DEFINITELY_TYPED_DIRECTORY}?ref=${candidate.sha}`,
      { fetchImpl, githubToken }
    );
    if (!Array.isArray(entries)) continue;
    const declarationEntry = entries.find((entry) => entry.name === DECLARATION_FILE_NAME);
    if (declarationEntry?.sha !== blobSha) continue;

    return {
      commit: candidate.sha,
      blobSha,
      commitDate: candidate.commit?.committer?.date ?? null,
      htmlUrl: candidate.html_url ?? null,
    };
  }

  throw new UnresolvedDefinitelyTypedCommitError(version, blobSha, commits.length);
}
