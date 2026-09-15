const changeFlags = [
  'id',
  'impact',
  'before',
  'after',
  'reason',
  'tests',
  'fields',
  'migration',
  'summary',
];
export const COMMAND_FLAGS = {
  change: Object.fromEntries(changeFlags.map((name) => [name, 'value'])),
  check: { base: 'value', release: 'boolean' },
  catalog: { capture: 'value', table: 'boolean', 'allow-current': 'boolean' },
  pack: {},
  verify: { candidate: 'value' },
  'verify-published': { candidate: 'value' },
};
export const CLI_HELP = `Collaboration compatibility tools

Usage: bun run collaboration:<command> [options]

  change   Record a compatibility decision (interactive without flags).
           --id --impact --before --after --reason --tests
           Optional: --fields --migration --summary
           Separate multiple test paths or fields with commas.
  check    Check decisions. Optional: --base REF or --release.
  catalog  Verify the catalog. Use --capture VERSION to record a release,
           --table to update the guide, or --allow-current during a publish retry.

Package commands: node scripts/collaboration/cli.mjs <command>
  pack                    Prepare .cache/collaboration/publish.
  verify --candidate DIR  Verify the final publication payload.
  verify-published --candidate DIR  Compare published npm integrity.

Use bun run collaboration:test --help for the package matrix.
Guide: docs/architecture/collaboration-compatibility.md`;
export const TEST_HELP = `Test published collaboration packages

Usage: bun run collaboration:test --all | --release VERSION [options]

  --all                  Check every cataloged release and catalog completeness.
  --release VERSION      Check one cataloged stable release (for development).
  --seed INTEGER         Reproduce one deterministic sequence.
  --shard INDEX/TOTAL     Run one partition of the matrix (default: 1/1).
  --candidate DIR        Test an existing packed candidate instead of packing.
  --candidate-output FILE Write the candidate path as JSON after success.
  --allow-current        Allow this package version to await capture on publish retry.
                         Requires --all; other missing releases still fail.
  --help                 Show this help without building or installing packages.

Before testing: bun run build:packages && bun run notices:generate
Reports: .cache/collaboration/report-*.json and failure.json
Guide: docs/architecture/collaboration-compatibility.md`;

export function parseOptions(args, flags) {
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    const name = token.startsWith('--') ? token.slice(2) : '';
    const kind = name === 'help' ? 'boolean' : Object.hasOwn(flags, name) ? flags[name] : undefined;
    if (!kind) throw new Error(`Unknown argument: ${token}. Use --help for supported options.`);
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate option: --${name}`);
    if (kind === 'boolean') values[name] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`);
      values[name] = value;
    }
  }
  return values;
}
export function testOptions(args) {
  const values = parseOptions(args, {
    all: 'boolean',
    release: 'value',
    seed: 'value',
    shard: 'value',
    candidate: 'value',
    'candidate-output': 'value',
    'allow-current': 'boolean',
  });
  if (values.help) return values;
  if (Boolean(values.all) === Boolean(values.release))
    throw new Error('Select exactly one of --all or --release VERSION');
  if (values.release && !/^\d+\.\d+\.\d+$/.test(values.release))
    throw new Error('--release needs a stable version, for example 2.18.0');
  if (values['allow-current'] && !values.all) throw new Error('--allow-current requires --all');
  const shard = /^(\d+)\/(\d+)$/.exec(values.shard ?? '1/1');
  const index = Number(shard?.[1]),
    count = Number(shard?.[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 1 || index > count)
    throw new Error('--shard needs INDEX/TOTAL with 1 <= INDEX <= TOTAL');
  if (
    values.seed !== undefined &&
    (!/^-?\d+$/.test(values.seed) || !Number.isSafeInteger(Number(values.seed)))
  )
    throw new Error('--seed needs a safe integer');
  return values;
}
