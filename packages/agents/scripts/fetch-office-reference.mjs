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
 * `packages/agents/compat/README.md` for the offline-CI guarantee.
 *
 * ## What this does NOT do
 *
 * It never writes Microsoft's declaration *source* to the repository —
 * only the normalized facts (symbol/member names, parameter/return
 * shapes, requirement sets, upstream UIDs) that `extractWordReference`
 * pulls out of it, plus provenance for exactly what was fetched.
 *
 * Usage:
 *   node scripts/fetch-office-reference.mjs [--version <semver>] [--check]
 *
 *   --version <semver>  Pin a specific @types/office-js version instead of
 *                        the current "latest" dist-tag.
 *   --check             Regenerate into a temp comparison file and exit
 *                        non-zero if it differs from the checked-in
 *                        fixture, without overwriting anything (used by the
 *                        scheduled drift-check workflow).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { verifySubresourceIntegrity } from './lib/integrity.mjs';
import { extractFileFromTarGzip } from './lib/tar.mjs';
import { extractWordReference } from './lib/extract-word-reference.mjs';
import { buildReferenceFixture, validateReferenceFixture } from './lib/reference-normalize.mjs';
import { buildProvenance, validateProvenance } from './lib/provenance.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(AGENTS_ROOT, 'compat', 'manifest.json');
const REFERENCE_PATH = join(AGENTS_ROOT, 'compat', 'reference', 'word.reference.json');
const PROVENANCE_PATH = join(AGENTS_ROOT, 'compat', 'provenance.json');

const REGISTRY_URL = 'https://registry.npmjs.org/@types/office-js';
const PACKAGE_NAME = '@types/office-js';

async function fetchRegistryMetadata(version) {
  const url = version ? `${REGISTRY_URL}/${version}` : `${REGISTRY_URL}/latest`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`npm registry request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchTarball(tarballUrl) {
  const response = await fetch(tarballUrl);
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
 * Performs the full fetch -> verify -> extract -> normalize pipeline and
 * returns `{ fixture, provenance }` without writing anything to disk. Kept
 * separate from `main()` so the `--check` mode can diff in memory.
 */
export async function regenerate({ version, fetchedAt = new Date().toISOString() } = {}) {
  const registryMetadata = await fetchRegistryMetadata(version);
  const upstreamPackage = {
    name: PACKAGE_NAME,
    version: registryMetadata.version,
    integrity: registryMetadata.dist.integrity,
    shasum: registryMetadata.dist.shasum,
    tarballUrl: registryMetadata.dist.tarball,
    typesPublisherContentHash: registryMetadata.typesPublisherContentHash ?? null,
    sourceRepository: registryMetadata.repository ?? null,
    license: registryMetadata.license ?? 'MIT',
  };

  const tarballBuffer = await fetchTarball(upstreamPackage.tarballUrl);
  if (!verifySubresourceIntegrity(tarballBuffer, upstreamPackage.integrity)) {
    throw new Error(
      `integrity mismatch: downloaded ${PACKAGE_NAME}@${upstreamPackage.version} tarball does not match npm registry's dist.integrity`
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
    packageName: upstreamPackage.name,
    packageVersion: upstreamPackage.version,
    symbols: rawSymbols,
  });
  const fixtureErrors = validateReferenceFixture(fixture);
  if (fixtureErrors.length > 0) {
    throw new Error(`generated reference fixture failed validation:\n${fixtureErrors.join('\n')}`);
  }

  const provenance = buildProvenance({ upstreamPackage, fixture, fetchedAt });
  const provenanceErrors = validateProvenance(provenance);
  if (provenanceErrors.length > 0) {
    throw new Error(`generated provenance failed validation:\n${provenanceErrors.join('\n')}`);
  }

  return { fixture, provenance };
}

async function main() {
  const args = process.argv.slice(2);
  const versionIndex = args.indexOf('--version');
  const version = versionIndex >= 0 ? args[versionIndex + 1] : undefined;
  const checkOnly = args.includes('--check');

  const { fixture, provenance } = await regenerate({ version });
  const fixtureJson = `${JSON.stringify(fixture, null, 2)}\n`;
  const provenanceJson = `${JSON.stringify(provenance, null, 2)}\n`;

  if (checkOnly) {
    const [existingFixture, existingProvenance] = await Promise.all([
      readFile(REFERENCE_PATH, 'utf8').catch(() => null),
      readFile(PROVENANCE_PATH, 'utf8').catch(() => null),
    ]);
    const fixtureChanged = existingFixture !== fixtureJson;
    const provenanceVersionChanged =
      existingProvenance == null ||
      JSON.parse(existingProvenance).upstreamPackage.version !== provenance.upstreamPackage.version;

    if (!fixtureChanged && !provenanceVersionChanged) {
      console.log('No drift detected: checked-in reference fixture is up to date.');
      return;
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'office-compat-drift-'));
    try {
      await writeFile(join(tempDir, 'word.reference.json'), fixtureJson);
      await writeFile(join(tempDir, 'provenance.json'), provenanceJson);
      console.log(`Drift detected. Regenerated files written to ${tempDir} for review.`);
      console.log(`Upstream version: ${provenance.upstreamPackage.version}`);
    } finally {
      // Leave the temp dir for CI to upload as an artifact; the caller's
      // process lifetime (a single scheduled job run) owns cleanup.
      void rm;
    }
    process.exitCode = 1;
    return;
  }

  await writeFile(REFERENCE_PATH, fixtureJson);
  await writeFile(PROVENANCE_PATH, provenanceJson);
  console.log(`Wrote ${REFERENCE_PATH}`);
  console.log(`Wrote ${PROVENANCE_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
