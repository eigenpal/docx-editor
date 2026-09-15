import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { option, ROOT } from './common.mjs';
import { capture, updateTable, verifyCatalog } from './catalog.mjs';
import { check } from './policy.mjs';
import { createChange } from './change.mjs';
import { packCandidate, verifyCandidate, verifyPublishedCandidate } from './installation.mjs';
try {
  switch (process.argv[2]) {
    case 'pack': {
      const packed = packCandidate();
      const target = resolve(ROOT, '.cache/collaboration/publish');
      rmSync(target, { recursive: true, force: true });
      mkdirSync(target, { recursive: true });
      for (const file of readdirSync(packed))
        if (file.endsWith('.json') || file.endsWith('.tgz'))
          cpSync(resolve(packed, file), resolve(target, file));
      console.log(`Candidate packed in ${target}`);
      break;
    }
    case 'change':
      await createChange();
      break;
    case 'check':
      check(option('base', 'origin/main'), process.argv.includes('--release'));
      break;
    case 'catalog':
      if (option('capture')) await capture(option('capture'));
      else if (process.argv.includes('--table')) updateTable();
      else await verifyCatalog({ allowCurrent: process.argv.includes('--allow-current') });
      break;
    case 'verify-published':
      await verifyPublishedCandidate(option('candidate'));
      break;
    case 'verify':
      verifyCandidate(option('candidate'), { publication: true });
      break;
    default:
      throw new Error('Use change, check, catalog, or verify');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
