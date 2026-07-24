// Versioned geometry-fixture catalog (interactive-paginated-editing 3.1).
// Each class appears exactly once with declarative input, capability reason, and expected semantics.

export const GEOMETRY_FIXTURE_VERSION = 1 as const;

export const GEOMETRY_FIXTURE_CLASSES = [
  'emptyParagraph',
  'trailingParagraph',
  'tabs',
  'whitespace',
  'combiningCharacters',
  'surrogatePairs',
  'ligatures',
  'rtlBidi',
  'verticalMovement',
  'pageBoundary',
  'transformedItem',
  'tableCell',
  'atomicImage',
  'readOnlyContent',
] as const;

export type GeometryFixtureClass = (typeof GEOMETRY_FIXTURE_CLASSES)[number];

export type GeometryFixtureCapability = 'supported' | 'readOnly' | 'unsupported';

export interface GeometryFixtureParagraphInput {
  readonly text?: string;
  readonly runs?: readonly string[];
  readonly empty?: boolean;
}

export interface GeometryFixtureInput {
  readonly paragraphs?: readonly GeometryFixtureParagraphInput[];
  readonly leadingEmptyParagraphs?: number;
  readonly trailingEmptyParagraphs?: number;
  readonly tableCellParagraph?: string;
  readonly structuralTableOnly?: boolean;
  readonly atomicImagePlaceholder?: boolean;
  readonly paginate?: { readonly wordCount: number; readonly narrowPageWidth?: number };
}

export interface GeometryFixtureExpectedSemantic {
  readonly classificationOnly?: boolean;
  readonly hasEditableCaretStops?: boolean;
  readonly blockCount?: number;
  readonly emptyBlockCount?: number;
  readonly graphemeCounts?: readonly number[];
  readonly trailingGraphemeOffset?: number;
  readonly trailingAffinity?: InteractionAffinityRef;
  readonly oneClusterPerGrapheme?: boolean;
  readonly fullUtf16Span?: boolean;
  readonly noInternalCaretStop?: boolean;
  readonly stableIdentityAcrossSplits?: boolean;
  readonly whitespaceSubrangeCount?: number;
  readonly paragraphOwnershipCount?: number;
  readonly readOnlyBlockCount?: number;
  readonly structuralOwnership?: boolean;
}

/** Local alias so fixture data stays PM-free without importing interaction types. */
export type InteractionAffinityRef = 'upstream' | 'downstream';

export interface GeometryFixtureCase {
  readonly id: string;
  readonly version: typeof GEOMETRY_FIXTURE_VERSION;
  readonly class: GeometryFixtureClass;
  readonly capability: GeometryFixtureCapability;
  readonly reason: string;
  readonly input: GeometryFixtureInput;
  readonly expected?: GeometryFixtureExpectedSemantic;
}

export const GEOMETRY_FIXTURES: readonly GeometryFixtureCase[] = [
  {
    id: 'empty-paragraph',
    version: GEOMETRY_FIXTURE_VERSION,
    class: 'emptyParagraph',
    capability: 'supported',
    reason: 'Body empty paragraphs retain identity and an editable caret stop without painted text.',
    input: { paragraphs: [{ empty: true }, { text: 'middle' }] },
    expected: {
      blockCount: 2,
      emptyBlockCount: 1,
      hasEditableCaretStops: true,
      paragraphOwnershipCount: 2,
      graphemeCounts: [0, 6],
    },
  },
  {
    id: 'trailing-paragraph',
    version: GEOMETRY_FIXTURE_VERSION,
    class: 'trailingParagraph',
    capability: 'supported',
    reason: 'Trailing caret after the last grapheme uses downstream affinity at graphemeCount.',
    input: { paragraphs: [{ text: 'abc' }] },
    expected: {
      blockCount: 1,
      hasEditableCaretStops: true,
      trailingGraphemeOffset: 3,
      trailingAffinity: 'downstream',
      paragraphOwnershipCount: 1,
      graphemeCounts: [3],
    },
  },
  {
    id: 'tabs',
    version: GEOMETRY_FIXTURE_VERSION,
    class: 'tabs',
    capability: 'unsupported',
    reason: 'Tab-stop geometry and tab-owned whitespace shaping are not implemented in layout yet.',
    input: { paragraphs: [{ text: 'before\tafter' }] },
  },
  {
    id: 'whitespace-only',
    version: GEOMETRY_FIXTURE_VERSION,
    class: 'whitespace',
    capability: 'supported',
    reason: 'Whitespace-only body paragraphs retain semantic order and explicit whitespace ownership.',
    input: { paragraphs: [{ empty: true }, { text: '   ' }, { text: 'word' }] },
    expected: {
      blockCount: 3,
      emptyBlockCount: 1,
      whitespaceSubrangeCount: 1,
      paragraphOwnershipCount: 3,
      hasEditableCaretStops: true,
    },
  },
  {
    id: 'combining-e-acute',
    version: GEOMETRY_FIXTURE_VERSION,
    class: 'combiningCharacters',
    capability: 'supported',
    reason: 'Combining marks form one grapheme cluster with no internal caret stop.',
    input: { paragraphs: [{ text: 'e\u0301' }] },
    expected: {
      graphemeCounts: [1],
      noInternalCaretStop: true,
      hasEditableCaretStops: true,
    },
  },
  {
    id: 'surrogate-emoji',
    version: GEOMETRY_FIXTURE_VERSION,
    class: 'surrogatePairs',
    capability: 'supported',
    reason: 'UTF-16 surrogate pairs map to one grapheme cluster; geometry-trusted caret edges exclude unsupported advances.',
    input: { paragraphs: [{ text: '😀' }] },
    expected: {
      graphemeCounts: [1],
      noInternalCaretStop: true,
      hasEditableCaretStops: true,
    },
  },
  {
    id: 'ligature-fi',
    version: GEOMETRY_FIXTURE_VERSION,
    class: 'ligatures',
    capability: 'unsupported',
    reason: 'True ligature shaping fidelity is deferred to task group 8; one-cluster-per-grapheme is approximate only.',
    input: { paragraphs: [{ text: 'fi' }] },
  },
  {
    id: 'rtl-bidi-run',
    version: GEOMETRY_FIXTURE_VERSION,
    class: 'rtlBidi',
    capability: 'unsupported',
    reason: 'Full bidi cluster affinity and visual reordering are deferred to task group 8.',
    input: { paragraphs: [{ text: '\u05d0\u05d1' }] },
  },
  {
    id: 'vertical-movement',
    version: GEOMETRY_FIXTURE_VERSION,
    class: 'verticalMovement',
    capability: 'unsupported',
    reason: 'Vertical keyboard navigation with retained visual advance is validated by focused task 5.5 tests, not this fixture gate.',
    input: { paragraphs: [{ text: 'line one' }, { text: 'line two' }] },
  },
  {
    id: 'page-boundary',
    version: GEOMETRY_FIXTURE_VERSION,
    class: 'pageBoundary',
    capability: 'supported',
    reason: 'Semantic identity and contiguous UTF-16/grapheme ranges survive pagination splits.',
    input: { paginate: { wordCount: 30, narrowPageWidth: 4000 } },
    expected: {
      stableIdentityAcrossSplits: true,
      hasEditableCaretStops: true,
    },
  },
  {
    id: 'transformed-item',
    version: GEOMETRY_FIXTURE_VERSION,
    class: 'transformedItem',
    capability: 'unsupported',
    reason: 'Invertible item transforms and coordinate conversion land in task 3.5.',
    input: { paragraphs: [{ text: 'rotated' }] },
  },
  {
    id: 'table-cell-text',
    version: GEOMETRY_FIXTURE_VERSION,
    class: 'tableCell',
    capability: 'readOnly',
    reason: 'Table-cell paragraphs are selectable/read-only in the body-paragraph lane until the table interaction lane proves editing.',
    input: { tableCellParagraph: 'cell text' },
    expected: {
      hasEditableCaretStops: false,
      readOnlyBlockCount: 1,
      paragraphOwnershipCount: 1,
      graphemeCounts: [9],
    },
  },
  {
    id: 'atomic-image',
    version: GEOMETRY_FIXTURE_VERSION,
    class: 'atomicImage',
    capability: 'readOnly',
    reason: 'Atomic images are classified read-only until the image interaction lane lands.',
    input: { atomicImagePlaceholder: true },
    expected: {
      hasEditableCaretStops: false,
      classificationOnly: true,
    },
  },
  {
    id: 'read-only-structural',
    version: GEOMETRY_FIXTURE_VERSION,
    class: 'readOnlyContent',
    capability: 'readOnly',
    reason: 'Structural table boundaries expose selectable ownership without editable body caret stops in nested cells.',
    input: { structuralTableOnly: true, tableCellParagraph: 'locked' },
    expected: {
      hasEditableCaretStops: false,
      structuralOwnership: true,
      readOnlyBlockCount: 1,
      paragraphOwnershipCount: 1,
    },
  },
] as const;

export function validateGeometryFixtureCatalog(
  fixtures: readonly GeometryFixtureCase[] = GEOMETRY_FIXTURES,
): void {
  if (fixtures.length !== GEOMETRY_FIXTURE_CLASSES.length) {
    throw new Error(`geometry fixtures: expected ${GEOMETRY_FIXTURE_CLASSES.length} cases, got ${fixtures.length}`);
  }
  const ids = new Set<string>();
  const classes = new Set<string>();
  for (const fixture of fixtures) {
    if (fixture.version !== GEOMETRY_FIXTURE_VERSION) {
      throw new Error(`geometry fixtures: ${fixture.id} has version ${fixture.version}`);
    }
    if (ids.has(fixture.id)) throw new Error(`geometry fixtures: duplicate id ${fixture.id}`);
    ids.add(fixture.id);
    if (classes.has(fixture.class)) throw new Error(`geometry fixtures: duplicate class ${fixture.class}`);
    classes.add(fixture.class);
    if (!fixture.reason.trim()) throw new Error(`geometry fixtures: ${fixture.id} missing reason`);
    if (!fixture.input || Object.keys(fixture.input).length === 0) {
      throw new Error(`geometry fixtures: ${fixture.id} missing declarative input`);
    }
    if (fixture.capability === 'supported' || fixture.capability === 'readOnly') {
      if (!fixture.expected) throw new Error(`geometry fixtures: ${fixture.id} missing expected semantics`);
    }
    if (fixture.capability === 'unsupported' && fixture.expected) {
      throw new Error(`geometry fixtures: ${fixture.id} must not declare expected semantics when unsupported`);
    }
  }
  for (const cls of GEOMETRY_FIXTURE_CLASSES) {
    if (!classes.has(cls)) throw new Error(`geometry fixtures: missing class ${cls}`);
  }
}

export function fixtureByClass(className: GeometryFixtureClass): GeometryFixtureCase {
  const found = GEOMETRY_FIXTURES.find((f) => f.class === className);
  if (!found) throw new Error(`missing geometry fixture for class ${className}`);
  return found;
}

export function unsupportedFixtureCases(): readonly GeometryFixtureCase[] {
  return GEOMETRY_FIXTURES.filter((f) => f.capability === 'unsupported');
}
