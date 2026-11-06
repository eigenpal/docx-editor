// The license header of an EigenPal Pro License package, as a legal comment (`/*!`) at the top
// of every JavaScript file in `dist/`. Minification drops ordinary comments, so the header that
// opens each source file does not reach the build, and tsup's tree-shaking pass drops a `banner`
// from files that only re-export. So the header goes in after the build, into each file that
// lacks it. Its link names the LICENSE.md that ships in the package, not a repository path.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The legal comment for the package whose `tsup.config.ts` is `configUrl`. */
export function licenseComment(configUrl) {
  const header = readFileSync(new URL('./license-header.txt', configUrl), 'utf8').trim();
  const text = header.replace(
    /\s+—\s+see packages\/[\w-]+\/LICENSE\.md\./,
    '. See LICENSE.md in this package.'
  );
  if (text === header) throw new Error(`license-header.txt: no LICENSE.md link in ${configUrl}`);
  if (text.includes('*/')) throw new Error('A license header cannot hold a comment terminator.');
  return `/*!\n${text}\n*/\n`;
}

function scripts(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...scripts(path));
    else if (/\.(c|m)?js$/.test(name)) out.push(path);
  }
  return out;
}

/** A tsup `onSuccess` that puts the license comment at the top of every script in `dist/`. */
export function addLicenseHeaders(configUrl) {
  return async () => {
    const comment = licenseComment(configUrl);
    const first = comment.split('\n')[1];
    const dist = fileURLToPath(new URL('./dist', configUrl));
    for (const file of scripts(dist)) {
      const source = readFileSync(file, 'utf8');
      if (source.startsWith(comment)) continue;
      // A shebang must stay on the first line.
      const shebang = source.startsWith('#!') ? source.slice(0, source.indexOf('\n') + 1) : '';
      const body = shebang ? source.slice(shebang.length) : source;
      if (body.startsWith('/*!\n' + first)) continue;
      writeFileSync(file, shebang + comment + body);
    }
  };
}
