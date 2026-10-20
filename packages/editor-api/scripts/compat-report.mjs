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

function editingShape(entry, expected) {
  if (expected.kind !== 'property') return shape(entry);
  return {
    kind: 'property-write',
    writeType: entry.readonly ? null : entry.writeType,
    ...(entry.ownerTypeParameters ? { ownerTypeParameters: entry.ownerTypeParameters } : {}),
  };
}

export function createCompatibilityReport(reference, actual, notes = {}, scope) {
  if (reference.schemaVersion !== 1 || !reference.endpoints?.length)
    throw new Error('Invalid signature inventory');
  const referenceIds = new Set(reference.endpoints.map((entry) => entry.uid));
  if (referenceIds.size !== reference.endpoints.length)
    throw new Error('Duplicate reference endpoint');
  if (scope?.schemaVersion !== 1 || !scope.endpoints?.length)
    throw new Error('Missing editing scope');
  const selected = new Set(scope.endpoints);
  if (selected.size !== scope.endpoints.length) throw new Error('Duplicate editing endpoint');
  const references = new Map(reference.endpoints.map((entry) => [entry.uid, entry]));
  for (const uid of selected) {
    const entry = references.get(uid);
    if (!entry) throw new Error(`Unknown editing endpoint: ${uid}`);
    if (
      !uid.startsWith('Word.') ||
      !uid.includes('#') ||
      entry.scope !== 'api' ||
      !(entry.kind === 'method' || (entry.kind === 'property' && !entry.readonly))
    ) {
      throw new Error(`Not an editing method or property write: ${uid}`);
    }
  }
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
  const endpoints = reference.endpoints
    .filter((entry) => selected.has(entry.uid))
    .map((expected) => {
      const localUid = expected.uid.replace(/^(Word|OfficeExtension)\./, 'DocxEditor.');
      const local = byId.get(localUid);
      const expectedShape = editingShape(expected, expected);
      const actualShape = local ? editingShape(local, expected) : null;
      const matchedOverloads =
        expectedShape.overloads?.filter((overload) =>
          actualShape?.overloads?.some((candidate) => same(overload, candidate))
        ).length ?? 0;
      const status = !local ? 'missing' : same(expectedShape, actualShape) ? 'match' : 'different';
      return {
        ...expected,
        expected: expectedShape,
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
    scope: {
      description: scope.description,
      excluded: reference.endpoints.length - endpoints.length,
    },
    metric:
      'Exact editing-method signatures and property-write types; not runtime equivalence or TypeScript assignability.',
    summary: summarize(endpoints),
    groups: Object.fromEntries(
      [
        ['Editing methods', 'method'],
        ['Property writes', 'property'],
      ].map(([label, kind]) => [label, summarize(endpoints.filter((entry) => entry.kind === kind))])
    ),
    endpoints,
  };
}

/** Every module specifier in a file: static imports, re-exports and literal dynamic imports. */
function moduleSpecifiers(file) {
  const specifiers = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
        specifiers.push(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return specifiers;
}

/**
 * The checks that protect the inventory, and only those. A resolution error must never be
 * counted as missing support or as a successful `any` match, so every import in the program has
 * to resolve, and the package's own sources — whose exported signatures are what the report
 * measures — have to type-check. The core sources that the tsconfig `paths` pull in are not
 * checked here: a full semantic pass over them is most of a `tsc` run (hundreds of files, tens of
 * seconds on a loaded CI runner) for no gain, because a resolved module never becomes `any` and
 * core's own type errors are `bun run typecheck`'s gate, not this report's.
 */
function inventoryProblems(program, packageRoot) {
  const checker = program.getTypeChecker();
  const options = program.getCompilerOptions();
  const resolutionCache = ts.createModuleResolutionCache(packageRoot, (name) => name, options);
  const own = `${packageRoot.replaceAll('\\', '/')}/src/`;
  const diagnostics = [
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ];
  const unresolved = [];
  for (const file of program.getSourceFiles()) {
    if (file.fileName.includes('/node_modules/')) continue;
    diagnostics.push(...program.getSyntacticDiagnostics(file));
    for (const specifier of moduleSpecifiers(file)) {
      // A typed module or an ambient declaration gives the specifier a symbol. A dependency that
      // ships no declarations has none, but it still resolves to a file on disk; that import is
      // `any` on purpose (and says so with a suppression comment), not a resolution failure.
      if (checker.getSymbolAtLocation(specifier)) continue;
      const mode = program.getModeForUsageLocation(file, specifier);
      const found = ts.resolveModuleName(
        specifier.text,
        file.fileName,
        options,
        ts.sys,
        resolutionCache,
        undefined,
        mode
      ).resolvedModule;
      if (!found) unresolved.push(`${file.fileName}: cannot resolve module '${specifier.text}'`);
    }
    if (file.fileName.startsWith(own)) diagnostics.push(...program.getSemanticDiagnostics(file));
  }
  return { diagnostics, unresolved };
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
  const { diagnostics, unresolved } = inventoryProblems(program, packageRoot);
  if (unresolved.length) throw new Error(unresolved.join('\n'));
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
    '## Office.js document editing compatibility (informational)',
    '',
    `Reference: \`${report.upstream.name}@${report.upstream.version}\`.`,
    `Editing signature match: **${report.summary.percent}% (${report.summary.match}/${report.summary.total})**.`,
    '',
    '| Scope | Exact matches | Different | Missing | Signature match % |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...Object.entries(report.groups).map(
      ([name, summary]) =>
        `| ${name} | ${summary.match}/${summary.total} | ${summary.different} | ${summary.missing} | ${summary.percent ?? 'N/A'} |`
    ),
    '',
    report.metric,
    `Scope: ${report.scope.description ?? 'Direct document editing methods and property writes.'}`,
    'Reads, navigation, selection movement, host setup, enums, and support types are excluded. Setter checks ignore getter types.',
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

export function renderAgentSummary(report, scope) {
  if (report.summary.total !== 81)
    throw new Error('The agent editing profile must contain 81 members');
  const grouped = Object.values(scope.areas).flat();
  if (
    grouped.length !== 81 ||
    new Set(grouped).size !== 81 ||
    grouped.some((uid) => !scope.endpoints.includes(uid))
  )
    throw new Error('Every agent editing member must belong to exactly one area');
  const rows = Object.entries(scope.areas).map(([area, ids]) => {
    const entries = report.endpoints.filter((entry) => ids.includes(entry.uid));
    const present = entries.filter((entry) => entry.status !== 'missing').length;
    const exact = entries.filter((entry) => entry.status === 'match').length;
    return `| ${area} | ${present}/${entries.length} | ${exact}/${entries.length} |`;
  });
  return [
    '## Effective document-editing profile (informational)',
    '',
    `Member presence: **${report.summary.total - report.summary.missing}/81**. Exact signature match: **${report.summary.percent}% (${report.summary.match}/81)**.`,
    '',
    '| Area | Members present | Exact signatures |',
    '| --- | ---: | ---: |',
    ...rows,
    '',
    'This fixed profile covers ordinary document editing. Neither member presence nor signature equality proves runtime equivalence with Word.',
    'See agent-editing-report.md for each member’s runtime limitations, and the OpenSpec evidence and consumer-app results for tested workflows.',
    '',
  ].join('\n');
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
  const scope = readJson(path.join(root, 'compat/editing-scope.json'));
  const actual = extractActualInventory();
  const report = createCompatibilityReport(reference, actual, notes, scope);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'report.md'), renderDetails(report));
  const summary = renderSummary(report);
  fs.writeFileSync(path.join(output, 'summary.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  const agentScope = readJson(path.join(root, 'compat/agent-editing-scope.json'));
  const agentReport = createCompatibilityReport(reference, actual, notes, agentScope);
  const agentSummary = renderAgentSummary(agentReport, agentScope);
  fs.writeFileSync(
    path.join(output, 'agent-editing-report.json'),
    JSON.stringify(agentReport, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(output, 'agent-editing-report.md'),
    agentSummary + renderDetails(agentReport)
  );
  fs.writeFileSync(path.join(output, 'agent-editing-summary.md'), agentSummary);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, agentSummary);
  console.log(agentSummary);
  console.log(`Full report: ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
