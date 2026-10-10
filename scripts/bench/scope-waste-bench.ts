// Wasted layout work per editing scope.
//
// The other benchmark in this directory measures how MUCH one layout pass costs. This one
// measures how many passes the engine throws away, which is a different failure and one
// that timing alone hides: a discarded pass is paid for in full and then repeated, so the
// document is laid out twice per keystroke while every wall-clock median still looks
// ordinary on a small fixture.
//
// It exists because that waste is also a correctness signal. A pass discarded as stale
// leaves the painted DOM one revision behind the model, so the post-edit caret cannot be
// written into the nodes that are on screen and the next repaint reads the pre-edit caret
// back — the cursor jumps to the start of the story (issue #361). The counter reproduced
// that bug exactly: five keystrokes in a header cost five discarded passes and zero in the
// body, because a header part counts its own revisions and the scheduler validated them
// against the package's.
//
// So every scenario types into a DIFFERENT story. A body-only benchmark cannot see any of
// this: the body's revision and the package's coincide until a non-body edit or a
// package-level op moves one without the other.
//
// Usage:
//   bun scripts/bench/scope-waste-bench.ts [--keystrokes 5] [--json]

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

// The engine's own zip writer, not `fflate` directly: `fflate` is a dependency of
// `packages/core`, and a script in this directory resolves against the ROOT package, where
// it is not declared. Importing it here ran fine locally on a hoisted install and failed on
// CI with "Cannot find package 'fflate'".
import { strToU8, writeZip } from '../../packages/core/src/store/package/zip.ts';
import { paragraphTextOf } from '../../packages/core/src/store/index.ts';
import { mountPaginatedSurface } from '../../packages/core/src/editor/paginated-surface.ts';
import type { PaginatedSurface } from '../../packages/core/src/editor/paginated-surface-contract.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const TABLE =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
  `<w:tr><w:tc>${p('A1')}</w:tc><w:tc>${p('B1')}</w:tc></w:tr>` +
  `<w:tr><w:tc>${p('A2')}</w:tc><w:tc>${p('B2')}</w:tc></w:tr></w:tbl>`;

/** A document carrying every story the scenarios type into, so nothing is created mid-run. */
function fixture(): Uint8Array {
  const story = (kind: 'header' | 'footer', name: string, text: string): [string, Uint8Array] => {
    const root = kind === 'header' ? 'hdr' : 'ftr';
    return [`/word/${name}`, strToU8(`<w:${root} xmlns:w="${W}">${p(text)}</w:${root}>`)];
  };
  const contentTypes =
    `<Types xmlns="${CT}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
    '</Types>';
  const documentXml =
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
    p('body one') +
    p('body two') +
    TABLE +
    '<w:sectPr>' +
    '<w:headerReference w:type="default" r:id="rId10"/>' +
    '<w:footerReference w:type="default" r:id="rId11"/>' +
    '</w:sectPr></w:body></w:document>';
  // Canonical part names carry a leading slash; `writeZip` validates them through the OPC
  // profile and strips it for the zip entry.
  return writeZip(
    new Map<string, Uint8Array>([
      ['/[Content_Types].xml', strToU8(contentTypes)],
      [
        '/_rels/.rels',
        strToU8(
          `<Relationships xmlns="${REL}">` +
            `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
            '</Relationships>'
        ),
      ],
      [
        '/word/_rels/document.xml.rels',
        strToU8(
          `<Relationships xmlns="${REL}">` +
            `<Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/>` +
            `<Relationship Id="rId11" Type="${R}/footer" Target="footer1.xml"/>` +
            '</Relationships>'
        ),
      ],
      story('header', 'header1.xml', 'HDR'),
      story('footer', 'footer1.xml', 'FTR'),
      ['/word/document.xml', strToU8(documentXml)],
    ])
  );
}

export interface ScopeWasteScenario {
  readonly name: string;
  /** Keystrokes typed into the scope. */
  readonly keystrokes: number;
  /** Layout passes computed and thrown away because the model had already moved on. */
  readonly staleDiscards: number;
  /** Cooperative runs abandoned mid-flight for a newer revision. */
  readonly cancelledRuns: number;
}

export interface ScopeWasteReport {
  readonly schema: 1;
  readonly scenarios: readonly ScopeWasteScenario[];
}

function mount(): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, fixture(), { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

/** Type into whatever scope `open` left active, and count the passes thrown away. */
function measure(
  name: string,
  keystrokes: number,
  open: (surface: PaginatedSurface) => void
): ScopeWasteScenario {
  const { surface, container } = mount();
  try {
    open(surface);
    // AFTER opening: entering a story and any lifecycle op are their own commits, and this
    // measures typing.
    const before = surface.state().perf;
    for (let index = 0; index < keystrokes; index += 1) surface.type('x');
    const after = surface.state().perf;
    return {
      name,
      keystrokes,
      staleDiscards: after.staleDiscards - before.staleDiscards,
      cancelledRuns: after.cancelledRuns - before.cancelledRuns,
    };
  } finally {
    surface.destroy();
    container.remove();
  }
}

function caretAtParagraph(surface: PaginatedSurface, paragraphId: string): void {
  surface.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 0 },
  });
}

/** Paragraph ids the fixture guarantees, in body document order. */
function bodyParagraphs(surface: PaginatedSurface): readonly string[] {
  return surface.session.paragraphIds();
}

/** The one paragraph carrying this text, so a scenario names its target rather than an index. */
function paragraphWithText(surface: PaginatedSurface, text: string): string {
  const part = surface.session.part();
  for (const id of bodyParagraphs(surface)) {
    if (paragraphTextOf(part, id) === text) return id;
  }
  throw new Error(`the fixture has no paragraph reading ${text}`);
}

/** Add a first-page header part. One package-level op; returns the new relationship id. */
function createFirstPageHeader(surface: PaginatedSurface): string {
  const created = surface.applyHeaderFooterLifecycle?.({
    op: 'createHeaderFooter',
    sectionIndex: 0,
    kind: 'header',
    variant: 'first',
  });
  if (!created?.ok) throw new Error(`create refused: ${created?.reason ?? 'unavailable'}`);
  const slot = surface.session.headerFooterResolutionBySection()[0]?.headers.get('first');
  if (!slot) throw new Error('the created header did not resolve');
  return slot.rId;
}

export function runScopeWasteBench(keystrokes: number): ScopeWasteReport {
  const scenarios: ScopeWasteScenario[] = [
    measure('body-paragraph', keystrokes, (surface) => {
      caretAtParagraph(surface, paragraphWithText(surface, 'body one'));
    }),
    measure('table-cell', keystrokes, (surface) => {
      caretAtParagraph(surface, paragraphWithText(surface, 'A1'));
    }),
    measure('declared-header', keystrokes, (surface) => {
      if (!surface.enterHeaderFooter({ rId: 'rId10' })) throw new Error('header did not open');
    }),
    measure('declared-footer', keystrokes, (surface) => {
      if (!surface.enterHeaderFooter({ rId: 'rId11' })) throw new Error('footer did not open');
    }),
    measure('declared-header-after-package-op', keystrokes, (surface) => {
      // A part declared in the FILE starts level with the package, so the two scenarios
      // above pass even while the engine is confusing the counters. Any package-level op
      // moves the package revision without touching a story's, and from then on the
      // pre-existing header trails too — which is what a session that has been open for a
      // while actually looks like.
      createFirstPageHeader(surface);
      if (!surface.enterHeaderFooter({ rId: 'rId10' })) throw new Error('header did not open');
    }),
    measure('created-header', keystrokes, (surface) => {
      // The sharpest case, and the one issue #361 was reported against: a part created in
      // this session starts its own revision counter at zero, so it trails the package's by
      // the whole lifecycle op.
      const rId = createFirstPageHeader(surface);
      if (!surface.enterHeaderFooter({ rId })) throw new Error('header did not open');
    }),
    measure('footnote', keystrokes, (surface) => {
      caretAtParagraph(surface, paragraphWithText(surface, 'body one'));
      if (!surface.insertNote('footnote')) throw new Error('footnote was refused');
      // Inserting a note opens its story, which is the third revision space: the notes part
      // has its own counter too.
      if (surface.activeScope().kind !== 'note') throw new Error('footnote did not open');
    }),
  ];
  return { schema: 1, scenarios };
}

function parseKeystrokes(argv: readonly string[]): number {
  const index = argv.indexOf('--keystrokes');
  if (index < 0) return 5;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error('--keystrokes needs a positive integer');
  return value;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const report = runScopeWasteBench(parseKeystrokes(argv));
  if (argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('wasted layout passes per editing scope (lower is better; 0 is the contract)\n');
    for (const scenario of report.scenarios) {
      console.log(
        `  ${scenario.name.padEnd(18)} ${scenario.keystrokes} keystrokes` +
          ` → ${scenario.staleDiscards} discarded, ${scenario.cancelledRuns} cancelled`
      );
    }
  }
}
