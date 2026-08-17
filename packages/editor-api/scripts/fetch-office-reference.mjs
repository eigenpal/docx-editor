#!/usr/bin/env node
/**
 * Fetches the current stable `@types/office-js` release, verifies its
 * integrity against the npm registry, extracts the manifest-selected
 * `Word.*` subset, and regenerates the checked-in normalized reference
 * fixture + provenance record.
 *
 * ## Network use
 *
 * This is the ONLY script in this task that touches the network. It is
 * invoked by the scheduled `.github/workflows/office-compat-drift.yml`
 * workflow, or manually by a maintainer — never by `bun test`, `bun run
 * typecheck`, `bun run build`, or `bun install`. See
 * `packages/editor-api/compat/README.md` for the offline-CI guarantee.
 *
 * ## What this does NOT do
 *
 * It never writes Microsoft's declaration *source* to the repository —
 * only the normalized facts (symbol/member names, parameter/return
 * shapes, requirement sets, upstream UIDs) that `extractWordReference`
 * pulls out of it, plus provenance for exactly what was fetched.
 *
 * Usage:
 *   node scripts/fetch-office-reference.mjs [--version <semver>] [--check|--adopt]
 *
 *   --version <semver>  Pin a specific @types/office-js version instead of
 *                        the current "latest" dist-tag.
 *   --check             Regenerate into a temp comparison file and exit
 *                        non-zero if it differs from the checked-in
 *                        fixture, without overwriting anything (used by the
 *                        scheduled drift-check workflow). Also prints a
 *                        symbol/member-level delta (added/removed/changed
 *                        symbols and members, including overload-level
 *                        changes) via `reference-diff.mjs`, which the
 *                        scheduled workflow embeds in the drift issue body.
 *   --json <path>       With `--check`, also write that result as JSON, so
 *                        the workflow can branch on it instead of parsing
 *                        prose out of stdout.
 *   --adopt             Adopt a *shape-identical* upstream release: only the
 *                        version string and provenance move, so there is
 *                        nothing about the API for a human to review. Writes
 *                        the fixture, the provenance record, and the newly
 *                        resolved source-commit pin. Refuses (exit 1) the
 *                        moment any symbol or member differs.
 *
 * ## Which drift a machine may adopt
 *
 * `compat/definitely-typed-commits.json` records the reviewed DefinitelyTyped
 * source commit for each adopted @types/office-js version. A version bump is
 * how real upstream drift arrives, so `--check` must be able to fetch,
 * extract, and diff a brand-new, not-yet-adopted version — it never skips or
 * aborts before computing the delta just because no one has reviewed it yet
 * (see `checkForDrift`).
 *
 * The write paths are stricter, and split by what actually changed:
 *
 * - `regenerate` (plain `node fetch-office-reference.mjs` /
 *   `compat:fetch-reference`) hard-fails for a version with no pin. It
 *   overwrites the checked-in, trusted `compat/reference/word.reference.json`
 *   and `compat/provenance.json`, so it may never turn an unreviewed release
 *   into trusted committed input.
 * - `adoptShapeIdenticalDrift` (`--adopt`) is the one path that may resolve a
 *   pin on its own, and only for a release whose manifest-selected shape is
 *   byte-identical to what is already checked in. The pin it writes is proved,
 *   not assumed: `definitely-typed-commit.mjs` accepts a commit only when that
 *   commit's `index.d.ts` matches the integrity-verified tarball's bytes. When
 *   any symbol or member moved, the delta is a fact about the API and this
 *   path refuses, leaving the scheduled workflow to open a review issue.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { verifySubresourceIntegrity } from './lib/integrity.mjs';
import { extractFileFromTarGzip } from './lib/tar.mjs';
import { extractWordReference } from './lib/extract-word-reference.mjs';
import { buildReferenceFixture, validateReferenceFixture } from './lib/reference-normalize.mjs';
import { buildProvenance, validateProvenance } from './lib/provenance.mjs';
import {
  PINNED_DOCS_REFERENCE_COMMIT,
  fetchDocsReferenceCommitMetadata,
} from './lib/docs-reference.mjs';
import { diffReferenceFixtures, formatReferenceDiff } from './lib/reference-diff.mjs';
import { resolveDefinitelyTypedCommitFromSource } from './lib/definitely-typed-commit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(PACKAGE_ROOT, 'compat', 'manifest.json');
const REFERENCE_PATH = join(PACKAGE_ROOT, 'compat', 'reference', 'word.reference.json');
const PROVENANCE_PATH = join(PACKAGE_ROOT, 'compat', 'provenance.json');
const PINNED_COMMITS_PATH = join(PACKAGE_ROOT, 'compat', 'definitely-typed-commits.json');

const REGISTRY_URL = 'https://registry.npmjs.org/@types/office-js';
const PACKAGE_NAME = '@types/office-js';

async function fetchRegistryMetadata(version, fetchImpl) {
  const url = version ? `${REGISTRY_URL}/${version}` : `${REGISTRY_URL}/latest`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`npm registry request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchTarball(tarballUrl, fetchImpl) {
  const response = await fetchImpl(tarballUrl);
  if (!response.ok) {
    throw new Error(`tarball download failed: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function loadManifest() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const manifestSymbols = {};
  for (const [name, selection] of Object.entries(manifest.symbols)) {
    manifestSymbols[name] = selection;
  }
  return manifestSymbols;
}

/**
 * Thrown by `buildProvenanceForFixture` when the fetched version has no
 * reviewed source-commit pin yet. A distinct class (rather than a plain
 * `Error`) so `checkForDrift` can distinguish "this version just hasn't been
 * reviewed yet" (report as review-required drift, still show the delta) from
 * every other failure mode — a corrupt tarball, a validation bug, a real
 * integrity mismatch — which must keep failing loudly, not be silently
 * reclassified as "review required".
 */
export class MissingDefinitelyTypedCommitError extends Error {
  constructor(version) {
    super(
      `No reviewed DefinitelyTyped commit is pinned for ${PACKAGE_NAME}@${version}. ` +
        'Add the exact source commit before regenerating or adopting upstream drift.'
    );
    this.name = 'MissingDefinitelyTypedCommitError';
    this.version = version;
  }
}

/**
 * The reviewed pins live in `compat/definitely-typed-commits.json` rather
 * than in this file: `--adopt` writes an entry, and data a script edits
 * belongs in data, not in the script's own source.
 */
async function loadPinnedCommits() {
  const raw = await readFile(PINNED_COMMITS_PATH, 'utf8');
  return JSON.parse(raw).commits ?? {};
}

async function writePinnedCommit(version, commit) {
  const pins = JSON.parse(await readFile(PINNED_COMMITS_PATH, 'utf8'));
  pins.commits = { ...pins.commits, [version]: commit };
  await writeFile(PINNED_COMMITS_PATH, `${JSON.stringify(pins, null, 2)}\n`);
}

async function resolvePinnedCommit(version) {
  const pins = await loadPinnedCommits();
  return pins[version] ?? null;
}

/**
 * Fetch -> verify -> extract -> normalize, stopping short of anything that
 * requires a reviewed source-commit pin. This is the
 * part of the pipeline that must succeed for *any* published version,
 * reviewed or not — it's what lets `checkForDrift` compute a real delta for
 * a brand-new version before a maintainer has pinned its source commit.
 */
async function fetchAndBuildFixture({ version, fetchImpl }) {
  const registryMetadata = await fetchRegistryMetadata(version, fetchImpl);
  const upstreamPackageBase = {
    name: PACKAGE_NAME,
    version: registryMetadata.version,
    integrity: registryMetadata.dist.integrity,
    shasum: registryMetadata.dist.shasum,
    tarballUrl: registryMetadata.dist.tarball,
    typesPublisherContentHash: registryMetadata.typesPublisherContentHash ?? null,
    sourceRepositoryRaw: registryMetadata.repository ?? null,
    license: registryMetadata.license ?? 'MIT',
  };

  const tarballBuffer = await fetchTarball(upstreamPackageBase.tarballUrl, fetchImpl);
  if (!verifySubresourceIntegrity(tarballBuffer, upstreamPackageBase.integrity)) {
    throw new Error(
      `integrity mismatch: downloaded ${PACKAGE_NAME}@${upstreamPackageBase.version} tarball does not match npm registry's dist.integrity`
    );
  }

  const declarationBuffer = extractFileFromTarGzip(tarballBuffer, 'index.d.ts');
  if (!declarationBuffer) {
    throw new Error('index.d.ts not found inside the verified tarball');
  }
  const declarationText = declarationBuffer.toString('utf8');

  const manifestSymbols = await loadManifest();
  const rawSymbols = extractWordReference(declarationText, manifestSymbols);

  const fixture = buildReferenceFixture({
    packageName: upstreamPackageBase.name,
    packageVersion: upstreamPackageBase.version,
    symbols: rawSymbols,
  });
  const fixtureErrors = validateReferenceFixture(fixture);
  if (fixtureErrors.length > 0) {
    throw new Error(`generated reference fixture failed validation:\n${fixtureErrors.join('\n')}`);
  }

  return { upstreamPackageBase, fixture, declarationBuffer };
}

/**
 * Completes the pipeline into a validated, adoptable `provenance` record.
 * Throws `MissingDefinitelyTypedCommitError` (not a generic `Error`) when
 * `upstreamPackageBase.version` has no reviewed source-commit pin and the
 * caller supplied none — the one failure mode `checkForDrift` treats as
 * "review required" rather than a hard abort; every other failure here
 * (docs-reference commit unreachable, provenance shape invalid) still
 * propagates as a normal thrown `Error`.
 *
 * `commit` is the escape hatch for `adoptShapeIdenticalDrift`, which has
 * just proved a commit against the published bytes and is about to write it
 * to the pin file — it may pass that commit here rather than round-trip
 * through the file it is in the middle of updating.
 */
async function buildProvenanceForFixture({
  upstreamPackageBase,
  fixture,
  fetchedAt,
  fetchImpl,
  commit = null,
}) {
  const definitelyTypedCommit = commit ?? (await resolvePinnedCommit(upstreamPackageBase.version));
  if (!definitelyTypedCommit) {
    throw new MissingDefinitelyTypedCommitError(upstreamPackageBase.version);
  }

  const { sourceRepositoryRaw, ...upstreamPackageRest } = upstreamPackageBase;
  const upstreamPackage = {
    ...upstreamPackageRest,
    sourceRepository: sourceRepositoryRaw
      ? {
          ...sourceRepositoryRaw,
          commit: definitelyTypedCommit,
          sourceUrl: `https://github.com/DefinitelyTyped/DefinitelyTyped/tree/${definitelyTypedCommit}/types/office-js`,
        }
      : null,
  };

  // Second (and only other) network call this script makes: verifies the
  // pinned `office-js-docs-reference` commit is still reachable and
  // records its metadata, exactly as it verifies the `@types/office-js`
  // tarball above. Never invoked outside this network-capable script, so
  // `bun test`/`typecheck`/`build`/`install` stay offline.
  const docsReference = await fetchDocsReferenceCommitMetadata(PINNED_DOCS_REFERENCE_COMMIT, {
    fetchImpl,
  });

  const provenance = buildProvenance({ upstreamPackage, fixture, fetchedAt, docsReference });
  const provenanceErrors = validateProvenance(provenance);
  if (provenanceErrors.length > 0) {
    throw new Error(`generated provenance failed validation:\n${provenanceErrors.join('\n')}`);
  }
  return provenance;
}

/**
 * Performs the full fetch -> verify -> extract -> normalize -> provenance
 * pipeline and returns `{ fixture, provenance }` without writing anything
 * to disk. This is the **write path**: used by plain `node
 * fetch-office-reference.mjs` (`compat:fetch-reference`), which overwrites
 * the checked-in `compat/reference/word.reference.json` and
 * `compat/provenance.json`. It deliberately still hard-fails for an
 * unpinned version (via `buildProvenanceForFixture`) — unlike
 * `checkForDrift` below, nothing here may ever turn unreviewed upstream
 * data into trusted committed input.
 */
export async function regenerate({
  version,
  fetchedAt = new Date().toISOString(),
  fetchImpl = fetch,
} = {}) {
  const { upstreamPackageBase, fixture } = await fetchAndBuildFixture({ version, fetchImpl });
  const provenance = await buildProvenanceForFixture({
    upstreamPackageBase,
    fixture,
    fetchedAt,
    fetchImpl,
  });
  return { fixture, provenance };
}

/** True when any symbol or member moved — the delta a human has to read. */
function hasShapeChanges(diff) {
  return (
    diff.addedSymbols.length > 0 ||
    diff.removedSymbols.length > 0 ||
    diff.changedSymbols.length > 0
  );
}

/**
 * The **check path**, used by `--check`/`compat:check-drift`. Unlike
 * `regenerate`, this never overwrites the checked-in fixture and never
 * needs a reviewed source-commit pin to do its job:
 * it always fetches and normalizes whatever version is currently published
 * (reviewed or not) and always computes the full symbol/member-level delta
 * against the checked-in fixture, because a version bump — not just a
 * changed reference for an already-pinned version — is how real drift
 * arrives. When the fetched version has no reviewed commit pin,
 * `reviewRequired` is set and `provenance`/`provenanceJson` are `null`
 * instead of a hard throw — the delta is still complete and safe to
 * review, it just isn't (yet) adoptable as committed provenance.
 *
 * @param {object} existingProvenance Parsed `compat/provenance.json`
 *   contents, or `null` if it doesn't exist yet.
 */
export async function checkForDrift({
  version,
  fetchedAt = new Date().toISOString(),
  fetchImpl = fetch,
  existingFixtureJson,
  existingProvenance,
} = {}) {
  const { upstreamPackageBase, fixture } = await fetchAndBuildFixture({ version, fetchImpl });
  const fixtureJson = `${JSON.stringify(fixture, null, 2)}\n`;

  const fixtureChanged = existingFixtureJson !== fixtureJson;
  const provenanceVersionChanged =
    existingProvenance == null ||
    existingProvenance.upstreamPackage?.version !== upstreamPackageBase.version;

  if (!fixtureChanged && !provenanceVersionChanged) {
    return {
      driftDetected: false,
      shapeChanged: false,
      upstreamVersion: upstreamPackageBase.version,
    };
  }

  const previousFixture =
    existingFixtureJson != null ? JSON.parse(existingFixtureJson) : { symbols: {} };
  const diff = diffReferenceFixtures(previousFixture, fixture);
  const diffSummary = formatReferenceDiff(diff);

  let provenance = null;
  let reviewRequired = false;
  let reviewReason = null;
  try {
    provenance = await buildProvenanceForFixture({
      upstreamPackageBase,
      fixture,
      fetchedAt,
      fetchImpl,
    });
  } catch (error) {
    if (!(error instanceof MissingDefinitelyTypedCommitError)) {
      throw error; // real failures (integrity, validation, network) still abort loudly
    }
    reviewRequired = true;
    reviewReason = error.message;
  }

  return {
    driftDetected: true,
    shapeChanged: hasShapeChanges(diff),
    upstreamVersion: upstreamPackageBase.version,
    fixture,
    fixtureJson,
    diff,
    diffSummary,
    provenance,
    provenanceJson: provenance ? `${JSON.stringify(provenance, null, 2)}\n` : null,
    reviewRequired,
    reviewReason,
  };
}

/**
 * The **adopt path**, used by `--adopt`/`compat:adopt` and by the scheduled
 * workflow when the drift carries no shape change. It is the write path for
 * exactly one situation: upstream published a new version whose
 * manifest-selected shape is identical to the checked-in fixture, so the only
 * thing that moved is provenance — the version string, the tarball hash, the
 * source commit.
 *
 * Two guards keep this honest. It refuses the moment `diffReferenceFixtures`
 * reports any added, removed, or changed symbol or member, because that delta
 * is a fact about the API that a person has to read. And the pin it resolves
 * is proved against the published bytes (see `definitely-typed-commit.mjs`),
 * never inferred from a branch ref or a publish date.
 *
 * Writes nothing itself; returns what `main` (or a test) should write.
 */
export async function adoptShapeIdenticalDrift({
  version,
  fetchedAt = new Date().toISOString(),
  fetchImpl = fetch,
  githubToken = null,
  existingFixtureJson,
} = {}) {
  const { upstreamPackageBase, fixture, declarationBuffer } = await fetchAndBuildFixture({
    version,
    fetchImpl,
  });
  const upstreamVersion = upstreamPackageBase.version;
  const fixtureJson = `${JSON.stringify(fixture, null, 2)}\n`;

  const previousFixture =
    existingFixtureJson != null ? JSON.parse(existingFixtureJson) : { symbols: {} };
  const diff = diffReferenceFixtures(previousFixture, fixture);
  const diffSummary = formatReferenceDiff(diff);

  if (hasShapeChanges(diff)) {
    return { adopted: false, reason: 'shape-changed', upstreamVersion, diff, diffSummary };
  }

  const pinnedCommit = await resolvePinnedCommit(upstreamVersion);
  const resolved = pinnedCommit
    ? { commit: pinnedCommit, blobSha: null }
    : await resolveDefinitelyTypedCommitFromSource({
        version: upstreamVersion,
        declaration: declarationBuffer,
        fetchImpl,
        githubToken,
      });

  const provenance = await buildProvenanceForFixture({
    upstreamPackageBase,
    fixture,
    fetchedAt,
    fetchImpl,
    commit: resolved.commit,
  });

  return {
    adopted: true,
    upstreamVersion,
    definitelyTypedCommit: resolved.commit,
    commitWasPinned: Boolean(pinnedCommit),
    declarationBlobSha: resolved.blobSha,
    diff,
    diffSummary,
    fixtureJson,
    provenanceJson: `${JSON.stringify(provenance, null, 2)}\n`,
  };
}

async function readCheckedInFixture() {
  return readFile(REFERENCE_PATH, 'utf8').catch(() => null);
}

/**
 * Machine-readable twin of what `--check` prints. The scheduled workflow
 * branches on `shapeChanged` (auto-adopt vs open a review issue), and
 * reading that decision out of a JSON file beats grepping prose out of a
 * stdout stream whose wording is meant for people.
 */
async function writeCheckResultJson(path, result) {
  const summary = {
    driftDetected: Boolean(result.driftDetected),
    shapeChanged: Boolean(result.shapeChanged),
    upstreamVersion: result.upstreamVersion,
    reviewRequired: Boolean(result.reviewRequired),
  };
  await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`);
}

async function adopt({ version }) {
  const result = await adoptShapeIdenticalDrift({
    version,
    githubToken: process.env.GITHUB_TOKEN ?? null,
    existingFixtureJson: await readCheckedInFixture(),
  });

  if (!result.adopted) {
    console.error(
      `Refusing to adopt ${PACKAGE_NAME}@${result.upstreamVersion} automatically: the ` +
        'manifest-selected shape changed, which needs a maintainer to review it.'
    );
    console.error('');
    console.error(result.diffSummary);
    process.exitCode = 1;
    return;
  }

  await writeFile(REFERENCE_PATH, result.fixtureJson);
  await writeFile(PROVENANCE_PATH, result.provenanceJson);
  if (!result.commitWasPinned) {
    await writePinnedCommit(result.upstreamVersion, result.definitelyTypedCommit);
  }

  console.log(`Adopted ${PACKAGE_NAME}@${result.upstreamVersion} (no symbol/member changes).`);
  console.log(
    `DefinitelyTyped commit: ${result.definitelyTypedCommit}` +
      (result.commitWasPinned
        ? ' (already pinned)'
        : ` (verified: index.d.ts git blob ${result.declarationBlobSha})`)
  );
  console.log(`Wrote ${REFERENCE_PATH}`);
  console.log(`Wrote ${PROVENANCE_PATH}`);
  if (!result.commitWasPinned) console.log(`Wrote ${PINNED_COMMITS_PATH}`);
}

async function main() {
  const args = process.argv.slice(2);
  const versionIndex = args.indexOf('--version');
  const version = versionIndex >= 0 ? args[versionIndex + 1] : undefined;
  const jsonIndex = args.indexOf('--json');
  const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : null;
  const checkOnly = args.includes('--check');

  if (args.includes('--adopt')) {
    await adopt({ version });
    return;
  }

  if (checkOnly) {
    const [existingFixtureJson, existingProvenanceRaw] = await Promise.all([
      readCheckedInFixture(),
      readFile(PROVENANCE_PATH, 'utf8').catch(() => null),
    ]);
    const existingProvenance =
      existingProvenanceRaw != null ? JSON.parse(existingProvenanceRaw) : null;

    const result = await checkForDrift({ version, existingFixtureJson, existingProvenance });
    if (jsonPath) await writeCheckResultJson(jsonPath, result);

    if (!result.driftDetected) {
      console.log('No drift detected: checked-in reference fixture is up to date.');
      return;
    }

    // The temp dir is deliberately left on disk (no cleanup call here): the
    // scheduled workflow uploads it as a build artifact, and the caller's
    // process lifetime — a single scheduled job run, or a maintainer's own
    // shell — owns removing it afterwards. `provenance.json` is only
    // written when one was actually produced: an unreviewed version has no
    // adoptable provenance yet (see `checkForDrift`), and writing a
    // half-built one here would risk it being mistaken for something a
    // maintainer could just copy into `compat/`.
    const tempDir = await mkdtemp(join(tmpdir(), 'office-compat-drift-'));
    await writeFile(join(tempDir, 'word.reference.json'), result.fixtureJson);
    if (result.provenanceJson) {
      await writeFile(join(tempDir, 'provenance.json'), result.provenanceJson);
    }
    console.log(`Drift detected. Regenerated files written to ${tempDir} for review.`);
    console.log(`Upstream version: ${result.upstreamVersion}`);
    if (result.reviewRequired) {
      console.log('');
      console.log(`REVIEW REQUIRED: ${result.reviewReason}`);
      console.log(
        'The symbol/member delta below is complete and safe to review, but this version must ' +
          'not be adopted into compat/provenance.json until its exact DefinitelyTyped source ' +
          'commit is recorded in compat/definitely-typed-commits.json — by `--adopt`, which ' +
          'proves the commit against the published bytes and only runs when nothing about the ' +
          'shape changed, or by a maintainer.'
      );
    }
    if (!result.shapeChanged) {
      console.log('');
      console.log(
        'This drift is provenance-only: no symbol or member moved, so `--adopt` can take it ' +
          'without a maintainer reading a delta.'
      );
    }
    console.log('');
    // The scheduled workflow captures this entire stdout stream into the
    // drift-tracking issue body (see .github/workflows/office-compat-drift.yml)
    // — without this, the issue only ever said "something changed", never
    // what.
    console.log('Symbol/member-level delta vs the checked-in reference fixture:');
    console.log(result.diffSummary);
    process.exitCode = 1;
    return;
  }

  const { fixture, provenance } = await regenerate({ version });
  await writeFile(REFERENCE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
  await writeFile(PROVENANCE_PATH, `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(`Wrote ${REFERENCE_PATH}`);
  console.log(`Wrote ${PROVENANCE_PATH}`);
}

// `file://${process.argv[1]}` (the pattern this repository's other entry
// guards used to use) mis-detects on any path npm/bun/node's own argv
// quoting doesn't happen to already be a clean file URL — spaces, `#`, `?`,
// and non-ASCII characters all encode differently in a real file URL than
// in a bare path string. `pathToFileURL` performs the same normalization
// Node used to construct `import.meta.url` in the first place, so the two
// sides compare correctly regardless of how this script's own path looks.
const isMainModule =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
