// One protocol, two hosts, one answer.
//
// The headless host and the browser host are the same host: the same operations, the same
// handle table, the same reads, the same transaction. What is genuinely different is who owns
// the document — bytes this process opened, or an editor that is already painted — and that is
// exactly the difference a consumer must not be able to observe.
//
// So this runs an IDENTICAL script of batches against both and compares the transcripts whole,
// refs included, rather than comparing a curated summary. A divergence in a field nobody
// thought to assert is the failure mode this shape exists to catch. The document is deliberately
// not two plain paragraphs: a style cascade, a table with cell paragraphs, a tab and a break,
// and section properties are where a bespoke read would drift from the canonical one.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createServerAutomationHost } from '../../automation/index.ts';
import type {
  AutomationBatchResponse,
  AutomationHandle,
  AutomationHost,
} from '../../automation/index.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { canonicalOoxmlFingerprint } from '../../store/package/ooxml-serialize.ts';
import { semanticDigest } from '../../store/package/ooxml-digest.ts';
import { createBrowserAutomationHost } from '../automation-host.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const DOCUMENT =
  `<w:document xmlns:w="${W}"><w:body>` +
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr>' +
  '<w:r><w:rPr><w:b/></w:rPr><w:t>Quarterly report</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Prepared by </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>the team</w:t></w:r></w:p>' +
  '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="4680"/><w:gridCol w:w="4680"/></w:tblGrid>' +
  '<w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>Total</w:t></w:r></w:p></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc>' +
  '<w:tc><w:p><w:r><w:t>1200</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
  '<w:p><w:r><w:t>notes</w:t><w:tab/><w:t>and</w:t><w:br/><w:t>more</w:t></w:r></w:p>' +
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
  '</w:body></w:document>';

const STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>' +
  '<w:rPr><w:sz w:val="32"/></w:rPr></w:style>' +
  '</w:styles>';

/** Representative bytes: a style cascade, a table, inline furniture, section properties. */
const REPRESENTATIVE: Uint8Array = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(DOCUMENT),
  'word/styles.xml': strToU8(STYLES),
});

function serverHost(bytes: Uint8Array = REPRESENTATIVE): AutomationHost {
  const opened = createServerAutomationHost(bytes);
  if (!opened.ok) throw new Error(`headless host did not open: ${opened.reason}`);
  return opened.host;
}

function browserHost(): { host: AutomationHost; editor: DocxEditorInstance } {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: REPRESENTATIVE });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { host: createBrowserAutomationHost(editor), editor };
}

/** The two hosts under test, plus the editor the browser one borrowed. */
function bothHosts(): {
  server: AutomationHost;
  browser: AutomationHost;
  editor: DocxEditorInstance;
} {
  const { host, editor } = browserHost();
  return { server: serverHost(), browser: host, editor };
}

/**
 * Run one function against both hosts and return the two results for comparison.
 *
 * Named so a failure reads as "the hosts disagreed", which is the only thing these tests are
 * about — every assertion below is `expect(server).toEqual(browser)` over a whole value.
 */
function onBoth<T>(
  hosts: { server: AutomationHost; browser: AutomationHost },
  run: (host: AutomationHost) => T
): { server: T; browser: T } {
  return { server: run(hosts.server), browser: run(hosts.browser) };
}

function handlesOf(host: AutomationHost): {
  document: AutomationHandle;
  body: AutomationHandle;
  paragraphs: readonly AutomationHandle[];
} {
  const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  const body = handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
  const listed = host.execute({ operations: [{ op: 'getParagraphs', body }] });
  const result = listed.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'handles') {
    throw new Error('expected paragraph handles');
  }
  return { document, body, paragraphs: result.value.handles };
}

function handleAt(response: AutomationBatchResponse, index: number): AutomationHandle {
  const result = response.results[index];
  if (result?.status !== 'ok' || result.value.kind !== 'handle') {
    throw new Error(`expected a handle at ${index}`);
  }
  return result.value.handle;
}

function textOf(host: AutomationHost, target: AutomationHandle): string {
  const response = host.execute({ operations: [{ op: 'getText', target }] });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'text') throw new Error('expected text');
  return result.value.text;
}

interface Transcript {
  readonly document: AutomationHandle;
  readonly body: AutomationHandle;
  readonly paragraphs: readonly AutomationHandle[];
  readonly bodyText: string;
  readonly paragraphTexts: readonly string[];
}

/**
 * Everything a consumer can observe about a host's document, as one comparable value.
 *
 * Refs are included on purpose: their ordinal half is minted in first-seen order per kind, so
 * two hosts asked the same questions in the same order must agree about it. Comparing
 * everything EXCEPT the identifiers is where a real divergence hides.
 */
function transcript(host: AutomationHost): Transcript & Record<string, unknown> {
  const { document, body, paragraphs } = handlesOf(host);
  return {
    capabilitiesDocument: host.capabilities.document,
    capabilitiesSave: host.capabilities.save,
    revision: host.revision(),
    document,
    body,
    paragraphs,
    bodyText: textOf(host, body),
    paragraphTexts: paragraphs.map((paragraph) => textOf(host, paragraph)),
  };
}

/**
 * The same transcript with the minting host's token collapsed to a fixed marker.
 *
 * Every ref carries a per-host random token, because a ref that is portable between hosts is a
 * ref that can address a document its holder was never given — so the two hosts CANNOT agree
 * about that half, by design. Normalized here, for comparison, and nowhere else: resolution
 * matches the whole ref exactly, which is what makes a foreign one `invalid-handle`.
 */
function withoutHostToken(value: Transcript): unknown {
  const token = value.document.ref.split(':')[1];
  if (!token || token.length < 24) throw new Error('a ref no longer carries a host token');
  return JSON.parse(JSON.stringify(value).replaceAll(token, '<host>'));
}

/** Reopen saved bytes and describe them with the repository's own fidelity oracles. */
function oracles(bytes: Uint8Array): { fingerprint: string; digest: unknown } {
  const reopened = readOoxmlPackage(bytes);
  if (!reopened.ok) throw new Error(`saved bytes did not reopen: ${reopened.reason}`);
  const main = reopened.package.parts.get(reopened.package.mainDocumentPart);
  if (!main) throw new Error('saved bytes carry no main document part');
  return {
    fingerprint: canonicalOoxmlFingerprint(main),
    digest: semanticDigest(reopened.package.parts.values()),
  };
}

function savedBytes(host: AutomationHost): Uint8Array {
  const saved = host.save();
  if (!saved.ok) throw new Error(`save failed: ${saved.error.code}`);
  return saved.bytes;
}

describe('the two hosts read the same document identically', () => {
  test('the fixture is representative enough for the comparison to mean something', () => {
    // A guard on the guard: if the document degenerated to a couple of paragraphs, every
    // comparison below would still pass and prove much less.
    const host = serverHost();
    const { paragraphs } = handlesOf(host);
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(textOf(host, paragraphs[0]!)).toBe('Quarterly report');
    expect(textOf(host, paragraphs[1]!)).toBe('Prepared by the team');
  });

  test('initial document, body and paragraph reads are equal, ref for ref', () => {
    const hosts = bothHosts();
    const { server, browser } = onBoth(hosts, transcript);
    expect(withoutHostToken(server)).toEqual(withoutHostToken(browser));
    // The normalization is not papering over an accidental equality: the raw refs differ,
    // because each host scoped its own.
    expect(server.document.ref).not.toBe(browser.document.ref);
  });

  test('reading twice is stable in both, so neither is quietly re-minting', () => {
    const hosts = bothHosts();
    const first = onBoth(hosts, transcript);
    const second = onBoth(hosts, transcript);
    expect(second.server).toEqual(first.server);
    expect(second.browser).toEqual(first.browser);
  });

  test('a read-only batch changes nothing and publishes nothing in either host', () => {
    const hosts = bothHosts();
    const observed = onBoth(hosts, (host) => {
      const { body } = handlesOf(host);
      const events: number[] = [];
      host.subscribe((event) => events.push(event.revision));
      const response = host.execute({ operations: [{ op: 'getText', target: body }] });
      return { ok: response.ok, changed: response.changed, revision: response.revision, events };
    });
    expect(observed.server).toEqual(observed.browser);
    expect(observed.server.changed).toBe(false);
    expect(observed.server.events).toEqual([]);
  });
});

describe('the same write produces the same document in both hosts', () => {
  /** One ordered batch: a cell paragraph and a body paragraph, in one transaction. */
  const write = (host: AutomationHost): AutomationBatchResponse => {
    const { paragraphs } = handlesOf(host);
    return host.execute({
      operations: [
        { op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'Draft: ' },
        { op: 'insertText', paragraph: paragraphs[2]!, offset: 0, text: '#' },
      ],
    });
  };

  test('the batch reports the same revision behaviour and the same change flag', () => {
    const hosts = bothHosts();
    const before = onBoth(hosts, (host) => host.revision());
    const responses = onBoth(hosts, write);
    const after = onBoth(hosts, (host) => host.revision());

    expect({
      ok: responses.server.ok,
      changed: responses.server.changed,
      results: responses.server.results,
    }).toEqual({
      ok: responses.browser.ok,
      changed: responses.browser.changed,
      results: responses.browser.results,
    });
    expect(responses.server.ok).toBe(true);
    // The absolute number belongs to whoever owns the document — a browser host carries a
    // remount base — so the comparable quantity is what one batch moved.
    expect(after.server - before.server).toBe(after.browser - before.browser);
    expect(after.server - before.server).toBeGreaterThan(0);
  });

  test('the reads after the write are equal, so both applied the same edit', () => {
    const hosts = bothHosts();
    onBoth(hosts, write);
    const reads = onBoth(hosts, (host) => {
      const { body, paragraphs } = handlesOf(host);
      return {
        bodyText: textOf(host, body),
        texts: paragraphs.map((paragraph) => textOf(host, paragraph)),
      };
    });
    expect(reads.server).toEqual(reads.browser);
    expect(reads.server.texts[0]).toBe('Draft: Quarterly report');
  });

  test('the saved bytes carry the same canonical fingerprint and semantic digest', () => {
    const hosts = bothHosts();
    onBoth(hosts, write);
    const saved = onBoth(hosts, savedBytes);
    const server = oracles(saved.server);
    const browser = oracles(saved.browser);
    expect(server.fingerprint).toBe(browser.fingerprint);
    expect(server.digest).toEqual(browser.digest);
  });

  test('save, reopen and save again keeps the semantic digest — in both hosts', () => {
    // The D9 round trip, run through the automation port: an edit made by script must survive
    // serialization the same way an edit made by hand does.
    const hosts = bothHosts();
    onBoth(hosts, write);
    const saved = onBoth(hosts, savedBytes);
    for (const bytes of [saved.server, saved.browser]) {
      const once = oracles(bytes);
      const again = oracles(savedBytes(serverHost(bytes)));
      expect(again.digest).toEqual(once.digest);
    }
  });
});

describe('the two hosts refuse the same things the same way', () => {
  test('a mixed batch with one invalid command writes nothing in either host', () => {
    const hosts = bothHosts();
    const outcome = onBoth(hosts, (host) => {
      const { paragraphs } = handlesOf(host);
      const events: number[] = [];
      host.subscribe((event) => events.push(event.revision));
      const revisionBefore = host.revision();
      const response = host.execute({
        operations: [
          { op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'good' },
          { op: 'insertText', paragraph: paragraphs[1]!, offset: 9_999, text: 'bad' },
        ],
      });
      return {
        ok: response.ok,
        changed: response.changed,
        results: response.results,
        movedRevision: host.revision() !== revisionBefore,
        events,
        texts: paragraphs.map((paragraph) => textOf(host, paragraph)),
      };
    });
    expect(outcome.server).toEqual(outcome.browser);
    expect(outcome.server.ok).toBe(false);
    expect(outcome.server.movedRevision).toBe(false);
    expect(outcome.server.events).toEqual([]);
    expect(outcome.server.texts[0]).toBe('Quarterly report');
  });

  test('a stale expected revision is refused identically', () => {
    const hosts = bothHosts();
    const outcome = onBoth(hosts, (host) => {
      const { paragraphs } = handlesOf(host);
      host.execute({
        operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'X' }],
      });
      const stale = host.revision() - 1;
      const response = host.execute({
        expectedRevision: stale,
        operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'Y' }],
      });
      const first = response.results[0];
      return {
        ok: response.ok,
        changed: response.changed,
        code: first?.status === 'error' ? first.error.code : first?.status,
        text: textOf(host, paragraphs[0]!),
      };
    });
    expect(outcome.server).toEqual(outcome.browser);
    expect(outcome.server.code).toBe('stale-revision');
    expect(outcome.server.text).toBe('XQuarterly report');
  });

  test("each host refuses the other's handles, in both directions", () => {
    // Comparable transcripts must not mean portable handles. Both hosts are opened on the SAME
    // bytes and asked the same questions, so the ordinal half of every ref lines up and a real
    // paragraph sits behind it — the host token is the only thing that refuses the transplant.
    const hosts = bothHosts();
    const fromBrowser = handlesOf(hosts.browser).paragraphs[0]!;
    const fromServer = handlesOf(hosts.server).paragraphs[0]!;
    const outcome = onBoth(hosts, (host) => {
      const foreign = host === hosts.server ? fromBrowser : fromServer;
      const read = host.execute({ operations: [{ op: 'getText', target: foreign }] });
      const write = host.execute({
        operations: [{ op: 'insertText', paragraph: foreign, offset: 0, text: 'INJECTED' }],
      });
      const codeOf = (response: AutomationBatchResponse): unknown => {
        const first = response.results[0];
        return first?.status === 'error' ? first.error.code : first?.status;
      };
      return {
        readOk: read.ok,
        readCode: codeOf(read),
        writeOk: write.ok,
        writeChanged: write.changed,
        writeCode: codeOf(write),
        ownText: textOf(host, handlesOf(host).paragraphs[0]!),
      };
    });

    expect(outcome.server).toEqual(outcome.browser);
    expect(outcome.server).toEqual({
      readOk: false,
      readCode: 'invalid-handle',
      writeOk: false,
      writeChanged: false,
      writeCode: 'invalid-handle',
      ownText: 'Quarterly report',
    });
  });

  test('dispose is idempotent in both, and later operations fail with the same code', () => {
    const hosts = bothHosts();
    const outcome = onBoth(hosts, (host) => {
      const { body } = handlesOf(host);
      host.dispose();
      host.dispose();
      const response = host.execute({ operations: [{ op: 'getText', target: body }] });
      const first = response.results[0];
      const saved = host.save();
      return {
        ok: response.ok,
        code: first?.status === 'error' ? first.error.code : first?.status,
        saveOk: saved.ok,
        saveCode: saved.ok ? null : saved.error.code,
      };
    });
    expect(outcome.server).toEqual(outcome.browser);
    expect(outcome.server).toEqual({
      ok: false,
      code: 'disposed',
      saveOk: false,
      saveCode: 'disposed',
    });
    // And the editor the browser host borrowed is still alive, because dispose released a
    // lens and not a document.
    expect(hosts.editor.surface).not.toBeNull();
  });
});
