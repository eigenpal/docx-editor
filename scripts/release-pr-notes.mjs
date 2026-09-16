import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function omitPrivateReleases(body, privateNames) {
  let inReleases = false;
  let omit = false;
  let fence = null;
  return body
    .split(/(?<=\n)/)
    .filter((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
        return !omit;
      }
      if (fence) return !omit;
      if (/^# Releases\s*$/.test(line)) {
        inReleases = true;
        return true;
      }
      if (/^<!-- codesmith:footer -->/.test(line) || /^# /.test(line)) {
        inReleases = false;
        omit = false;
      } else if (inReleases && /^## /.test(line)) {
        const name = /^## (\S+)@\S+\s*$/.exec(line)?.[1];
        omit = privateNames.has(name);
      }
      return !omit;
    })
    .join('');
}

export function updateReleasePr(repository, number) {
  assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/);
  assert.match(number ?? '', /^[1-9]\d*$/);
  const api = (args, input) =>
    execFileSync('gh', ['api', ...args], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      input,
    });
  const pr = JSON.parse(api([`repos/${repository}/pulls/${number}`]));
  assert.equal(pr.state, 'open');
  assert.equal(pr.base.ref, 'main');
  assert.equal(pr.head.ref, 'changeset-release/main');
  assert.equal(pr.head.repo.full_name, repository);
  const workspace = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const privateNames = new Set(
    globSync(
      workspace.workspaces.map((path) => `${path}/package.json`),
      { cwd: root }
    )
      .map((path) => JSON.parse(readFileSync(join(root, path), 'utf8')))
      .filter((manifest) => manifest.private)
      .map((manifest) => manifest.name)
  );
  const body = omitPrivateReleases(pr.body ?? '', privateNames);
  if (body !== pr.body)
    api(
      ['--method', 'PATCH', `repos/${repository}/pulls/${number}`, '--input', '-'],
      JSON.stringify({ body })
    );
  console.log(`Release PR #${number} notes contain no private-package release sections.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  updateReleasePr(process.env.GITHUB_REPOSITORY, process.env.RELEASE_PR_NUMBER);
}
