import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { json, sha } from './common.mjs';
import { registry, PUBLICATION_TIMEOUT_MS } from './registry.mjs';

export function readPublicationCandidate(directory) {
  const manifest = json(join(directory, 'candidate.json'));
  if (manifest.preview !== false || !Object.keys(manifest.packages ?? {}).length)
    throw new Error('Expected a nonempty publication candidate, not a preview');
  if (sha(readFileSync(join(directory, 'package-lock.json'))) !== manifest.lockHash)
    throw new Error('Candidate lock changed');
  for (const [name, expected] of Object.entries(manifest.packages)) {
    if (!expected.filename || basename(expected.filename) !== expected.filename)
      throw new Error(`Invalid candidate filename: ${name}`);
    const tarball = readFileSync(join(directory, expected.filename));
    const integrity = 'sha512-' + createHash('sha512').update(tarball).digest('base64');
    if (sha(tarball) !== expected.hash || integrity !== expected.integrity)
      throw new Error(`Candidate tarball changed: ${name}`);
  }
  return manifest;
}

export async function verifyPublication(
  manifest,
  {
    lookup = registry,
    now = Date.now,
    log = console.log,
    deadline = now() + PUBLICATION_TIMEOUT_MS,
  } = {}
) {
  const controller = new AbortController();
  try {
    await Promise.all(
      Object.entries(manifest.packages).map(async ([name, expected]) => {
        const published = await lookup(name, expected.version, {
          waitForPublication: true,
          deadline,
          signal: controller.signal,
        });
        if (
          published.name !== name ||
          published.version !== expected.version ||
          published.dist?.integrity !== expected.integrity
        )
          throw new Error(
            `Published artifact differs from tested candidate: ${name}@${expected.version}`
          );
        log(`Verified ${name}@${expected.version}`);
      })
    );
  } catch (error) {
    controller.abort(error);
    throw error;
  }
  log('Published artifact integrity matches the tested candidate.');
}

export async function verifyPublishedCandidate(directory) {
  await verifyPublication(readPublicationCandidate(directory));
}
