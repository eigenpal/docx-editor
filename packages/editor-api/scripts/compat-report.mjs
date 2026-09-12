#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { isDeepStrictEqual } from 'node:util';
import { inventoryModule } from './lib/signature-inventory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const shape = ({ uid, scope, requirementSet, ...value }) => value;
const same = isDeepStrictEqual;

export function createCompatibilityReport(reference, actual, notes = {}) {
  if (reference.schemaVersion !== 1 || !reference.endpoints?.length)
    throw new Error('Invalid signature inventory');
  const referenceIds = new Set(reference.endpoints.map((entry) => entry.uid));
  if (referenceIds.size !== reference.endpoints.length)
    throw new Error('Duplicate reference endpoint');
  for (const [uid, note] of Object.entries(notes)) {
    if (!referenceIds.has(uid)) throw new Error(`Unknown runtime note endpoint: ${uid}`);
    if (
      !['equivalent', 'partial', 'different', 'unsupported', 'unverified'].includes(note.status) ||
      typeof note.notes !== 'string' ||
      !note.notes.trim()
    )
      throw new Error(`Invalid runtime note: ${uid}`);
  }
  const byId = new Map(actual.map((entry) => [entry.uid, entry]));
  const endpoints = reference.endpoints.map((expected) => {
    const localUid = expected.uid.replace(/^(Word|OfficeExtension)\./, 'DocxEditor.');
    const local = byId.get(localUid);
    const expectedShape = shape(expected);
    const actualShape = local ? shape(local) : null;
    const matchedOverloads =
      expectedShape.overloads?.filter((overload) =>
        actualShape?.overloads?.some((candidate) => same(overload, candidate))
      ).length ?? 0;
    const status = !local ? 'missing' : same(expectedShape, actualShape) ? 'match' : 'different';
    return {
      ...expected,
      status,
      actual: actualShape,
      matchedOverloads,
      runtime: notes[expected.uid] ?? {
        status: 'unverified',
        notes: 'Runtime behavior has not been reviewed.',
      },
    };
  });
  function summarize(entries) {
    const count = (status) => entries.filter((entry) => entry.status === status).length;
    const total = entries.length;
    return {
      total,
      match: count('match'),
      different: count('different'),
      missing: count('missing'),
      percent: total ? Number(((100 * count('match')) / total).toFixed(2)) : null,
    };
  }
  return {
    schemaVersion: 1,
    upstream: reference.upstream,
    metric:
      'Exact normalized signature shapes; not runtime equivalence or TypeScript assignability.',
    summary: summarize(endpoints),
    groups: Object.fromEntries(
      ['Word', 'OfficeExtension'].flatMap((namespace) =>
        ['api', 'supporting-types'].map((scope) => [
          `${namespace}/${scope}`,
          summarize(
            endpoints.filter(
              (entry) => entry.uid.startsWith(`${namespace}.`) && entry.scope === scope
            )
          ),
        ])
      )
    ),
    endpoints,
  };
}

export function extractActualInventory(packageRoot = root) {
  const configPath = path.join(packageRoot, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot);
  if (parsed.errors.length) throw new Error('Cannot parse editor-api tsconfig');
  const entry = path.join(packageRoot, 'src/index.ts');
  const program = ts.createProgram([entry], parsed.options);
  // Resolution errors must never be counted as missing support or successful `any` matches.
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => packageRoot,
        getNewLine: () => '\n',
      })
    );
  const checker = program.getTypeChecker();
  return inventoryModule(
    checker,
    checker.getSymbolAtLocation(program.getSourceFile(entry)),
    'DocxEditor'
  );
}

export function renderSummary(report) {
  const lines = [
    '## Office.js signature compatibility (informational)',
    '',
    `Reference: \`${report.upstream.name}@${report.upstream.version}\`.`,
    '',
    '| Scope | Exact matches | Different | Missing | Signature match % |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...Object.entries(report.groups).map(
      ([name, summary]) =>
        `| ${name} | ${summary.match}/${summary.total} | ${summary.different} | ${summary.missing} | ${summary.percent ?? 'N/A'} |`
    ),
    '',
    report.metric,
    'The inventory covers Word and OfficeExtension, including nested support types. Other Office hosts are outside this report.',
    'Each method counts once; all overloads must match. Runtime notes do not change the signature percentage.',
    'Download the office-js-compatibility artifact for every endpoint, expected/actual signatures, and runtime notes.',
    '',
  ];
  return lines.join('\n');
}

export function renderDetails(report) {
  const escape = (value) => String(value).replace(/\|/g, '&#124;').replace(/\n/g, ' ');
  return (
    renderSummary(report) +
    '\n| Endpoint | Signature | Runtime | Notes |\n| --- | --- | --- | --- |\n' +
    report.endpoints
      .map(
        (entry) =>
          `| ${escape(entry.uid)} | ${entry.status} | ${entry.runtime.status} | ${escape(entry.runtime.notes)} |`
      )
      .join('\n') +
    '\n'
  );
}

async function main() {
  const args = process.argv.slice(2);
  let output = path.join(root, 'compat/reports');
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--output')
      throw new Error('Usage: compat:report [--output directory]');
    output = path.resolve(args[1]);
  }
  const reference = readJson(path.join(root, 'compat/reference/word.full-inventory.json'));
  const notes = readJson(path.join(root, 'compat/runtime-notes.json'));
  const report = createCompatibilityReport(reference, extractActualInventory(), notes);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'report.md'), renderDetails(report));
  const summary = renderSummary(report);
  fs.writeFileSync(path.join(output, 'summary.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  console.log(`Full report: ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
