import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { option, ROOT } from './common.mjs';
import { capture, updateTable, verifyCatalog } from './catalog.mjs';
import { check } from './policy.mjs';
import { createChange } from './change.mjs';
import { packCandidate, verifyCandidate, verifyPublishedCandidate } from './installation.mjs';
import { CLI_HELP, COMMAND_FLAGS, parseOptions } from './arguments.mjs';
try {
  const command = process.argv[2];
  if (!command || command === '--help') {
    console.log(CLI_HELP);
    process.exit(0);
  }
  if (!Object.hasOwn(COMMAND_FLAGS, command))
    throw new Error(`Unknown command: ${command}. Use --help for supported commands.`);
  const args = parseOptions(process.argv.slice(3), COMMAND_FLAGS[command]);
  if (args.help) {
    console.log(CLI_HELP);
    process.exit(0);
  }
  if (command === 'check' && args.base && args.release)
    throw new Error('Select --base or --release, not both');
  if (
    command === 'catalog' &&
    [args.capture, args.table, args['allow-current']].filter(Boolean).length > 1
  )
    throw new Error('Select one catalog mode: --capture, --table, or --allow-current');
  if (command.startsWith('verify') && !args.candidate)
    throw new Error('--candidate DIR is required');
  switch (command) {
    case 'pack': {
      const packed = await packCandidate();
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
