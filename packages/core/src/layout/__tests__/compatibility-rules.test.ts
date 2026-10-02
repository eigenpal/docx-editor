// The compatibility rule registry, as a table: which rule applies in which mode, and with which
// options. The expectations below are written out by hand, so they read as documentation and
// a change to a rule shows up as a change here.
//
// The last tests keep docs/architecture/compatibility-modes.md in sync with the registry and
// with the files that consult each rule. To regenerate the tables after a deliberate change:
//
//   UPDATE_COMPATIBILITY_DOCS=1 bun test packages/core/src/layout/__tests__/compatibility-rules.test.ts

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import {
  COMPATIBILITY_MODE_CLASSES,
  compatibilityModeClass,
  type CompatibilityModeClass,
} from '../compatibility/compatibility-mode.ts';
import {
  MODE_COMPATIBILITY_RULES,
  PROFILE_COMPATIBILITY_RULES,
  hasCompatibilityRule,
  type CompatibilityRuleName,
  type ModeCompatibilityRuleName,
  type ProfileCompatibilityRuleName,
} from '../compatibility/compatibility-rules.ts';
import { compatibilityProfileFromSettings } from '../compatibility/compatibility-profile.ts';
import {
  LEGACY_COMPAT_OPTIONS,
  WORD_COMPAT_SETTINGS,
} from '../compatibility/compatibility-settings.ts';

const MODERN = ['word2013', 'newer'] as const;
const LEGACY = ['absent', 'word2003', 'word2007', 'word2010'] as const;

/** Every mode rule and the classes it applies in. A missing rule fails typecheck. */
const MODE_MATRIX = {
  anchorOnlyParagraphSeeding: MODERN,
  anchorOnlyParagraphWrapExclusion: MODERN,
  anchorsLayOutInCell: MODERN,
  fixedTableContentEdgeOrigin: LEGACY,
  floatingTableContentOrigin: LEGACY,
  headerFooterAnchorsWrapText: MODERN,
  headerRowsKeepWithBody: MODERN,
  justifiedSpaceShrink: MODERN,
  keepNextGivesTailLines: MODERN,
  legacyPercentTableContentWidth: LEGACY,
  legacySharedGridLineSideRules: LEGACY,
  modernGridLineSideRules: MODERN,
  noteTableCellKeeps: MODERN,
  rowPageBreakYieldsToKeep: MODERN,
  tableParagraphWidowControl: MODERN,
  vMergeTextMovesPastHeadRow: MODERN,
} as const satisfies Record<ModeCompatibilityRuleName, readonly CompatibilityModeClass[]>;

/** Threaded mode values, one or more per class. */
const MODE_VALUES: readonly [number | undefined, CompatibilityModeClass][] = [
  [undefined, 'absent'],
  [11, 'word2003'],
  [12, 'word2007'],
  [13, 'unlisted'],
  [14, 'word2010'],
  [15, 'word2013'],
  [16, 'newer'],
  [17, 'newer'],
  [9999, 'newer'],
  // Values layout never threads still classify; none of them is a known mode.
  [0, 'unlisted'],
  [10, 'unlisted'],
  [-1, 'unlisted'],
  [14.5, 'unlisted'],
  [NaN, 'unlisted'],
  [15.5, 'newer'],
];

describe('mode rules', () => {
  test('every mode value maps to its class', () => {
    for (const [value, modeClass] of MODE_VALUES) {
      expect(compatibilityModeClass(value)).toBe(modeClass);
    }
  });

  for (const [rule, modes] of Object.entries(MODE_MATRIX)) {
    test(rule, () => {
      const on = new Set<CompatibilityModeClass>(modes);
      for (const [value, modeClass] of MODE_VALUES) {
        expect([value, hasCompatibilityRule(value, rule as ModeCompatibilityRuleName)]).toEqual([
          value,
          on.has(modeClass),
        ]);
      }
      expect(MODE_COMPATIBILITY_RULES[rule as ModeCompatibilityRuleName].modes).toEqual(modes);
    });
  }

  test('no rule applies in an unlisted mode', () => {
    for (const rule of Object.keys(MODE_MATRIX) as ModeCompatibilityRuleName[]) {
      expect([rule, hasCompatibilityRule(13, rule)]).toEqual([rule, false]);
    }
  });

  test('an absent mode reads as 12, and a mode above 15 reads as 15', () => {
    // Word lays out a document without a declaration as mode 12, and modes 16, 17, 99 and
    // 9999 as mode 15.
    for (const rule of Object.keys(MODE_MATRIX) as ModeCompatibilityRuleName[]) {
      expect([rule, hasCompatibilityRule(undefined, rule)]).toEqual([
        rule,
        hasCompatibilityRule(12, rule),
      ]);
      for (const newer of [16, 17, 99, 9999])
        expect([rule, newer, hasCompatibilityRule(newer, rule)]).toEqual([
          rule,
          newer,
          hasCompatibilityRule(15, rule),
        ]);
    }
  });
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const URI = 'http://schemas.microsoft.com/office/word';
const modeSetting = (value: string) =>
  `<w:compatSetting w:name="compatibilityMode" w:uri="${URI}" w:val="${value}"/>`;
const wordSetting = (name: string, value: string) =>
  `<w:compatSetting w:name="${name}" w:uri="${URI}" w:val="${value}"/>`;

function profileOf(compat: string) {
  const read = readOoxmlPart(
    `<w:settings xmlns:w="${W}"><w:compat>${compat}</w:compat></w:settings>`,
    {
      name: '/word/settings.xml',
      contentType: 'application/xml',
    }
  );
  if (!read.ok) throw new Error(read.reason);
  return compatibilityProfileFromSettings(read.part.root);
}

const MODE_DECLARATIONS: readonly [string, string][] = [
  ['absent', ''],
  ['11', modeSetting('11')],
  ['12', modeSetting('12')],
  ['13', modeSetting('13')],
  ['14', modeSetting('14')],
  ['15', modeSetting('15')],
  ['16', modeSetting('16')],
  ['refused', modeSetting('14') + modeSetting('15')],
];

/**
 * Every profile rule: the options that turn it on, and the modes (by declaration label) it
 * applies in when those options are present.
 */
const PROFILE_MATRIX: Record<
  ProfileCompatibilityRuleName,
  {
    readonly options: string;
    readonly on: readonly string[];
    readonly withoutOptions?: readonly string[];
  }
> = {
  adjustLineHeightInTable: {
    options: '<w:adjustLineHeightInTable/>',
    on: ['absent', '11', '12', '13', '14', '15', '16', 'refused'],
  },
  doNotBreakWrappedTables: {
    options: '<w:doNotBreakWrappedTables/>',
    on: ['absent', '11', '12', '13', '14', '15', '16', 'refused'],
  },
  fixedParagraphSpacing: {
    options: '<w:doNotUseHTMLParagraphAutoSpacing/>',
    on: ['absent', '11', '12', '13', '14', '15', '16', 'refused'],
  },
  ignoreIndentAsNumberingTabStop: {
    options: '<w:doNotUseIndentAsNumberingTabStop/>',
    on: ['absent', '11', '12', '13', '14', '15', '16', 'refused'],
  },
  // The mode decides when the setting is not declared; an explicit setting wins either way.
  optionalLigatures: {
    options: wordSetting('enableOpenTypeFeatures', '1'),
    on: ['absent', '11', '12', '13', '14', '15', '16', 'refused'],
    withoutOptions: ['15', '16'],
  },
  preserveExactLineBaseline: {
    options: '<w:noExtraLineSpacing/>',
    on: ['absent', '11', '12', '14'],
  },
  strictTableStyleHierarchy: {
    options: wordSetting('overrideTableStyleFontSizeAndJustification', '1'),
    on: ['absent', '11', '12', '13', '14', '15', '16', 'refused'],
  },
};

describe('profile rules', () => {
  for (const [rule, row] of Object.entries(PROFILE_MATRIX)) {
    test(rule, () => {
      const name = rule as ProfileCompatibilityRuleName;
      for (const [label, declaration] of MODE_DECLARATIONS) {
        expect([label, profileOf(declaration + row.options).has(name)]).toEqual([
          label,
          row.on.includes(label),
        ]);
        expect([label, profileOf(declaration).has(name)]).toEqual([
          label,
          (row.withoutOptions ?? []).includes(label),
        ]);
      }
    });
  }

  test('an explicit off and a duplicated OpenType setting turn ligatures off', () => {
    for (const [label, declaration] of MODE_DECLARATIONS) {
      const off = wordSetting('enableOpenTypeFeatures', '0');
      const twice = wordSetting('enableOpenTypeFeatures', '1').repeat(2);
      expect([label, profileOf(declaration + off).has('optionalLigatures')]).toEqual([
        label,
        false,
      ]);
      expect([label, profileOf(declaration + twice).has('optionalLigatures')]).toEqual([
        label,
        false,
      ]);
    }
  });

  test('a profile answers mode rules from its own mode', () => {
    for (const [label, declaration] of MODE_DECLARATIONS) {
      const profile = profileOf(declaration);
      for (const rule of Object.keys(MODE_MATRIX) as ModeCompatibilityRuleName[]) {
        expect([label, rule, profile.has(rule)]).toEqual([
          label,
          rule,
          hasCompatibilityRule(profile.modeValue, rule),
        ]);
      }
    }
  });

  test('the profile reads every cataloged option and ignores unknown names', () => {
    const legacy = Object.keys(LEGACY_COMPAT_OPTIONS).map((name) => `<w:${name}/>`);
    const settings = Object.keys(WORD_COMPAT_SETTINGS).map((name) => wordSetting(name, 'true'));
    const profile = profileOf(
      legacy.join('') + settings.join('') + '<w:__proto__/>' + wordSetting('constructor', '1')
    );
    expect(Object.keys(profile.legacy).sort()).toEqual(Object.keys(LEGACY_COMPAT_OPTIONS).sort());
    expect(Object.keys(profile.settings).sort()).toEqual(Object.keys(WORD_COMPAT_SETTINGS).sort());
    expect(Object.values(profile.legacy).every((value) => value === true)).toBe(true);
    expect(Object.values(profile.settings).every((value) => value === true)).toBe(true);
    expect(Object.hasOwn(profile.legacy, '__proto__')).toBe(false);
    expect(Object.hasOwn(profile.settings, 'constructor')).toBe(false);
  });

  test('mode declarations classify as absent, refused, known or unknown', () => {
    expect(profileOf('').mode).toEqual({ kind: 'absent' });
    expect(profileOf(modeSetting('15')).mode).toEqual({ kind: 'known', value: 15 });
    expect(profileOf(modeSetting('16')).mode).toEqual({ kind: 'unknown', value: 16 });
    expect(profileOf(modeSetting('13')).mode).toEqual({ kind: 'unknown', value: 13 });
    expect(profileOf(modeSetting('10')).mode).toEqual({ kind: 'refused', reason: 'malformed' });
    expect(profileOf(modeSetting('99999')).mode).toEqual({ kind: 'refused', reason: 'malformed' });
    expect(profileOf(modeSetting('14') + modeSetting('14')).mode).toEqual({
      kind: 'refused',
      reason: 'duplicate',
    });
    expect(profileOf(modeSetting('x')).modeValue).toBeUndefined();
    expect(profileOf(modeSetting('x')).modeClass).toBe('absent');
  });
});

// --- Registry documentation and its sync with docs/architecture/compatibility-modes.md ------

const CORE_SRC = join(import.meta.dir, '..', '..');
const REPO_ROOT = join(CORE_SRC, '..', '..', '..');
const DOC = join(REPO_ROOT, 'docs', 'architecture', 'compatibility-modes.md');
const ALL_RULES = { ...MODE_COMPATIBILITY_RULES, ...PROFILE_COMPATIBILITY_RULES };

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') sourceFiles(path, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/** The non-test files outside the compatibility module that consult each rule. */
function consultingFiles(): Map<CompatibilityRuleName, string[]> {
  const result = new Map<CompatibilityRuleName, string[]>();
  for (const rule of Object.keys(ALL_RULES) as CompatibilityRuleName[]) result.set(rule, []);
  const call = /(?:hasCompatibilityRule\(\s*[\w.?]+\s*,|\.has\()\s*'(\w+)'\s*\)/g;
  for (const file of sourceFiles(CORE_SRC).sort()) {
    const path = relative(CORE_SRC, file);
    if (path.startsWith('layout/compatibility/')) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(call)) {
      const files = result.get(match[1] as CompatibilityRuleName);
      if (files && !files.includes(path)) files.push(path);
    }
  }
  return result;
}

const code = (text: string) => `\`${text}\``;

function renderRuleTable(): string {
  const consulted = consultingFiles();
  const rows = ['| Rule | Applies when | Behavior | Source | Consulted by | Pinned by |'];
  rows.push('| --- | --- | --- | --- | --- | --- |');
  for (const [name, rule] of Object.entries(ALL_RULES).sort(([a], [b]) => a.localeCompare(b))) {
    const when =
      rule.kind === 'mode' ? `Mode is ${rule.modes.map(code).join(', ')}` : rule.condition;
    rows.push(
      `| ${code(name)} | ${when} | ${rule.behavior} | ${rule.source} | ${consulted
        .get(name as CompatibilityRuleName)!
        .map(code)
        .join(', ')} | ${rule.pinnedBy.map(code).join(', ')} |`
    );
  }
  return rows.join('\n');
}

function renderOptionTables(): string {
  const consumers = (option: string) =>
    Object.entries(PROFILE_COMPATIBILITY_RULES)
      .filter(([, rule]) => (rule.reads as readonly string[]).includes(option))
      .map(([name]) => code(name))
      .join(', ') || 'None';
  const legacy = [
    '| Option | Source | Meaning | Reading | Rules |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const [name, spec] of Object.entries(LEGACY_COMPAT_OPTIONS)) {
    legacy.push(
      `| ${code(`w:${name}`)} | ${spec.source} | ${spec.summary} | ${code(spec.repeat)}, ${code(spec.onOff)} | ${consumers(name)} |`
    );
  }
  const settings = [
    '| Setting | Source | Meaning | Reading | Rules |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const [name, spec] of Object.entries(WORD_COMPAT_SETTINGS)) {
    settings.push(
      `| ${code(name)} | ${spec.source} | ${spec.summary} | ${code(spec.repeat)}, ${code(spec.onOff)} | ${consumers(name)} |`
    );
  }
  return `### Legacy options\n\n${legacy.join('\n')}\n\n### Word compatibility settings\n\n${settings.join('\n')}`;
}

/** Table cells are compared without alignment padding, so a formatter can pad them. */
const normalize = (text: string) =>
  text
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/\s*\|\s*/g, '|')
        .replace(/-{3,}/g, '---')
    )
    .join('\n')
    .trim();

function syncSection(marker: string, rendered: string) {
  const doc = readFileSync(DOC, 'utf8');
  const start = `<!-- ${marker}:start -->`;
  const end = `<!-- ${marker}:end -->`;
  const from = doc.indexOf(start);
  const to = doc.indexOf(end);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  const current = doc.slice(from + start.length, to);
  if (process.env.UPDATE_COMPATIBILITY_DOCS === '1') {
    writeFileSync(DOC, `${doc.slice(0, from + start.length)}\n\n${rendered}\n\n${doc.slice(to)}`);
    return;
  }
  expect(normalize(current)).toBe(normalize(rendered));
}

describe('registry documentation', () => {
  test('every rule has a behavior, a source, and pinning tests that exist', () => {
    for (const [name, rule] of Object.entries(ALL_RULES)) {
      expect([name, rule.behavior.length > 0, rule.source.length > 0]).toEqual([name, true, true]);
      expect([name, rule.pinnedBy.length > 0]).toEqual([name, true]);
      for (const file of rule.pinnedBy)
        expect([name, existsSync(join(CORE_SRC, file))]).toEqual([name, true]);
    }
    for (const [name, spec] of [
      ...Object.entries(LEGACY_COMPAT_OPTIONS),
      ...Object.entries(WORD_COMPAT_SETTINGS),
    ]) {
      expect([name, spec.source.length > 0, spec.summary.length > 0]).toEqual([name, true, true]);
    }
  });

  test('every rule is consulted outside the compatibility module', () => {
    for (const [rule, files] of consultingFiles())
      expect([rule, files.length > 0]).toEqual([rule, true]);
  });

  test('every mode class is documented', () => {
    const doc = readFileSync(DOC, 'utf8');
    for (const modeClass of COMPATIBILITY_MODE_CLASSES) expect(doc).toContain(`\`${modeClass}\``);
  });

  test('the rule table matches the registry', () => {
    syncSection('compatibility-rules', renderRuleTable());
  });

  test('the option tables match the catalogs', () => {
    syncSection('compatibility-options', renderOptionTables());
  });
});
